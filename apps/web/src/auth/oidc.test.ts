import { env } from "cloudflare:workers";
import { getCurrentUser as readUser, saveHub } from "@xpro/core/server";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { createSignInFixture, hubOrigin, readCookies, readHubState, readWorkspaceState, removeMembership,
  signInPassword, withWorkspace, workspaceServices,
  type CurrentUserAction, type SignInFixture, type WorkspaceFixture, type WorkspaceHandler, type WorkspaceServices } from "#test/sign-in";
import type { SignedInLogin } from "#test/hub-identities";
import * as oauth from "oauth4webapi";
import { err, ok } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishSignIn as finish, startSignIn as start } from "./oidc.server";
import { signOut as endSession } from "./sign-out.server";

// These declarations define T018/T019's boundary without substituting an implementation.
const startSignIn: WorkspaceHandler = start;
const finishSignIn: WorkspaceHandler = finish;
const signOut: WorkspaceHandler = endSession;
const getCurrentUser: CurrentUserAction = readUser;
let fixture: SignInFixture;
beforeEach(async () => { fixture = await createSignInFixture(env.DB); });
afterEach(async () => { await fixture.identities.db.destroy(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Story 2 — workspace OpenID Connect", () => {
  it.each(["internal", "external"] as const)("when an %s person completes real Hub sign-in then they enter the workspace app or Portal with the correct device session", async (kind) => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId, kind });
    const other = await fixture.prepareWorkspace();
    const otherBefore = await readWorkspaceState(other);
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const hubBefore = await readHubState(fixture.identities);
    const before = await readWorkspaceState(workspace);
    const flow = await prepareCallback({ login, workspace });
    const response = await callWorkspace(finishSignIn, { workspace, request: flow.callback });
    expectRedirect(response, workspace.origin + (kind === "internal" ? "/" : "/portal"));
    expect(response.headers.getSetCookie().some((cookie) => /; Secure/i.test(cookie) && /; HttpOnly/i.test(cookie))).toBe(true);
    const after = await readWorkspaceState(workspace);
    expect(after).toEqual({ ...before, sessions: [{
      id: expect.any(String), loginId: login.loginId, hubSessionId: login.hubSessionId, expiresAt: expect.any(String),
    }] });
    const native = hubBefore.sessions.find((session) => session.id === login.hubSessionId);
    expect(native).toBeDefined();
    expect(Date.parse(after.sessions[0]?.expiresAt ?? "")).toBeLessThanOrEqual(Date.parse(native?.expiresAt ?? ""));
    expect(Date.parse(after.sessions[0]?.expiresAt ?? "")).toBeGreaterThan(Date.now());
    expect((await callWorkspace(getCurrentUser, { workspace, request: workspaceRequest(workspace, "/", readCookies(response)) })).toJSON())
      .toEqual(ok({ loginId: login.loginId, isMaster: false, membershipRole: "member" }).toJSON());
    expect(await readHubState(fixture.identities)).toEqual(hubBefore);
    expect(await readWorkspaceState(other)).toEqual(otherBefore);
  });

  it("when the master opens a workspace with no membership or local user then ordinary OIDC still permits the master", async () => {
    const created = await fixture.identities.createLogin({ role: "admin" });
    const workspace = await fixture.prepareWorkspace();
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const flow = await prepareCallback({ login, workspace });
    const response = await callWorkspace(finishSignIn, { workspace, request: flow.callback });
    expectRedirect(response, workspace.origin + "/");
    expect((await callWorkspace(getCurrentUser, { workspace, request: workspaceRequest(workspace, "/", readCookies(response)) })).toJSON())
      .toEqual(ok({ loginId: login.loginId, isMaster: true, membershipRole: null }).toJSON());
    expect((await readWorkspaceState(workspace)).users).toEqual([]);
  });

  it("when the workspace uses a separate customer domain then the registered callback and local session stay on that domain", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId, origin: "https://tenant.its-own-domain.test" });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const flow = await prepareCallback({ login, workspace });
    const response = await callWorkspace(finishSignIn, { workspace, request: flow.callback });
    expectRedirect(response, workspace.origin + "/");
    expect((await callWorkspace(getCurrentUser, { workspace, request: workspaceRequest(workspace, "/", readCookies(response)) })).toJSON())
      .toEqual(ok({ loginId: login.loginId, isMaster: false, membershipRole: "member" }).toJSON());
  });

  it("when a workspace begins sign-in then discovery and a fresh S256, state and nonce request use the fixed confidential client and callback", async () => {
    const workspace = await fixture.prepareWorkspace();
    const responses = await Promise.all([begin(workspace), begin(workspace)]);
    const urls = responses.map((response) => new URL(requiredLocation(response)));
    for (const [index, url] of urls.entries()) {
      expect(url.origin + url.pathname).toBe(hubOrigin + "/api/auth/oauth2/authorize");
      expect(url.searchParams.get("client_id")).toBe(workspace.clientId);
      expect(url.searchParams.get("redirect_uri")).toBe(workspace.origin + "/auth/callback");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual(["email", "openid", "profile"]);
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(url.searchParams.get("state")).toBeTruthy();
      expect(url.searchParams.get("nonce")).toBeTruthy();
      expect(url.searchParams.has("code_verifier")).toBe(false);
      expect(url.href).not.toContain(workspace.clientSecret);
      expect(readCookies(responses[index] ?? new Response())).not.toBe("");
    }
    expect(urls[0]?.searchParams.get("state")).not.toBe(urls[1]?.searchParams.get("state"));
    expect(urls[0]?.searchParams.get("nonce")).not.toBe(urls[1]?.searchParams.get("nonce"));
    expect(urls[0]?.searchParams.get("code_challenge")).not.toBe(urls[1]?.searchParams.get("code_challenge"));
  });

  it("when the Hub has no current session then authorization returns to central sign-in without issuing a code", async () => {
    const workspace = await fixture.prepareWorkspace();
    const response = await handleHubAuthRequest(new Request(requiredLocation(await begin(workspace))), fixture.settings);
    const location = new URL(requiredLocation(response), hubOrigin);
    expect(location.origin + location.pathname).toBe(hubOrigin + "/sign-in");
    expect(location.searchParams.has("code")).toBe(false);
    expect((await readWorkspaceState(workspace)).sessions).toEqual([]);
  });

  it("when the authenticated person still needs profile completion then authorization cannot issue a workspace code", async () => {
    const created = await fixture.identities.createLogin({ username: null });
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const response = await handleHubAuthRequest(new Request(requiredLocation(await begin(workspace)), {
      headers: { cookie: login.cookie },
    }), fixture.settings);
    const location = new URL(requiredLocation(response), hubOrigin);
    expect(location.origin + location.pathname).toBe(hubOrigin + "/complete-profile");
    expect(location.searchParams.has("code")).toBe(false);
    expect((await readWorkspaceState(workspace)).sessions).toEqual([]);
  });

  it.each(["missing state", "changed state", "duplicate state", "missing code", "duplicate code", "missing cookie", "changed cookie", "wrong issuer"] as const)(
    "when a callback has %s then it cannot issue a workspace session", async (fault) => {
      const created = await fixture.identities.createLogin();
      const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
      const login = await fixture.signIn(created, handleHubAuthRequest);
      const flow = await prepareCallback({ login, workspace });
      const url = new URL(flow.callback.url);
      if (fault === "missing state") url.searchParams.delete("state");
      if (fault === "changed state") url.searchParams.set("state", crypto.randomUUID());
      if (fault === "duplicate state") url.searchParams.append("state", crypto.randomUUID());
      if (fault === "missing code") url.searchParams.delete("code");
      if (fault === "duplicate code") url.searchParams.append("code", "another-code");
      if (fault === "wrong issuer") url.searchParams.set("iss", "https://foreign.example.test/api/auth");
      const headers = new Headers(flow.callback.headers);
      if (fault === "missing cookie") headers.delete("cookie");
      if (fault === "changed cookie") headers.set("cookie", (headers.get("cookie") ?? "")
        .split(";").map((cookie) => cookie.trim() + "tampered").join("; "));
      const before = await readWorkspaceState(workspace);
      await expectInvalidProtocol(await callWorkspace(finishSignIn, { workspace, request: new Request(url, { headers }) }));
      expect(await readWorkspaceState(workspace)).toEqual(before);
    },
  );

  it.each(["nonce", "PKCE"] as const)("when the authorization request's %s is changed then the real token exchange cannot authenticate the callback", async (fault) => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const flow = await prepareCallback({ login, workspace, async alterAuthorization(url) {
      if (fault === "nonce") url.searchParams.set("nonce", oauth.generateRandomNonce());
      else url.searchParams.set("code_challenge", await oauth.calculatePKCECodeChallenge(oauth.generateRandomCodeVerifier()));
    } });
    const before = await readWorkspaceState(workspace);
    await expectInvalidProtocol(await callWorkspace(finishSignIn, { workspace, request: flow.callback }));
    expect(await readWorkspaceState(workspace)).toEqual(before);
  });

  it("when the same callback code and original browser state are replayed then only the first session remains", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const flow = await prepareCallback({ login, workspace });
    const first = await callWorkspace(finishSignIn, { workspace, request: flow.callback.clone() });
    expect([302, 303]).toContain(first.status);
    const saved = await readWorkspaceState(workspace);
    expect(saved.sessions).toHaveLength(1);
    await expectInvalidProtocol(await callWorkspace(finishSignIn, { workspace, request: flow.callback.clone() }));
    expect(await readWorkspaceState(workspace)).toEqual(saved);
  });

  it("when a callback code and its browser state have expired then no workspace session is created", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const flow = await prepareCallback({ login, workspace });
    const before = await readWorkspaceState(workspace);
    const expiredDelayMs = 11 * 60 * 1000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + expiredDelayMs);
    await expectInvalidProtocol(await callWorkspace(finishSignIn, { workspace, request: flow.callback }));
    expect(await readWorkspaceState(workspace)).toEqual(before);
  });

  it("when someone tries to redeem a code without the workspace's own client secret then the native provider issues no token", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const flow = await prepareCallback({ login, workspace });
    const code = new URL(flow.callback.url).searchParams.get("code");
    const response = await handleHubAuthRequest(new Request(hubOrigin + "/api/auth/oauth2/token", { method: "POST", headers: {
      "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + btoa(workspace.clientId + ":wrong-secret"),
    }, body: new URLSearchParams({ grant_type: "authorization_code", code: code ?? "", redirect_uri: workspace.origin + "/auth/callback",
      code_verifier: oauth.generateRandomCodeVerifier() }) }), fixture.settings);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await response.json()).not.toHaveProperty("access_token");
    expect((await readWorkspaceState(workspace)).sessions).toEqual([]);
  });

  it("when authorization substitutes an unregistered callback address then the native provider sends no code there", async () => {
    const workspace = await fixture.prepareWorkspace();
    const created = await fixture.identities.createLogin();
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const url = new URL(requiredLocation(await begin(workspace)));
    const unregistered = workspace.origin + "/auth/callback/other";
    url.searchParams.set("redirect_uri", unregistered);
    const response = await handleHubAuthRequest(new Request(url, { headers: { cookie: login.cookie } }), fixture.settings);
    expect(response.ok).toBe(false);
    expect(response.headers.get("location")?.startsWith(unregistered) ?? false).toBe(false);
    expect((await readWorkspaceState(workspace)).sessions).toEqual([]);
  });

  it.each(["https://foreign.example.test/private", "//foreign.example.test/private", "/\\foreign.example.test/private", "javascript:alert(1)"])(
    "when returnTo is unsafe (%s) then successful sign-in uses the workspace default", async (returnTo) => {
      const created = await fixture.identities.createLogin();
      const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
      const login = await fixture.signIn(created, handleHubAuthRequest);
      const flow = await prepareCallback({ login, workspace, returnTo });
      expectRedirect(await callWorkspace(finishSignIn, { workspace, request: flow.callback }), workspace.origin + "/");
    },
  );

  it.each([
    { kind: "internal", path: "/sales/orders/42?view=edit" }, { kind: "external", path: "/portal/orders/42?view=edit" },
  ] as const)("when a $kind person's session ends then reauthentication returns to the same safe $path", async ({ kind, path }) => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId, kind });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const firstFlow = await prepareCallback({ login, workspace });
    const first = await callWorkspace(finishSignIn, { workspace, request: firstFlow.callback });
    expect([302, 303]).toContain(first.status);
    await fixture.identities.auth.api.signOut({ headers: { cookie: login.cookie } });
    expect((await callWorkspace(getCurrentUser, { workspace, request: workspaceRequest(workspace, path, readCookies(first)) })).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    const fresh = await fixture.signIn(created, handleHubAuthRequest);
    const flow = await prepareCallback({ login: fresh, workspace, returnTo: path });
    expectRedirect(await callWorkspace(finishSignIn, { workspace, request: flow.callback }), workspace.origin + path);
  });

  it("when membership is removed after authorization then a remaining local user cannot enter the requested workspace", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const flow = await prepareCallback({ login, workspace });
    await removeMembership({ identities: fixture.identities, loginId: login.loginId, workspaceId: workspace.id });
    const before = await readWorkspaceState(workspace);
    expectRedirect(await callWorkspace(finishSignIn, { workspace, request: flow.callback }), hubOrigin + "/");
    expect(await readWorkspaceState(workspace)).toEqual(before);
  });

  it("when a non-master has membership but no local workspace user then the callback cannot invent an internal or external type", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace();
    await fixture.identities.auth.api.addMember({ body: { userId: created.loginId, organizationId: workspace.id, role: "member" } });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const flow = await prepareCallback({ login, workspace });
    const before = await readWorkspaceState(workspace);
    const response = await callWorkspace(finishSignIn, { workspace, request: flow.callback });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "core_forbidden" });
    expect(await readWorkspaceState(workspace)).toEqual(before);
  });

  it.each(["suspended", "archived"] as const)("when a person becomes %s after authorization then the callback cannot create a session", async (status) => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const flow = await prepareCallback({ login, workspace });
    await saveHub(env.DB, [fixture.identities.db.updateTable("user")
      .set(status === "suspended" ? { banned: 1 } : { archivedAt: new Date().toISOString() }).where("id", "=", login.loginId).compile()]);
    const before = await readWorkspaceState(workspace);
    const response = await callWorkspace(finishSignIn, { workspace, request: flow.callback });
    expect([400, 403]).toContain(response.status);
    expect(await response.json()).toMatchObject({ code: expect.stringMatching(/^core_(login_inactive|sign_in_invalid)$/) });
    expect(await readWorkspaceState(workspace)).toEqual(before);
  });

  it("when a request has a Hub cookie and identity headers but no workspace session then protected identity is unavailable", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const request = workspaceRequest(workspace, "/", login.cookie);
    request.headers.set("x-login-id", login.loginId);
    request.headers.set("x-is-master", "true");
    expect((await callWorkspace(getCurrentUser, { workspace, request })).toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect((await readWorkspaceState(workspace)).sessions).toEqual([]);
  });

  it("when the Hub session ends without a sign-out message then the next workspace action still refuses its cached session", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const flow = await prepareCallback({ login, workspace });
    const response = await callWorkspace(finishSignIn, { workspace, request: flow.callback });
    expect([302, 303]).toContain(response.status);
    const cookie = readCookies(response);
    await fixture.identities.auth.api.signOut({ headers: { cookie: login.cookie } });
    expect((await readWorkspaceState(workspace)).sessions).toHaveLength(1);
    expect((await callWorkspace(getCurrentUser, { workspace, request: workspaceRequest(workspace, "/", cookie) })).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
  });

  it("when a workspace device signs out then its Hub and local access end while another device remains signed in", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
    const first = await fixture.signIn(created, handleHubAuthRequest);
    const second = await fixture.signIn(created, handleHubAuthRequest);
    const firstFlow = await prepareCallback({ login: first, workspace });
    const firstResponse = await callWorkspace(finishSignIn, { workspace, request: firstFlow.callback });
    const secondFlow = await prepareCallback({ login: second, workspace });
    const secondResponse = await callWorkspace(finishSignIn, { workspace, request: secondFlow.callback });
    expectRedirect(firstResponse, workspace.origin + "/");
    expectRedirect(secondResponse, workspace.origin + "/");
    const firstCookie = readCookies(firstResponse);
    const secondCookie = readCookies(secondResponse);
    const response = await callWorkspace(signOut, { workspace,
      request: new Request(workspace.origin + "/auth/sign-out", { method: "POST", headers: { origin: workspace.origin, cookie: firstCookie } }) });
    expect([200, 302, 303]).toContain(response.status);
    expect((await callWorkspace(getCurrentUser, { workspace, request: workspaceRequest(workspace, "/", firstCookie) })).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect((await callWorkspace(getCurrentUser, { workspace, request: workspaceRequest(workspace, "/", secondCookie) })).toJSON())
      .toEqual(ok({ loginId: created.loginId, isMaster: false, membershipRole: "member" }).toJSON());
    expect(await fixture.identities.auth.api.getSession({ headers: { cookie: first.cookie } })).toBeNull();
    expect((await fixture.identities.auth.api.getSession({ headers: { cookie: second.cookie } }))?.session.id).toBe(second.hubSessionId);
  });

  it("when a real sign-in completes then credentials, tokens and device session details are absent from returned addresses, logs and audit entries", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const flow = await prepareCallback({ login, workspace });
    const response = await callWorkspace(finishSignIn, { workspace, request: flow.callback });
    expectRedirect(response, workspace.origin + "/");
    const code = new URL(flow.callback.url).searchParams.get("code");
    expect(code).toBeTruthy();
    const state = await readWorkspaceState(workspace);
    const native = await fixture.identities.auth.api.getSession({ headers: { cookie: login.cookie } });
    const sensitive = [signInPassword, login.cookie, login.hubSessionId, native?.session.token ?? "",
      workspace.clientSecret, readCookies(response), state.sessions[0]?.id ?? ""];
    const addresses = [flow.authorizationUrl.href, flow.callback.url, requiredLocation(response)];
    for (const address of addresses) {
      for (const secret of sensitive) { expect(secret).not.toBe(""); expect(decodeURIComponent(address)).not.toContain(secret); }
    }
    const audits = await fixture.identities.db.selectFrom("auditEntries").selectAll().execute();
    const recorded = JSON.stringify({ logs: logs.flatMap((log) => log.mock.calls), audits });
    for (const secret of [...sensitive, code ?? ""]) expect(recorded).not.toContain(secret);
  });
});

