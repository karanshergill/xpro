import { env } from "cloudflare:workers";
import { createWorkspaceAccessRequest, getCurrentUser, saveHub } from "@xpro/core/server";
import { http } from "msw";
import { err, ok } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { network } from "#test/network";
import { createSignInFixture, readWorkspaceState, signInAtWorkspace, withWorkspace, workspaceServices,
  type SignInFixture, type WorkspaceFixture, type WorkspaceServices } from "#test/sign-in";
import { receiveHubSignOut, signOut } from "./sign-out.server";

let fixture: SignInFixture;
type LogoutMessage = { url: string; method: string; headers: [string, string][]; body: string };
beforeEach(async () => { fixture = await createSignInFixture(env.DB); });
afterEach(async () => { await fixture.identities.db.destroy(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("workspace sessions and real native logout", () => {
  it.each(["Hub", "workspace"])("when the %s ends a device session then its native signed message ends only matching local sessions and repeats are harmless", async (source) => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId, backchannel: true });
    const other = await fixture.prepareWorkspace();
    const first = await fixture.signIn(created, handleHubAuthRequest);
    const second = await fixture.signIn(created, handleHubAuthRequest);
    const firstLocal = await signInAtWorkspace({ fixture, workspace, login: first });
    await signInAtWorkspace({ fixture, workspace, login: second });
    const master = await fixture.signInMaster();
    await signInAtWorkspace({ fixture, workspace: other, login: master });
    const otherBefore = await readWorkspaceState(other);
    const before = await readWorkspaceState(workspace);
    const deliveries: LogoutMessage[] = [];
    network.use(http.post(workspace.origin + "/auth/back-channel-sign-out", async ({ request }) => {
      const message = { url: request.url, method: request.method, headers: [...request.headers.entries()], body: await request.text() };
      deliveries.push(message);
      return await deliverMessage(workspace, message);
    }));
    if (source === "Hub") await fixture.identities.auth.api.signOut({ headers: { cookie: first.cookie } });
    else expect((await call(signOut, workspace, signOutRequest(workspace, firstLocal.cookie))).status).toBe(200);
    expect(deliveries).toHaveLength(1);
    const expected = { ...before, sessions: before.sessions.filter((session) => session.hubSessionId !== first.hubSessionId) };
    expect(expected.sessions).toHaveLength(1);
    expect(await readWorkspaceState(workspace)).toEqual(expected);
    const delivered = deliveries[0];
    if (!delivered) throw new Error("The native provider did not deliver logout.");
    expect((await deliverMessage(workspace, delivered)).status).toBe(200);
    expect(await readWorkspaceState(workspace)).toEqual(expected);
    expect(await readWorkspaceState(other)).toEqual(otherBefore);
  });

  it("when the registered logout endpoint redirects then its signed message is never forwarded and live Hub checks still deny the ended session", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await fixture.prepareWorkspace({ loginId: created.loginId, backchannel: true });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const local = await signInAtWorkspace({ fixture, workspace, login });
    let calls = 0;
    let forwarded = 0;
    // Model a redirect at the HTTP transport; no authentication implementation is replaced.
    network.use(http.post(workspace.origin + "/auth/back-channel-sign-out", () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: "https://foreign.example.test/collect" } });
    }), http.post("https://foreign.example.test/collect", () => { forwarded += 1; return new Response(null); }));
    await fixture.identities.auth.api.signOut({ headers: { cookie: login.cookie } });
    expect(calls).toBe(1);
    expect(forwarded).toBe(0);
    expect((await readWorkspaceState(workspace)).sessions).toHaveLength(1);
    expect((await call(getCurrentUser, workspace, new Request(workspace.origin, { headers: { cookie: local.cookie } }))).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
  });

  it.each(["changed", "duplicate", "another workspace", "another origin"])("when a session cookie is %s then it cannot authenticate a workspace", async (fault) => {
    const { workspace, local } = await signedIn();
    const before = await readWorkspaceState(workspace);
    const other = await fixture.prepareWorkspace();
    let cookie = local.cookie;
    if (fault === "changed") cookie = cookie.replace(/(__Host-xpro-session=[^;]+)/, "$1tampered");
    if (fault === "duplicate") cookie += "; " + cookie;
    const target = fault === "another workspace" ? other : workspace;
    const origin = fault === "another origin" ? "https://foreign.example.test" : target.origin;
    const value = await call(getCurrentUser, target, new Request(origin + "/", { headers: { cookie } }));
    expect(value.toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect(await readWorkspaceState(workspace)).toEqual(before);
  });

  it("when the original Hub expiry is reached then a retained cookie and local row cannot extend the session", async () => {
    const { workspace, local, login } = await signedIn();
    const native = await fixture.identities.auth.api.getSession({ headers: { cookie: login.cookie } });
    if (!native) throw new Error("The native session is required.");
    const before = await readWorkspaceState(workspace);
    expect(before.sessions[0]?.expiresAt).toBe(native.session.expiresAt.toISOString());
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(native.session.expiresAt);
    expect((await call(getCurrentUser, workspace, new Request(workspace.origin, { headers: { cookie: local.cookie } }))).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect(await readWorkspaceState(workspace)).toEqual(before);
  });

  it.each(["GET", "foreign origin", "missing origin"])("when sign-out uses %s then it cannot end a device session", async (fault) => {
    const { workspace, local, login } = await signedIn();
    const before = await readWorkspaceState(workspace);
    const request = new Request(workspace.origin + "/auth/sign-out", { method: fault === "GET" ? "GET" : "POST",
      headers: { cookie: local.cookie, ...(fault === "missing origin" ? {} : { origin: fault === "foreign origin" ? "https://foreign.example.test" : workspace.origin }) } });
    expect((await call(signOut, workspace, request)).status).toBe(403);
    expect(await readWorkspaceState(workspace)).toEqual(before);
    expect((await fixture.identities.auth.api.getSession({ headers: { cookie: login.cookie } }))?.session.id).toBe(login.hubSessionId);
  });

  it("when the short-lived ID token has expired then native end-session still signs out the original active device", async () => {
    const { workspace, local, login } = await signedIn();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 16 * 60 * 1000);
    const response = await call(signOut, workspace, signOutRequest(workspace, local.cookie));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([expect.stringContaining("Max-Age=0")]);
    expect(await fixture.identities.auth.api.getSession({ headers: { cookie: login.cookie } })).toBeNull();
    expect((await readWorkspaceState(workspace)).sessions).toEqual([]);
    expect((await call(signOut, workspace, signOutRequest(workspace, local.cookie))).status).toBe(200);
  });

  it("when several actions share workspace request setup then they use one live Hub check and profile changes still restrict protected actions", async () => {
    const { workspace, local, login } = await signedIn();
    await saveHub(env.DB, [fixture.identities.db.updateTable("user").set({ username: null }).where("id", "=", login.loginId).compile()]);
    await withWorkspace(workspace, async ({ storage }) => {
      const services = workspaceServices({ fixture, workspace, storage }, handleHubAuthRequest);
      let calls = 0;
      const hubAccess = { async validateAccess(input: Parameters<typeof env.HUB_ACCESS.validateAccess>[0]) {
        calls += 1; return await env.HUB_ACCESS.validateAccess(input);
      } };
      const access = await createWorkspaceAccessRequest(new Request(workspace.origin, { headers: { cookie: local.cookie } }), { ...services, hubAccess });
      expect(access.authorize({ kind: "check_session" }).toJSON())
        .toEqual(ok({ loginId: login.loginId, isMaster: false, membershipRole: "member" }).toJSON());
      expect(access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
        .toEqual(err({ code: "core_profile_incomplete", fields: ["username"] }).toJSON());
      expect(access.authorize({ kind: "sign_out" }).isOk).toBe(true);
      expect(calls).toBe(1);
    });
  });
});

