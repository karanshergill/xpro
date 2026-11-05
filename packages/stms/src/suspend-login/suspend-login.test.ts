import { sql } from "kysely";
import { err, ok } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManagementFixture, prepareManagementServices, suspensionReasons, suspendFixtureLogin, archiveFixtureLogin,
  expectManagementRefusal, expectManagementFailure, expectManagementSaved, managementLocalAccess,
  prepareManagementRefreshTokens, expectManagementTokensEnded, type ManagementAction, type ManagementError } from "#test/login-management";
import { readResetState, signInAfterReset, signInWithResetToken, type ResetFixture } from "#test/reset-password";
import { readResetTokens } from "#test/reset-password.db";
import { hubRequest, signInAtWorkspace, signInPassword } from "#test/sign-in";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { suspendLogin as suspend } from "./suspend-login.server";
import { reactivateLogin as reactivate } from "#reactivate-login/reactivate-login.server.ts";

// T037 supplies the real actions, without replacing authentication or storage.
const suspendLogin: ManagementAction = suspend;
const reactivateLogin: ManagementAction = reactivate;
let fixture: ResetFixture;
beforeEach(async () => { fixture = await createManagementFixture(); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe("Story 5 — suspension and reactivation", () => {
  it("when a master suspends a login then all devices and issued tokens lose access while another login and both workspace databases stay intact", async () => {
    const issued = await signInWithResetToken({ fixture, workspace: fixture.workspace, login: fixture.target });
    const second = await signInAtWorkspace({ fixture: fixture.signIn, workspace: fixture.workspace, login: fixture.devices[1] });
    const other = await signInWithResetToken({ fixture, workspace: fixture.otherWorkspace, login: fixture.other });
    await prepareManagementRefreshTokens(fixture);
    const before = await readResetState(fixture), tokens = await readResetTokens(fixture);
    const services = await prepareManagementServices({ actor: fixture.master });
    expect((await suspendLogin(suspendInput(), services)).toJSON()).toEqual(ok({ loginId: fixture.target.loginId }).toJSON());
    const after = await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: { banned: 1, banReason: "stms_unpaid", banExpires: null },
      sessions: before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId),
      action: "stms_login_suspended", reason: "stms_unpaid" });
    const audit = after.hub.audits.find((row) => row.requestId === services.context.requestId);
    if (!audit) throw new Error("The successful suspension must have an audit.");
    await expectManagementTokensEnded({ fixture, before: tokens, loginId: fixture.target.loginId, revokedAt: audit.createdAt });
    for (const cookie of [issued.cookie, second.cookie]) {
      expect((await managementLocalAccess({ fixture, workspace: fixture.workspace, cookie })).toJSON())
        .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    }
    expect((await managementLocalAccess({ fixture, workspace: fixture.otherWorkspace, cookie: other.cookie })).isOk).toBe(true);
    for (const login of fixture.devices) expect(await fixture.signIn.identities.auth.api.getSession({ headers: { cookie: login.cookie } })).toBeNull();
    expect((await userInfo(issued.accessToken)).status).toBe(401);
    expect((await userInfo(other.accessToken)).status).toBe(200);
    const blocked = await signInAfterReset({ fixture, login: fixture.target, password: signInPassword });
    expect(blocked.response.status).toBe(403);
    expect(await blocked.response.json()).toMatchObject({ code: "accounts_login_suspended",
      message: "This account is suspended. Please contact support." });
  });

  it.each(suspensionReasons)("when the master selects %s then the fixed reason and optional comment are audited with the change", async (reason) => {
    const comment = reason === "stms_other" ? "Verified support request" : undefined;
    const input = { ...suspendInput(), reason, ...(comment ? { comment } : {}) };
    const services = await prepareManagementServices({ actor: fixture.master }), before = await readResetState(fixture);
    expect((await suspendLogin(input, services)).toJSON()).toEqual(ok({ loginId: fixture.target.loginId }).toJSON());
    await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: { banned: 1, banReason: reason, banExpires: null },
      sessions: before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId),
      action: "stms_login_suspended", reason, ...(comment ? { comment } : {}) });
  });

  it("when a normal suspension reason includes an optional comment then the audit keeps it", async () => {
    const comment = "Payment confirmed overdue", services = await prepareManagementServices({ actor: fixture.master });
    const before = await readResetState(fixture);
    expect((await suspendLogin({ ...suspendInput(), comment }, services)).isOk).toBe(true);
    await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: { banned: 1, banReason: "stms_unpaid", banExpires: null },
      sessions: before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId),
      action: "stms_login_suspended", reason: "stms_unpaid", comment });
  });

  it("when the master reactivates a suspended login then its existing password works but none of the old sessions or tokens is restored", async () => {
    const issued = await signInWithResetToken({ fixture, workspace: fixture.workspace, login: fixture.target });
    await suspendFixtureLogin(fixture);
    const services = await prepareManagementServices({ actor: fixture.master }), before = await readResetState(fixture);
    const tokens = await readResetTokens(fixture);
    expect((await reactivateLogin({ loginId: fixture.target.loginId }, services)).toJSON()).toEqual(ok({ loginId: fixture.target.loginId }).toJSON());
    await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: { banned: 0, banReason: null, banExpires: null }, sessions: before.hub.sessions, action: "stms_login_reactivated" });
    expect(await readResetTokens(fixture)).toEqual(tokens);
    expect((await userInfo(issued.accessToken)).status).toBe(401);
    const fresh = await signInAfterReset({ fixture, login: fixture.target, password: signInPassword });
    expect(fresh.response.status).toBe(200);
    for (const device of fixture.devices) expect(await fixture.signIn.identities.auth.api.getSession({ headers: { cookie: device.cookie } })).toBeNull();
  });

  it("when a master suspends another master then the target's global role and credentials are preserved", async () => {
    await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.target.loginId, { role: "admin" });
    const services = await prepareManagementServices({ actor: fixture.master }), before = await readResetState(fixture);
    expect((await suspendLogin(suspendInput(), services)).isOk).toBe(true);
    await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: { banned: 1, banReason: "stms_unpaid", banExpires: null },
      sessions: before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId),
      action: "stms_login_suspended", reason: "stms_unpaid" });
  });

  it("when a master tries to suspend their own login then the action is refused without ending any session", async () => {
    await expectManagementRefusal({ fixture, action: suspendLogin, submitted: { ...suspendInput(), loginId: fixture.master.loginId },
      actor: fixture.master, error: { code: "stms_self_suspend_forbidden" } });
  });

  it.each([undefined, false, "true"])("when suspension confirmation is %s then there is no change", async (confirmed) => {
    await expectManagementRefusal({ fixture, action: suspendLogin, submitted: { ...suspendInput(), confirmed },
      actor: fixture.master, error: { code: "core_invalid_input", fields: ["confirmed"] } });
  });

  it.each([undefined, "", "unpaid", 1])("when the suspension reason is invalid (%s) then it is refused", async (reason) => {
    await expectManagementRefusal({ fixture, action: suspendLogin, submitted: { ...suspendInput(), reason },
      actor: fixture.master, error: { code: "core_invalid_input", fields: ["reason"] } });
  });

  it.each([undefined, "", "  ", null, 7])("when Other has no meaningful comment (%s) then suspension is refused", async (comment) => {
    await expectManagementRefusal({ fixture, action: suspendLogin, submitted: { ...suspendInput(), reason: "stms_other", comment },
      actor: fixture.master, error: { code: "core_invalid_input", fields: ["comment"] } });
  });

  it.each(["suspended", "archived"] as const)("when the target is already %s then a new suspension cannot overwrite its state or duplicate an audit", async (state) => {
    if (state === "suspended") await suspendFixtureLogin(fixture);
    else await archiveFixtureLogin(fixture, { loginId: fixture.target.loginId, previousStatus: "active" });
    await expectManagementRefusal({ fixture, action: suspendLogin, submitted: suspendInput(), actor: fixture.master,
      error: { code: "stms_login_state_conflict" } });
  });

  it.each(["active", "archived"] as const)("when the target is %s then reactivation cannot clear an archive or invent a transition", async (state) => {
    if (state === "archived") await archiveFixtureLogin(fixture, { loginId: fixture.target.loginId, previousStatus: "active" });
    await expectManagementRefusal({ fixture, action: reactivateLogin, submitted: { loginId: fixture.target.loginId }, actor: fixture.master,
      error: { code: "stms_login_state_conflict" } });
  });

  it.each(["login", "sessions", "audit", "access token", "refresh token"] as const)(
    "when saving suspension's %s step fails then state, credentials, sessions, tokens and audit all roll back", async (stage) => {
      await signInWithResetToken({ fixture, workspace: fixture.workspace, login: fixture.target });
      await prepareManagementRefreshTokens(fixture);
      const events = { login: 'update of banned on "user"', sessions: 'delete on "session"', audit: 'insert on audit_entries',
        "access token": 'update of revoked on "oauthAccessToken"', "refresh token": 'update of revoked on "oauthRefreshToken"' };
      await sql`create trigger test_refuse_management before ${sql.raw(events[stage])}
        begin select raise(abort, 'private_management_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
      await expectManagementFailure({ fixture, action: suspendLogin, operation: "stms_suspend_login", submitted: suspendInput() });
    },
  );

  it.each(["login", "audit"] as const)("when reactivation's %s write fails then suspension and history both remain", async (stage) => {
    await suspendFixtureLogin(fixture);
    const event = stage === "login" ? 'update of banned on "user"' : 'insert on audit_entries';
    await sql`create trigger test_refuse_reactivation before ${sql.raw(event)}
      begin select raise(abort, 'private_reactivation_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
    await expectManagementFailure({ fixture, action: reactivateLogin, operation: "stms_reactivate_login", submitted: { loginId: fixture.target.loginId } });
  });

  it.each(["ended", "expired", "suspended", "archived", "incomplete profile"] as const)(
    "when the acting master's authority is %s then the next suspension cannot save", async (state) => {
      if (state === "ended") await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: fixture.master.cookie } });
      if (state === "expired") { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1_000); }
      if (state === "suspended" || state === "archived" || state === "incomplete profile") {
        await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.master.loginId,
          state === "suspended" ? { banned: true } : state === "archived" ? { archivedAt: new Date().toISOString() } : { phone: null });
      }
      const error: ManagementError = state === "ended" || state === "expired" ? { code: "core_unauthenticated" }
        : state === "incomplete profile" ? { code: "core_profile_incomplete", fields: ["phone"] } : { code: "core_login_inactive" };
      await expectManagementRefusal({ fixture, action: suspendLogin, submitted: suspendInput(), actor: fixture.master, error });
    },
  );

  it.each(["/admin/ban-user", "/admin/unban-user"])("when a master posts to native %s then it cannot bypass the audited action", async (path) => {
    const before = await readResetState(fixture);
    expect((await handleHubAuthRequest(hubRequest("/api/auth" + path, { userId: fixture.target.loginId }, fixture.master.cookie),
      fixture.signIn.settings)).status).toBe(404);
    expect(await readResetState(fixture)).toEqual(before);
  });
});