async function begin(workspace: WorkspaceFixture, returnTo?: string): Promise<Response> {
  const url = new URL("/auth/start", workspace.origin);
  if (returnTo !== undefined) url.searchParams.set("returnTo", returnTo);
  return await callWorkspace(startSignIn, { workspace, request: new Request(url) });
}

async function prepareCallback(input: {
  login: SignedInLogin; workspace: WorkspaceFixture; returnTo?: string; alterAuthorization?: (url: URL) => void | Promise<void>;
}) {
  const started = await begin(input.workspace, input.returnTo);
  const authorizationUrl = new URL(requiredLocation(started));
  await input.alterAuthorization?.(authorizationUrl);
  const response = await handleHubAuthRequest(new Request(authorizationUrl, { headers: { cookie: input.login.cookie } }), fixture.settings);
  expect([302, 303]).toContain(response.status);
  const callback = new Request(requiredLocation(response), { headers: { cookie: readCookies(started) } });
  expect(new URL(callback.url).origin + new URL(callback.url).pathname).toBe(input.workspace.origin + "/auth/callback");
  expect(new URL(callback.url).searchParams.get("code")).toBeTruthy();
  return { callback, authorizationUrl };
}

async function callWorkspace<Value>(
  action: (request: Request, services: WorkspaceServices) => Promise<Value>,
  input: { workspace: WorkspaceFixture; request: Request },
): Promise<Value> {
  return await withWorkspace(input.workspace, async ({ storage }) =>
    await action(input.request, workspaceServices({ fixture, workspace: input.workspace, storage }, handleHubAuthRequest)));
}

function workspaceRequest(workspace: WorkspaceFixture, path: string, cookie: string): Request {
  return new Request(new URL(path, workspace.origin), { headers: { cookie } });
}

function requiredLocation(response: Response): string {
  const location = response.headers.get("location");
  if (!location) throw new Error(`Expected a redirect, received ${response.status}.`);
  return location;
}

function expectRedirect(response: Response, location: string): void {
  expect([302, 303]).toContain(response.status);
  expect(requiredLocation(response)).toBe(location);
  expect(response.headers.get("cache-control")).toBe("no-store");
}

async function expectInvalidProtocol(response: Response): Promise<void> {
  expect(response.status).toBe(400);
  expect(response.headers.getSetCookie()).toContainEqual(expect.stringMatching(/^__Host-xpro-sign-in=;.*Max-Age=0/i));
  expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ code: "core_sign_in_invalid",
    message: "Sign-in could not be completed. Please try again.", requestId: response.headers.get("x-request-id") });
}
