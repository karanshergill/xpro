import { env } from "cloudflare:workers";
import { createRequestContext, readPrivateCookie } from "@xpro/core/server";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { createSignInFixture, hubOrigin, hubRequest, readCookies, readWorkspaceState, signInPassword,
  type SignInFixture, type WorkspaceFixture } from "#test/sign-in";
import type { SignedInLogin } from "#test/hub-identities";
import { err } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSignIn, validateSignInCallback, type SignInServices } from "./oidc.server";

let fixture: SignInFixture;
beforeEach(async () => { fixture = await createSignInFixture(env.DB); });
afterEach(async () => { await fixture.identities.db.destroy(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("T018 — native OIDC protocol before the T019 session save", () => {
  it.each(["default", "customer domain"] as const)("when a confidential client uses its %s then native code exchange proves the login and original Hub session without creating a workspace session", async (domain) => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId,
      ...(domain === "customer domain" ? { origin: "https://tenant.customer.test" } : {}) });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const before = await readWorkspaceState(workspace);
    const flow = await prepareFlow(workspace, login);
    const result = await validateSignInCallback(flow.request, services(workspace));
    expect(result.isOk).toBe(true);
    if (result.isErr) throw new Error("Native exchange was refused.");
    expect(result.value).toEqual({ loginId: login.loginId, hubSessionId: login.hubSessionId,
      idToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/), returnTo: null });
    expect(await readWorkspaceState(workspace)).toEqual(before);
  });

  it("when two flows start then each has fresh S256, state, nonce and a host-only private cookie", async () => {
    const workspace = await fixture.prepareWorkspace();
    const starts = await Promise.all([start(workspace), start(workspace)]);
    const urls = starts.map(location);
    for (const url of urls) {
      expect(url.origin + url.pathname).toBe(hubOrigin + "/api/auth/oauth2/authorize");
      expect(url.searchParams.get("client_id")).toBe(workspace.clientId);
      expect(url.searchParams.get("redirect_uri")).toBe(workspace.origin + "/auth/callback");
      expect(url.searchParams.get("scope")).toBe("openid profile email");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
      expect(url.href).not.toContain(workspace.clientSecret);
      expect(url.searchParams.has("code_verifier")).toBe(false);
    }
    for (const field of ["state", "nonce", "code_challenge"]) expect(urls[0]?.searchParams.get(field)).not.toBe(urls[1]?.searchParams.get(field));
    expect(starts[0]?.headers.get("set-cookie")).toMatch(/^__Host-xpro-sign-in=.*; HttpOnly; Secure; SameSite=Lax$/);
  });

  it("when no Hub session exists then the native provider returns a signed continuation to sign-in", async () => {
    const workspace = await fixture.prepareWorkspace();
    const response = await handleHubAuthRequest(new Request(location(await start(workspace))), fixture.settings);
    const destination = new URL(response.headers.get("location") ?? "", hubOrigin);
    expect(destination.pathname).toBe("/sign-in");
    expect(destination.searchParams.has("sig")).toBe(true);
    expect(destination.searchParams.has("code")).toBe(false);
  });

  it.each([
    { accept: "application/json", hasExistingMasterSession: false },
    { accept: "text/html", hasExistingMasterSession: false },
    { accept: "application/json", hasExistingMasterSession: true },
  ])("when native sign-in resumes for $accept (old master cookie: $hasExistingMasterSession) then the new login owns the code and one success audit", async ({ accept, hasExistingMasterSession }) => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
    const begin = await start(workspace);
    const prompt = await handleHubAuthRequest(new Request(location(begin)), fixture.settings);
    const query = new URL(prompt.headers.get("location") ?? "", hubOrigin).search.slice(1);
    const oldMaster = hasExistingMasterSession ? await fixture.signInMaster() : null;
    const request = hubRequest("/api/auth/sign-in/email", { email: created.email, password: signInPassword, oauth_query: query }, oldMaster?.cookie);
    const headers = new Headers(request.headers); headers.set("accept", accept);
    const response = await handleHubAuthRequest(new Request(request, { headers }), fixture.settings);
    const session = await fixture.identities.auth.api.getSession({ headers: { cookie: readCookies(response) } });
    if (!session) throw new Error("Native continuation did not issue a session.");
    const callback = accept === "text/html" ? response.headers.get("location") : (await response.json() as { url: string }).url;
    expect(response.status).toBe(accept === "text/html" ? 302 : 200);
    expect(typeof callback).toBe("string");
    if (!callback) throw new Error("Native continuation did not return a callback.");
    expect(new URL(callback).origin).toBe(workspace.origin);
    expect(callback).not.toContain(session.session.token);
    expect(callback).not.toContain(session.session.id);
    expect(await fixture.identities.db.selectFrom("auditEntries").selectAll().where("action", "=", "accounts_sign_in").execute()).toEqual([
      expect.objectContaining({ action: "accounts_sign_in", outcome: "success", actorLoginId: created.loginId,
        affectedLoginId: created.loginId, requestId: response.headers.get("x-request-id"), reason: null }),
    ]);
    const result = await validateSignInCallback(new Request(callback, { headers: { cookie: readCookies(begin) } }), services(workspace));
    expect(result.isOk && result.value.hubSessionId).toBe(session.session.id);
    expect(result.isOk && result.value.loginId).toBe(created.loginId);
  });

  it.each(["changed", "expired"] as const)("when the signed sign-in continuation is %s then credentials are not consumed and the protocol refusal is safely audited", async (fault) => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
    const prompt = await handleHubAuthRequest(new Request(location(await start(workspace))), fixture.settings);
    const query = new URL(prompt.headers.get("location") ?? "", hubOrigin).searchParams;
    if (fault === "changed") query.set("state", "changed");
    if (fault === "expired") { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 11 * 60_000); }
    const beforeSessions = await fixture.identities.db.selectFrom("session").selectAll().execute();
    const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", {
      email: created.email, password: signInPassword, oauth_query: query.toString(),
    }), fixture.settings);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "core_sign_in_invalid", message: "Sign-in could not be completed. Please try again.",
      requestId: response.headers.get("x-request-id") });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await fixture.identities.db.selectFrom("session").selectAll().execute()).toEqual(beforeSessions);
    expect(await fixture.identities.db.selectFrom("auditEntries").selectAll().where("action", "=", "accounts_sign_in").execute()).toEqual([
      expect.objectContaining({ action: "accounts_sign_in", outcome: "refused", reason: "core_sign_in_invalid", actorLoginId: null, affectedLoginId: null }),
    ]);
  });

  it("when profile completion is required then native continuation cannot skip it and resumes only after the real completion action", async () => {
    const created = await fixture.identities.createLogin({ phone: null });
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const authorization = location(await start(workspace));
    const response = await handleHubAuthRequest(new Request(authorization, { headers: { cookie: login.cookie } }), fixture.settings);
    const completion = new URL(response.headers.get("location") ?? "", hubOrigin);
    expect(completion.pathname).toBe("/complete-profile");
    expect(completion.searchParams.has("sig")).toBe(true);
    const refused = await handleHubAuthRequest(hubRequest("/api/auth/oauth2/continue", {
      postLogin: true, oauth_query: completion.search.slice(1),
    }, login.cookie), fixture.settings);
    expect(await refused.json()).toMatchObject({ redirect: true, url: expect.stringContaining("/complete-profile?") });
    // Exercise the implemented action, not a direct database profile repair.
    const { completeFirstSignIn } = await import("@xpro/accounts/server");
    const { prepareDestination } = await import("#test/sign-in");
    expect((await completeFirstSignIn({ phone: { country: "US", number: "2025550123" } }, await prepareDestination(login))).isOk).toBe(true);
    const resumed = await handleHubAuthRequest(hubRequest("/api/auth/oauth2/continue", {
      postLogin: true, oauth_query: completion.search.slice(1),
    }, login.cookie), fixture.settings);
    expect(await resumed.json()).toMatchObject({ redirect: true, url: expect.stringContaining(workspace.origin + "/auth/callback?code=") });
  });

  it.each(["missing state", "changed state", "duplicate state", "missing code", "duplicate code", "wrong issuer", "missing cookie", "changed cookie", "wrong callback", "wrong method"] as const)("when the callback has %s then no identity or local session is issued", async (fault) => {
    const login = await fixture.signIn(await fixture.identities.createLogin(), handleHubAuthRequest);
    const workspace = await fixture.prepareWorkspace({ loginId: login.loginId });
    const flow = await prepareFlow(workspace, login);
    const callback = new URL(flow.request.url);
    let cookie = flow.cookie;
    if (fault === "missing state") callback.searchParams.delete("state");
    if (fault === "changed state") callback.searchParams.set("state", "different");
    if (fault === "duplicate state") callback.searchParams.append("state", callback.searchParams.get("state") ?? "");
    if (fault === "missing code") callback.searchParams.delete("code");
    if (fault === "duplicate code") callback.searchParams.append("code", callback.searchParams.get("code") ?? "");
    if (fault === "wrong issuer") callback.searchParams.set("iss", "https://wrong.example.test/api/auth");
    if (fault === "missing cookie") cookie = "";
    if (fault === "changed cookie") cookie = cookie.replace("=", "=changed");
    if (fault === "wrong callback") callback.pathname = "/other";
    const result = await validateSignInCallback(new Request(callback, {
      method: fault === "wrong method" ? "POST" : "GET", headers: { cookie },
    }), services(workspace));
    expect(result.toJSON()).toEqual(err({ code: "core_sign_in_invalid" }).toJSON());
    expect((await readWorkspaceState(workspace)).sessions).toEqual([]);
  });

  it.each(["nonce", "code_challenge"] as const)("when the real provider receives a changed %s then the exchange is refused", async (field) => {
    const login = await fixture.signIn(await fixture.identities.createLogin(), handleHubAuthRequest);
    const workspace = await fixture.prepareWorkspace({ loginId: login.loginId });
    const flow = await prepareFlow(workspace, login, { alteredParameter: field });
    expect((await validateSignInCallback(flow.request, services(workspace))).toJSON()).toEqual(err({ code: "core_sign_in_invalid" }).toJSON());
  });

  it("when an authorization code is replayed then only the first exchange succeeds", async () => {
    const login = await fixture.signIn(await fixture.identities.createLogin(), handleHubAuthRequest);
    const workspace = await fixture.prepareWorkspace({ loginId: login.loginId });
    const flow = await prepareFlow(workspace, login);
    expect((await validateSignInCallback(flow.request.clone(), services(workspace))).isOk).toBe(true);
    expect((await validateSignInCallback(flow.request.clone(), services(workspace))).toJSON()).toEqual(err({ code: "core_sign_in_invalid" }).toJSON());
  });

  it("when the same code is exchanged concurrently then the native single-use claim allows one exchange", async () => {
    const login = await fixture.signIn(await fixture.identities.createLogin(), handleHubAuthRequest);
    const workspace = await fixture.prepareWorkspace({ loginId: login.loginId });
    const flow = await prepareFlow(workspace, login);
    const results = await Promise.all([validateSignInCallback(flow.request.clone(), services(workspace)),
      validateSignInCallback(flow.request.clone(), services(workspace))]);
    expect(results.filter((result) => result.isOk)).toHaveLength(1);
    expect(results.filter((result) => result.isErr).map((result) => result.toJSON())).toEqual([err({ code: "core_sign_in_invalid" }).toJSON()]);
  });

  it("when the transaction is more than ten minutes old then its saved state cannot be reused", async () => {
    const login = await fixture.signIn(await fixture.identities.createLogin(), handleHubAuthRequest);
    const workspace = await fixture.prepareWorkspace({ loginId: login.loginId });
    const flow = await prepareFlow(workspace, login);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 11 * 60_000);
    expect((await validateSignInCallback(flow.request, services(workspace))).toJSON()).toEqual(err({ code: "core_sign_in_invalid" }).toJSON());
  });

  it("when the registered secret is wrong then the native token endpoint refuses client authentication", async () => {
    const login = await fixture.signIn(await fixture.identities.createLogin(), handleHubAuthRequest);
    const workspace = await fixture.prepareWorkspace({ loginId: login.loginId });
    const flow = await prepareFlow(workspace, login);
    expect((await validateSignInCallback(flow.request, { ...services(workspace), clientSecret: "wrong-secret" })).toJSON())
      .toEqual(err({ code: "core_sign_in_invalid" }).toJSON());
  });

  it.each(["/orders/42?tab=items#draft", "https://evil.test/", "//evil.test/", "/\\evil.test", "javascript:alert(1)"])("when the requested return path is %s then only a same-origin app path survives", async (returnTo) => {
    const login = await fixture.signIn(await fixture.identities.createLogin(), handleHubAuthRequest);
    const workspace = await fixture.prepareWorkspace({ loginId: login.loginId });
    const flow = await prepareFlow(workspace, login, { returnTo });
    const result = await validateSignInCallback(flow.request, services(workspace));
    expect(result.isOk && result.value.returnTo).toBe(returnTo.startsWith("/orders/") ? returnTo : null);
  });

  it("when the Hub session ends after authorization then the native exchange cannot resurrect it", async () => {
    const login = await fixture.signIn(await fixture.identities.createLogin(), handleHubAuthRequest);
    const workspace = await fixture.prepareWorkspace({ loginId: login.loginId });
    const flow = await prepareFlow(workspace, login);
    await fixture.identities.auth.api.signOut({ headers: { cookie: login.cookie } });
    expect((await validateSignInCallback(flow.request, services(workspace))).toJSON()).toEqual(err({ code: "core_sign_in_invalid" }).toJSON());
  });

  it("when an unregistered redirect is requested then the provider never sends an authorization code there", async () => {
    const login = await fixture.signIn(await fixture.identities.createLogin(), handleHubAuthRequest);
    const workspace = await fixture.prepareWorkspace({ loginId: login.loginId });
    const authorization = location(await start(workspace));
    authorization.searchParams.set("redirect_uri", "https://outside.example.test/auth/callback");
    const response = await handleHubAuthRequest(new Request(authorization, { headers: { cookie: login.cookie } }), fixture.settings);
    const destination = new URL(response.headers.get("location") ?? hubOrigin, hubOrigin);
    expect(destination.origin).not.toBe("https://outside.example.test");
    expect(destination.searchParams.has("code")).toBe(false);
  });

  it("when a native code expires then the token endpoint refuses it even when called directly", async () => {
    const login = await fixture.signIn(await fixture.identities.createLogin(), handleHubAuthRequest);
    const workspace = await fixture.prepareWorkspace({ loginId: login.loginId });
    const flow = await prepareFlow(workspace, login);
    const pending = await readPrivateCookie(flow.request, { name: "__Host-xpro-sign-in", secret: workspace.secret, maxAge: 600,
      audience: JSON.stringify([workspace.id, workspace.origin, hubOrigin + "/api/auth", workspace.clientId]) });
    if (!pending || typeof pending !== "object" || !("verifier" in pending) || typeof pending.verifier !== "string") throw new Error("No saved verifier.");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 11 * 60_000);
    const response = await handleHubAuthRequest(new Request(hubOrigin + "/api/auth/oauth2/token", { method: "POST",
      headers: { authorization: "Basic " + btoa(workspace.clientId + ":" + workspace.clientSecret) },
      body: new URLSearchParams({ grant_type: "authorization_code", code: new URL(flow.request.url).searchParams.get("code") ?? "",
        redirect_uri: workspace.origin + "/auth/callback", code_verifier: pending.verifier }),
    }), fixture.settings);
    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("when discovery is fetched then only authorization-code grants are offered and unused public registration/grants remain refused", async () => {
    const metadata = await handleHubAuthRequest(new Request(hubOrigin + "/api/auth/.well-known/openid-configuration"), fixture.settings);
    const standardMetadata = await handleHubAuthRequest(new Request(hubOrigin + "/.well-known/oauth-authorization-server/api/auth"), fixture.settings);
    expect(await standardMetadata.json()).toEqual(await metadata.clone().json());
    const body = await metadata.json() as { issuer: string; grant_types_supported: string[]; registration_endpoint?: string };
    expect(body.issuer).toBe(hubOrigin + "/api/auth");
    expect(body.grant_types_supported).toEqual(["authorization_code"]);
    expect(body.registration_endpoint).toBeUndefined();
    expect((await handleHubAuthRequest(hubRequest("/api/auth/oauth2/register", {}), fixture.settings)).status).toBe(404);
    for (const grant_type of ["password", "client_credentials", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"]) {
      const response = await handleHubAuthRequest(new Request(hubOrigin + "/api/auth/oauth2/token", {
        method: "POST", body: new URLSearchParams({ grant_type }),
      }), fixture.settings);
      expect(response.ok).toBe(false);
      expect(await response.json()).not.toHaveProperty("access_token");
    }
  });
});

