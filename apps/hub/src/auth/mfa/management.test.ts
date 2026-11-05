import { env } from "cloudflare:workers";
import { createRequestContext } from "@xpro/core/server";
import { beginMfaSignIn, createEnrolledMaster, createMfaFixture, currentMfaCode, mfaCookie, readMfaLogin,
  type MfaFixture, type MfaSetup } from "#test/master-mfa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMfaAction } from "#functions/mfa.server.ts";
import type { HubAuthSettings } from "#auth/auth.server.ts";

let fixture: MfaFixture;
let isAllowed = true, isAvailable = true;
let keys: string[];
beforeEach(async () => {
  isAllowed = true; isAvailable = true; keys = [];
  fixture = await createMfaFixture(env.DB, { async limit({ key }) {
    keys.push(key);
    if (!isAvailable) throw new Error("test_rate_service_unavailable");
    return { success: isAllowed };
  } });
});
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await fixture.identities.db.destroy(); });

describe("guarded MFA management", () => {
  it.each(["replace", "backups"] as const)("Current password and recent MFA — wrong password for %s", async (action) => {
    const login = await createEnrolledMaster(fixture), before = await state();
    const response = await call({ action, cookie: login.cookie, body: { password: "Wrong-password123!" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "accounts_current_password_invalid", message: "The current password is incorrect.", requestId: expect.any(String) });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await state()).toEqual(before);
  });

  it.each([300_000, 300_001])("when MFA age is %s milliseconds then the management boundary is inclusive", async (age) => {
    const login = await createEnrolledMaster(fixture);
    const session = await fixture.identities.db.selectFrom("session").select("mfaVerifiedAt").where("id", "=", login.hubSessionId).executeTakeFirstOrThrow();
    if (!session.mfaVerifiedAt) throw new Error("Native fixture has no completed MFA.");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(session.mfaVerifiedAt) + age);
    const before = await state(), response = await call({ action: "backups", cookie: login.cookie });
    expect(response.status).toBe(age === 300_000 ? 200 : 403);
    if (age > 300_000) {
      expect(await response.json()).toEqual({ code: "core_mfa_recent_verification_required",
        message: "Verify multi-factor authentication again to make this change.", requestId: expect.any(String) });
      expect(await state()).toEqual(before);
    }
  });

  it("Current password and recent MFA", async () => {
    const login = await createEnrolledMaster(fixture);
    const session = await fixture.identities.db.selectFrom("session").selectAll().where("id", "=", login.hubSessionId).executeTakeFirstOrThrow();
    if (!session.mfaVerifiedAt) throw new Error("Missing original MFA time.");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(session.mfaVerifiedAt) + 300_001);
    expect((await fixture.auth.api.getSession({ headers: { cookie: login.cookie }, query: { disableCookieCache: true } }))?.session.id).toBe(login.hubSessionId);
    const before = await state();
    for (const action of ["replace", "backups"] as const) {
      const response = await call({ action, cookie: login.cookie });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ code: "core_mfa_recent_verification_required",
        message: "Verify multi-factor authentication again to make this change.", requestId: response.headers.get("x-request-id") });
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(await state()).toEqual(before);
    expect(await fixture.identities.db.selectFrom("session").selectAll().where("id", "=", login.hubSessionId).executeTakeFirst()).toEqual(session);
  });

  it("New backup-code set", async () => {
    const login = await createEnrolledMaster(fixture);
    const before = await fixture.identities.db.selectFrom("session").selectAll().where("id", "=", login.hubSessionId).executeTakeFirstOrThrow();
    const response = await call({ action: "backups", cookie: login.cookie });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const body: { backupCodes: string[] } = await response.json();
    expect(Object.keys(body)).toEqual(["backupCodes"]); expect(body.backupCodes).toHaveLength(10);
    expect(body.backupCodes.some((code) => login.backupCodes.includes(code))).toBe(false);
    expect(await fixture.identities.db.selectFrom("session").selectAll().where("id", "=", login.hubSessionId).executeTakeFirstOrThrow()).toEqual(before);
    const pending = await beginMfaSignIn(fixture, login.email), old = login.backupCodes[0];
    if (!old) throw new Error("No old native backup code.");
    expect((await fixture.auth.api.verifyBackupCode({ headers: { cookie: mfaCookie(pending) }, body: { code: old }, asResponse: true })).status).toBe(401);
    const current = await fixture.auth.api.viewBackupCodes({ body: { userId: login.loginId } });
    expect(current.backupCodes).toEqual(body.backupCodes);
  });

  it("Authenticator replacement", async () => {
    const login = await createEnrolledMaster(fixture), unrelated = await fixture.identities.signIn();
    const oldFactor = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", login.loginId).executeTakeFirstOrThrow();
    const devicePending = await beginMfaSignIn(fixture, login.email);
    const deviceVerified = await fixture.auth.api.verifyTOTP({ headers: { cookie: mfaCookie(devicePending) },
      body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true });
    const otherDevice = await readMfaLogin(fixture, { login, response: deviceVerified });
    const pending = await beginMfaSignIn(fixture, login.email);
    const response = await call({ action: "replace", cookie: login.cookie });
    expect(response.status).toBe(200);
    const body: MfaSetup = await response.json();
    expect(Object.keys(body).sort()).toEqual(["backupCodes", "setupId", "totpURI"]);
    const cookie = mfaCookie(response), session = await fixture.auth.api.getSession({ headers: { cookie } });
    if (!session) throw new Error("Replacement did not deliver its enrollment session.");
    const factor = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", login.loginId).executeTakeFirstOrThrow();
    expect(factor).toMatchObject({ userId: login.loginId, verified: 0, failedVerificationCount: 0 });
    expect(factor.id).not.toBe(oldFactor.id); expect(factor.secret).not.toBe(oldFactor.secret);
    expect(await fixture.auth.api.getSession({ headers: { cookie: login.cookie } })).toBeNull();
    expect(await fixture.auth.api.getSession({ headers: { cookie: otherDevice.cookie } })).toBeNull();
    expect(await fixture.identities.db.selectFrom("session").select(["authRevision", "mfaVerifiedAt"]).where("id", "=", session.session.id).executeTakeFirst())
      .toEqual({ authRevision: 2, mfaVerifiedAt: null });
    expect(await fixture.identities.db.selectFrom("verification").selectAll().where("value", "=", login.loginId).where("authRevision", "is not", null).execute()).toEqual([]);
    await expect(fixture.auth.api.verifyTOTP({ headers: { cookie: mfaCookie(pending) },
      body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true }))
      .rejects.toMatchObject({ statusCode: 409, body: { code: "core_unauthenticated" } });
    expect(await env.HUB_ACCESS.validateAccess({ loginId: login.loginId, hubSessionId: session.session.id, workspaceId: null, context: createRequestContext() }))
      .toEqual({ status: "invalid", code: "core_unauthenticated" });
    expect((await fixture.auth.api.getSession({ headers: { cookie: unrelated.cookie } }))?.user.id).toBe(unrelated.loginId);
  });

  it("when pending setup is explicitly restarted then old material and sessions are retired before new setup", async () => {
    const login = await fixture.identities.signIn({ role: "admin" });
    expect((await call({ action: "setup", cookie: login.cookie })).status).toBe(200);
    const old = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", login.loginId).executeTakeFirstOrThrow();
    const before = await state();
    expect((await call({ action: "setup", cookie: login.cookie })).status).toBe(409);
    expect(await state()).toEqual(before);
    const restarted = await call({ action: "replace", cookie: login.cookie });
    expect(restarted.status).toBe(200);
    const current = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", login.loginId).executeTakeFirstOrThrow();
    expect(current.id).not.toBe(old.id); expect(current.secret).not.toBe(old.secret); expect(current.verified).toBe(0);
    expect(await fixture.auth.api.getSession({ headers: { cookie: login.cookie } })).toBeNull();
    expect((await fixture.auth.api.getSession({ headers: { cookie: mfaCookie(restarted) } }))?.user.id).toBe(login.loginId);
    expect((await fixture.identities.db.selectFrom("auditEntries").select("action").orderBy("createdAt").execute()).map((row) => row.action))
      .toEqual(["accounts_mfa_setup_started", "accounts_mfa_setup_restarted", "accounts_mfa_setup_started"]);
  });

  it("Last backup code", async () => {
    const login = await createEnrolledMaster(fixture);
    let cookie = "";
    for (const code of login.backupCodes) {
      const pending = await beginMfaSignIn(fixture, login.email);
      const verified = await fixture.auth.api.verifyBackupCode({ headers: { cookie: mfaCookie(pending) }, body: { code }, asResponse: true });
      expect(verified.status).toBe(200); cookie = mfaCookie(verified);
    }
    expect((await fixture.auth.api.viewBackupCodes({ body: { userId: login.loginId } })).backupCodes).toEqual([]);
    const replacement = await call({ action: "replace", cookie });
    expect(replacement.status).toBe(200);
    expect((await replacement.json() as MfaSetup).backupCodes).toHaveLength(10);
    const pendingCookie = mfaCookie(replacement);
    const pendingSession = await fixture.auth.api.getSession({ headers: { cookie: pendingCookie } });
    if (!pendingSession) throw new Error("Missing actual replacement enrollment session.");
    expect(await env.HUB_ACCESS.validateAccess({ loginId: login.loginId, hubSessionId: pendingSession.session.id,
      workspaceId: null, context: createRequestContext() })).toEqual({ status: "invalid", code: "core_unauthenticated" });
    const verified = await fixture.auth.api.verifyTOTP({ headers: { cookie: pendingCookie },
      body: { code: await currentMfaCode(fixture, login.loginId) }, asResponse: true });
    expect(verified.status).toBe(200);
    const restored = await readMfaLogin(fixture, { login, response: verified });
    expect(await env.HUB_ACCESS.validateAccess({ loginId: restored.loginId, hubSessionId: restored.hubSessionId,
      workspaceId: null, context: createRequestContext() })).toMatchObject({ status: "valid", mfa: { status: "verified" } });
  });

  it("when a submission is rate limited then it returns a safe refusal without changing MFA state", async () => {
    const login = await createEnrolledMaster(fixture), before = await state();
    isAllowed = false;
    const response = await call({ action: "backups", cookie: login.cookie });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: "accounts_mfa_limited", message: "Too many attempts. Please wait before trying again.", requestId: expect.any(String) });
    expect(new Set(keys)).toEqual(new Set([`mfa:${login.loginId}`]));
    expect(await state()).toEqual(before); expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("when the rate service is unavailable then no factor mutation or success cookie is delivered", async () => {
    const login = await createEnrolledMaster(fixture), before = await state();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    isAvailable = false;
    const response = await call({ action: "backups", cookie: login.cookie });
    expect(response.status).toBe(500); expect(await state()).toEqual(before); expect(response.headers.getSetCookie()).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it.each(["setup", "replace", "backups"] as const)("when an ordinary login asks for %s then tenant status cannot grant master MFA access", async (action) => {
    const login = await fixture.identities.signIn(), before = await state();
    expect((await call({ action, cookie: login.cookie })).status).toBe(403); expect(await state()).toEqual(before);
  });

  it("when a body supplies another identity or private flags then strict input refuses the whole change", async () => {
    const login = await createEnrolledMaster(fixture), before = await state();
    const response = await call({ action: "backups", cookie: login.cookie,
      body: { password: fixture.password, loginId: crypto.randomUUID(), mfaVerifiedAt: new Date().toISOString() } });
    expect(response.status).toBe(400); expect(await state()).toEqual(before);
  });
});

async function call(input: { action: Parameters<typeof handleMfaAction>[0]; cookie: string; body?: unknown; settings?: HubAuthSettings }): Promise<Response> {
  return await handleMfaAction(input.action, input.body ?? { password: fixture.password }, {
    request: new Request(fixture.origin + "/_serverFn/mfa", { method: "POST", headers: {
      origin: fixture.origin, cookie: input.cookie, "content-type": "application/json",
    } }), settings: input.settings ?? { database: env.DB, baseURL: fixture.origin, secret: fixture.auth.options.secret, rateLimiter: fixture.rateLimiter },
  });
}

async function state() {
  const db = fixture.identities.db;
  return { users: await db.selectFrom("user").selectAll().orderBy("id").execute(),
    factors: await db.withoutPlugins().selectFrom("twoFactor").selectAll().orderBy("id").execute(),
    sessions: await db.selectFrom("session").selectAll().orderBy("id").execute(),
    challenges: await db.selectFrom("verification").selectAll().orderBy("id").execute(),
    audit: await db.selectFrom("auditEntries").selectAll().orderBy("id").execute() };
}
