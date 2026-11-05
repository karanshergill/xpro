import { env } from "cloudflare:workers";
import { sql } from "kysely";
import { err, ok } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManagementFixture, prepareManagementServices, suspendFixtureLogin, archiveFixtureLogin,
  expectManagementRefusal, expectManagementFailure, expectManagementSaved, managementLocalAccess,
  prepareManagementRefreshTokens, expectManagementTokensEnded, type ManagementAction } from "#test/login-management";
import { readResetState, signInAfterReset, signInWithResetToken, type ResetFixture } from "#test/reset-password";
import { readResetTokens } from "#test/reset-password.db";
import { hubRequest, signInPassword, removeMembership } from "#test/sign-in";
import { squarePicture } from "#test/picture-fixtures";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { archiveLogin as archive } from "./archive-login.server";
import { restoreLogin as restore } from "#restore-login/restore-login.server.ts";

// T038 supplies both real actions. Archiving never substitutes a native delete.
const archiveLogin: ManagementAction = archive;
const restoreLogin: ManagementAction = restore;
let fixture: ResetFixture;
beforeEach(async () => { fixture = await createManagementFixture(); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe("Story 5 — archiving and restoring", () => {
  it("when a master confirms archiving then the login, identifiers, picture and business history are kept while its devices and tokens lose access", async () => {
    const key = "profiles/" + fixture.target.loginId + "/" + crypto.randomUUID() + ".png", picture = squarePicture();
    await env.PROFILE_PICTURES.put(key, picture.stream(), { httpMetadata: { contentType: "image/png" } });
    await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.target.loginId, { pictureKey: key });
    const issued = await signInWithResetToken({ fixture, workspace: fixture.workspace, login: fixture.target });
    const other = await signInWithResetToken({ fixture, workspace: fixture.otherWorkspace, login: fixture.other });
    await prepareManagementRefreshTokens(fixture);
    const before = await readResetState(fixture), tokens = await readResetTokens(fixture);
    const services = await prepareManagementServices({ actor: fixture.master });
    expect((await archiveLogin(archiveInput(), services)).toJSON()).toEqual(ok({ loginId: fixture.target.loginId }).toJSON());
    const after = await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: { archivedAt: expect.any(String), statusBeforeArchiving: "active" },
      sessions: before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId), action: "stms_login_archived" });
    const audit = after.hub.audits.find((row) => row.requestId === services.context.requestId);
    if (!audit) throw new Error("The successful archive must have an audit.");
    await expectManagementTokensEnded({ fixture, before: tokens, loginId: fixture.target.loginId, revokedAt: audit.createdAt });
    const retained = await env.PROFILE_PICTURES.get(key);
    if (!retained) throw new Error("Archiving must retain the real private picture.");
    expect(new Uint8Array(await retained.arrayBuffer())).toEqual(new Uint8Array(await picture.arrayBuffer()));
    expect((await managementLocalAccess({ fixture, workspace: fixture.workspace, cookie: issued.cookie })).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect((await managementLocalAccess({ fixture, workspace: fixture.otherWorkspace, cookie: other.cookie })).isOk).toBe(true);
    expect((await userInfo(issued.accessToken)).status).toBe(401);
    expect((await userInfo(other.accessToken)).status).toBe(200);
    const blocked = await signInAfterReset({ fixture, login: fixture.target, password: signInPassword });
    expect(blocked.response.status).toBe(403);
    expect(await blocked.response.json()).toMatchObject({ code: "accounts_login_archived",
      message: "This account is no longer active. Please contact support." });
    const saved = await readResetState(fixture);
    const row = saved.hub.users.find((item) => item.id === fixture.target.loginId);
    if (!row?.username) throw new Error("The archived login must retain its username.");
    await expect(fixture.signIn.identities.auth.api.createUser({ body: {
      email: row.email, password: signInPassword, name: "Duplicate archived email", role: "user",
    } })).rejects.toThrow();
    await expect(fixture.signIn.identities.auth.api.createUser({ body: {
      email: "archived-duplicate-" + crypto.randomUUID() + "@example.test", password: signInPassword, name: "Duplicate archived username",
      role: "user", data: { username: row.username },
    } })).rejects.toThrow();
    expect(await readResetState(fixture)).toEqual(saved);
  });

  it("when a master archives a suspended login with an optional comment then its previous suspension and reason are preserved", async () => {
    await suspendFixtureLogin(fixture);
    const comment = "Retained for historical records", services = await prepareManagementServices({ actor: fixture.master });
    const before = await readResetState(fixture);
    expect((await archiveLogin({ ...archiveInput(), comment }, services)).toJSON()).toEqual(ok({ loginId: fixture.target.loginId }).toJSON());
    await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: { archivedAt: expect.any(String), statusBeforeArchiving: "suspended" },
      sessions: before.hub.sessions, action: "stms_login_archived", comment });
  });

  it.each(["active", "suspended"] as const)(
    "when a master restores a previously %s login then its previous status returns without recreating sessions or changing membership", async (previousStatus) => {
      const issued = await signInWithResetToken({ fixture, workspace: fixture.workspace, login: fixture.target });
      if (previousStatus === "suspended") await suspendFixtureLogin(fixture);
      await archiveFixtureLogin(fixture, { loginId: fixture.target.loginId, previousStatus });
      const services = await prepareManagementServices({ actor: fixture.master }), before = await readResetState(fixture);
      const tokens = await readResetTokens(fixture);
      expect((await restoreLogin({ loginId: fixture.target.loginId }, services)).toJSON()).toEqual(ok({ loginId: fixture.target.loginId }).toJSON());
      await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
        userChanges: { archivedAt: null, statusBeforeArchiving: null }, sessions: before.hub.sessions, action: "stms_login_restored" });
      expect(await readResetTokens(fixture)).toEqual(tokens);
      expect((await userInfo(issued.accessToken)).status).toBe(401);
      const fresh = await signInAfterReset({ fixture, login: fixture.target, password: signInPassword });
      expect(fresh.response.status).toBe(previousStatus === "active" ? 200 : 403);
      for (const device of fixture.devices) expect(await fixture.signIn.identities.auth.api.getSession({ headers: { cookie: device.cookie } })).toBeNull();
    },
  );

  it("when the target is another master then archiving preserves its global role and follows the same audit rule", async () => {
    await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.target.loginId, { role: "admin" });
    const services = await prepareManagementServices({ actor: fixture.master }), before = await readResetState(fixture);
    expect((await archiveLogin(archiveInput(), services)).isOk).toBe(true);
    await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: { archivedAt: expect.any(String), statusBeforeArchiving: "active" },
      sessions: before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId), action: "stms_login_archived" });
  });

  it("when membership was removed while a login was archived then restoration does not recreate it or alter local user history", async () => {
    await archiveFixtureLogin(fixture, { loginId: fixture.target.loginId, previousStatus: "active" });
    await removeMembership({ identities: fixture.signIn.identities, loginId: fixture.target.loginId, workspaceId: fixture.workspace.id });
    const services = await prepareManagementServices({ actor: fixture.master }), before = await readResetState(fixture);
    expect(before.hub.members.filter((row) => row.userId === fixture.target.loginId)).toEqual([]);
    expect((await restoreLogin({ loginId: fixture.target.loginId }, services)).toJSON()).toEqual(ok({ loginId: fixture.target.loginId }).toJSON());
    await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: { archivedAt: null, statusBeforeArchiving: null }, sessions: before.hub.sessions, action: "stms_login_restored" });
  });

  it("when a master tries to archive their own login then every record and acting session stays unchanged", async () => {
    await expectManagementRefusal({ fixture, action: archiveLogin, submitted: { ...archiveInput(), loginId: fixture.master.loginId },
      actor: fixture.master, error: { code: "stms_self_archive_forbidden" } });
  });

  it.each([undefined, false, "true"])("when archive confirmation is %s then no archive is saved", async (confirmed) => {
    await expectManagementRefusal({ fixture, action: archiveLogin, submitted: { ...archiveInput(), confirmed },
      actor: fixture.master, error: { code: "core_invalid_input", fields: ["confirmed"] } });
  });

  it("when the optional archive comment has an invalid type then it is refused without changing history", async () => {
    await expectManagementRefusal({ fixture, action: archiveLogin, submitted: { ...archiveInput(), comment: 7 },
      actor: fixture.master, error: { code: "core_invalid_input", fields: ["comment"] } });
  });

  it("when an already archived login is archived again then its previous status cannot be overwritten", async () => {
    await archiveFixtureLogin(fixture, { loginId: fixture.target.loginId, previousStatus: "active" });
    await expectManagementRefusal({ fixture, action: archiveLogin, submitted: archiveInput(), actor: fixture.master,
      error: { code: "stms_login_state_conflict" } });
  });

  it("when a non-archived login is restored then no new audit or state change is created", async () => {
    await expectManagementRefusal({ fixture, action: restoreLogin, submitted: { loginId: fixture.target.loginId }, actor: fixture.master,
      error: { code: "stms_login_state_conflict" } });
  });

  it.each(["login", "sessions", "audit", "access token", "refresh token"] as const)(
    "when archive's %s save fails then no archive, session revocation or audit survives on its own", async (stage) => {
      await signInWithResetToken({ fixture, workspace: fixture.workspace, login: fixture.target });
      await prepareManagementRefreshTokens(fixture);
      const events = { login: 'update of archived_at on "user"', sessions: 'delete on "session"', audit: 'insert on audit_entries',
        "access token": 'update of revoked on "oauthAccessToken"', "refresh token": 'update of revoked on "oauthRefreshToken"' };
      await sql`create trigger test_refuse_archive before ${sql.raw(events[stage])}
        begin select raise(abort, 'private_archive_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
      await expectManagementFailure({ fixture, action: archiveLogin, operation: "stms_archive_login", submitted: archiveInput() });
    },
  );

  it.each(["login", "audit"] as const)("when restore's %s save fails then the archive and its previous status remain", async (stage) => {
    await archiveFixtureLogin(fixture, { loginId: fixture.target.loginId, previousStatus: "active" });
    const event = stage === "login" ? 'update of archived_at on "user"' : 'insert on audit_entries';
    await sql`create trigger test_refuse_restore before ${sql.raw(event)}
      begin select raise(abort, 'private_restore_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
    await expectManagementFailure({ fixture, action: restoreLogin, operation: "stms_restore_login", submitted: { loginId: fixture.target.loginId } });
  });

  it.each(["/admin/remove-user", "/delete-user"])("when a master posts to native %s then physical deletion cannot bypass archiving", async (path) => {
    const before = await readResetState(fixture);
    expect((await handleHubAuthRequest(hubRequest("/api/auth" + path, { userId: fixture.target.loginId }, fixture.master.cookie),
      fixture.signIn.settings)).status).toBe(404);
    expect(await readResetState(fixture)).toEqual(before);
  });
});

