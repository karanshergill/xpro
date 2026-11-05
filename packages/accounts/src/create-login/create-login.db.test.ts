import { env } from "cloudflare:workers";
import { createHubConnection } from "@xpro/core/server";
import { CompiledQuery, sql } from "kysely";
import { err } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHubIdentities, type HubIdentities } from "#test/hub-identities";
import { readHubState } from "#test/sign-in";
import { creationEmailQuery, creationLoginQuery, creationMembershipQuery, creationWorkspaceQuery,
  loginCreationQuery, prepareLoginCreation, readCreatedLogin, type CreationDetails } from "./create-login.db";

let identities: HubIdentities;
let creatorId: string;
let workspaceId: string;
beforeEach(async () => {
  identities = await createHubIdentities(env.DB);
  creatorId = (await identities.createLogin({ role: "admin" })).loginId;
  const owner = await identities.createLogin();
  const workspace = await identities.auth.api.createOrganization({ body: {
    name: "Creation request workspace", slug: crypto.randomUUID(), userId: owner.loginId,
  } });
  if (!workspace) throw new Error("The prepared workspace is required.");
  workspaceId = workspace.id;
});
afterEach(async () => { await identities.db.destroy(); });

describe("Saved login creation references", () => {
  it.each(["workspace", "standalone"] as const)("when a valid %s intent is saved then only its non-secret request is created", async (target) => {
    const input = intent(target === "workspace" ? workspaceId : null);
    const before = await readHubState(identities);
    const result = await prepareLoginCreation(env.DB, input);
    if (result.isErr) throw new Error("Valid creation intent must be saved.");
    expect(result.value).toEqual({ id: input.creationId, creatorLoginId: creatorId, workspaceId: input.workspaceId,
      kind: input.kind, details: input.details, createdLoginId: null, completedAt: null, createdAt: expect.any(String) });
    const saved = await readHubState(identities);
    expect(saved.creations).toEqual([{ id: input.creationId, creatorLoginId: creatorId, organizationId: input.workspaceId,
      kind: input.kind, details: JSON.stringify(input.details), createdLoginId: null, completedAt: null, createdAt: result.value.createdAt }]);
    expect({ ...saved, creations: [] }).toEqual(before);
    expect(await readCreatedLogin(env.DB, input.creationId)).toBeNull();
  });

  it("when the same intent is repeated with normalized details in another property order then its original record is returned untouched", async () => {
    const input = intent(workspaceId);
    const first = await prepareLoginCreation(env.DB, input);
    const saved = await readHubState(identities);
    const repeated = await prepareLoginCreation(env.DB, { ...input, details: {
      phone: input.details.phone, name: "  " + input.details.name + "  ",
      username: input.details.username, email: "  " + input.details.email.toUpperCase() + "  ",
    } });
    expect(repeated.toJSON()).toEqual(first.toJSON());
    expect(await readHubState(identities)).toEqual(saved);
  });

  it("when eight callers claim one intent concurrently then every result identifies the same single saved request", async () => {
    const input = intent(workspaceId);
    const before = await readHubState(identities);
    const results = await Promise.all(Array.from({ length: 8 }, async () => await prepareLoginCreation(env.DB, input)));
    const first = results[0];
    if (!first || first.isErr) throw new Error("One saved request is required.");
    expect(results.map((result) => result.toJSON())).toEqual(Array.from({ length: 8 }, () => first.toJSON()));
    const after = await readHubState(identities);
    expect(after.creations).toHaveLength(1);
    expect({ ...after, creations: [] }).toEqual(before);
  });

  it.each(["creator", "workspace", "kind", "email", "username", "name", "phone"] as const)(
    "when a saved reference is reused with another %s then the original state is preserved", async (field) => {
      const input = intent(workspaceId);
      const otherCreator = await identities.createLogin();
      const otherOwner = await identities.createLogin();
      const otherWorkspace = await identities.auth.api.createOrganization({ body: {
        name: "Other workspace", slug: crypto.randomUUID(), userId: otherOwner.loginId,
      } });
      if (!otherWorkspace) throw new Error("The second prepared workspace is required.");
      await prepareLoginCreation(env.DB, input);
      const changed = { ...input, details: { ...input.details } };
      if (field === "creator") changed.creatorLoginId = otherCreator.loginId;
      if (field === "workspace") changed.workspaceId = otherWorkspace.id;
      if (field === "kind") changed.kind = "external";
      if (field === "email") changed.details.email = "different-" + input.details.email;
      if (field === "username") changed.details.username = username();
      if (field === "name") changed.details.name = "Different person";
      if (field === "phone") changed.details.phone = "+442079460123";
      const before = await readHubState(identities);
      expect((await prepareLoginCreation(env.DB, changed)).toJSON()).toEqual(err({ code: field === "creator" ? "core_forbidden" : "accounts_creation_conflict" }).toJSON());
      expect(await readHubState(identities)).toEqual(before);
    },
  );

  it.each([
    { value: { creationId: "invalid" }, fields: ["creationId"] },
    { value: { creatorLoginId: "invalid" }, fields: ["creatorLoginId"] },
    { value: { workspaceId: "invalid" }, fields: ["workspaceId"] },
    { value: { workspaceId: null, kind: "internal" }, fields: ["workspaceId", "kind"] },
    { value: { kind: null }, fields: ["workspaceId", "kind"] },
    { value: { password: "Must-never-be-saved123!" }, fields: [] },
    { value: { details: { password: "Must-never-be-saved123!" } }, fields: ["details"] },
  ])("when invalid metadata or a password is supplied ($fields) then nothing is saved", async ({ value, fields }) => {
    const input = intent(workspaceId);
    const submitted = { ...input, ...value, details: { ...input.details, ...value.details } };
    const before = await readHubState(identities);
    expect((await prepareLoginCreation(env.DB, submitted)).toJSON()).toEqual(err({ code: "core_invalid_input", fields }).toJSON());
    expect(await readHubState(identities)).toEqual(before);
  });

  it.each([
    { value: { email: "invalid" } }, { value: { username: "1bad" } },
    { value: { name: " " } }, { value: { phone: "2025550123" } },
  ])("when stored profile details are invalid ($value) then the save rechecks them without changing state", async ({ value }) => {
    const input = intent(workspaceId);
    const before = await readHubState(identities);
    expect((await prepareLoginCreation(env.DB, { ...input, details: { ...input.details, ...value } })).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: ["details"] }).toJSON());
    expect(await readHubState(identities)).toEqual(before);
  });

  it("when the real request insert fails then no request is left and the same reference can be submitted again", async () => {
    const input = intent(workspaceId);
    const before = await readHubState(identities);
    await sql`create trigger test_refuse_request before insert on login_creations
      begin select raise(abort, 'test_request_insert_failed'); end`.execute(identities.db.withoutPlugins());
    await expect(prepareLoginCreation(env.DB, input)).rejects.toThrow("test_request_insert_failed");
    expect(await readHubState(identities)).toEqual(before);
    await sql`drop trigger test_refuse_request`.execute(identities.db.withoutPlugins());
    expect((await prepareLoginCreation(env.DB, input)).isOk).toBe(true);
  });

  it("when a matching email belongs to an unrelated login then creation lookup never adopts it", async () => {
    const existing = await identities.createLogin();
    const input = intent(workspaceId);
    input.details.email = existing.email;
    await prepareLoginCreation(env.DB, input);
    const before = await readHubState(identities);
    expect(await readCreatedLogin(env.DB, input.creationId)).toBeNull();
    expect(await readHubState(identities)).toEqual(before);
  });

  it("when shared creation, identity and membership queries run then each uses its index", async () => {
    const input = intent(workspaceId);
    await prepareLoginCreation(env.DB, input);
    const db: Parameters<typeof loginCreationQuery>[0] = await createHubConnection(env.DB);
    try {
      for (const query of [loginCreationQuery(db, input.creationId), creationLoginQuery(db, input.creationId),
        creationEmailQuery(db, input.details.email), creationWorkspaceQuery(db, workspaceId), creationMembershipQuery(db, creatorId)]) {
        const plan = await db.executeQuery<{ detail: string }>(CompiledQuery.raw("explain query plan " + query.sql, [...query.parameters]));
        expect(plan.rows.some(({ detail }) => detail.startsWith("SEARCH "))).toBe(true);
        expect(plan.rows.some(({ detail }) => detail.startsWith("SCAN "))).toBe(false);
      }
    } finally { await db.destroy(); }
  });
});

function username(): string { return "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7); }
function intent(target: string | null): {
  creationId: string; creatorLoginId: string; workspaceId: string | null; kind: "internal" | "external" | null; details: CreationDetails;
} {
  return { creationId: crypto.randomUUID(), creatorLoginId: creatorId, workspaceId: target,
    kind: target === null ? null : "internal",
    details: { email: "created-" + crypto.randomUUID() + "@example.test", username: username(), name: "Created person", phone: "+12025550123" } };
}