async function signedIn() {
  const created = await fixture.identities.createLogin();
  const workspace = await fixture.prepareWorkspace({ loginId: created.loginId });
  const login = await fixture.signIn(created, handleHubAuthRequest);
  const local = await signInAtWorkspace({ fixture, workspace, login });
  expect(local.response.status).toBe(302);
  expect(local.response.headers.getSetCookie()).toContainEqual(expect.stringMatching(/^__Host-xpro-sign-in=;.*Max-Age=0/i));
  return { workspace, login, local };
}

async function call<Value>(action: (request: Request, services: WorkspaceServices) => Promise<Value>, workspace: WorkspaceFixture, request: Request): Promise<Value> {
  return await withWorkspace(workspace, async ({ storage }) => await action(request, workspaceServices({ fixture, workspace, storage }, handleHubAuthRequest)));
}

function signOutRequest(workspace: WorkspaceFixture, cookie: string): Request {
  return new Request(workspace.origin + "/auth/sign-out", { method: "POST", headers: { origin: workspace.origin, cookie } });
}

async function deliverMessage(workspace: WorkspaceFixture, message: LogoutMessage): Promise<Response> {
  // HTTP transport carries plain data into the receiving DO, never another DO's stream.
  return await withWorkspace(workspace, async ({ storage }) => await receiveHubSignOut(new Request(message.url, {
    method: message.method, headers: message.headers, body: message.body,
  }), workspaceServices({ fixture, workspace, storage }, handleHubAuthRequest)));
}