function services(workspace: WorkspaceFixture): SignInServices {
  return { workspaceId: workspace.id, origin: workspace.origin, issuer: hubOrigin + "/api/auth", clientId: workspace.clientId,
    clientSecret: workspace.clientSecret, secret: workspace.secret, context: createRequestContext(),
    hub: { async fetch(request) { return await handleHubAuthRequest(request, fixture.settings); } } };
}
async function start(workspace: WorkspaceFixture, returnTo?: string): Promise<Response> {
  return await startSignIn(new Request(workspace.origin + "/auth/start" + (returnTo ? "?" + new URLSearchParams({ returnTo }) : "")), services(workspace));
}
function location(response: Response): URL {
  const url = response.headers.get("location");
  if (!url) throw new Error(`Expected a protocol redirect (${response.status}).`);
  return new URL(url);
}
async function prepareFlow(workspace: WorkspaceFixture, login: SignedInLogin,
  input: { returnTo?: string; alteredParameter?: "nonce" | "code_challenge" } = {}) {
  const response = await start(workspace, input.returnTo);
  const authorization = location(response);
  if (input.alteredParameter) authorization.searchParams.set(input.alteredParameter, "A".repeat(43));
  const code = await handleHubAuthRequest(new Request(authorization, { headers: { cookie: login.cookie } }), fixture.settings);
  const cookie = readCookies(response);
  return { cookie, request: new Request(location(code), { headers: { cookie } }) };
}
