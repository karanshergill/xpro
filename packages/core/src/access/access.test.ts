import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { CompiledQuery } from "kysely";
import { createHubIdentities, type HubIdentities, type SignedInLogin } from "#test/hub-identities";
import { saveHub, validateHubLocalAccess as validate } from "#test/hub-access";
import { err, ok } from "true-myth/result";
import { v7 } from "uuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceDatabase } from "#database/workspace.db.ts";
import { save } from "#save/save.db.ts";
import { createRequestContext } from "#server/request.ts";
import type { AccessActor, AccessRequest, AccessRequestInput, HubAccessInput, HubAccessResult } from "./access";
import { createAccessRequest as createRequest } from "./access.server";

// These signatures define T012's contract without providing an implementation.
const createAccessRequest: (input: AccessRequestInput) => Promise<AccessRequest> = createRequest;
const validateHubLocalAccess: (database: D1Database, input: HubAccessInput) => Promise<HubAccessResult> = validate;
let identities: HubIdentities;

beforeEach(async () => { identities = await createHubIdentities(env.DB); });
afterEach(async () => { vi.useRealTimers(); await identities.db.destroy(); });

describe("shared access checks", () => {
  it("when a workspace member has the required local permission then the actual signed-in login is returned", async () => {
    const { login, workspaceId } = await makeMember();
    await makeMember();
    const before = await readHubState();
    const request = await makeRequest({ login, workspaceId });
    expect(request.access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(ok(actor(login, "member")).toJSON());
    expect(request.calls).toEqual([{ loginId: login.loginId, hubSessionId: login.hubSessionId, workspaceId, context: request.context }]);
    expect(await readHubState()).toEqual(before);
  });

  it("when there is no local session then access is refused without calling the Hub", async () => {
    const request = await makeRequest({ login: null, workspaceId: v7() });
    expect(request.access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect(request.calls).toEqual([]);
  });

  it("when a different login is paired with a real Hub session then it cannot inherit the session owner's access", async () => {
    const { login, workspaceId } = await makeMember();
    const stranger = await identities.signIn();
    const request = await makeRequest({ login: { ...login, loginId: stranger.loginId }, workspaceId });
    expect(request.access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
  });

  it("when a Hub session is unknown then locally granted permission cannot authenticate it", async () => {
    const { login, workspaceId } = await makeMember();
    const request = await makeRequest({ login: { ...login, hubSessionId: v7() }, workspaceId });
    expect(request.access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
  });

  it("when a Hub session is signed out then the next action is refused without a workspace sign-out message", async () => {
    const { login, workspaceId } = await makeMember();
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).isOk).toBe(true);
    await identities.auth.api.signOut({ headers: { cookie: login.cookie } });
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
  });

  it("when all Hub sessions are revoked then both devices lose access on their next action", async () => {
    const { login, workspaceId } = await makeMember();
    const secondDevice = await identities.signInAgain(login);
    const administrator = await identities.signIn({ role: "admin" });
    expect(secondDevice.hubSessionId).not.toBe(login.hubSessionId);
    await identities.auth.api.revokeUserSessions({ headers: { cookie: administrator.cookie }, body: { userId: login.loginId } });
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect((await makeRequest({ login: secondDevice, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect(await identities.auth.api.getSession({ headers: { cookie: login.cookie } })).toBeNull();
  });

  it("when the Hub session reaches its original expiry then the next action is refused", async () => {
    const { login, workspaceId } = await makeMember();
    const session = await identities.auth.api.getSession({ headers: { cookie: login.cookie } });
    if (!session) throw new Error("The real HTTP sign-in did not create a session.");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(session.session.expiresAt);
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
  });

  it.each(["banned", "archivedAt"] as const)("when a login becomes %s then its retained session cannot grant access", async (field) => {
    const { login, workspaceId } = await makeMember();
    await saveHub(env.DB, [identities.db.updateTable("user").set(field, field === "banned" ? 1 : new Date().toISOString())
      .where("id", "=", login.loginId).compile()]);
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_login_inactive" }).toJSON());
    expect(await identities.db.selectFrom("session").select("id").where("id", "=", login.hubSessionId).executeTakeFirst()).toBeDefined();
  });

  it("when membership is removed then the next action is refused even though the Hub session remains active", async () => {
    const { login, owner, workspaceId, memberId } = await makeMember();
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).isOk).toBe(true);
    await identities.auth.api.removeMember({ headers: { cookie: owner.cookie }, body: { memberIdOrEmail: memberId, organizationId: workspaceId } });
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_forbidden" }).toJSON());
    expect((await identities.auth.api.getSession({ headers: { cookie: login.cookie } }))?.user.id).toBe(login.loginId);
  });

  it("when an organization role changes then the next action receives the current role without treating it as a global master", async () => {
    const { login, owner, workspaceId, memberId } = await makeMember("admin");
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(ok(actor(login, "admin")).toJSON());
    await identities.auth.api.updateMemberRole({ headers: { cookie: owner.cookie }, body: { memberId, organizationId: workspaceId, role: "member" } });
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(ok(actor(login, "member")).toJSON());
  });

  it("when membership is granted after a refused request then a new request uses the new membership", async () => {
    const { workspaceId } = await makeMember();
    const login = await identities.signIn();
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_forbidden" }).toJSON());
    await identities.auth.api.addMember({ body: { userId: login.loginId, organizationId: workspaceId, role: "member" } });
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(ok(actor(login, "member")).toJSON());
  });

  it.each(["owner", "admin", "member"] as const)("when a workspace %s lacks the required local permission then membership alone cannot grant it", async (role) => {
    const { login, workspaceId } = await makeMember(role);
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: false }).toJSON())
      .toEqual(err({ code: "core_forbidden" }).toJSON());
  });

  it("when the requested workspace differs from the login's membership then access to that workspace is refused", async () => {
    const { login } = await makeMember();
    const { workspaceId } = await makeMember();
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_forbidden" }).toJSON());
  });

  it("when a local user exists without Hub membership then that local record cannot grant workspace access", async () => {
    const login = await identities.signIn();
    const { workspaceId } = await makeMember();
    const workspace = env.WORKSPACES.getByName(workspaceId);
    const user = { id: v7(), loginId: login.loginId, kind: "internal" as const, createdAt: new Date().toISOString(), archivedAt: null };
    const localUsers = await runInDurableObject(workspace, async (_instance, state) => {
      const db = createWorkspaceDatabase(state.storage.sql);
      try {
        await save(state.storage, async () => { await db.insertInto("workspaceUsers").values(user).execute(); return ok(user.id); });
        return await db.selectFrom("workspaceUsers").selectAll().execute();
      } finally { await db.destroy(); }
    });
    expect(localUsers).toEqual([user]);
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_forbidden" }).toJSON());
  });

  it("when a master has no MFA verification then its role cannot bypass membership or local permission", async () => {
    const master = await identities.signIn({ role: "admin" });
    const { workspaceId } = await makeMember();
    const request = await makeRequest({ login: master, workspaceId });
    expect(request.access.authorize({ kind: "protected", hasLocalPermission: false }).toJSON())
      .toEqual(err({ code: "core_mfa_required" }).toJSON());
    expect(await identities.db.withoutPlugins().selectFrom("member").selectAll().where("userId", "=", master.loginId).execute()).toEqual([]);
    expect(request.calls).toHaveLength(1);
  });

  it("when a master's global role is removed then its next request loses the membership and local-permission bypass", async () => {
    const administrator = await identities.signIn({ role: "admin" });
    const master = await identities.signIn({ role: "admin" });
    const { workspaceId } = await makeMember();
    expect((await makeRequest({ login: master, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: false }).toJSON())
      .toEqual(err({ code: "core_mfa_required" }).toJSON());
    await identities.auth.api.setRole({ headers: { cookie: administrator.cookie }, body: { userId: master.loginId, role: "user" } });
    expect((await makeRequest({ login: master, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: false }).toJSON())
      .toEqual(err({ code: "core_forbidden" }).toJSON());
  });

  it("when the global master role is granted then the next request requires MFA before privileged access", async () => {
    const administrator = await identities.signIn({ role: "admin" });
    const login = await identities.signIn();
    const { workspaceId } = await makeMember();
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: false }).toJSON())
      .toEqual(err({ code: "core_forbidden" }).toJSON());
    await identities.auth.api.setRole({ headers: { cookie: administrator.cookie }, body: { userId: login.loginId, role: "admin" } });
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: false }).toJSON())
      .toEqual(err({ code: "core_mfa_required" }).toJSON());
  });

  it.each(["user", "admin"] as const)("when a %s login's creation is unfinished then a valid session and complete profile cannot grant protected access", async (role) => {
    const { login, workspaceId } = await makeMember("member", role);
    const creator = await identities.signIn({ role: "admin" });
    const id = v7();
    await saveHub(env.DB, [
      identities.db.insertInto("loginCreations").values({ id, creatorLoginId: creator.loginId, organizationId: workspaceId,
        createdLoginId: login.loginId, kind: "internal", details: "{}", createdAt: new Date().toISOString(), completedAt: null }).compile(),
      identities.db.updateTable("user").set({ loginCreationId: id }).where("id", "=", login.loginId).compile(),
    ]);
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_creation_incomplete" }).toJSON());
  });

  it("when a login is linked to its own completed creation then creation completion permits the normal access check", async () => {
    const creator = await identities.signIn({ role: "admin" });
    const login = await identities.signIn();
    await recordCompletedCreation({ loginId: login.loginId, createdLoginId: login.loginId, creatorLoginId: creator.loginId });
    expect((await makeRequest({ login, workspaceId: null })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(ok(actor(login, null)).toJSON());
  });

  it("when a completion record belongs to a different login then its marker cannot complete this login", async () => {
    const creator = await identities.signIn({ role: "admin" });
    const login = await identities.signIn();
    const other = await identities.signIn();
    await recordCompletedCreation({ loginId: login.loginId, createdLoginId: other.loginId, creatorLoginId: creator.loginId });
    expect((await makeRequest({ login, workspaceId: null })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_creation_incomplete" }).toJSON());
  });

  it.each(["user", "admin"] as const)("when a %s login's profile is unfinished then protected access requires the applicable MFA/profile completion", async (role) => {
    const login = await identities.signIn({ role, username: null, name: "", phone: null });
    expect((await makeRequest({ login, workspaceId: null })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err(role === "admin" ? { code: "core_mfa_required" } : { code: "core_profile_incomplete", fields: ["username", "name", "phone"] }).toJSON());
  });

  it.each([
    { field: "username", input: { username: null } },
    { field: "name", input: { name: "" } },
    { field: "phone", input: { phone: null } },
  ] as const)("when only $field is missing then only that field is requested", async ({ field, input }) => {
    const login = await identities.signIn(input);
    expect((await makeRequest({ login, workspaceId: null })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_profile_incomplete", fields: [field] }).toJSON());
  });

  it.each(["complete_profile", "check_session", "sign_out"] as const)("when a valid login's profile is unfinished then %s remains allowed", async (kind) => {
    const login = await identities.signIn({ username: null, name: "", phone: null });
    expect((await makeRequest({ login, workspaceId: null })).access.authorize({ kind }).toJSON())
      .toEqual(ok(actor(login, null)).toJSON());
  });

  it("when stored profile details are invalid rather than missing then they still block protected access", async () => {
    const login = await identities.signIn();
    await saveHub(env.DB, [identities.db.updateTable("user").set({ username: "1bad", name: " ", phone: "invalid" })
      .where("id", "=", login.loginId).compile()]);
    expect((await makeRequest({ login, workspaceId: null })).access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_profile_incomplete", fields: ["username", "name", "phone"] }).toJSON());
  });

  it("when several functions authorize concurrently in one request then they make one combined Hub check", async () => {
    const { login, workspaceId } = await makeMember();
    const request = await makeRequest({ login, workspaceId });
    const results = await Promise.all([1, 2, 3].map(async () => request.access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON()));
    expect(results).toEqual([1, 2, 3].map(() => ok(actor(login, "member")).toJSON()));
    expect(request.calls).toEqual([{ loginId: login.loginId, hubSessionId: login.hubSessionId, workspaceId, context: request.context }]);
  });

  it("when local permission facts differ between actions then reusing the Hub result does not reuse a permission decision", async () => {
    const { login, workspaceId } = await makeMember();
    const request = await makeRequest({ login, workspaceId });
    expect(request.access.authorize({ kind: "protected", hasLocalPermission: true }).isOk).toBe(true);
    expect(request.access.authorize({ kind: "protected", hasLocalPermission: false }).toJSON())
      .toEqual(err({ code: "core_forbidden" }).toJSON());
    expect(request.access.authorize({ kind: "protected", hasLocalPermission: true }).isOk).toBe(true);
    expect(request.calls).toHaveLength(1);
  });

  it("when a new request carries the same correlation ID then it still checks current Hub state", async () => {
    const { login, workspaceId } = await makeMember();
    const requestId = v7();
    const first = await makeRequest({ login, workspaceId, requestId });
    expect(first.access.authorize({ kind: "protected", hasLocalPermission: true }).isOk).toBe(true);
    await identities.auth.api.signOut({ headers: { cookie: login.cookie } });
    const next = await makeRequest({ login, workspaceId, requestId });
    expect(next.access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect(first.calls).toHaveLength(1);
    expect(next.calls).toHaveLength(1);
  });

  it("when Hub validation cannot complete then access is refused and no previous successful result is reused", async () => {
    const { login, workspaceId } = await makeMember();
    expect((await makeRequest({ login, workspaceId })).access.authorize({ kind: "protected", hasLocalPermission: true }).isOk).toBe(true);
    await identities.db.withoutPlugins().schema.dropTable("session").execute();
    const request = await makeRequest({ login, workspaceId });
    expect(request.access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expect(request.calls).toHaveLength(1);
  });
});

async function makeRequest(input: { login: SignedInLogin | null; workspaceId: string | null; requestId?: string }) {
  const calls: HubAccessInput[] = [];
  const context = input.requestId ? { requestId: input.requestId } : createRequestContext();
  const access = await createAccessRequest({ app: "workspace",
    session: input.login ? { loginId: input.login.loginId, hubSessionId: input.login.hubSessionId } : null,
    workspaceId: input.workspaceId,
    context,
    hub: { async validateAccess(value) { calls.push(structuredClone(value)); return await validateHubLocalAccess(env.DB, value); } },
  });
  return { access, calls, context };
}

async function makeMember(role: "owner" | "admin" | "member" = "member", globalRole: "user" | "admin" = "user") {
  const owner = await identities.signIn();
  const organization = await identities.auth.api.createOrganization({ body: { name: "Access workspace", slug: `access-${v7()}`, userId: owner.loginId } });
  if (!organization) throw new Error("The native Organization API did not create a workspace.");
  const login = await identities.signIn({ role: globalRole });
  const member = await identities.auth.api.addMember({ body: { userId: login.loginId, organizationId: organization.id, role } });
  if (!member) throw new Error("The native Organization API did not add its member.");
  return { login, owner, workspaceId: organization.id, memberId: member.id };
}

function actor(login: SignedInLogin, membershipRole: AccessActor["membershipRole"]): AccessActor {
  return { loginId: login.loginId, isMaster: false, membershipRole };
}

async function recordCompletedCreation(input: { loginId: string; createdLoginId: string; creatorLoginId: string }) {
  const id = v7();
  const createdAt = new Date().toISOString();
  const queries: CompiledQuery[] = [
    identities.db.insertInto("loginCreations").values({ id, creatorLoginId: input.creatorLoginId, organizationId: null,
      createdLoginId: input.createdLoginId, kind: null, details: "{}", createdAt, completedAt: createdAt }).compile(),
    identities.db.updateTable("user").set({ loginCreationId: id }).where("id", "=", input.loginId).compile(),
    identities.db.insertInto("auditEntries").values({ id: v7(), action: "stms_login_created", outcome: "success",
      actorLoginId: input.creatorLoginId, affectedLoginId: input.createdLoginId, reason: null, comment: null,
      requestId: createRequestContext().requestId, createdAt }).compile(),
  ];
  await saveHub(env.DB, queries);
}

async function readHubState() {
  return {
    users: await identities.db.selectFrom("user").selectAll().orderBy("id").execute(),
    credentials: await identities.db.selectFrom("account").selectAll().orderBy("id").execute(),
    sessions: await identities.db.selectFrom("session").selectAll().orderBy("id").execute(),
    organizations: await identities.db.selectFrom("organization").selectAll().orderBy("id").execute(),
    members: await identities.db.selectFrom("member").selectAll().orderBy("id").execute(),
    creations: await identities.db.selectFrom("loginCreations").selectAll().orderBy("id").execute(),
    audit: await identities.db.selectFrom("auditEntries").selectAll().orderBy("id").execute(),
  };
}
