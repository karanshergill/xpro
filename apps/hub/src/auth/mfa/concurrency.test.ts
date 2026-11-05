import { env } from "cloudflare:workers";
import { runWithRequestState } from "@better-auth/core/context";
import { createAccessRequest, createRequestContext, saveHub } from "@xpro/core/server";
import { resetPassword } from "@xpro/stms/server";
import { beginMfaSignIn, createEnrolledMaster, createMfaFixture, currentMfaCode, mfaCookie, type MfaFixture } from "#test/master-mfa";
import { pauseDatabaseQuery } from "#test/database-barrier.db";
import { isAPIError } from "better-auth/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHubAuth } from "#auth/auth.server.ts";
import { handleMfaAction } from "#functions/mfa.server.ts";
import type { MfaTables } from "./phases.db";

let fixture: MfaFixture;
beforeEach(async () => { fixture = await createMfaFixture(env.DB); });
afterEach(async () => { vi.useRealTimers(); await fixture.identities.db.destroy(); });

describe("overlapping native MFA work", () => {
  it("when an enrolled master's credential session is delayed past a password reset then it cannot issue an authoritative MFA challenge", async () => {
    const login = await createEnrolledMaster(fixture), operator = await createEnrolledMaster(fixture);
    const barrier = pauseDatabaseQuery(env.DB, (query) => query.startsWith('insert into "session"'));
    const older = await nativeAuth(barrier.database);
    const pending = outcome(older.api.signInEmail({ body: { email: login.email, password: fixture.password }, asResponse: true }));
    await Promise.race([barrier.entered, pending.then(() => { throw new Error("Credentials did not reach native session insertion."); })]);
    try {
      const context = createRequestContext();
      const access = await createAccessRequest({ app: "hub", session: operator, workspaceId: null, context, hub: env.HUB_ACCESS });
      expect((await resetPassword({ loginId: login.loginId, newPassword: "Winning-credential-reset456!" }, { database: env.DB, access, context,
        async hashPassword(password) { return await (await fixture.auth.$context).password.hash(password); },
      })).isOk).toBe(true);
    } finally { barrier.release(); }
    const refused = await pending;
    expect(refused.status).toBe(409);
    for (const cookie of refused.cookies) {
      expect(cookie.split(";")[0]?.endsWith("=")).toBe(true);
      expect(cookie).toContain("Max-Age=0");
    }
    const db = fixture.identities.db.withoutPlugins().withTables<MfaTables>();
    expect(await db.selectFrom("verification").select("id").where("value", "=", login.loginId).where("auth_revision", "is not", null).execute()).toEqual([]);
    for (const session of await db.selectFrom("session").selectAll().where("userId", "=", login.loginId).execute()) {
      expect(session.mfa_verified_at).toBeNull();
      expect(await env.HUB_ACCESS.validateAccess({ loginId: login.loginId, hubSessionId: session.id,
        workspaceId: null, context: createRequestContext() })).toEqual({ status: "invalid", code: "core_unauthenticated" });
    }
    const fresh = await fixture.auth.api.signInEmail({ body: { email: login.email, password: "Winning-credential-reset456!" }, asResponse: true });
    expect(await fresh.json()).toMatchObject({ twoFactorRedirect: true });
    expect((await fixture.auth.api.verifyTOTP({ headers: { cookie: mfaCookie(fresh) }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true })).status).toBe(200);
    expect((await fixture.auth.api.getSession({ headers: { cookie: operator.cookie } }))?.session.id).toBe(operator.hubSessionId);
  });

  it("when backup generation overlaps then only one set and its audit commit", async () => {
    const login = await createEnrolledMaster(fixture);
    const barrier = pauseDatabaseQuery(env.DB, (query) => query.startsWith('update "twoFactor"') && query.includes('"backupCodes"'));
    const older = await nativeAuth(barrier.database);
    const pending = outcome(older.api.generateBackupCodes({ headers: { cookie: login.cookie }, body: { password: fixture.password }, asResponse: true }));
    await barrier.entered;
    let winner;
    try {
      expect((await fixture.auth.api.generateBackupCodes({ headers: { cookie: login.cookie }, body: { password: fixture.password }, asResponse: true })).status).toBe(200);
      winner = await factor(login.loginId);
    } finally { barrier.release(); }
    expect(await pending).toMatchObject({ status: 409, cookies: [] });
    expect(await factor(login.loginId)).toEqual(winner);
    expect(await fixture.identities.db.selectFrom("auditEntries").select("id").where("affectedLoginId", "=", login.loginId)
      .where("action", "=", "accounts_mfa_backup_codes_replaced").execute()).toHaveLength(1);
  });

  it("when backup use finishes after regeneration then it cannot overwrite or consume the new set", async () => {
    const login = await createEnrolledMaster(fixture), challenge = await beginMfaSignIn(fixture, login.email), code = login.backupCodes[0];
    if (!code) throw new Error("No native backup code.");
    const barrier = pauseDatabaseQuery(env.DB, (query) => query.startsWith('update "twoFactor"') && query.includes('"backupCodes"'));
    const older = await nativeAuth(barrier.database);
    const pending = outcome(older.api.verifyBackupCode({ headers: { cookie: mfaCookie(challenge) }, body: { code }, asResponse: true }));
    await barrier.entered;
    let winner;
    try {
      expect((await fixture.auth.api.generateBackupCodes({ headers: { cookie: login.cookie }, body: { password: fixture.password }, asResponse: true })).status).toBe(200);
      winner = await factor(login.loginId);
    } finally { barrier.release(); }
    expect(await pending).toMatchObject({ status: 409, cookies: [] });
    expect(await factor(login.loginId)).toEqual(winner);
  });

  it("when two challenges use the same backup concurrently then the native comparison permits one success", async () => {
    const login = await createEnrolledMaster(fixture), code = login.backupCodes[0];
    if (!code) throw new Error("No native backup code.");
    const challenges = await Promise.all([1, 2].map(async () => await beginMfaSignIn(fixture, login.email)));
    const results = await Promise.all(challenges.map(async (challenge) => await outcome(fixture.auth.api.verifyBackupCode({
      headers: { cookie: mfaCookie(challenge) }, body: { code }, asResponse: true,
    }))));
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status !== 200)).toEqual([expect.objectContaining({ status: 409, cookies: [] })]);
    expect((await fixture.auth.api.viewBackupCodes({ body: { userId: login.loginId } })).backupCodes).toHaveLength(9);
  });

  it("when a delayed native counter write meets a newer replacement then the winner's factor stays unchanged", async () => {
    const login = await createEnrolledMaster(fixture), challenge = await beginMfaSignIn(fixture, login.email);
    const barrier = pauseDatabaseQuery(env.DB, (query) => query.startsWith('update "twoFactor"'));
    const older = await nativeAuth(barrier.database);
    const pending = outcome(older.api.verifyTOTP({ headers: { cookie: mfaCookie(challenge) },
      body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true }));
    await barrier.entered;
    let winner;
    try {
      const disabled = await fixture.auth.api.disableTwoFactor({ headers: { cookie: login.cookie }, body: { password: fixture.password }, asResponse: true });
      expect((await fixture.auth.api.enableTwoFactor({ headers: { cookie: mfaCookie(disabled) }, body: { password: fixture.password }, asResponse: true })).status).toBe(200);
      winner = await factor(login.loginId);
    } finally { barrier.release(); }
    expect(await pending).toMatchObject({ status: 409, cookies: [] });
    expect(await factor(login.loginId)).toEqual(winner);
  });

  it.each(["revision", "challenge expiry"] as const)("when %s changes after challenge consumption then an older session cannot gain completed MFA", async (change) => {
    const login = await createEnrolledMaster(fixture), challenge = await beginMfaSignIn(fixture, login.email);
    const record = await fixture.identities.db.selectFrom("verification").selectAll().where("value", "=", login.loginId).where("authRevision", "is not", null).executeTakeFirstOrThrow();
    const barrier = pauseDatabaseQuery(env.DB, (query) => query.startsWith('insert into "session"'));
    const older = await nativeAuth(barrier.database);
    const pending = outcome(older.api.verifyTOTP({ headers: { cookie: mfaCookie(challenge) },
      body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true }));
    await barrier.entered;
    try {
      if (change === "revision") await saveHub(env.DB, [fixture.identities.db.updateTable("user").set({ authRevision: 2 }).where("id", "=", login.loginId).compile()]);
      else { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(record.expiresAt)); }
    }
    finally { barrier.release(); }
    expect(await pending).toMatchObject({ status: 409, cookies: [] });
    expect(await fixture.identities.db.withoutPlugins().withTables<MfaTables>().selectFrom("session").select("id").where("userId", "=", login.loginId)
      .where("auth_revision", "=", 2).execute()).toEqual([]);
    expect(await fixture.identities.db.withoutPlugins().withTables<MfaTables>().selectFrom("session").select("id")
      .where("userId", "=", login.loginId).where("id", "!=", login.hubSessionId).where("mfa_verified_at", "is not", null).execute()).toEqual([]);
    expect(await fixture.identities.db.selectFrom("verification").selectAll().where("value", "=", login.loginId).where("authRevision", "is not", null).execute()).toEqual([]);
  });

  it("when the original enrollment session expires after activation starts then replacement cannot renew its authority", async () => {
    const login = await fixture.identities.signIn({ role: "admin" });
    const session = await fixture.auth.api.getSession({ headers: { cookie: login.cookie } });
    if (!session) throw new Error("The real enrollment session disappeared.");
    expect((await fixture.auth.api.enableTwoFactor({ headers: { cookie: login.cookie }, body: { password: fixture.password }, asResponse: true })).status).toBe(200);
    const barrier = pauseDatabaseQuery(env.DB, (query) => query.startsWith('insert into "session"'));
    const older = await nativeAuth(barrier.database);
    const pending = outcome(older.api.verifyTOTP({ headers: { cookie: login.cookie }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true }));
    await barrier.entered;
    try { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(session.session.expiresAt); }
    finally { barrier.release(); }
    expect(await pending).toMatchObject({ status: 409, cookies: [] });
  });

  it("when pending activation overlaps an explicit restart then it cannot overwrite the newer pending factor", async () => {
    const login = await fixture.identities.signIn({ role: "admin" });
    expect((await fixture.auth.api.enableTwoFactor({ headers: { cookie: login.cookie }, body: { password: fixture.password }, asResponse: true })).status).toBe(200);
    const barrier = pauseDatabaseQuery(env.DB, (query) => query.startsWith('update "user"') && query.includes('"twoFactorEnabled"'));
    const older = await nativeAuth(barrier.database);
    const pending = outcome(older.api.verifyTOTP({ headers: { cookie: login.cookie }, body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true }));
    await barrier.entered;
    let winner;
    try {
      const disabled = await fixture.auth.api.disableTwoFactor({ headers: { cookie: login.cookie }, body: { password: fixture.password }, asResponse: true });
      expect((await fixture.auth.api.enableTwoFactor({ headers: { cookie: mfaCookie(disabled) }, body: { password: fixture.password }, asResponse: true })).status).toBe(200);
      winner = await factor(login.loginId);
    } finally { barrier.release(); }
    expect(await pending).toMatchObject({ status: 409, cookies: [] });
    expect(await factor(login.loginId)).toEqual(winner);
    expect(await fixture.identities.db.selectFrom("auditEntries").select("id").where("affectedLoginId", "=", login.loginId)
      .where("action", "=", "accounts_mfa_enrolled").execute()).toEqual([]);
  });

  it("when native password checking outlasts recent MFA then the management save refuses the change", async () => {
    const login = await createEnrolledMaster(fixture), before = await factor(login.loginId);
    const session = await fixture.identities.db.selectFrom("session").select("mfaVerifiedAt").where("id", "=", login.hubSessionId).executeTakeFirstOrThrow();
    if (!session.mfaVerifiedAt) throw new Error("The native session has no MFA proof.");
    const barrier = pauseDatabaseQuery(env.DB, (query) => query.startsWith("select ") && query.includes('from "account"'));
    const pending = handleMfaAction("backups", { password: fixture.password }, {
      request: new Request(fixture.origin + "/_serverFn/mfa", { method: "POST", headers: { origin: fixture.origin, cookie: login.cookie } }),
      settings: { database: barrier.database, baseURL: fixture.origin, secret: fixture.auth.options.secret, rateLimiter: fixture.rateLimiter },
    });
    await barrier.entered;
    try { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(session.mfaVerifiedAt) + 300_001); }
    finally { barrier.release(); }
    expect((await pending).status).toBe(401); expect(await factor(login.loginId)).toEqual(before);
  });

  it("when native MFA calls share initially empty request state then each login keeps its own verified session", async () => {
    const logins = await Promise.all([1, 2].map(async () => await fixture.identities.signIn({ role: "admin" })));
    for (const login of logins) expect((await fixture.auth.api.enableTwoFactor({ headers: { cookie: login.cookie }, body: { password: fixture.password }, asResponse: true })).status).toBe(200);
    const codes = await Promise.all(logins.map(async (login) => await currentMfaCode(fixture, login.loginId)));
    const responses = await runWithRequestState(new WeakMap(), async () => await Promise.all(logins.map(async (login, index) =>
      await fixture.auth.api.verifyTOTP({ headers: { cookie: login.cookie }, body: { code: codes[index] }, asResponse: true }))));
    for (const [index, response] of responses.entries()) {
      expect(response.status).toBe(200);
      expect((await fixture.auth.api.getSession({ headers: { cookie: mfaCookie(response) } }))?.user.id).toBe(logins[index]?.loginId);
    }
  });
});

async function nativeAuth(database: D1Database) {
  const auth = await createHubAuth({ database, baseURL: fixture.origin, secret: fixture.auth.options.secret, rateLimiter: fixture.rateLimiter });
  await auth.$context; return auth;
}
async function factor(id: string) { return await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", id).executeTakeFirstOrThrow(); }
async function outcome(pending: Promise<Response>): Promise<{ status: number; cookies: string[] }> {
  try { const response = await pending; return { status: response.status, cookies: response.headers.getSetCookie() }; }
  catch (error) {
    if (!isAPIError(error)) throw error;
    return { status: error.statusCode, cookies: new Headers(error.headers).getSetCookie() };
  }
}
