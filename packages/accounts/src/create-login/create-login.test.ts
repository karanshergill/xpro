import { env } from "cloudflare:workers";
import { createHubConnection, createRequestContext, saveHub } from "@xpro/core/server";
import { CompiledQuery, sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCreationFixture, creationInput, type CreationFixture, type CreationInput, type WorkspaceUsers } from "#test/create-login";
import { interruptAfterWrite } from "#test/creation-faults.db";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { readPlacements, route, routingServices } from "#test/routing";
import { hubRequest, prepareDestination, readCookies, readHubState, readWorkspaceState, removeMembership, withWorkspace } from "#test/sign-in";
import type { SignedInLogin } from "#test/hub-identities";
import { completedCreationQuery, completionQueries } from "./complete-creation.db";
import { prepareLoginCreation } from "./create-login.db";

let fixture: CreationFixture;
beforeEach(async () => { fixture = await createCreationFixture(); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe("Story 6 — create a login for someone else", () => {
  it("when a master creates a login with valid details then an active non-master login is created without an Account or workspace", async () => {
    const creator = await fixture.actor("master");
    const input = creationInput();
    const before = await snapshot();
    const response = await fixture.submit(input, { creator });
    const loginId = await expectComplete(response, { input, creator, before });
    const signedIn = await signInCreated(input, loginId);
    const destination = await route(new Request("https://hub.example.test/auth/destination", {
      headers: { cookie: signedIn.cookie },
    }), routingServices(fixture.signIn, [fixture.workspace]));
    expect(destination.status).toBe(302);
    expect(destination.headers.get("location")).toBe("https://hub.example.test/no-workspace");
    expect(destination.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    { role: "owner", kind: "internal" }, { role: "owner", kind: "external" },
    { role: "admin", kind: "internal" }, { role: "admin", kind: "external" },
    { role: "master", kind: "internal" }, { role: "master", kind: "external" },
  ] as const)("when a $role creates a login for the prepared workspace as $kind then the person can sign in and enter with that local type", async ({ role, kind }) => {
    const creator = await fixture.actor(role);
    const input = { ...creationInput(fixture.workspace), kind };
    const before = await snapshot();
    const response = await fixture.submit(input, { creator });
    const loginId = await expectComplete(response, { input, creator, before });
    await expectWorkspaceEntry(input, await signInCreated(input, loginId));
    await expectUnrelated(before, { input, loginId });
  });

  it("when complete details are supplied then first sign-in skips profile completion and the ordinary password still works on later sign-ins", async () => {
    const creator = await fixture.actor("owner");
    const input = creationInput(fixture.workspace);
    const before = await snapshot();
    const loginId = await expectComplete(await fixture.submit(input, { creator }), { input, creator, before });
    const credentials = (await snapshot()).hub.credentials;
    for (const attempt of [1, 2]) {
      const signedIn = await signInCreated(input, loginId);
      const access = await prepareDestination(signedIn);
      expect(access.access.authorize({ kind: "protected", hasLocalPermission: true }).isOk, "Sign-in attempt " + attempt).toBe(true);
      await expectWorkspaceEntry(input, signedIn);
    }
    expect((await readHubState(fixture.signIn.identities)).credentials).toEqual(credentials);
  });

  it.each(["member", "other workspace", "non-master standalone", "anonymous", "ended session"] as const)(
    "when a creator has no current authority (%s) then the request is refused and nothing changes", async (state) => {
      const creator = state === "anonymous" ? null : await fixture.actor(state === "member" ? "member" : "owner");
      let input = creationInput(fixture.workspace);
      if (state === "other workspace") input = { ...input, workspaceId: fixture.other.id };
      if (state === "non-master standalone") input = creationInput();
      if (state === "ended session" && creator) await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: creator.cookie } });
      const before = await snapshot();
      await expectRefused(await fixture.submit(input, { creator }), state === "anonymous" || state === "ended session" ? 401 : 403);
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each(["owner", "admin"] as const)("when a workspace %s asks to create a master then no master access or other record is granted", async (role) => {
    const creator = await fixture.actor(role);
    const before = await snapshot();
    await expectRefused(await fixture.submit({ ...creationInput(fixture.workspace), role: "admin", isMaster: true }, { creator }), 400);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["normalized email", "username", "reserved username"] as const)(
    "when a separate login uses a taken or reserved identifier (%s) then no existing identity or membership is adopted", async (identifier) => {
      const creator = await fixture.actor("owner");
      const existing = await fixture.signIn.identities.createLogin();
      const profile = await fixture.signIn.identities.db.selectFrom("user").selectAll().where("id", "=", existing.loginId).executeTakeFirstOrThrow();
      const input = creationInput(fixture.workspace);
      if (identifier === "normalized email") input.email = "  " + existing.email.toUpperCase() + "  ";
      if (identifier === "username") input.username = profile.username ?? "";
      if (identifier === "reserved username") await saveHub(env.DB, [
        fixture.signIn.identities.db.insertInto("reservedUsernames").values({
          id: crypto.randomUUID(), username: input.username, addedAt: new Date().toISOString(),
        }).compile(),
      ]);
      const before = await snapshot();
      await expectRefused(await fixture.submit(input, { creator }), 409);
      await expectUnadopted(before, input);
    },
  );

  it.each(["suspended", "archived"] as const)("when a duplicate identifier belongs to a %s login then a new creation cannot take it over", async (state) => {
    const creator = await fixture.actor("master");
    const existing = await fixture.signIn.identities.createLogin();
    await saveHub(env.DB, [fixture.signIn.identities.db.updateTable("user")
      .set(state === "suspended" ? { banned: 1 } : { archivedAt: new Date().toISOString() }).where("id", "=", existing.loginId).compile()]);
    const before = await snapshot();
    const input = { ...creationInput(fixture.workspace), email: existing.email };
    await expectRefused(await fixture.submit(input, { creator }), 409);
    await expectUnadopted(before, input);
  });

  it.each([
    { stage: "request", prefix: 0 }, { stage: "login", prefix: 1 }, { stage: "credential", prefix: 2 },
    { stage: "membership", prefix: 3 }, { stage: "workspace user", prefix: 4 },
    { stage: "audit", prefix: 5 }, { stage: "completion", prefix: 5 },
  ] as const)("when saving $stage fails then only the durable prefix remains blocked and the same request can finish", async ({ stage, prefix }) => {
    const creator = await fixture.actor("owner");
    const input = creationInput(fixture.workspace);
    const before = await snapshot();
    await refuseWrite(stage);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expectRefused(await fixture.submit(input, { creator }));
    await expectPrefix(input, prefix);
    await allowWrite(stage);
    await expectBlocked(input);
    const failed = await snapshot();
    await expectUnrelated(before, { input, loginId: subjectFrom(failed, input)?.id ?? "" });
    const loginId = await expectComplete(await fixture.submit(input, { creator }), { input, creator, before });
    await expectWorkspaceEntry(input, await signInCreated(input, loginId));
    expect(JSON.stringify(log.mock.calls)).not.toContain(input.password);
  });

  it.each([
    { table: "login_creations", prefix: 1 }, { table: "user", prefix: 2 },
    { table: "account", prefix: 3 }, { table: "member", prefix: 4 },
  ] as const)("when the request connection stops after committing $table then a fresh request resumes the saved work", async ({ table, prefix }) => {
    const creator = await fixture.actor("owner");
    const input = creationInput(fixture.workspace);
    const before = await snapshot();
    const database = interruptAfterWrite(env.DB, (query) => isInsert(query, table));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expectRefused(await fixture.submit(input, { creator, database }));
    await expectPrefix(input, prefix);
    await expectBlocked(input);
    const loginId = await expectComplete(await fixture.submit(input, { creator }), { input, creator, before });
    await expectWorkspaceEntry(input, await signInCreated(input, loginId));
    expect(JSON.stringify(log.mock.calls)).not.toContain(input.password);
  });

  it("when the workspace write commits but its reply is lost then retry confirms that same user without adding another one", async () => {
    const creator = await fixture.actor("owner");
    const input = creationInput(fixture.workspace);
    const before = await snapshot();
    const workspaceUsers: WorkspaceUsers = { async ensure(value) {
      const result = await fixture.workspaceUsers.ensure(value);
      if (result.variant === "Ok") throw new Error("test_workspace_reply_lost");
      return result;
    } };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expectRefused(await fixture.submit(input, { creator, workspaceUsers }));
    await expectPrefix(input, 5);
    await expectBlocked(input);
    const savedUsers = (await readWorkspaceState(fixture.workspace)).users;
    await expectComplete(await fixture.submit(input, { creator }), { input, creator, before });
    expect((await readWorkspaceState(fixture.workspace)).users).toEqual(savedUsers);
  });

  it("when a completed request's success response was lost then retry returns its original result with no further writes", async () => {
    const creator = await fixture.actor("owner");
    const input = creationInput(fixture.workspace);
    const before = await snapshot();
    const response = await fixture.submit(input, { creator });
    const loginId = await expectComplete(response, { input, creator, before });
    const saved = await snapshot();
    const repeated = await fixture.submit(input, { creator });
    expect(await repeated.json()).toEqual({ creationId: input.creationId, loginId });
    expect(repeated.status).toBe(200);
    expect(await snapshot()).toEqual(saved);
  });

  it("when the final Hub batch commits but its reply is lost then retry returns the one audited creation", async () => {
    const creator = await fixture.actor("owner");
    const input = creationInput(fixture.workspace);
    const before = await snapshot();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const database = interruptAfterWrite(env.DB, (query) => /^update ["`]?login_creations["`]?\s/i.test(query));
    await expectRefused(await fixture.submit(input, { creator, database }));
    const committed = await snapshot();
    expect(committed.hub.creations.find((row) => row.id === input.creationId)?.completedAt).toEqual(expect.any(String));
    await expectComplete(await fixture.submit(input, { creator }), { input, creator, before });
    expect(await snapshot()).toEqual(committed);
  });

  it.each(["credential", "membership", "status", "profile"] as const)(
    "when the required native %s changes during the workspace call then the final batch refuses completion", async (record) => {
      const creator = await fixture.actor("owner");
      const input = creationInput(fixture.workspace);
      const before = await snapshot();
      const workspaceUsers: WorkspaceUsers = { async ensure(current) {
        const result = await fixture.workspaceUsers.ensure(current);
        const db = fixture.signIn.identities.db;
        const query = record === "credential" ? db.withoutPlugins().updateTable("account").set({ password: null }).where("userId", "=", current.loginId).compile()
          : record === "membership" ? db.withoutPlugins().deleteFrom("member").where("userId", "=", current.loginId).compile()
          : db.updateTable("user").set(record === "status" ? { banned: 1 } : { name: "Changed while saving the workspace" }).where("id", "=", current.loginId).compile();
        await saveHub(env.DB, [query]);
        return result;
      } };
      await expectRefused(await fixture.submit(input, { creator, workspaceUsers }), 403);
      const after = await snapshot();
      expect(after.hub.creations.find((row) => row.id === input.creationId)).toMatchObject({ createdLoginId: null, completedAt: null });
      const subject = subjectFrom(after, input);
      if (!subject) throw new Error("The unfinished linked login is required.");
      expect(after.hub.audits.filter((row) => row.action === "accounts_login_created" && row.affectedLoginId === subject.id)).toEqual([]);
      await expectUnrelated(before, { input, loginId: subject.id });
    },
  );

  it.each(["workspaceId", "loginId", "kind"] as const)("when the workspace reply has a different %s then the Hub keeps creation blocked", async (field) => {
    const creator = await fixture.actor("owner");
    const input = creationInput(fixture.workspace);
    const workspaceUsers: WorkspaceUsers = { async ensure(current) {
      const result = await fixture.workspaceUsers.ensure(current);
      return result.variant === "Err" ? result : { variant: "Ok", value: { ...result.value,
        ...(field === "workspaceId" ? { workspaceId: fixture.other.id } : field === "loginId" ? { loginId: creator.loginId } : { kind: "external" }),
      } };
    } };
    await expectRefused(await fixture.submit(input, { creator, workspaceUsers }), 403);
    const after = await snapshot();
    expect(after.hub.creations.find((row) => row.id === input.creationId)).toMatchObject({ createdLoginId: null, completedAt: null });
    expect(after.hub.audits.filter((row) => row.action === "accounts_login_created")).toEqual([]);
  });

  it("when the final shared batch is planned then all of its lookups use indexes", async () => {
    const creator = await fixture.actor("owner");
    const input = creationInput(fixture.workspace);
    const before = await snapshot();
    const loginId = await expectComplete(await fixture.submit(input, { creator }), { input, creator, before });
    const saved = await prepareLoginCreation(env.DB, { creationId: input.creationId, creatorLoginId: creator.loginId,
      workspaceId: fixture.workspace.id, kind: input.kind, details: { email: input.email, username: input.username,
        name: input.name, phone: "+12025550123" } });
    if (saved.isErr) throw new Error("The saved creation is required.");
    const db: Parameters<typeof completionQueries>[0] = await createHubConnection(env.DB);
    try {
      for (const query of [...completionQueries(db, { creation: saved.value, loginId, auditId: crypto.randomUUID(),
        completedAt: new Date().toISOString(), context: createRequestContext() }), completedCreationQuery(db, { creation: saved.value, loginId })]) {
        const plan = await db.executeQuery<{ detail: string }>(CompiledQuery.raw("explain query plan " + query.sql, [...query.parameters]));
        expect(plan.rows.some(({ detail }) => detail.startsWith("SEARCH "))).toBe(true);
        expect(plan.rows.filter(({ detail }) => detail.startsWith("SCAN "))).toEqual([]);
      }
    } finally { await db.destroy(); }
  });

  it.each(["cross-site", "missing origin"] as const)("when the Hub submission has %s then it refuses before saving", async (origin) => {
    const creator = await fixture.actor("owner");
    const before = await snapshot();
    await expectRefused(await fixture.submit(creationInput(fixture.workspace), { creator,
      headers: { origin: origin === "cross-site" ? "https://attacker.test" : "" } }), 403);
    expect(await snapshot()).toEqual(before);
  });

  it("when eight fresh attempts use the same creation reference concurrently then one complete creation is returned to every caller", async () => {
    const creator = await fixture.actor("owner");
    const input = creationInput(fixture.workspace);
    const before = await snapshot();
    const responses = await Promise.all(Array.from({ length: 8 }, async () => await fixture.submit(input, { creator })));
    const first = responses[0];
    if (!first) throw new Error("The first creation response is required.");
    const loginId = await expectComplete(first, { input, creator, before });
    for (const response of responses.slice(1)) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ creationId: input.creationId, loginId });
    }
  });

  it("when eight retries repair a missing credential concurrently then one password record and one completed creation remain", async () => {
    const creator = await fixture.actor("owner");
    const input = creationInput(fixture.workspace);
    const before = await snapshot();
    await refuseWrite("credential");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expectRefused(await fixture.submit(input, { creator }));
    await expectPrefix(input, 2);
    await allowWrite("credential");
    const responses = await Promise.all(Array.from({ length: 8 }, async () => await fixture.submit(input, { creator })));
    const first = responses[0];
    if (!first) throw new Error("The first repair response is required.");
    const loginId = await expectComplete(first, { input, creator, before });
    for (const response of responses.slice(1)) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ creationId: input.creationId, loginId });
    }
    await expectWorkspaceEntry(input, await signInCreated(input, loginId));
  });

  it.each((["incomplete", "completed"] as const).flatMap((state) =>
    (["creator", "workspace", "email", "username", "name", "phone", "kind"] as const).map((changed) => ({ state, changed }))))(
    "when a $state reference is retried with a different $changed then no saved work changes", async ({ state, changed }) => {
      const creator = await fixture.actor(changed === "workspace" ? "master" : "owner");
      const differentCreator = await fixture.actor("master");
      const input = creationInput(fixture.workspace);
      if (state === "incomplete") await refuseWrite("workspace user");
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const first = await fixture.submit(input, { creator });
      if (state === "incomplete") { await expectRefused(first); await allowWrite("workspace user"); }
      else expect(first.status).toBe(200);
      let submitted: CreationInput = { ...input };
      if (changed === "workspace") submitted.workspaceId = fixture.other.id;
      if (changed === "email") submitted.email = creationInput().email;
      if (changed === "username") submitted.username = creationInput().username;
      if (changed === "name") submitted.name = "Different person";
      if (changed === "phone") submitted.phone = { country: "GB", number: "020 7946 0123" };
      if (changed === "kind") submitted.kind = "external";
      const beforeRetry = await snapshot();
      await expectRefused(await fixture.submit(submitted, { creator: changed === "creator" ? differentCreator : creator }), changed === "creator" ? 403 : 409);
      expect(await snapshot()).toEqual(beforeRetry);
    },
  );

  it.each((["incomplete", "completed"] as const).flatMap((state) =>
    (["permission", "membership", "session", "suspension", "archival"] as const).map((change) => ({ state, change }))))(
    "when the creator of a $state request loses authority through $change then the same reference is refused", async ({ state, change }) => {
      const creator = await fixture.actor("admin");
      const input = creationInput(fixture.workspace);
      if (state === "incomplete") await refuseWrite("workspace user");
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const first = await fixture.submit(input, { creator });
      if (state === "incomplete") { await expectRefused(first); await allowWrite("workspace user"); }
      else expect(first.status).toBe(200);
      if (change === "permission") await saveHub(env.DB, [
        fixture.signIn.identities.db.withoutPlugins().updateTable("member").set({ role: "member" }).where("userId", "=", creator.loginId).compile(),
      ]);
      if (change === "membership") await removeMembership({ identities: fixture.signIn.identities, loginId: creator.loginId, workspaceId: fixture.workspace.id });
      if (change === "session") await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: creator.cookie } });
      if (change === "suspension" || change === "archival") await saveHub(env.DB, [
        fixture.signIn.identities.db.updateTable("user").set(change === "suspension" ? { banned: 1 } : { archivedAt: new Date().toISOString() })
          .where("id", "=", creator.loginId).compile(),
      ]);
      const beforeRetry = await snapshot();
      await expectRefused(await fixture.submit(input, { creator }), change === "session" ? 401 : 403);
      expect(await snapshot()).toEqual(beforeRetry);
      if (state === "incomplete") await expectBlocked(input);
    },
  );

  it.each(["incomplete", "completed"] as const)("when a %s request is retried with another supplied password then the saved credential is preserved", async (state) => {
    const creator = await fixture.actor("owner");
    const input = creationInput(fixture.workspace);
    const before = await snapshot();
    if (state === "incomplete") await refuseWrite("workspace user");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = await fixture.submit(input, { creator });
    if (state === "incomplete") { await expectRefused(first); await allowWrite("workspace user"); }
    else await expectComplete(first, { input, creator, before });
    const pending = await snapshot();
    const subject = subjectFrom(pending, input);
    if (!subject) throw new Error("The saved login is required.");
    const credential = pending.hub.credentials.find((row) => row.userId === subject.id && row.providerId === "credential");
    if (!credential) throw new Error("The existing credential is required.");
    const changed = { ...input, password: "Different-password456!" };
    const repeated = await fixture.submit(changed, { creator });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual({ creationId: input.creationId, loginId: subject.id });
    expect((await snapshot()).hub.credentials.find((row) => row.id === credential.id)).toEqual(credential);
    await signInCreated(input, subject.id);
    const refused = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", {
      email: input.email, password: changed.password,
    }), fixture.signIn.settings);
    expect(refused.status).toBe(401);
    await expectUnrelated(before, { input, loginId: subject.id });
  });

  it("when the saved workspace user's member role has changed before retry then completing the request preserves it", async () => {
    const creator = await fixture.actor("owner");
    const input = creationInput(fixture.workspace);
    const before = await snapshot();
    await refuseWrite("audit");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expectRefused(await fixture.submit(input, { creator }));
    await allowWrite("audit");
    const subject = subjectFrom(await snapshot(), input);
    if (!subject) throw new Error("The pending login is required.");
    await saveHub(env.DB, [fixture.signIn.identities.db.withoutPlugins().updateTable("member").set({ role: "admin" }).where("userId", "=", subject.id).compile()]);
    const saved = await snapshot();
    const response = await fixture.submit(input, { creator });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ creationId: input.creationId, loginId: subject.id });
    expect((await snapshot()).hub.members).toEqual(saved.hub.members);
    expect((await snapshot()).workspace.users).toEqual(saved.workspace.users);
    await expectUnrelated(before, { input, loginId: subject.id });
  });

  it("when caller-supplied identity and permission headers claim another creator then the real signed-in creator remains authoritative", async () => {
    const creator = await fixture.actor("member");
    const before = await snapshot();
    await expectRefused(await fixture.submit(creationInput(fixture.workspace), { creator, headers: {
      "x-xpro-user-id": crypto.randomUUID(), "x-xpro-role": "admin",
      "x-xpro-workspace-id": fixture.workspace.id, "x-xpro-member-create": "true",
    } }), 403);
    expect(await snapshot()).toEqual(before);
  });

  it("when creation is marked incomplete after real sessions exist then both Hub and workspace protected requests refuse those sessions", async () => {
    const creator = await fixture.actor("owner");
    const input = creationInput(fixture.workspace);
    const before = await snapshot();
    const loginId = await expectComplete(await fixture.submit(input, { creator }), { input, creator, before });
    const signedIn = await signInCreated(input, loginId);
    const cookie = await expectWorkspaceEntry(input, signedIn);
    // Exercise stale authenticated access using genuine sessions, not a test-only login bypass.
    await saveHub(env.DB, [fixture.signIn.identities.db.updateTable("loginCreations")
      .set({ completedAt: null }).where("id", "=", input.creationId).compile()]);
    const saved = await snapshot();
    const services = routingServices(fixture.signIn, [fixture.workspace]);
    const hub = await route(new Request("https://hub.example.test/auth/destination", {
      headers: { cookie: signedIn.cookie },
    }), services);
    const workspace = await route(new Request(fixture.workspace.origin + "/orders", {
      headers: { cookie, accept: "application/json" },
    }), services);
    for (const response of [hub, workspace]) {
      expect(await response.clone().json()).toMatchObject({ code: "core_creation_incomplete" });
      await expectRefused(response, 403);
    }
    expect(await snapshot()).toEqual(saved);
  });

  it.each([
    { label: "short username", value: { username: "abc" } },
    { label: "uppercase username", value: { username: "Abcd" } },
    { label: "long username", value: { username: "abcdefghi" } },
    { label: "username starting with a number", value: { username: "1abc" } },
    { label: "invalid email", value: { email: "not-an-email" } },
    { label: "empty name", value: { name: " " } },
    { label: "invalid phone", value: { phone: { country: "ZZ", number: "invalid" } } },
    { label: "short password", value: { password: "Short1!" } },
    { label: "long password", value: { password: "A1!" + "a".repeat(62) } },
    { label: "password without uppercase", value: { password: "lowercase123!" } },
    { label: "password without a number", value: { password: "No-number-here!" } },
    { label: "password without a symbol", value: { password: "NoSymbolHere123" } },
    { label: "invalid creation reference", value: { creationId: "invalid" } },
    { label: "invalid workspace reference", value: { workspaceId: "invalid" } },
    { label: "invalid local type", value: { kind: "admin" } },
    { label: "server-owned login link", value: { loginCreationId: crypto.randomUUID() } },
    { label: "server-owned completion", value: { completedAt: new Date().toISOString() } },
  ])("when creation receives $label then it refuses the request before saving anything", async ({ value }) => {
    const creator = await fixture.actor("owner");
    const before = await snapshot();
    await expectRefused(await fixture.submit({ ...creationInput(fixture.workspace), ...value }, { creator }), 400);
    expect(await snapshot()).toEqual(before);
  });

  it.each([null, []])("when the creation payload is not an object (%j) then it is refused without writes", async (input) => {
    const creator = await fixture.actor("owner");
    const before = await snapshot();
    await expectRefused(await fixture.submit(input, { creator }), 400);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["/api/auth/admin/create-user", "/api/auth/organization/add-member", "/api/auth/sign-up/email"])(
    "when a caller uses the unused native route %s then it cannot bypass private creation", async (path) => {
      const creator = await fixture.actor("master");
      const before = await snapshot();
      const response = await handleHubAuthRequest(hubRequest(path, { ...creationInput(fixture.workspace), role: "admin" }, creator.cookie), fixture.signIn.settings);
      expect(response.status).toBe(404);
      expect(await snapshot()).toEqual(before);
    },
  );

  it("when creation succeeds or fails then its saved request, audit, response and logs contain no readable password", async () => {
    const creator = await fixture.actor("owner");
    const input = creationInput(fixture.workspace);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await refuseWrite("audit");
    const failed = await fixture.submit(input, { creator });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    const failureBody = await failed.text();
    await allowWrite("audit");
    const completed = await fixture.submit(input, { creator });
    expect(completed.status).toBe(200);
    const state = await snapshot();
    const stored = JSON.stringify({ creations: state.hub.creations, audits: state.hub.audits,
      response: await completed.text(), failureBody, logs: log.mock.calls });
    expect(stored).not.toContain(input.password);
    const logged = JSON.stringify(log.mock.calls);
    for (const value of [input.email, input.username, input.name, input.phone.number]) expect(logged).not.toContain(value);
    const subject = subjectFrom(state, input);
    expect(subject).toBeDefined();
    const credential = state.hub.credentials.find((row) => row.userId === subject?.id && row.providerId === "credential");
    expect(credential?.password).toEqual(expect.any(String));
    expect(credential?.password).not.toBe(input.password);
  });
});

type Snapshot = Awaited<ReturnType<typeof snapshot>>;
async function snapshot() {
  return { hub: await readHubState(fixture.signIn.identities),
    invitations: await fixture.signIn.identities.db.selectFrom("invitation").selectAll().orderBy("id").execute(),
    workspace: await readWorkspaceState(fixture.workspace), other: await readWorkspaceState(fixture.other),
    placements: await readPlacements(fixture.signIn) };
}

function subjectFrom(state: Snapshot, input: CreationInput): Snapshot["hub"]["users"][number] | undefined {
  return state.hub.users.find((row) => row.email === input.email.trim().toLowerCase());
}

async function expectComplete(response: Response, input: {
  input: CreationInput; creator: SignedInLogin; before: Snapshot;
}): Promise<string> {
  const { input: submitted, creator, before } = input;
  expect(response.status).toBe(200);
  const after = await snapshot();
  const subject = subjectFrom(after, submitted);
  if (!subject) throw new Error("Successful creation must have saved its login.");
  expect(await response.json()).toEqual({ creationId: submitted.creationId, loginId: subject.id });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(subject).toMatchObject({ email: submitted.email.trim().toLowerCase(), username: submitted.username,
    name: submitted.name, phone: "+12025550123", role: "user", archivedAt: null, loginCreationId: submitted.creationId });
  expect(subject.banned === null || subject.banned === 0).toBe(true);
  const creations = after.hub.creations.filter((row) => row.id === submitted.creationId);
  expect(creations).toHaveLength(1);
  expect(creations[0]).toEqual({ id: submitted.creationId, creatorLoginId: creator.loginId,
    organizationId: submitted.workspaceId ?? null, createdLoginId: subject.id, kind: submitted.kind ?? null,
    details: expect.any(String), createdAt: expect.any(String), completedAt: expect.any(String) });
  const credentials = after.hub.credentials.filter((row) => row.userId === subject.id);
  expect(credentials).toHaveLength(1);
  expect(credentials[0]).toMatchObject({ providerId: "credential", accountId: subject.id, password: expect.any(String) });
  const expectedMember = submitted.workspaceId ? [{ id: expect.any(String), organizationId: submitted.workspaceId,
    userId: subject.id, role: "member", createdAt: expect.any(String) }] : [];
  expect(after.hub.members.filter((row) => row.userId === subject.id)).toEqual(expectedMember);
  expect(after.workspace.users.filter((row) => row.loginId === subject.id)).toEqual(submitted.workspaceId ? [{
    id: expect.any(String), loginId: subject.id, kind: submitted.kind, archivedAt: null, createdAt: expect.any(String),
  }] : []);
  const audits = after.hub.audits.filter((row) => row.action === "accounts_login_created" && row.affectedLoginId === subject.id);
  expect(audits).toEqual([{ id: expect.any(String), action: "accounts_login_created", outcome: "success",
    actorLoginId: creator.loginId, affectedLoginId: subject.id, reason: null, comment: null,
    requestId: expect.any(String), createdAt: expect.any(String) }]);
  expect(audits[0]?.requestId).not.toBe(submitted.creationId);
  await expectUnrelated(before, { input: submitted, loginId: subject.id });
  return subject.id;
}

async function expectUnrelated(before: Snapshot, input: { input: CreationInput; loginId: string }): Promise<void> {
  const after = await snapshot();
  const { input: submitted, loginId } = input;
  const otherRecords = (state: Snapshot) => ({
    ...state, hub: { ...state.hub,
      users: state.hub.users.filter((row) => row.id !== loginId),
      credentials: state.hub.credentials.filter((row) => row.userId !== loginId),
      sessions: state.hub.sessions.filter((row) => row.userId !== loginId),
      members: state.hub.members.filter((row) => row.userId !== loginId),
      creations: state.hub.creations.filter((row) => row.id !== submitted.creationId),
      // Refusal probes create their own native credential audit; other audit history is immutable.
      audits: state.hub.audits.filter((row) => row.affectedLoginId !== loginId
        && !(row.action === "accounts_sign_in" && row.outcome === "refused")),
    }, workspace: {
      users: state.workspace.users.filter((row) => row.loginId !== loginId),
      sessions: state.workspace.sessions.filter((row) => row.loginId !== loginId),
      audits: state.workspace.audits.filter((row) => row.affectedLoginId !== loginId),
    },
  });
  expect(otherRecords(after)).toEqual(otherRecords(before));
  const existingAuditIds = new Set(before.hub.audits.map((row) => row.id));
  expect(after.hub.audits.filter((row) => existingAuditIds.has(row.id))).toEqual(before.hub.audits);
}

async function expectUnadopted(before: Snapshot, input: CreationInput): Promise<void> {
  const after = await snapshot();
  const request = after.hub.creations.find((row) => row.id === input.creationId);
  if (request) expect(request).toMatchObject({ createdLoginId: null, completedAt: null });
  expect({ ...after, hub: { ...after.hub, creations: after.hub.creations.filter((row) => row.id !== input.creationId) } }).toEqual(before);
}

async function expectRefused(response: Response, status?: number): Promise<void> {
  if (status !== undefined) expect(response.status).toBe(status);
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(600);
  const body: unknown = await response.json();
  expect(body).toMatchObject({ code: expect.stringMatching(/^(core|accounts)_/), message: expect.any(String),
    requestId: response.headers.get("x-request-id") });
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error("A safe error object is required.");
  expect(Object.keys(body).filter((name) => !["code", "message", "requestId", "fields"].includes(name))).toEqual([]);
  expect(response.headers.get("x-request-id")).toEqual(expect.any(String));
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.getSetCookie()).toEqual([]);
}

async function signInCreated(input: CreationInput, loginId: string): Promise<SignedInLogin> {
  const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", {
    email: input.email, password: input.password,
  }), fixture.signIn.settings);
  expect(response.status).toBe(200);
  const cookie = readCookies(response);
  const session = await fixture.signIn.identities.auth.api.getSession({ headers: { cookie }, query: { disableCookieCache: true } });
  if (!session || session.user.id !== loginId) throw new Error("The created person's actual native session is required.");
  return { loginId, email: input.email, cookie, hubSessionId: session.session.id };
}

async function expectWorkspaceEntry(input: CreationInput, login: SignedInLogin): Promise<string> {
  const services = routingServices(fixture.signIn, [fixture.workspace]);
  const started = await route(new Request(fixture.workspace.origin + "/auth/start"), services);
  const authorization = started.headers.get("location");
  if (!authorization) throw new Error("Native authorization must start.");
  const authorized = await handleHubAuthRequest(new Request(authorization, { headers: { cookie: login.cookie } }), fixture.signIn.settings);
  const callback = authorized.headers.get("location");
  if (!callback) throw new Error("Complete profiles must continue directly to the callback.");
  const completed = await route(new Request(callback, { headers: { cookie: readCookies(started) } }), services);
  expect(completed.status).toBe(302);
  expect(new URL(completed.headers.get("location") ?? "", fixture.workspace.origin).pathname).not.toBe("/complete-profile");
  const cookie = readCookies(completed);
  const page = await route(new Request(fixture.workspace.origin + "/orders", {
    headers: { cookie, accept: "application/json" },
  }), services);
  expect(page.status).toBe(200);
  expect(await page.json()).toEqual({ workspaceId: fixture.workspace.id, loginId: login.loginId, kind: input.kind });
  const home = await route(new Request(fixture.workspace.origin + "/", {
    headers: { cookie, accept: input.kind === "external" ? "text/html" : "application/json" },
  }), services);
  expect(home.status).toBe(input.kind === "external" ? 302 : 200);
  if (input.kind === "external") expect(home.headers.get("location")).toBe(fixture.workspace.origin + "/portal");
  return cookie;
}

async function expectBlocked(input: CreationInput): Promise<void> {
  const before = await snapshot();
  const subject = subjectFrom(before, input);
  const hasCredential = before.hub.credentials.some((row) => row.userId === subject?.id && row.providerId === "credential" && row.password !== null);
  const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", {
    email: input.email, password: input.password,
  }), fixture.signIn.settings);
  expect(await response.clone().json()).toMatchObject({ code: hasCredential ? "core_creation_incomplete" : "accounts_credentials_invalid" });
  await expectRefused(response, hasCredential ? 403 : 401);
  const state = await snapshot();
  if (subject) expect(state.hub.sessions.filter((row) => row.userId === subject.id)).toEqual([]);
}

async function expectPrefix(input: CreationInput, length: number): Promise<void> {
  const state = await snapshot();
  expect(state.hub.creations.filter((row) => row.id === input.creationId)).toHaveLength(length >= 1 ? 1 : 0);
  const subject = subjectFrom(state, input);
  expect(subject !== undefined).toBe(length >= 2);
  if (subject) expect(subject.loginCreationId).toBe(input.creationId);
  expect(state.hub.credentials.filter((row) => row.userId === subject?.id && row.providerId === "credential")).toHaveLength(length >= 3 ? 1 : 0);
  expect(state.hub.members.filter((row) => row.userId === subject?.id)).toHaveLength(length >= 4 ? 1 : 0);
  expect(state.workspace.users.filter((row) => row.loginId === subject?.id)).toHaveLength(length >= 5 ? 1 : 0);
  if (length >= 1) expect(state.hub.creations.find((row) => row.id === input.creationId)?.completedAt).toBeNull();
  expect(state.hub.audits.filter((row) => row.action === "accounts_login_created" && row.affectedLoginId === subject?.id)).toEqual([]);
}

type FailureStage = "request" | "login" | "credential" | "membership" | "workspace user" | "audit" | "completion";
async function refuseWrite(stage: FailureStage): Promise<void> {
  const targets = {
    request: ["login_creations", "insert"], login: ["user", "insert"], credential: ["account", "insert"],
    membership: ["member", "insert"], "workspace user": ["workspace_users", "insert"],
    audit: ["audit_entries", "insert"], completion: ["login_creations", "update of completed_at"],
  } as const;
  const [table, event] = targets[stage];
  const query = sql`create trigger test_refuse_creation before ${sql.raw(event)} on ${sql.id(table)}
    begin select raise(abort, 'test_creation_save_failed'); end`;
  if (stage === "workspace user") await withWorkspace(fixture.workspace, async ({ db }) => { await query.execute(db); });
  else await query.execute(fixture.signIn.identities.db.withoutPlugins());
}

async function allowWrite(stage: FailureStage): Promise<void> {
  const query = sql`drop trigger test_refuse_creation`;
  if (stage === "workspace user") await withWorkspace(fixture.workspace, async ({ db }) => { await query.execute(db); });
  else await query.execute(fixture.signIn.identities.db.withoutPlugins());
}

function isInsert(query: string, table: string): boolean {
  return new RegExp('^insert(?: or [a-z]+)? into "?' + table + '"?[ (]', "i").test(query);
}
