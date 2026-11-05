import { env } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import * as oauth from "oauth4webapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { network } from "#test/network";
import { createEnrolledMaster, createMfaFixture, currentMfaCode, mfaCookie, type MfaFixture } from "#test/master-mfa";
import { pauseDatabaseQuery } from "#test/database-barrier.db";
import { hubRequest } from "#test/sign-in";
import { handleHubAuthRequest, type HubRequestSettings } from "#auth/oidc.server.ts";
import { handleFirstSignIn, validateFirstSignIn } from "#functions/complete-first-sign-in.server.ts";

let fixture: MfaFixture, settings: HubRequestSettings;
let client: { client_id: string; client_secret: string };
let clientOwnerCookie: string;
const callback = "https://workspace.example.test/auth/callback";
beforeEach(async () => {
  fixture = await createMfaFixture(env.DB);
  settings = { database: env.DB, baseURL: fixture.origin, secret: fixture.auth.options.secret,
    rateLimiter: fixture.rateLimiter, turnstileSecret: "fixture-turnstile-secret" };
  network.use(http.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", () =>
    HttpResponse.json({ success: true, hostname: "hub.example.test", action: "sign-in" })));
  const administrator = await createEnrolledMaster(fixture);
  clientOwnerCookie = administrator.cookie;
  const native = await fixture.auth.api.adminCreateOAuthClient({ headers: { cookie: administrator.cookie }, body: {
    client_name: "Real MFA OAuth", redirect_uris: [callback], scope: "openid profile email", require_pkce: true,
    token_endpoint_auth_method: "client_secret_basic", grant_types: ["authorization_code"], response_types: ["code"], skip_consent: true,
  } });
  if (typeof native.client_secret !== "string") throw new Error("The native provider did not create a confidential client.");
  client = { client_id: native.client_id, client_secret: native.client_secret };
});
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await fixture.identities.db.destroy(); });

