import { env } from "cloudflare:workers";
import { createAccessRequest, createRequestContext, getCurrentUser, saveHub } from "@xpro/core/server";
import { reactivateLogin, resetPassword, suspendLogin } from "@xpro/stms/server";
import { isAPIError } from "better-auth/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignInFixture, deliverWorkspaceLogout, hubRequest, readWorkspaceState, signInPassword,
  withWorkspace, workspaceServices, type SignInFixture } from "#test/sign-in";
import { network } from "#test/network";
import { http } from "msw";
import { createEnrolledMaster, beginMfaSignIn, currentMfaCode, mfaCookie, readMfaLogin, type EnrolledMaster, type MfaFixture } from "#test/master-mfa";
import { pauseDatabaseQuery } from "#test/database-barrier.db";
import { interruptAfterWrite } from "#test/creation-faults.db";
import { signInWithResetToken as issueWorkspaceTokens } from "#test/reset-password";
import { createHubAuth } from "#auth/auth.server.ts";
import { handleHubAuthRequest } from "#auth/oidc.server.ts";
import { handleChangePassword } from "#functions/profile.server.ts";
import type { MfaTables } from "./phases.db";
import { createHubDatabase } from "#db/hub.db.ts";

let signIn: SignInFixture, fixture: MfaFixture, actor: EnrolledMaster, target: EnrolledMaster;
const replacement = "Changed-race-password456!", reset = "Reset-race-password789!";
beforeEach(async () => {
  signIn = await createSignInFixture(env.DB);
  const auth = await nativeAuth(env.DB);
  fixture = { identities: signIn.identities, auth, origin: signIn.settings.baseURL, password: signInPassword, rateLimiter: signIn.settings.rateLimiter };
  actor = await createEnrolledMaster(fixture); target = await createEnrolledMaster(fixture);
});
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await signIn.identities.db.destroy(); });