const writes = [
  { name: "archive", action: archiveLogin, submitted: archiveInput },
  { name: "restore", action: restoreLogin, submitted: () => ({ loginId: fixture.target.loginId }) },
];
describe.each(writes)("master-only $name", ({ name, action, submitted }) => {
  it("when two requests claim the same transition then one audit commits and the other request conflicts", async () => {
    if (name === "restore") await archiveFixtureLogin(fixture, { loginId: fixture.target.loginId, previousStatus: "active" });
    const services = [await prepareManagementServices({ actor: fixture.master }), await prepareManagementServices({ actor: fixture.master })];
    const before = await readResetState(fixture);
    const results = await Promise.all(services.map((context) => action(submitted(), context)));
    expect(results.filter((result) => result.isOk)).toHaveLength(1);
    expect(results.filter((result) => result.isErr).map((result) => result.toJSON()))
      .toEqual([err({ code: "stms_login_state_conflict" }).toJSON()]);
    const winner = services[results.findIndex((result) => result.isOk)];
    if (!winner) throw new Error("Exactly one real archive transition must win.");
    await expectManagementSaved({ fixture, before, services: winner, loginId: fixture.target.loginId,
      userChanges: name === "archive" ? { archivedAt: expect.any(String), statusBeforeArchiving: "active" } : { archivedAt: null, statusBeforeArchiving: null },
      sessions: name === "archive" ? before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId) : before.hub.sessions,
      action: name === "archive" ? "stms_login_archived" : "stms_login_restored" });
  });

  it.each(["user", "owner", "admin", "member"] as const)("when a non-master %s attempts the action then no record or audit changes", async (role) => {
    const actor = role === "user" ? fixture.other : await fixture.signIn.identities.signIn();
    if (role !== "user") await fixture.signIn.identities.auth.api.addMember({ body: {
      userId: actor.loginId, organizationId: fixture.workspace.id, role,
    } });
    await expectManagementRefusal({ fixture, action, submitted: submitted(), actor, error: { code: "core_forbidden" } });
  });
  it("when an anonymous request attempts the action then there is no write", async () => {
    await expectManagementRefusal({ fixture, action, submitted: submitted(), actor: null, error: { code: "core_unauthenticated" } });
  });
  it("when the body tries to replace the acting master or previous status then strict input refuses it", async () => {
    await expectManagementRefusal({ fixture, action, submitted: { ...submitted(), actorLoginId: fixture.other.loginId, statusBeforeArchiving: "active" },
      actor: fixture.master, error: { code: "core_invalid_input", fields: [] } });
  });
  it("when the target ID is malformed then the input is refused safely", async () => {
    await expectManagementRefusal({ fixture, action, submitted: { ...submitted(), loginId: "private-target" },
      actor: fixture.master, error: { code: "core_invalid_input", fields: ["loginId"] } });
  });
  it("when the target does not exist then no orphan history is written", async () => {
    await expectManagementRefusal({ fixture, action, submitted: { ...submitted(), loginId: crypto.randomUUID() },
      actor: fixture.master, error: { code: "stms_login_not_found" } });
  });
});

function archiveInput(): { loginId: string; confirmed: true } { return { loginId: fixture.target.loginId, confirmed: true }; }
async function userInfo(token: string): Promise<Response> {
  return await handleHubAuthRequest(new Request("https://hub.example.test/api/auth/oauth2/userinfo",
    { headers: { authorization: "Bearer " + token } }), fixture.signIn.settings);
}