const writes = [
  { name: "suspend", action: suspendLogin, submitted: suspendInput },
  { name: "reactivate", action: reactivateLogin, submitted: () => ({ loginId: fixture.target.loginId }) },
];
describe.each(writes)("master-only $name", ({ name, action, submitted }) => {
  it("when two requests claim the same transition then exactly one change and audit commit", async () => {
    if (name === "reactivate") await suspendFixtureLogin(fixture);
    const services = [await prepareManagementServices({ actor: fixture.master }), await prepareManagementServices({ actor: fixture.master })];
    const before = await readResetState(fixture);
    const results = await Promise.all(services.map((context) => action(submitted(), context)));
    expect(results.filter((result) => result.isOk)).toHaveLength(1);
    expect(results.filter((result) => result.isErr).map((result) => result.toJSON()))
      .toEqual([err({ code: "stms_login_state_conflict" }).toJSON()]);
    const winner = services[results.findIndex((result) => result.isOk)];
    if (!winner) throw new Error("Exactly one transition request must win.");
    await expectManagementSaved({ fixture, before, services: winner, loginId: fixture.target.loginId,
      userChanges: name === "suspend" ? { banned: 1, banReason: "stms_unpaid", banExpires: null } : { banned: 0, banReason: null, banExpires: null },
      sessions: name === "suspend" ? before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId) : before.hub.sessions,
      action: name === "suspend" ? "stms_login_suspended" : "stms_login_reactivated",
      ...(name === "suspend" ? { reason: "stms_unpaid" } : {}) });
  });

  it.each(["user", "owner", "admin", "member"] as const)("when a non-master %s attempts the action then no state or audit changes", async (role) => {
    const actor = role === "user" ? fixture.other : await fixture.signIn.identities.signIn();
    if (role !== "user") await fixture.signIn.identities.auth.api.addMember({ body: {
      userId: actor.loginId, organizationId: fixture.workspace.id, role,
    } });
    await expectManagementRefusal({ fixture, action, submitted: submitted(), actor, error: { code: "core_forbidden" } });
  });
  it("when the actor is anonymous then the action is refused", async () => {
    await expectManagementRefusal({ fixture, action, submitted: submitted(), actor: null, error: { code: "core_unauthenticated" } });
  });
  it("when authority is submitted in the body then it cannot replace the actual actor", async () => {
    await expectManagementRefusal({ fixture, action, submitted: { ...submitted(), actorLoginId: fixture.other.loginId, isMaster: true },
      actor: fixture.master, error: { code: "core_invalid_input", fields: [] } });
  });
  it("when the ID is malformed then input is refused before saving", async () => {
    await expectManagementRefusal({ fixture, action, submitted: { ...submitted(), loginId: "private-target" },
      actor: fixture.master, error: { code: "core_invalid_input", fields: ["loginId"] } });
  });
  it("when the login is missing then there is no orphan audit", async () => {
    await expectManagementRefusal({ fixture, action, submitted: { ...submitted(), loginId: crypto.randomUUID() },
      actor: fixture.master, error: { code: "stms_login_not_found" } });
  });
});

function suspendInput(): { loginId: string; reason: "stms_unpaid"; confirmed: true } {
  return { loginId: fixture.target.loginId, reason: "stms_unpaid", confirmed: true };
}
async function userInfo(token: string): Promise<Response> {
  return await handleHubAuthRequest(new Request("https://hub.example.test/api/auth/oauth2/userinfo",
    { headers: { authorization: "Bearer " + token } }), fixture.signIn.settings);
}