describe("password rotation races", () => {
  it("when the original session expires during native password verification then the captured proof cannot rotate the password", async () => {
    const session = await fixture.identities.db.selectFrom("session").selectAll().where("id", "=", target.hubSessionId).executeTakeFirstOrThrow();
    const barrier = pauseDatabaseQuery(env.DB, (query) => query.startsWith("select ") && query.includes('from "account"') && query.includes('"accountId"'));
    const auth = await nativeAuth(barrier.database);
    const pending = outcome(auth.api.changePassword({ headers: { cookie: target.cookie }, body: {
      currentPassword: signInPassword, newPassword: replacement, revokeOtherSessions: true,
    }, asResponse: true }));
    await entered(barrier.entered, pending);
    try { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(session.expiresAt) + 1); }
    finally { barrier.release(); }
    expect(await pending).toEqual({ status: 409, cookies: [] });
    expect(await passwordMatches(signInPassword)).toBe(true); expect(await passwordAudits()).toEqual([]);
    expect(await fixture.identities.db.selectFrom("session").selectAll().where("id", "=", target.hubSessionId).executeTakeFirst()).toEqual(session);
  });

  it("when the stored credential changes after capture without a revision change then the older password save still cannot overwrite it", async () => {
    const revision = await fixture.identities.db.selectFrom("user").select("authRevision").where("id", "=", target.loginId).executeTakeFirstOrThrow();
    const barrier = pauseDatabaseQuery(env.DB, (query) => query.startsWith('update "account"') && query.includes('"password"'));
    const auth = await nativeAuth(barrier.database);
    const pending = outcome(auth.api.changePassword({ headers: { cookie: target.cookie }, body: {
      currentPassword: signInPassword, newPassword: replacement, revokeOtherSessions: true,
    }, asResponse: true }));
    await entered(barrier.entered, pending);
    try {
      // Storage fault changes only the credential to test its independent comparison; no authority is granted.
      const password = await (await fixture.auth.$context).password.hash(reset);
      await saveHub(env.DB, [fixture.identities.db.withoutPlugins().updateTable("account").set({ password })
        .where("userId", "=", target.loginId).where("providerId", "=", "credential").compile()]);
    } finally { barrier.release(); }
    expect(await pending).toEqual({ status: 409, cookies: [] });
    expect(await passwordMatches(reset)).toBe(true); expect(await passwordMatches(replacement)).toBe(false);
    expect(await passwordAudits()).toEqual([]);
    expect(await fixture.identities.db.selectFrom("user").select("authRevision").where("id", "=", target.loginId).executeTakeFirst()).toEqual(revision);
  });

  it.each(["session deletion", "password save"] as const)("when a master reset wins during old %s then the public handler cannot overwrite it or delete its new verified session", async (stage) => {
    const barrier = pauseDatabaseQuery(env.DB, (query) => stage === "session deletion"
      ? query.startsWith('delete from "session"') : query.startsWith('update "account"') && query.includes('"password"'));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pending = handleChangePassword({ currentPassword: signInPassword, newPassword: replacement }, {
      request: hubRequest("/_serverFn/password", {}, target.cookie), settings: { ...signIn.settings, database: barrier.database },
    });
    await entered(barrier.entered, pending);
    let winning: Awaited<ReturnType<typeof readMfaLogin>>;
    try {
      expect((await resetPassword({ loginId: target.loginId, newPassword: reset }, await services())).isOk).toBe(true);
      const challenge = await fixture.auth.api.signInEmail({ body: { email: target.email, password: reset }, asResponse: true });
      const verified = await fixture.auth.api.verifyTOTP({ headers: { cookie: mfaCookie(challenge) },
        body: { code: await currentMfaCode(fixture, target.loginId) }, asResponse: true });
      winning = await readMfaLogin(fixture, { login: target, response: verified });
    }
    finally { barrier.release(); }
    const response = await pending;
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "core_unauthenticated", message: "Sign in to continue.", requestId: response.headers.get("x-request-id") });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    expect(await passwordMatches(reset)).toBe(true); expect(await passwordMatches(replacement)).toBe(false);
    expect(await passwordAudits()).toEqual([]);
    expect((await fixture.auth.api.getSession({ headers: { cookie: winning.cookie } }))?.session.id).toBe(winning.hubSessionId);
  });

  it("Login changes invalidate old access", async () => {
    const workspace = await signIn.prepareWorkspace({ loginId: target.loginId, backchannel: true });
    const otherWorkspace = await signIn.prepareWorkspace({ loginId: actor.loginId });
    const deliveries: { url: string; method: string; headers: [string, string][]; body: string }[] = [];
    network.use(http.post(workspace.origin + "/auth/back-channel-sign-out", async ({ request }) => {
      // Hold only the HTTP delivery; signature validation and workspace deletion run unchanged below.
      deliveries.push({ url: request.url, method: request.method, headers: [...request.headers.entries()], body: await request.text() });
      return new Response(null, { status: 200 });
    }));
    const oldToken = await issueWorkspaceTokens({ fixture: { signIn }, workspace, login: target });
    const unrelated = await issueWorkspaceTokens({ fixture: { signIn }, workspace: otherWorkspace, login: actor });
    const otherBefore = await readWorkspaceState(otherWorkspace);
    const barrier = pauseDatabaseQuery(env.DB, (query) => query.startsWith('update "account"') && query.includes('"password"'));
    const older = await nativeAuth(barrier.database);
    const pending = outcome(older.api.changePassword({ headers: { cookie: target.cookie }, body: {
      currentPassword: signInPassword, newPassword: "Losing-password123!", revokeOtherSessions: true,
    }, asResponse: true }));
    await entered(barrier.entered, pending);
    let winning: Awaited<ReturnType<typeof readMfaLogin>>, token: Awaited<ReturnType<typeof issueWorkspaceTokens>>;
    try {
      const challenge = await beginMfaSignIn(fixture, target.email);
      const verified = await fixture.auth.api.verifyTOTP({ headers: { cookie: mfaCookie(challenge) }, body: { code: await currentMfaCode(fixture, target.loginId) }, asResponse: true });
      const login = await readMfaLogin(fixture, { login: target, response: verified });
      const response = await fixture.auth.api.changePassword({ headers: { cookie: login.cookie }, body: {
        currentPassword: signInPassword, newPassword: replacement, revokeOtherSessions: true,
      }, asResponse: true });
      expect(response.status).toBe(200);
      winning = await readMfaLogin(fixture, { login: target, response });
      token = await issueWorkspaceTokens({ fixture: { signIn }, workspace, login: winning });
    } finally { barrier.release(); }
    expect(await pending).toEqual({ status: 409, cookies: [] });
    expect((await fixture.auth.api.getSession({ headers: { cookie: winning.cookie } }))?.session.id).toBe(winning.hubSessionId);
    expect(await userInfo(token.accessToken)).toBe(200); expect(await userInfo(unrelated.accessToken)).toBe(200);
    expect(await userInfo(oldToken.accessToken)).not.toBe(200);
    expect(await passwordMatches(replacement)).toBe(true); expect(await passwordMatches("Losing-password123!")).toBe(false);
    expect(await passwordAudits()).toHaveLength(1);
    expect(deliveries).toHaveLength(1);
    const beforeDelivery = await readWorkspaceState(workspace);
    expect(beforeDelivery.sessions.map((row) => row.hubSessionId).sort()).toEqual([target.hubSessionId, winning.hubSessionId].sort());
    for (const message of deliveries) expect((await deliverWorkspaceLogout({ fixture: signIn, workspace, message })).status).toBe(200);
    expect(await readWorkspaceState(workspace)).toEqual({ ...beforeDelivery,
      sessions: beforeDelivery.sessions.filter((row) => row.hubSessionId === winning.hubSessionId) });
    expect(await readWorkspaceState(otherWorkspace)).toEqual(otherBefore);
    const current = await withWorkspace(workspace, async ({ storage }) => await getCurrentUser(new Request(workspace.origin, {
      headers: { cookie: token.cookie },
    }), workspaceServices({ fixture: signIn, workspace, storage }, handleHubAuthRequest)));
    expect(current.isOk).toBe(true);
    expect(await userInfo(token.accessToken)).toBe(200); expect(await userInfo(unrelated.accessToken)).toBe(200);
  });

  it("when suspension and reactivation win after the password save then the delayed replacement session cannot adopt the new revision", async () => {
    const barrier = pauseDatabaseQuery(env.DB, (query) => query.startsWith('insert into "session"'));
    const auth = await nativeAuth(barrier.database);
    const pending = outcome(auth.api.changePassword({ headers: { cookie: target.cookie }, body: {
      currentPassword: signInPassword, newPassword: replacement, revokeOtherSessions: true,
    }, asResponse: true }));
    await entered(barrier.entered, pending);
    try {
      expect((await suspendLogin({ loginId: target.loginId, confirmed: true, reason: "stms_security_concern" }, await services())).isOk).toBe(true);
      expect((await reactivateLogin({ loginId: target.loginId }, await services())).isOk).toBe(true);
    } finally { barrier.release(); }
    expect(await pending).toEqual({ status: 409, cookies: [] });
    const rows = await fixture.identities.db.withoutPlugins().withTables<MfaTables>().selectFrom("session").selectAll().where("userId", "=", target.loginId).execute();
    for (const row of rows) {
      expect(row.mfa_verified_at).toBeNull();
      expect(await env.HUB_ACCESS.validateAccess({ loginId: target.loginId, hubSessionId: row.id, workspaceId: null, context: createRequestContext() }))
        .toEqual({ status: "invalid", code: "core_unauthenticated" });
    }
    expect(await passwordMatches(replacement)).toBe(true); expect(await passwordAudits()).toHaveLength(1);
  });

  it("when challenge cleanup refuses the guarded password batch then password, revision, challenge and audit roll back together", async () => {
    await beginMfaSignIn(fixture, target.email);
    const db = fixture.identities.db.withoutPlugins().withTables<MfaTables>();
    const before = {
      user: await db.selectFrom("user").selectAll().where("id", "=", target.loginId).executeTakeFirstOrThrow(),
      factor: await db.selectFrom("twoFactor").selectAll().where("userId", "=", target.loginId).executeTakeFirstOrThrow(),
      challenge: await db.selectFrom("verification").selectAll().where("value", "=", target.loginId).where("auth_revision", "is not", null).execute(),
    };
    await env.DB.exec('create trigger test_refuse_password_cleanup before delete on verification when old.auth_revision is not null begin select raise(abort, \'test_refuse_password_cleanup\'); end');
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await callPassword(env.DB);
    expect(response.status).toBe(500); expect(response.headers.getSetCookie()).toEqual([]); expect(log).toHaveBeenCalledTimes(1);
    expect(await passwordMatches(signInPassword)).toBe(true); expect(await passwordAudits()).toEqual([]);
    expect(await db.selectFrom("user").selectAll().where("id", "=", target.loginId).executeTakeFirst()).toEqual(before.user);
    expect(await db.selectFrom("twoFactor").selectAll().where("userId", "=", target.loginId).executeTakeFirst()).toEqual(before.factor);
    expect(await db.selectFrom("verification").selectAll().where("value", "=", target.loginId).where("auth_revision", "is not", null).execute()).toEqual(before.challenge);
    // Native session deletion precedes this batch under the accepted sequential-save exception.
    expect(await fixture.auth.api.getSession({ headers: { cookie: target.cookie } })).toBeNull();
    expect((await fixture.auth.api.getSession({ headers: { cookie: actor.cookie } }))?.user.id).toBe(actor.loginId);
  });

  it.each(["password batch", "replacement session"] as const)("when a committed %s reply is lost then no success cookie escapes and fresh native MFA sign-in still works", async (stage) => {
    const before = await fixture.identities.db.selectFrom("user").select("authRevision").where("id", "=", target.loginId).executeTakeFirstOrThrow();
    const factor = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", target.loginId).executeTakeFirstOrThrow();
    const database = interruptAfterWrite(env.DB, (query) => stage === "password batch"
      ? query.startsWith('update "account"') && query.includes('"password"') : query.startsWith('insert into "session"'));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await callPassword(database);
    expect(response.status).toBe(500); expect(response.headers.getSetCookie()).toEqual([]); expect(log).toHaveBeenCalledTimes(1);
    expect(await passwordMatches(replacement)).toBe(true); expect(await passwordAudits()).toHaveLength(1);
    const db = await createHubDatabase(env.DB);
    let sessions: { id: string; mfa_verified_at: string | null }[];
    try {
      expect(await db.selectFrom("user").select("authRevision").where("id", "=", target.loginId).executeTakeFirst())
        .toEqual({ authRevision: before.authRevision + 1 });
      expect(await db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", target.loginId).executeTakeFirst()).toEqual(factor);
      sessions = await db.withoutPlugins().withTables<MfaTables>().selectFrom("session")
        .select(["id", "mfa_verified_at"]).where("userId", "=", target.loginId).execute();
    } finally { await db.destroy(); }
    expect(sessions).toHaveLength(stage === "password batch" ? 0 : 1);
    for (const session of sessions) {
      expect(session.mfa_verified_at).toBeNull();
      expect(await env.HUB_ACCESS.validateAccess({ loginId: target.loginId, hubSessionId: session.id,
        workspaceId: null, context: createRequestContext() })).toMatchObject({ status: "invalid" });
    }
    const challenge = await fixture.auth.api.signInEmail({ body: { email: target.email, password: replacement }, asResponse: true });
    const verified = await fixture.auth.api.verifyTOTP({ headers: { cookie: mfaCookie(challenge) }, body: { code: await currentMfaCode(fixture, target.loginId) }, asResponse: true });
    expect(verified.status).toBe(200);
    expect((await readMfaLogin(fixture, { login: target, response: verified })).hubSessionId).not.toBe(target.hubSessionId);
    expect((await fixture.auth.api.getSession({ headers: { cookie: actor.cookie } }))?.user.id).toBe(actor.loginId);
  });
});

