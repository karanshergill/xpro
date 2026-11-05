import { env } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { network } from "#test/network";
import { beginMfaSignIn, createEnrolledMaster, createMfaFixture, currentMfaCode, mfaCookie, type MfaFixture } from "#test/master-mfa";
import { hubRequest } from "#test/sign-in";
import { handleHubAuthRequest, type HubRequestSettings } from "#auth/oidc.server.ts";
import { handleMfaAction } from "#functions/mfa.server.ts";
import { createRequestContext } from "@xpro/core/server";
import { parseCookies, setRequestCookie } from "better-auth/cookies";
import { symmetricDecrypt } from "better-auth/crypto";

let fixture: MfaFixture, settings: HubRequestSettings;
beforeEach(async () => {
  fixture = await createMfaFixture(env.DB);
  settings = { database: env.DB, baseURL: fixture.origin, secret: fixture.auth.options.secret,
    rateLimiter: fixture.rateLimiter, turnstileSecret: "fixture-turnstile-secret" };
  network.use(http.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", () =>
    HttpResponse.json({ success: true, hostname: "hub.example.test", action: "sign-in" })));
});
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await fixture.identities.db.destroy(); });

describe("public guarded MFA", () => {
  it.each(["email", "username"] as const)("when enrolled master %s credentials succeed then only the native pending challenge is returned", async (method) => {
    const login = await createEnrolledMaster(fixture), log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = await fixture.identities.db.selectFrom("user").select(["email", "username"]).where("id", "=", login.loginId).executeTakeFirstOrThrow();
    const response = await send("/sign-in/" + method, { [method]: user[method], password: fixture.password });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await fixture.auth.api.getSession({ headers: { cookie: mfaCookie(response) } })).toBeNull();
    expect(response.headers.getSetCookie().some((value) => /two_factor=.+;.*HttpOnly;.*Secure/.test(value))).toBe(true);
    expect(await signInAudits()).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it.each(["totp", "backup-code"] as const)("when public %s verification succeeds then the real verified session receives one completion audit", async (method) => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email);
    const code = method === "totp" ? await currentMfaCode(fixture, login.loginId) : login.backupCodes[0];
    const keys: string[] = [];
    const response = await send("/two-factor/verify-" + method, { code }, mfaCookie(pending), {
      ...settings, rateLimiter: { async limit({ key }) { keys.push(key); return { success: true }; } },
    });
    expect(response.status).toBe(200);
    expect(await response.clone().json()).toEqual({ status: true });
    expect(keys).toEqual([`mfa:${login.loginId}`]);
    const session = await fixture.auth.api.getSession({ headers: { cookie: mfaCookie(response) } });
    if (!session) throw new Error("Public MFA did not issue a session.");
    expect(await env.HUB_ACCESS.validateAccess({ loginId: login.loginId, hubSessionId: session.session.id,
      workspaceId: null, context: createRequestContext() })).toMatchObject({ status: "valid", mfa: { status: "verified" } });
    expect(await signInAudits()).toEqual([expect.objectContaining({ outcome: "success", actorLoginId: login.loginId,
      affectedLoginId: login.loginId, reason: null, requestId: response.headers.get("x-request-id") })]);
  });

  it("when an unenrolled master completes public activation then its password-only session is replaced and sign-in is audited only once", async () => {
    const login = await fixture.identities.createLogin({ role: "admin" });
    const credential = await send("/sign-in/email", { email: login.email, password: fixture.password });
    expect(credential.status).toBe(200);
    const cookie = mfaCookie(credential);
    expect(await signInAudits()).toEqual([]);
    const setup = await handleMfaAction("setup", { password: fixture.password }, {
      request: hubRequest("/_serverFn/mfa", {}, cookie), settings,
    });
    expect(setup.status).toBe(200);
    const response = await send("/two-factor/verify-totp", { code: await currentMfaCode(fixture, login.loginId) }, cookie);
    expect(response.status).toBe(200);
    expect(await response.clone().json()).toEqual({ status: true });
    expect(await fixture.auth.api.getSession({ headers: { cookie } })).toBeNull();
    expect(await signInAudits()).toEqual([expect.objectContaining({ outcome: "success", affectedLoginId: login.loginId })]);
  });

  it.each(["trustDevice", "disableSession", "authRevision", "mfaVerifiedAt", "twoFactorEnabled"])("when public verification supplies %s then strict input refuses it without consuming the code", async (field) => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email), code = login.backupCodes[0];
    const cookie = mfaCookie(pending), before = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().execute();
    const response = await send("/two-factor/verify-backup-code", { code, [field]: false }, cookie);
    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().execute()).toEqual(before);
    expect(await signInAudits()).toEqual([]);
    expect((await send("/two-factor/verify-backup-code", { code }, cookie)).status).toBe(200);
  });

  it("when a live cookie and native challenge are both supplied then public verification cannot consume either authority", async () => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email);
    const headers = new Headers({ cookie: mfaCookie(pending) });
    for (const [name, value] of parseCookies(login.cookie)) setRequestCookie(headers, name, value);
    const response = await send("/two-factor/verify-totp", { code: await currentMfaCode(fixture, login.loginId) }, headers.get("cookie") ?? "");
    expect(response.status).toBe(409);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await signInAudits()).toEqual([]);
    expect((await fixture.auth.api.getSession({ headers: { cookie: login.cookie } }))?.user.id).toBe(login.loginId);
    expect((await send("/two-factor/verify-totp", { code: await currentMfaCode(fixture, login.loginId) }, mfaCookie(pending))).status).toBe(200);
  });

  it.each(["/two-factor/enable", "/two-factor/disable", "/two-factor/get-totp-uri", "/two-factor/generate-backup-codes", "/two-factor/send-otp", "/two-factor/verify-otp"])("when HTTP calls %s then unused native management remains unavailable", async (path) => {
    const login = await createEnrolledMaster(fixture), before = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().execute();
    const response = await send(path, { password: fixture.password }, login.cookie);
    expect(response.status).toBe(404);
    expect(await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().execute()).toEqual(before);
  });

  it("Private authentication material", async () => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email);
    const diagnostics: unknown[][] = [];
    for (const method of ["debug", "info", "log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation((...args) => { diagnostics.push(args); });
    const code = "private-invalid-factor-" + crypto.randomUUID();
    const response = await send("/two-factor/verify-totp", { code }, mfaCookie(pending));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ code: "accounts_mfa_invalid_code", message: "The code is invalid or has expired. Try again or start sign-in again.", requestId: response.headers.get("x-request-id") });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await signInAudits()).toEqual([]);
    const visible = JSON.stringify({ body, diagnostics, audits: await fixture.identities.db.selectFrom("auditEntries").selectAll().execute() });
    for (const secret of [code, fixture.password, settings.secret, login.email, ...login.backupCodes]) expect(visible).not.toContain(secret);
    expect(diagnostics).toEqual([]);
  });

  it("when setup and management display new material then sessions, headers, audits and logs contain none of it", async () => {
    const login = await fixture.identities.signIn({ role: "admin" });
    const diagnostics: unknown[][] = [];
    for (const method of ["debug", "info", "log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation((...args) => { diagnostics.push(args); });
    const setupRequest = hubRequest("/_serverFn/mfa", {}, login.cookie);
    setupRequest.headers.set("x-mfa-setup-id", "untrusted-request-hint");
    const setup = await handleMfaAction("setup", { password: fixture.password }, { request: setupRequest, settings });
    expect(setup.status).toBe(200);
    const material: { setupId: string; totpURI: string; backupCodes: string[] } = await setup.json();
    expect(Object.keys(material).sort()).toEqual(["backupCodes", "setupId", "totpURI"]);
    const factor = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", login.loginId).executeTakeFirstOrThrow();
    expect(material.setupId).toBe(factor.id);
    const secret = await symmetricDecrypt({ key: (await fixture.auth.$context).secretConfig, data: factor.secret });
    const verified = await send("/two-factor/verify-totp", { code: await currentMfaCode(fixture, login.loginId) }, login.cookie);
    expect(verified.status).toBe(200); expect(await verified.clone().json()).toEqual({ status: true });
    const cookie = mfaCookie(verified), session = await fixture.auth.api.getSession({ headers: { cookie } });
    if (!session) throw new Error("Missing actual verified session.");
    for (const record of [session.user, session.session]) {
      expect(record).not.toHaveProperty("authRevision"); expect(record).not.toHaveProperty("mfaVerifiedAt");
      expect(record).not.toHaveProperty("secret"); expect(record).not.toHaveProperty("backupCodes");
    }
    const backups = await handleMfaAction("backups", { password: fixture.password }, { request: hubRequest("/_serverFn/mfa", {}, cookie), settings });
    const newCodes = await backups.json() as { backupCodes: string[] };
    expect(backups.status).toBe(200); expect(Object.keys(newCodes)).toEqual(["backupCodes"]);
    const replacement = await handleMfaAction("replace", { password: fixture.password }, { request: hubRequest("/_serverFn/mfa", {}, cookie), settings });
    const newSetup = await replacement.json() as { setupId: string; totpURI: string; backupCodes: string[] };
    expect(replacement.status).toBe(200); expect(Object.keys(newSetup).sort()).toEqual(["backupCodes", "setupId", "totpURI"]);
    const replacedFactor = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").select("id").where("userId", "=", login.loginId).executeTakeFirstOrThrow();
    expect(newSetup.setupId).toBe(replacedFactor.id);
    const responses = [setup, verified, backups, replacement];
    for (const response of responses) expect(response.headers.get("cache-control")).toBe("no-store");
    const visible = JSON.stringify({ diagnostics, session, verification: await verified.json(),
      headers: responses.map((response) => [...response.headers.entries()]), audits: await fixture.identities.db.selectFrom("auditEntries").selectAll().execute() });
    const sensitive = [fixture.password, settings.secret, secret, factor.secret, factor.backupCodes,
      new URL(material.totpURI).searchParams.get("secret"), new URL(newSetup.totpURI).searchParams.get("secret"),
      ...material.backupCodes, ...newCodes.backupCodes, ...newSetup.backupCodes];
    for (const value of sensitive) { if (value) expect(visible).not.toContain(value); }
    expect(diagnostics).toEqual([]);
  });

  it.each(["limited", "unavailable"] as const)("when the MFA limiter is %s then verification returns a safe actionable refusal", async (state) => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await send("/two-factor/verify-totp", { code: await currentMfaCode(fixture, login.loginId) }, mfaCookie(pending), {
      ...settings, rateLimiter: { async limit() { if (state === "unavailable") throw new Error("Private limiter details"); return { success: false }; } },
    });
    expect(response.status).toBe(state === "limited" ? 429 : 503);
    expect(await response.json()).toEqual({ code: state === "limited" ? "accounts_mfa_limited" : "accounts_mfa_unavailable",
      message: state === "limited" ? "Too many attempts. Please wait before trying again." : "Verification is temporarily unavailable. Please try again.",
      requestId: response.headers.get("x-request-id") });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await signInAudits()).toEqual([]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("Private limiter details");
    expect((await send("/two-factor/verify-totp", { code: await currentMfaCode(fixture, login.loginId) }, mfaCookie(pending))).status).toBe(200);
  });

  it("when native challenge attempts are exhausted then the public response requires fresh credentials", async () => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email), cookie = mfaCookie(pending);
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await send("/two-factor/verify-totp", { code: "invalid-code" }, cookie)).status).toBe(401);
    const response = await send("/two-factor/verify-totp", { code: await currentMfaCode(fixture, login.loginId) }, cookie);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "core_unauthenticated", message: "Start sign-in again.", requestId: response.headers.get("x-request-id") });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await signInAudits()).toEqual([]);
  });

  it("when a new sign-in uses an already verified browser then the native challenge still requires a second factor", async () => {
    const login = await createEnrolledMaster(fixture);
    const response = await send("/sign-in/email", { email: login.email, password: fixture.password, rememberMe: true }, login.cookie);
    expect(await response.clone().json()).toEqual({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    expect(await fixture.auth.api.getSession({ headers: { cookie: mfaCookie(response, login.cookie) } })).toBeNull();
    expect(await signInAudits()).toEqual([]);
  });

  it("Fresh sign-in on the same browser", async () => {
    for (const endedBy of ["sign-out", "expiry"] as const) {
      const login = await createEnrolledMaster(fixture);
      let cookie = login.cookie;
      if (endedBy === "sign-out") {
        const ended = await send("/sign-out", {}, cookie);
        expect(ended.status).toBe(200); cookie = mfaCookie(ended, cookie);
      } else {
        const session = await fixture.auth.api.getSession({ headers: { cookie } });
        if (!session) throw new Error("Missing actual session expiry.");
        vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(session.session.expiresAt.getTime() + 1);
      }
      expect(await fixture.auth.api.getSession({ headers: { cookie } })).toBeNull();
      const pending = await send("/sign-in/email", { email: login.email, password: fixture.password, rememberMe: true }, cookie);
      expect(pending.status).toBe(200);
      expect(await pending.json()).toEqual({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
      expect(await fixture.auth.api.getSession({ headers: { cookie: mfaCookie(pending, cookie) } })).toBeNull();
      expect(await signInAudits()).toEqual([]);
    }
  });

  it("when an untrusted origin submits a valid factor then native CSRF checks refuse it before consumption", async () => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email);
    const request = hubRequest("/api/auth/two-factor/verify-backup-code", { code: login.backupCodes[0] }, mfaCookie(pending));
    request.headers.set("origin", "https://foreign.example.test");
    const before = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().execute();
    const response = await handleHubAuthRequest(request, settings);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "core_forbidden", message: "You do not have permission to do this.", requestId: response.headers.get("x-request-id") });
    expect(await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().execute()).toEqual(before);
    expect(await signInAudits()).toEqual([]);
  });

  it("when verification storage fails then one safe server error drops all success cookies and hides factor material", async () => {
    const login = await createEnrolledMaster(fixture), pending = await beginMfaSignIn(fixture, login.email);
    const code = await currentMfaCode(fixture, login.loginId);
    await fixture.identities.db.schema.dropTable("verification").execute();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await send("/two-factor/verify-totp", { code }, mfaCookie(pending));
    const requestId = response.headers.get("x-request-id");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "core_unexpected_error", message: "Something went wrong. Please try again.", requestId });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId, app: "hub", operation: "accounts_hub_auth_request" })]]);
    expect(await signInAudits()).toEqual([]);
  });
});

async function send(path: string, body: unknown, cookie?: string, configured = settings): Promise<Response> {
  const request = hubRequest("/api/auth" + path, body, cookie);
  if (path.startsWith("/two-factor/")) request.headers.delete("x-captcha-response");
  return await handleHubAuthRequest(request, configured);
}
async function signInAudits() {
  return await fixture.identities.db.selectFrom("auditEntries").selectAll().where("action", "=", "accounts_sign_in").execute();
}