describe("live MFA OAuth boundaries", () => {
  it("when an unenrolled master authorizes or resumes then the signed post-login gate cannot issue a code", async () => {
    const login = await fixture.identities.signIn({ role: "admin" });
    const flow = await authorization();
    const response = await handleHubAuthRequest(new Request(flow.url, { headers: { cookie: login.cookie } }), settings);
    expect(response.status).toBe(302);
    const postLogin = new URL(response.headers.get("location") ?? "", fixture.origin);
    expect(postLogin.pathname).toBe("/complete-profile");
    expect(postLogin.searchParams.has("sig")).toBe(true);
    expect(postLogin.searchParams.has("code")).toBe(false);
    const continued = await handleHubAuthRequest(hubRequest("/api/auth/oauth2/continue", {
      postLogin: true, oauth_query: postLogin.search.slice(1),
    }, login.cookie), settings);
    expect(continued.status).toBe(200);
    expect(await continued.json()).toMatchObject({ redirect: true, url: expect.stringContaining("/complete-profile?") });
    expect(await fixture.identities.db.selectFrom("verification").selectAll().where("identifier", "not like", "2fa-%").execute()).toEqual([]);
  });

  it.each(["none", "verified", "limited"] as const)("when an ordinary token owner becomes an unenrolled master then bearer UserInfo refuses it (unrelated browser cookie: %s)", async (browserCookie) => {
    const administrator = await createEnrolledMaster(fixture), login = await fixture.identities.signIn();
    const browser = browserCookie === "limited" ? await fixture.identities.signIn({ role: "admin" }) : administrator;
    const flow = await authorization();
    const authorized = await handleHubAuthRequest(new Request(flow.url, { headers: { cookie: login.cookie } }), settings);
    const code = new URL(authorized.headers.get("location") ?? "", fixture.origin).searchParams.get("code");
    if (!code) throw new Error("The ordinary login did not receive its real authorization code.");
    const tokenResponse = await handleHubAuthRequest(new Request(fixture.origin + "/api/auth/oauth2/token", {
      method: "POST", headers: { authorization: "Basic " + btoa(client.client_id + ":" + client.client_secret), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callback, code_verifier: flow.verifier }),
    }), settings);
    expect(tokenResponse.status).toBe(200);
    const token = await tokenResponse.json() as { access_token: string };
    const request = (): Request => new Request(fixture.origin + "/api/auth/oauth2/userinfo", { headers: {
      authorization: "Bearer " + token.access_token, ...(browserCookie !== "none" ? { cookie: browser.cookie } : {}),
    } });
    expect((await handleHubAuthRequest(request(), settings)).status).toBe(200);
    await fixture.auth.api.setRole({ headers: { cookie: administrator.cookie }, body: { userId: login.loginId, role: "admin" } });
    const response = await handleHubAuthRequest(request(), settings);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "core_mfa_required" });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    { method: "totp", accept: "application/json" },
    { method: "backup-code", accept: "application/json" },
    { method: "totp", accept: "text/html" },
  ])("when public $method MFA resumes signed OAuth for $accept then actual verification precedes code issuance", async ({ method, accept }) => {
    const login = await createEnrolledMaster(fixture), flow = await authorization();
    const prompt = await handleHubAuthRequest(new Request(flow.url), settings);
    const query = new URL(prompt.headers.get("location") ?? "", fixture.origin).search.slice(1);
    const credential = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", {
      email: login.email, password: fixture.password, oauth_query: query,
    }), settings);
    expect(credential.status).toBe(200);
    expect(await credential.clone().json()).toEqual({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    expect(await completionAudits(login.loginId)).toEqual([]);
    const code = method === "totp" ? await currentMfaCode(fixture, login.loginId) : login.backupCodes[0];
    const request = hubRequest("/api/auth/two-factor/verify-" + method, { code, oauth_query: query }, mfaCookie(credential));
    request.headers.set("accept", accept);
    const barrier = pauseDatabaseQuery(env.DB, (sql) => sql.startsWith('insert into "verification"'));
    const verification = handleHubAuthRequest(request, { ...settings, database: barrier.database });
    try {
      await Promise.race([barrier.entered, verification.then(() => { throw new Error("OAuth did not reach native code issuance."); })]);
      const sessions = await fixture.identities.db.withoutPlugins().selectFrom("session").selectAll()
        .where("userId", "=", login.loginId).where("id", "!=", login.hubSessionId).execute();
      expect(sessions).toEqual([expect.objectContaining({ mfa_verified_at: expect.any(String), auth_revision: 1 })]);
    } finally { barrier.release(); }
    const response = await verification;
    expect(response.status).toBe(accept === "text/html" ? 302 : 200);
    const body: unknown = accept === "text/html" ? null : await response.clone().json();
    const destination = accept === "text/html" ? response.headers.get("location")
      : body && typeof body === "object" && "url" in body && typeof body.url === "string" ? body.url : null;
    if (!destination) throw new Error("Completed MFA did not resume the signed workspace flow.");
    if (body) expect(body).toEqual({ redirect: true, url: destination });
    const location = new URL(destination);
    expect(location.origin + location.pathname).toBe(callback);
    expect(location.searchParams.get("code")).toEqual(expect.any(String));
    expect(location.searchParams.get("state")).toBe(flow.url.searchParams.get("state"));
    expect(await completionAudits(login.loginId)).toEqual([expect.objectContaining({ outcome: "success", requestId: response.headers.get("x-request-id") })]);
    const cookie = mfaCookie(response), current = await fixture.auth.api.getSession({ headers: { cookie } });
    expect(current?.user.id).toBe(login.loginId);
    expect(destination).not.toContain(current?.session.token);
    expect(destination).not.toContain(fixture.password);
  });

  it("Workspace sign-in continuation", async () => {
    const login = await createEnrolledMaster(fixture, { phone: null }), flow = await authorization();
    const authorized = await handleHubAuthRequest(new Request(flow.url), settings);
    const query = new URL(authorized.headers.get("location") ?? "", fixture.origin).search.slice(1);
    const credential = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", {
      email: login.email, password: fixture.password, oauth_query: query,
    }), settings);
    expect(await credential.clone().json()).toEqual({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    const verified = await handleHubAuthRequest(hubRequest("/api/auth/two-factor/verify-totp", {
      code: await currentMfaCode(fixture, login.loginId), oauth_query: query,
    }, mfaCookie(credential)), settings);
    expect(verified.status).toBe(200);
    const body = await verified.json() as { redirect: boolean; url: string };
    expect(body).toEqual({ redirect: true, url: expect.any(String) });
    const prompt = new URL(body.url, fixture.origin), cookie = mfaCookie(verified);
    expect(prompt.pathname).toBe("/complete-profile");
    expect(prompt.searchParams.has("code")).toBe(false);
    const continueRequest = (): Request => hubRequest("/api/auth/oauth2/continue", { postLogin: true, oauth_query: prompt.search.slice(1) }, cookie);
    const paused = await handleHubAuthRequest(continueRequest(), settings);
    expect(await paused.json()).toEqual({ redirect: true, url: expect.stringContaining("/complete-profile?") });
    const completed = await handleFirstSignIn(validateFirstSignIn({ phone: { country: "US", number: "2025550123" } }), {
      request: hubRequest("/_serverFn/complete", {}, cookie), settings,
    });
    expect(completed.status).toBe(200);
    const resumed = await handleHubAuthRequest(continueRequest(), settings);
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toEqual({ redirect: true, url: expect.stringContaining(callback + "?code=") });
  });

  it("when a signed consent continuation was cleared before promotion then its saved flag cannot bypass live master MFA", async () => {
    const administrator = await createEnrolledMaster(fixture), login = await fixture.identities.signIn();
    await fixture.auth.api.adminUpdateOAuthClient({ headers: { cookie: clientOwnerCookie },
      body: { client_id: client.client_id, update: { skip_consent: false } } });
    const flow = await authorization();
    const authorized = await handleHubAuthRequest(new Request(flow.url, { headers: { cookie: login.cookie } }), settings);
    const consent = new URL(authorized.headers.get("location") ?? "", fixture.origin);
    expect(consent.pathname).toBe("/consent");
    expect(consent.searchParams.has("ba_pl")).toBe(true);
    await fixture.auth.api.setRole({ headers: { cookie: administrator.cookie }, body: { userId: login.loginId, role: "admin" } });
    await fixture.auth.api.adminUpdateOAuthClient({ headers: { cookie: clientOwnerCookie },
      body: { client_id: client.client_id, update: { skip_consent: true } } });
    const response = await handleHubAuthRequest(hubRequest("/api/auth/oauth2/continue", {
      postLogin: true, oauth_query: consent.search.slice(1),
    }, login.cookie), settings);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "core_mfa_required" });
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("when an MFA submission changes its signed continuation then no backup code is consumed and a valid retry still works", async () => {
    const login = await createEnrolledMaster(fixture), flow = await authorization();
    const prompt = await handleHubAuthRequest(new Request(flow.url), settings);
    const query = new URL(prompt.headers.get("location") ?? "", fixture.origin).searchParams;
    const pending = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", {
      email: login.email, password: fixture.password, oauth_query: query.toString(),
    }), settings);
    const original = query.toString(); query.set("state", "changed");
    const cookie = mfaCookie(pending), code = login.backupCodes[0];
    const before = await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().execute();
    const response = await handleHubAuthRequest(hubRequest("/api/auth/two-factor/verify-backup-code", { code, oauth_query: query.toString() }, cookie), settings);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "core_sign_in_invalid", message: "Sign-in could not be completed. Please try again.", requestId: response.headers.get("x-request-id") });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await fixture.identities.db.withoutPlugins().selectFrom("twoFactor").selectAll().execute()).toEqual(before);
    expect(await completionAudits(login.loginId)).toEqual([]);
    const retried = await handleHubAuthRequest(hubRequest("/api/auth/two-factor/verify-backup-code", { code, oauth_query: original }, cookie), settings);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual({ redirect: true, url: expect.stringContaining(callback + "?code=") });
  });
});

async function completionAudits(loginId: string) {
  return await fixture.identities.db.selectFrom("auditEntries").selectAll().where("action", "=", "accounts_sign_in")
    .where("affectedLoginId", "=", loginId).execute();
}

async function authorization() {
  const verifier = oauth.generateRandomCodeVerifier(), url = new URL(fixture.origin + "/api/auth/oauth2/authorize");
  url.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: "code",
    scope: "openid profile email", state: oauth.generateRandomState(), nonce: oauth.generateRandomNonce(),
    code_challenge_method: "S256", code_challenge: await oauth.calculatePKCECodeChallenge(verifier) }).toString();
  return { verifier, url };
}