async function callPassword(database: D1Database): Promise<Response> {
  return await handleChangePassword({ currentPassword: signInPassword, newPassword: replacement }, {
    request: hubRequest("/_serverFn/password", {}, target.cookie), settings: { ...signIn.settings, database },
  });
}

async function nativeAuth(database: D1Database) {
  const auth = await createHubAuth({ ...signIn.settings, database, turnstileSecret: undefined }); await auth.$context; return auth;
}
async function services() {
  const context = createRequestContext();
  const access = await createAccessRequest({ app: "hub", session: actor, workspaceId: null, context, hub: env.HUB_ACCESS });
  return { database: env.DB, context, access, async hashPassword(password: string) { return await (await fixture.auth.$context).password.hash(password); } };
}
async function entered<T>(barrier: Promise<void>, operation: Promise<T>): Promise<void> {
  await Promise.race([barrier, operation.then(() => { throw new Error("Native operation did not reach the intended pause."); })]);
}
async function outcome(value: Promise<Response>): Promise<{ status: number; cookies: string[] }> {
  try { const response = await value; return { status: response.status, cookies: response.headers.getSetCookie() }; }
  catch (error) { if (isAPIError(error)) return { status: error.statusCode, cookies: new Headers(error.headers).getSetCookie() }; throw error; }
}
async function passwordMatches(password: string): Promise<boolean> {
  const db = await createHubDatabase(env.DB);
  try {
    const account = await db.withoutPlugins().selectFrom("account").select("password").where("userId", "=", target.loginId).where("providerId", "=", "credential").executeTakeFirstOrThrow();
    if (!account.password) throw new Error("The native credential disappeared.");
    return await (await fixture.auth.$context).password.verify({ hash: account.password, password });
  } finally { await db.destroy(); }
}
async function passwordAudits() {
  const db = await createHubDatabase(env.DB);
  try { return await db.selectFrom("auditEntries").selectAll().where("action", "=", "accounts_password_changed").where("affectedLoginId", "=", target.loginId).execute(); }
  finally { await db.destroy(); }
}
async function userInfo(token: string): Promise<number> {
  return (await handleHubAuthRequest(new Request(fixture.origin + "/api/auth/oauth2/userinfo", { headers: { authorization: "Bearer " + token } }), signIn.settings)).status;
}
