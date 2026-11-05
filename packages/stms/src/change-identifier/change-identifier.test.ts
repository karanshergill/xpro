import { env } from "cloudflare:workers";
import { saveHub } from "@xpro/core/server";
import { checkUsername } from "@xpro/accounts/server";
import { sql } from "kysely";
import { err, ok } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManagementFixture, prepareManagementServices, expectManagementRefusal, expectManagementFailure,
  expectManagementSaved, findManagementUser, suspendFixtureLogin, archiveFixtureLogin, managementLocalAccess,
  prepareManagementRefreshTokens, expectManagementTokensEnded, type ManagementAction } from "#test/login-management";
import { readResetState, signInAfterReset, signInWithResetToken, type ResetFixture } from "#test/reset-password";
import { readResetTokens } from "#test/reset-password.db";
import { hubRequest, signInPassword } from "#test/sign-in";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { changeEmail as email } from "#change-email/change-email.server.ts";
import { changeUsername as username } from "#change-username/change-username.server.ts";

// T039 supplies the real actions. Old usernames are reserved in the same audited save.
const changeEmail: ManagementAction = email;
const changeUsername: ManagementAction = username;
let fixture: ResetFixture;
beforeEach(async () => { fixture = await createManagementFixture(); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

const changes: { field: "email" | "username"; action: ManagementAction; next: string; audit: string }[] = [
  { field: "email", action: changeEmail, next: "updated-person@example.test", audit: "stms_email_changed" },
  { field: "username", action: changeUsername, next: "newname", audit: "stms_username_changed" },
];
describe.each(changes)("Story 5 — change $field", ({ field, action, next, audit }) => {
  it("when the master changes the identifier without a comment then only that identifier changes and all old devices and tokens lose access", async () => {
    const issued = await signInWithResetToken({ fixture, workspace: fixture.workspace, login: fixture.target });
    const other = await signInWithResetToken({ fixture, workspace: fixture.otherWorkspace, login: fixture.other });
    await prepareManagementRefreshTokens(fixture);
    const before = await readResetState(fixture), tokens = await readResetTokens(fixture);
    const row = findManagementUser(before, fixture.target.loginId);
    const services = await prepareManagementServices({ actor: fixture.master });
    const submitted = field === "email" ? "  " + next.toUpperCase() + "  " : next;
    expect((await action({ loginId: fixture.target.loginId, [field]: submitted }, services)).toJSON())
      .toEqual(ok({ loginId: fixture.target.loginId }).toJSON());
    const reservations = field === "email" ? before.hub.reservations : expect.arrayContaining([...before.hub.reservations, {
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/), username: row.username, addedAt: expect.any(String),
    }]);
    const after = await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: field === "email" ? { email: next } : { username: next, displayUsername: next },
      sessions: before.hub.sessions.filter((item) => item.userId !== fixture.target.loginId), action: audit, reservations });
    expect(after.hub.reservations).toHaveLength(before.hub.reservations.length + (field === "username" ? 1 : 0));
    const savedAudit = after.hub.audits.find((item) => item.requestId === services.context.requestId);
    if (!savedAudit) throw new Error("The identifier change must have an audit.");
    await expectManagementTokensEnded({ fixture, before: tokens, loginId: fixture.target.loginId, revokedAt: savedAudit.createdAt });
    expect((await managementLocalAccess({ fixture, workspace: fixture.workspace, cookie: issued.cookie })).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect((await managementLocalAccess({ fixture, workspace: fixture.otherWorkspace, cookie: other.cookie })).isOk).toBe(true);
    expect((await userInfo(issued.accessToken)).status).toBe(401);
    expect((await userInfo(other.accessToken)).status).toBe(200);
    for (const device of fixture.devices) expect(await fixture.signIn.identities.auth.api.getSession({ headers: { cookie: device.cookie } })).toBeNull();
    const old = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/" + field,
      { [field]: row[field], password: signInPassword }), fixture.signIn.settings);
    expect(old.status).toBe(401);
    const fresh = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/" + field,
      { [field]: next, password: signInPassword }), fixture.signIn.settings);
    expect(fresh.status).toBe(200);
    if (field === "username") {
      expect((await checkUsername(env.DB, row.username)).toJSON()).toEqual(err({ code: "accounts_username_reserved" }).toJSON());
    }
  });

  it("when an identifier change includes an optional comment then one audit attributes it to the actual master", async () => {
    const comment = "Identity checked through support";
    const services = await prepareManagementServices({ actor: fixture.master }), before = await readResetState(fixture);
    expect((await action({ loginId: fixture.target.loginId, [field]: next, comment }, services)).isOk).toBe(true);
    const row = findManagementUser(before, fixture.target.loginId);
    const reservations = field === "email" ? before.hub.reservations : expect.arrayContaining([...before.hub.reservations,
      { id: expect.any(String), username: row.username, addedAt: expect.any(String) }]);
    const after = await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: field === "email" ? { email: next } : { username: next, displayUsername: next },
      sessions: before.hub.sessions.filter((item) => item.userId !== fixture.target.loginId), action: audit, comment, reservations });
    expect(after.hub.reservations).toHaveLength(before.hub.reservations.length + (field === "username" ? 1 : 0));
  });

  it("when the submitted identifier is already the same normalized value then success changes no timestamp, session or audit", async () => {
    const before = await readResetState(fixture), row = findManagementUser(before, fixture.target.loginId);
    const current = field === "email" ? "  " + row.email.toUpperCase() + "  " : row.username;
    expect((await action({ loginId: fixture.target.loginId, [field]: current }, await prepareManagementServices({ actor: fixture.master }))).toJSON())
      .toEqual(ok({ loginId: fixture.target.loginId }).toJSON());
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when a master changes their own identifier then their old acting session ends without changing their global role", async () => {
    const services = await prepareManagementServices({ actor: fixture.master }), before = await readResetState(fixture);
    const master = findManagementUser(before, fixture.master.loginId);
    const reservations = field === "email" ? before.hub.reservations : expect.arrayContaining([...before.hub.reservations,
      { id: expect.any(String), username: master.username, addedAt: expect.any(String) }]);
    expect((await action({ loginId: fixture.master.loginId, [field]: next }, services)).toJSON())
      .toEqual(ok({ loginId: fixture.master.loginId }).toJSON());
    const after = await expectManagementSaved({ fixture, before, services, loginId: fixture.master.loginId,
      userChanges: field === "email" ? { email: next } : { username: next, displayUsername: next },
      sessions: before.hub.sessions.filter((item) => item.userId !== fixture.master.loginId), action: audit, reservations });
    expect(after.hub.reservations).toHaveLength(before.hub.reservations.length + (field === "username" ? 1 : 0));
    expect(await fixture.signIn.identities.auth.api.getSession({ headers: { cookie: fixture.master.cookie } })).toBeNull();
  });

  it.each(["suspended", "archived"] as const)("when the target is %s then an identifier change preserves that status and the existing password", async (status) => {
    if (status === "suspended") await suspendFixtureLogin(fixture);
    else await archiveFixtureLogin(fixture, { loginId: fixture.target.loginId, previousStatus: "active" });
    const services = await prepareManagementServices({ actor: fixture.master }), before = await readResetState(fixture);
    const row = findManagementUser(before, fixture.target.loginId);
    expect((await action({ loginId: fixture.target.loginId, [field]: next }, services)).isOk).toBe(true);
    const reservations = field === "email" ? before.hub.reservations : expect.arrayContaining([...before.hub.reservations,
      { id: expect.any(String), username: row.username, addedAt: expect.any(String) }]);
    const after = await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: field === "email" ? { email: next } : { username: next, displayUsername: next }, sessions: before.hub.sessions,
      action: audit, reservations });
    expect(after.hub.reservations).toHaveLength(before.hub.reservations.length + (field === "username" ? 1 : 0));
    const login = { ...fixture.target, email: field === "email" ? next : fixture.target.email };
    expect((await signInAfterReset({ fixture, login, password: signInPassword })).response.status).toBe(403);
  });

  it.each(["active", "suspended", "archived"] as const)("when the value belongs to another %s login then uniqueness refuses the change", async (status) => {
    if (status === "suspended") await suspendFixtureLogin(fixture, fixture.other.loginId);
    if (status === "archived") await archiveFixtureLogin(fixture, { loginId: fixture.other.loginId, previousStatus: "active" });
    const before = await readResetState(fixture), other = findManagementUser(before, fixture.other.loginId);
    const value = field === "email" ? "  " + other.email.toUpperCase() + "  " : other.username;
    await expectManagementRefusal({ fixture, action, submitted: { loginId: fixture.target.loginId, [field]: value },
      actor: fixture.master, error: { code: field === "email" ? "accounts_email_taken" : "accounts_username_taken" } });
  });

  it("when two changes claim the same free value then exactly one wins with one audit and only its sessions revoked", async () => {
    const services = [await prepareManagementServices({ actor: fixture.master }), await prepareManagementServices({ actor: fixture.master })];
    const before = await readResetState(fixture), ids = [fixture.target.loginId, fixture.other.loginId];
    const results = await Promise.all(ids.map((loginId, index) => {
      const context = services[index];
      if (!context) throw new Error("Each actual concurrent request needs its own services.");
      return action({ loginId, [field]: next }, context);
    }));
    expect(results.filter((result) => result.isOk)).toHaveLength(1);
    expect(results.filter((result) => result.isErr).map((result) => result.toJSON()))
      .toEqual([err({ code: field === "email" ? "accounts_email_taken" : "accounts_username_taken" }).toJSON()]);
    const index = results.findIndex((result) => result.isOk), loginId = ids[index], context = services[index];
    if (!loginId || !context) throw new Error("Exactly one real request must win.");
    const row = findManagementUser(before, loginId);
    const reservations = field === "email" ? before.hub.reservations : expect.arrayContaining([...before.hub.reservations,
      { id: expect.any(String), username: row.username, addedAt: expect.any(String) }]);
    const after = await expectManagementSaved({ fixture, before, services: context, loginId,
      userChanges: field === "email" ? { email: next } : { username: next, displayUsername: next },
      sessions: before.hub.sessions.filter((item) => item.userId !== loginId), action: audit, reservations });
    expect(after.hub.reservations).toHaveLength(before.hub.reservations.length + (field === "username" ? 1 : 0));
  });

  it.each(["login", "sessions", "audit", "access token", "refresh token"] as const)(
    "when the %s save fails then the identifier, all sessions/tokens, reservations and audit remain unchanged", async (stage) => {
      await signInWithResetToken({ fixture, workspace: fixture.workspace, login: fixture.target });
      await prepareManagementRefreshTokens(fixture);
      const events = { login: "update of " + field + ' on "user"', sessions: 'delete on "session"', audit: 'insert on audit_entries',
        "access token": 'update of revoked on "oauthAccessToken"', "refresh token": 'update of revoked on "oauthRefreshToken"' };
      await sql`create trigger test_refuse_identifier before ${sql.raw(events[stage])}
        begin select raise(abort, 'private_identifier_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
      await expectManagementFailure({ fixture, action, operation: "stms_change_" + field, submitted: { loginId: fixture.target.loginId, [field]: next } });
    },
  );

  it.each(["user", "owner", "admin", "member"] as const)("when a non-master %s attempts the change then no identity, session or audit changes", async (role) => {
    const actor = role === "user" ? fixture.other : await fixture.signIn.identities.signIn();
    if (role !== "user") await fixture.signIn.identities.auth.api.addMember({ body: {
      userId: actor.loginId, organizationId: fixture.workspace.id, role,
    } });
    await expectManagementRefusal({ fixture, action, submitted: { loginId: fixture.target.loginId, [field]: next },
      actor, error: { code: "core_forbidden" } });
  });
  it("when the actor is anonymous then the identifier remains private and unchanged", async () => {
    await expectManagementRefusal({ fixture, action, submitted: { loginId: fixture.target.loginId, [field]: next },
      actor: null, error: { code: "core_unauthenticated" } });
  });
  it("when the master has ended their session then a fresh change is refused", async () => {
    await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: fixture.master.cookie } });
    await expectManagementRefusal({ fixture, action, submitted: { loginId: fixture.target.loginId, [field]: next },
      actor: fixture.master, error: { code: "core_unauthenticated" } });
  });
  it("when the body supplies a different actor or lifecycle write then strict input refuses it", async () => {
    await expectManagementRefusal({ fixture, action, submitted: { loginId: fixture.target.loginId, [field]: next,
      actorLoginId: fixture.other.loginId, role: "admin", banned: false }, actor: fixture.master,
      error: { code: "core_invalid_input", fields: [] } });
  });
  it("when the target ID is malformed then a safe field error leaves all records unchanged", async () => {
    await expectManagementRefusal({ fixture, action, submitted: { loginId: "private-target", [field]: next }, actor: fixture.master,
      error: { code: "core_invalid_input", fields: ["loginId"] } });
  });
  it("when the target is missing then no identifier or orphan reservation is saved", async () => {
    await expectManagementRefusal({ fixture, action, submitted: { loginId: crypto.randomUUID(), [field]: next }, actor: fixture.master,
      error: { code: "stms_login_not_found" } });
  });
  it("when the optional comment has the wrong type then it is refused", async () => {
    await expectManagementRefusal({ fixture, action, submitted: { loginId: fixture.target.loginId, [field]: next, comment: 7 }, actor: fixture.master,
      error: { code: "core_invalid_input", fields: ["comment"] } });
  });
});

describe("Identifier rules", () => {
  it.each(["not-an-email", "", "a @example.test", null, 7])("when a new email is invalid (%s) then it is refused", async (value) => {
    await expectManagementRefusal({ fixture, action: changeEmail, submitted: { loginId: fixture.target.loginId, email: value },
      actor: fixture.master, error: { code: "core_invalid_input", fields: ["email"] } });
  });
  it.each(["Abcd", "abc", "abcdefghi", "1abcd", "ab!d", "abcd ", ""])("when a username breaks the existing rules (%s) then the same named refusal is returned", async (value) => {
    await expectManagementRefusal({ fixture, action: changeUsername, submitted: { loginId: fixture.target.loginId, username: value },
      actor: fixture.master, error: { code: "accounts_username_invalid" } });
  });
  it.each([null, 7])("when a username is not a string (%s) then strict input refuses it", async (value) => {
    await expectManagementRefusal({ fixture, action: changeUsername, submitted: { loginId: fixture.target.loginId, username: value },
      actor: fixture.master, error: { code: "core_invalid_input", fields: ["username"] } });
  });
  it("when a username was reserved earlier then a master cannot reassign it", async () => {
    await saveHub(env.DB, [fixture.signIn.identities.db.insertInto("reservedUsernames")
      .values({ id: crypto.randomUUID(), username: "retired", addedAt: new Date().toISOString() }).compile()]);
    await expectManagementRefusal({ fixture, action: changeUsername, submitted: { loginId: fixture.target.loginId, username: "retired" },
      actor: fixture.master, error: { code: "accounts_username_reserved" } });
  });
  it("when saving the old-username reservation fails then the username, sessions and audit roll back together", async () => {
    await sql`create trigger test_refuse_reservation before insert on reserved_usernames
      begin select raise(abort, 'private_reservation_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
    await expectManagementFailure({ fixture, action: changeUsername, operation: "stms_change_username", submitted: { loginId: fixture.target.loginId, username: "newname" } });
  });
  it.each(["/admin/update-user", "/update-user", "/change-email"])("when a master posts directly to native %s then it cannot bypass the audited identifier change", async (path) => {
    const before = await readResetState(fixture);
    expect((await handleHubAuthRequest(hubRequest("/api/auth" + path,
      { userId: fixture.target.loginId, data: { email: "bypass@example.test", username: "bypass" } }, fixture.master.cookie),
    fixture.signIn.settings)).status).toBe(404);
    expect(await readResetState(fixture)).toEqual(before);
  });
});

async function userInfo(token: string): Promise<Response> {
  return await handleHubAuthRequest(new Request("https://hub.example.test/api/auth/oauth2/userinfo",
    { headers: { authorization: "Bearer " + token } }), fixture.signIn.settings);
}
