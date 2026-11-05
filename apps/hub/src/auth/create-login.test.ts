import { env } from "cloudflare:workers";
import { createLogin, readCreatedLogin, type PreparedLoginCreation } from "@xpro/accounts/server";
import { createRequestContext, saveHub } from "@xpro/core/server";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interruptAfterWrite } from "#test/creation-faults.db";
import type { SignedInLogin } from "#test/hub-identities";
import { createSignInFixture, hubRequest, readHubState, removeMembership, type SignInFixture } from "#test/sign-in";
import { createLoginServices } from "./create-login.server";
import { handleHubAuthRequest } from "./oidc.server";

let fixture: SignInFixture;
let owner: SignedInLogin;
let workspaceId: string;
beforeEach(async () => {
  fixture = await createSignInFixture(env.DB);
  const created = await fixture.identities.createLogin();
  const organization = await fixture.identities.auth.api.createOrganization({ body: {
    name: "Native creation workspace", slug: crypto.randomUUID(), userId: created.loginId,
  } });
  if (!organization) throw new Error("The prepared workspace is required.");
  workspaceId = organization.id;
  owner = await fixture.signIn(created, handleHubAuthRequest);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => { vi.restoreAllMocks(); await fixture.identities.db.destroy(); });

describe("Login creation native-record checkpoint", () => {
  it.each(["owner", "admin", "master"] as const)("when a current %s creates for a workspace then native records are prepared without completing creation", async (role) => {
    const creator = await actor(role);
    const input = creationInput();
    const before = await readHubState(fixture.identities);
    const prepared = await expectPrepared(input, creator);
    const after = await readHubState(fixture.identities);
    const login = after.users.find((row) => row.id === prepared.loginId);
    expect(login).toMatchObject({ email: input.email, username: input.username, name: input.name,
      phone: "+12025550123", role: "user", banned: 0, archivedAt: null, loginCreationId: input.creationId });
    expect(after.credentials.filter((row) => row.userId === prepared.loginId)).toEqual([expect.objectContaining({
      providerId: "credential", accountId: prepared.loginId, password: expect.any(String),
    })]);
    expect(after.members.filter((row) => row.userId === prepared.loginId)).toEqual([{
      id: expect.any(String), userId: prepared.loginId, organizationId: workspaceId, role: "member", createdAt: expect.any(String),
    }]);
    expect(after.creations).toEqual([{ id: input.creationId, creatorLoginId: creator.loginId, organizationId: workspaceId,
      kind: "internal", details: JSON.stringify(prepared.creation.details), createdLoginId: null,
      createdAt: prepared.creation.createdAt, completedAt: null }]);
    await expectUnrelated(before, prepared);
    const signIn = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", {
      email: input.email, password: input.password,
    }), fixture.settings);
    expect(signIn.status).toBe(403);
    expect(await signIn.json()).toMatchObject({ code: "core_creation_incomplete" });
    expect(signIn.headers.getSetCookie()).toEqual([]);
  });

  it("when a master creates a standalone login then no workspace or membership is created", async () => {
    const creator = await actor("master");
    const input = creationInput(null);
    const before = await readHubState(fixture.identities);
    const prepared = await expectPrepared(input, creator);
    expect(prepared.creation).toMatchObject({ workspaceId: null, kind: null });
    expect((await readHubState(fixture.identities)).members.filter((row) => row.userId === prepared.loginId)).toEqual([]);
    await expectUnrelated(before, prepared);
  });

  it.each(["anonymous", "ended session", "member", "standalone", "other workspace", "forged headers"] as const)(
    "when the creator has no current authority (%s) then nothing is saved", async (state) => {
      const creator: SignedInLogin | null = state === "anonymous" ? null : state === "member" || state === "forged headers" ? await actor("member") : owner;
      const input = creationInput(state === "standalone" ? null : state === "other workspace" ? crypto.randomUUID() : workspaceId);
      if (state === "ended session" && creator) await fixture.identities.auth.api.signOut({ headers: { cookie: creator.cookie } });
      const before = await readHubState(fixture.identities);
      const result = await submit(input, { creator, headers: state === "forged headers" ? {
        "x-xpro-user-id": owner.loginId, "x-xpro-role": "admin", "x-xpro-member-create": "true", "x-xpro-workspace-id": workspaceId,
      } : undefined });
      expect(result.toJSON()).toEqual({ variant: "Err", error: { code:
        state === "anonymous" || state === "ended session" ? "core_unauthenticated" : "core_forbidden" } });
      expect(await readHubState(fixture.identities)).toEqual(before);
    },
  );

  it.each(["permission", "membership", "session", "suspension", "archive", "profile"] as const)(
    "when a retry loses current authority through %s then its saved work is untouched", async (loss) => {
      const input = creationInput();
      await expectPrepared(input, owner);
      if (loss === "permission") await saveHub(env.DB, [fixture.identities.db.withoutPlugins().updateTable("member").set({ role: "member" }).where("userId", "=", owner.loginId).compile()]);
      if (loss === "membership") await removeMembership({ identities: fixture.identities, loginId: owner.loginId, workspaceId });
      if (loss === "session") await fixture.identities.auth.api.signOut({ headers: { cookie: owner.cookie } });
      if (loss === "suspension" || loss === "archive" || loss === "profile") await saveHub(env.DB, [fixture.identities.db.updateTable("user")
        .set(loss === "suspension" ? { banned: 1 } : loss === "archive" ? { archivedAt: new Date().toISOString() } : { phone: null })
        .where("id", "=", owner.loginId).compile()]);
      const before = await readHubState(fixture.identities);
      expect((await submit(input, { creator: owner })).isErr).toBe(true);
      expect(await readHubState(fixture.identities)).toEqual(before);
    },
  );

  it.each(["creator", "workspace", "kind", "email", "username", "name", "phone"] as const)(
    "when a saved reference is retried with another %s then no record changes", async (field) => {
      const creator = await actor("master");
      const input = creationInput();
      await expectPrepared(input, creator);
      let retryCreator = creator;
      const changed = { ...input };
      if (field === "creator") retryCreator = await actor("master");
      if (field === "workspace") {
        const organization = await fixture.identities.auth.api.createOrganization({ body: {
          name: "Different workspace", slug: crypto.randomUUID(), userId: (await fixture.identities.createLogin()).loginId,
        } });
        if (!organization) throw new Error("The other workspace is required.");
        changed.workspaceId = organization.id;
      }
      if (field === "kind") changed.kind = "external";
      if (field === "email") changed.email = "different-" + input.email;
      if (field === "username") changed.username = "z" + input.username.slice(1);
      if (field === "name") changed.name = "Different person";
      if (field === "phone") changed.phone = { country: "GB", number: "02079460123" };
      const before = await readHubState(fixture.identities);
      expect((await submit(changed, { creator: retryCreator })).toJSON()).toEqual({ variant: "Err", error: { code: field === "creator" ? "core_forbidden" : "accounts_creation_conflict" } });
      expect(await readHubState(fixture.identities)).toEqual(before);
    },
  );

  it.each(["email", "username", "reserved", "suspended", "archived"] as const)(
    "when an identifier is unrelated or reserved (%s) then the existing identity is never adopted", async (state) => {
      const existing = await fixture.identities.createLogin();
      const profile = await fixture.identities.db.selectFrom("user").selectAll().where("id", "=", existing.loginId).executeTakeFirstOrThrow();
      const input = creationInput();
      if (state === "username") input.username = profile.username ?? "";
      else if (state !== "reserved") input.email = "  " + existing.email.toUpperCase() + "  ";
      if (state === "suspended" || state === "archived") await saveHub(env.DB, [fixture.identities.db.updateTable("user")
        .set(state === "suspended" ? { banned: 1 } : { archivedAt: new Date().toISOString() }).where("id", "=", existing.loginId).compile()]);
      if (state === "reserved") await saveHub(env.DB, [fixture.identities.db.insertInto("reservedUsernames")
        .values({ id: crypto.randomUUID(), username: input.username, addedAt: new Date().toISOString() }).compile()]);
      const before = await readHubState(fixture.identities);
      const result = await submit(input, { creator: owner });
      expect(result.toJSON()).toEqual({ variant: "Err", error: { code: state === "username" ? "accounts_username_taken"
        : state === "reserved" ? "accounts_username_reserved" : "accounts_email_taken" } });
      expect(await readCreatedLogin(env.DB, input.creationId)).toBeNull();
      const after = await readHubState(fixture.identities);
      expect({ ...after, creations: after.creations.filter((row) => row.id !== input.creationId) }).toEqual(before);
    },
  );

  it.each(["login_creations", "user", "account", "member"] as const)(
    "when the real %s write commits and the connection stops then a fresh retry resumes without duplication", async (table) => {
      const input = creationInput();
      const before = await readHubState(fixture.identities);
      const database = interruptAfterWrite(env.DB, (query) => new RegExp("^insert into [\"`]?" + table + "[\"`]?\\s", "i").test(query));
      expect((await submit(input, { creator: owner, database })).toJSON()).toEqual({ variant: "Err", error: { code: "core_unexpected_error" } });
      const prepared = await expectPrepared(input, owner);
      const saved = await readHubState(fixture.identities);
      expect(saved.creations).toHaveLength(1);
      expect(saved.credentials.filter((row) => row.userId === prepared.loginId)).toHaveLength(1);
      expect(saved.members.filter((row) => row.userId === prepared.loginId)).toHaveLength(1);
      await expectUnrelated(before, prepared);
    },
  );

  it("when the native credential save fails then retry repairs only the linked login with the configured password helpers", async () => {
    const input = creationInput();
    await sql`create trigger test_refuse_credential before insert on account
      when NEW."providerId" = 'credential' begin select raise(abort, 'test_credential_save_failed'); end`.execute(fixture.identities.db.withoutPlugins());
    expect((await submit(input, { creator: owner })).isErr).toBe(true);
    const pending = await readCreatedLogin(env.DB, input.creationId);
    if (!pending) throw new Error("The initial native user link must survive.");
    expect((await readHubState(fixture.identities)).credentials.filter((row) => row.userId === pending.loginId)).toEqual([]);
    await sql`drop trigger test_refuse_credential`.execute(fixture.identities.db.withoutPlugins());
    const retry = { ...input, password: "Recovered-person123!" };
    const prepared = await expectPrepared(retry, owner);
    expect(prepared.loginId).toBe(pending.loginId);
    const saved = await readHubState(fixture.identities);
    const account = saved.credentials.find((row) => row.userId === pending.loginId);
    if (!account?.password) throw new Error("The native credential is required.");
    const native = await fixture.identities.auth.$context;
    expect(await native.password.verify({ password: retry.password, hash: account.password })).toBe(true);
    expect(await native.password.verify({ password: input.password, hash: account.password })).toBe(false);
    expect(saved.creations[0]?.completedAt).toBeNull();
  });

  it.each(["fresh", "missing credential"] as const)("when eight %s attempts run concurrently then one native record set remains", async (state) => {
    const input = creationInput();
    if (state === "missing credential") {
      const database = interruptAfterWrite(env.DB, (query) => /^insert into ["`]?user["`]?\s/i.test(query));
      expect((await submit(input, { creator: owner, database })).isErr).toBe(true);
    }
    const results = await Promise.all(Array.from({ length: 8 }, async () => await submit(input, { creator: owner })));
    const first = results[0];
    if (!first || first.isErr) throw new Error("Concurrent creation must prepare its native records.");
    expect(results.map((result) => result.toJSON())).toEqual(Array.from({ length: 8 }, () => first.toJSON()));
    const saved = await readHubState(fixture.identities);
    expect(saved.users.filter((row) => row.loginCreationId === input.creationId)).toHaveLength(1);
    expect(saved.credentials.filter((row) => row.userId === first.value.loginId)).toHaveLength(1);
    expect(saved.members.filter((row) => row.userId === first.value.loginId)).toHaveLength(1);
  });

  it("when an existing native password and membership role are present then a retry changes neither", async () => {
    const input = creationInput();
    const prepared = await expectPrepared(input, owner);
    await saveHub(env.DB, [fixture.identities.db.withoutPlugins().updateTable("member").set({ role: "admin" }).where("userId", "=", prepared.loginId).compile()]);
    const before = await readHubState(fixture.identities);
    const result = await expectPrepared({ ...input, password: "Different-person123!" }, owner);
    expect(result).toEqual(prepared);
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it("when a saved completed reference is repeated then it returns the original pointer without changing its later profile or password", async () => {
    const input = creationInput();
    const prepared = await expectPrepared(input, owner);
    const completedAt = new Date().toISOString();
    // Seed the persisted replay condition only; T026 must test the real completion batch.
    await saveHub(env.DB, [fixture.identities.db.updateTable("loginCreations")
      .set({ createdLoginId: prepared.loginId, completedAt }).where("id", "=", input.creationId).compile(),
    fixture.identities.db.updateTable("user").set({ name: "Later profile change" }).where("id", "=", prepared.loginId).compile()]);
    const before = await readHubState(fixture.identities);
    expect((await submit({ ...input, password: "Different-person123!" }, { creator: owner })).toJSON()).toEqual({ variant: "Ok",
      value: { ...prepared, creation: { ...prepared.creation, createdLoginId: prepared.loginId, completedAt } } });
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it.each(["different pointer", "missing initial link"] as const)("when a completed saved reference has a %s then replay refuses without writing", async (state) => {
    const input = creationInput();
    const prepared = await expectPrepared(input, owner);
    const other = await fixture.identities.createLogin();
    await saveHub(env.DB, [fixture.identities.db.updateTable("loginCreations")
      .set({ createdLoginId: state === "different pointer" ? other.loginId : prepared.loginId, completedAt: new Date().toISOString() })
      .where("id", "=", input.creationId).compile(),
    ...(state === "missing initial link" ? [fixture.identities.db.updateTable("user").set({ loginCreationId: null })
      .where("id", "=", prepared.loginId).compile()] : [])]);
    const before = await readHubState(fixture.identities);
    expect((await submit(input, { creator: owner })).toJSON()).toEqual({ variant: "Err", error: { code: "accounts_creation_conflict" } });
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it("when a master targets a missing workspace then no reference or native record is saved", async () => {
    const creator = await actor("master");
    const input = creationInput(crypto.randomUUID());
    const before = await readHubState(fixture.identities);
    expect((await submit(input, { creator })).toJSON()).toEqual({ variant: "Err", error: { code: "core_forbidden" } });
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it.each(["password", "role", "profile", "membership", "suspension", "archive"] as const)(
    "when pending records have an incompatible %s then retry refuses without repairing unrelated state", async (field) => {
      const input = creationInput();
      const prepared = await expectPrepared(input, owner);
      const { db } = fixture.identities;
      if (field === "password") await saveHub(env.DB, [db.withoutPlugins().updateTable("account").set({ password: null }).where("userId", "=", prepared.loginId).compile()]);
      else if (field === "membership") {
        const other = await fixture.identities.auth.api.createOrganization({ body: { name: "Other", slug: crypto.randomUUID(), userId: (await fixture.identities.createLogin()).loginId } });
        if (!other) throw new Error("The other workspace is required.");
        await saveHub(env.DB, [db.withoutPlugins().updateTable("member").set({ organizationId: other.id }).where("userId", "=", prepared.loginId).compile()]);
      } else await saveHub(env.DB, [db.updateTable("user").set(field === "role" ? { role: "admin" }
        : field === "profile" ? { name: "Changed outside this request" } : field === "suspension" ? { banned: 1 }
        : { archivedAt: new Date().toISOString() }).where("id", "=", prepared.loginId).compile()]);
      const before = await readHubState(fixture.identities);
      expect((await submit(input, { creator: owner })).toJSON()).toEqual({ variant: "Err", error: { code: "accounts_creation_conflict" } });
      expect(await readHubState(fixture.identities)).toEqual(before);
    },
  );

  it.each([
    { value: { role: "admin" }, fields: [] }, { value: { password: "short" }, fields: ["password"] },
    { value: { username: "ABC", phone: { country: "ZZ", number: "bad" } }, fields: ["username", "phone"] },
    { value: { kind: undefined }, fields: ["workspaceId", "kind"] },
  ])("when creation input is invalid ($fields) then it saves nothing and exposes no submitted values", async ({ value, fields }) => {
    const input = { ...creationInput(), ...value };
    const before = await readHubState(fixture.identities);
    expect((await submit(input, { creator: owner })).toJSON()).toEqual({ variant: "Err", error: { code: "core_invalid_input", fields } });
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it("when preparation succeeds, repeats or fails then persisted intent and safe logs contain no password or personal data", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const input = creationInput();
    const prepared = await expectPrepared(input, owner);
    await expectPrepared({ ...input, email: "  " + input.email.toUpperCase() + "  ", name: "  " + input.name + "  " }, owner);
    const failing = creationInput();
    await sql`create trigger test_refuse_new_login before insert on user begin select raise(abort, 'test_login_save_failed'); end`.execute(fixture.identities.db.withoutPlugins());
    expect((await submit(failing, { creator: owner })).isErr).toBe(true);
    const state = await readHubState(fixture.identities);
    expect(JSON.stringify({ result: prepared, creations: state.creations, audits: state.audits })).not.toContain(input.password);
    const logs = JSON.stringify(log.mock.calls);
    for (const person of [input, failing]) {
      for (const value of [person.password, person.email, person.username, person.name, person.phone.number]) expect(logs).not.toContain(value);
    }
    expect(log.mock.calls.length).toBeGreaterThan(0);
  });
});

type Input = ReturnType<typeof creationInput>;
async function actor(role: "owner" | "admin" | "member" | "master"): Promise<SignedInLogin> {
  if (role === "owner") return owner;
  const created = await fixture.identities.createLogin({ role: role === "master" ? "admin" : "user" });
  if (role !== "master") await fixture.identities.auth.api.addMember({ body: { userId: created.loginId, organizationId: workspaceId, role } });
  return await fixture.signIn(created, handleHubAuthRequest);
}

function creationInput(target: string | null = workspaceId): {
  creationId: string; email: string; username: string; name: string; phone: { country: string; number: string }; password: string;
  workspaceId?: string; kind?: "internal" | "external";
} {
  return { creationId: crypto.randomUUID(), email: "new-" + crypto.randomUUID() + "@example.test",
    username: "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7), name: "Created person",
    phone: { country: "US", number: "2025550123" }, password: "Created-person123!",
    ...(target === null ? {} : { workspaceId: target, kind: "internal" }) };
}

async function submit(input: unknown, options: { creator: SignedInLogin | null; database?: D1Database; headers?: HeadersInit }) {
  const request = hubRequest("/_server/create-login", input, options.creator?.cookie);
  const headers = new Headers(request.headers);
  for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
  const services = await createLoginServices(new Request(request, { headers }), {
    settings: { ...fixture.settings, database: options.database ?? env.DB }, context: createRequestContext(),
  });
  return await createLogin(input, services);
}

async function expectPrepared(input: Input, creator: SignedInLogin): Promise<PreparedLoginCreation> {
  const result = await submit(input, { creator });
  expect(result.isOk).toBe(true);
  if (result.isErr) throw new Error("Native record preparation was refused.");
  expect(result.value).toEqual({ creation: { id: input.creationId, creatorLoginId: creator.loginId,
    workspaceId: input.workspaceId ?? null, kind: input.kind ?? null, details: { email: input.email.trim().toLowerCase(),
      username: input.username, name: input.name.trim(), phone: "+12025550123" },
    createdLoginId: null, createdAt: expect.any(String), completedAt: null }, loginId: expect.any(String) });
  return result.value;
}

async function expectUnrelated(before: Awaited<ReturnType<typeof readHubState>>, prepared: PreparedLoginCreation): Promise<void> {
  const after = await readHubState(fixture.identities);
  expect({ ...after, users: after.users.filter((row) => row.id !== prepared.loginId),
    credentials: after.credentials.filter((row) => row.userId !== prepared.loginId),
    members: after.members.filter((row) => row.userId !== prepared.loginId),
    creations: after.creations.filter((row) => row.id !== prepared.creation.id) }).toEqual(before);
}
