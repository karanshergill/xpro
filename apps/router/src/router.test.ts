import { env } from "cloudflare:workers";
import { pageLoginIdHeader } from "@xpro/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignInFixture, hubOrigin, readHubState, readWorkspaceState, removeMembership, type SignInFixture } from "#test/sign-in";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { fetchHub, fetchWorkspace, preparePlacement, readPlacements, route, routingServices, signInViaRouter } from "#test/routing";

let fixture: SignInFixture;
beforeEach(async () => { fixture = await createSignInFixture(env.DB); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.identities.db.destroy(); });

describe("Workspace address routing", () => {
  it("when routed requests fail then each logs its own request ID and fixed router location without private input", async () => {
    const workspace = await preparePlacement(fixture), other = await preparePlacement(fixture);
    const before = { hub: await readHubState(fixture.identities), own: await readWorkspaceState(workspace), other: await readWorkspaceState(other) };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const services = routingServices(fixture, [workspace, other]);
    services.dispatch = { get() { throw new Error("private-dispatch-failure", { cause: "private-cause" }); } };
    const forgedId = crypto.randomUUID();
    const responses = await Promise.all(["first", "second"].map(async (name) => await route(
      new Request(workspace.origin + "/private-name?code=private-oauth-code", { method: "POST", headers: {
        "x-request-id": forgedId, authorization: "Bearer private-token", cookie: "private-cookie",
      }, body: "private-password-" + name }), services)));
    const ids = responses.map((response) => response.headers.get("x-request-id"));
    expect(new Set(ids).size).toBe(2); expect(ids).not.toContain(forgedId);
    for (const response of responses) {
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ code: "core_unexpected_error", message: "Something went wrong. Please try again.",
        requestId: response.headers.get("x-request-id") });
    }
    expect(log.mock.calls.slice().sort()).toEqual(ids.map((requestId) => [JSON.stringify({
      event: "core_unexpected_error", requestId, app: "router", operation: "core_router_request",
    })]).sort());
    expect({ hub: await readHubState(fixture.identities), own: await readWorkspaceState(workspace), other: await readWorkspaceState(other) }).toEqual(before);
  });

  it("when placement cache saving fails then routing succeeds and the background event has the same request ID", async () => {
    const workspace = await preparePlacement(fixture), services = routingServices(fixture, [workspace]);
    const before = { hub: await readHubState(fixture.identities), workspace: await readWorkspaceState(workspace) };
    services.placements = new Proxy(env.PLACEMENTS, { get(target, key) {
      if (key === "put") return async () => { throw new Error("private-cache-failure"); };
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await route(page(workspace.origin), services);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(workspace.origin + "/auth/start?returnTo=%2F");
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"),
      app: "router", operation: "stms_cache_placement" })]]);
    expect(await env.PLACEMENTS.get("origin:" + workspace.origin)).toBeNull();
    expect({ hub: await readHubState(fixture.identities), workspace: await readWorkspaceState(workspace) }).toEqual(before);
  });

  it.each(["primary", "custom"] as const)("when a prepared %s address is opened then native sign-in returns to that workspace", async (address) => {
    const created = await fixture.identities.createLogin();
    const workspace = await preparePlacement(fixture, { loginId: created.loginId, alias: "https://erp.acme.test" });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const origin = address === "primary" ? workspace.origin : "https://erp.acme.test";
    const signedIn = await signInViaRouter({ fixture, workspace, login, origin });
    expect(signedIn.response.status).toBe(302);
    expect(signedIn.response.headers.get("location")).toBe(origin + "/");
    const before = { hub: await readHubState(fixture.identities), workspace: await readWorkspaceState(workspace), directory: await readPlacements(fixture) };
    const response = await route(new Request(origin + "/orders?view=open", { headers: { cookie: signedIn.cookie, accept: "text/html" } }),
      routingServices(fixture, [workspace]));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ workspaceId: workspace.id, loginId: login.loginId, kind: "internal" });
    expect({ hub: await readHubState(fixture.identities), workspace: await readWorkspaceState(workspace), directory: await readPlacements(fixture) }).toEqual(before);
    expect(await env.PLACEMENTS.get("origin:" + origin, "json")).toEqual({ workspaceId: workspace.id, workerName: workspace.workerName, origin });
  });

  it.each(["matching", "different", "empty"] as const)("when routing preserves a %s page identity precondition then live workspace access still decides", async (hint) => {
    const login = await fixture.identities.signIn();
    const workspace = await preparePlacement(fixture, { loginId: login.loginId });
    const other = await preparePlacement(fixture);
    const signedIn = await signInViaRouter({ fixture, workspace, login });
    const before = { hub: await readHubState(fixture.identities), own: await readWorkspaceState(workspace), other: await readWorkspaceState(other) };
    const response = await route(new Request(workspace.origin + "/orders", { headers: {
      cookie: signedIn.cookie, [pageLoginIdHeader]: hint === "matching" ? login.loginId : hint === "empty" ? "" : crypto.randomUUID(),
    } }), routingServices(fixture, [workspace, other]));
    expect(response.status).toBe(hint === "matching" ? 200 : 409);
    expect(await response.json()).toEqual(hint === "matching"
      ? { workspaceId: workspace.id, loginId: login.loginId, kind: "internal" }
      : { code: "core_identity_changed", message: "Your sign-in has changed. Reload this page to continue.", requestId: response.headers.get("x-request-id") });
    expect({ hub: await readHubState(fixture.identities), own: await readWorkspaceState(workspace), other: await readWorkspaceState(other) }).toEqual(before);
  });

  it("when a known route is cached then another request needs no directory lookup", async () => {
    const workspace = await preparePlacement(fixture);
    const services = routingServices(fixture, [workspace]);
    await route(page(workspace.origin), services);
    await fixture.identities.db.schema.dropTable("workspaceAddresses").execute();
    const response = await route(page(workspace.origin), services);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(workspace.origin + "/auth/start?returnTo=%2F");
  });

  it("when a request includes forged identity and proxy headers then routing overwrites its hints and authorization still uses the real session", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await preparePlacement(fixture, { loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const signedIn = await signInViaRouter({ fixture, workspace, login });
    const forgedId = crypto.randomUUID();
    const services = routingServices(fixture, [workspace]);
    services.dispatch = { get(workerName) {
      expect(workerName).toBe(workspace.workerName);
      return { async fetch(request) { return await fetchWorkspace(request, { fixture, workspace, render: async (current, context) => {
        expect(context.access.authorize({ kind: "protected", hasLocalPermission: false }).toJSON())
          .toEqual({ variant: "Err", error: { code: "core_forbidden" } });
        return Response.json({ method: current.method, path: new URL(current.url).pathname + new URL(current.url).search,
          body: await current.text(), isMaster: context.actor.isMaster, loginId: context.actor.loginId,
          hint: current.headers.get("x-xpro-workspace-id"), requestId: current.headers.get("x-request-id"),
          claimedLogin: current.headers.get("x-xpro-login-id"), claimedMaster: current.headers.get("x-xpro-is-master"),
          forwardedHost: current.headers.get("x-forwarded-host") });
      } }); } };
    } };
    const response = await route(new Request(workspace.origin + "/orders?view=open", { method: "POST", headers: {
      cookie: signedIn.cookie, origin: workspace.origin, "content-type": "text/plain",
      "x-request-id": forgedId, "x-xpro-workspace-id": crypto.randomUUID(), "x-xpro-login-id": crypto.randomUUID(),
      "x-xpro-is-master": "true", "x-forwarded-host": "evil.test",
    }, body: "unchanged body" }), services);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("x-request-id")).not.toBe(forgedId);
    expect(await response.json()).toEqual({ method: "POST", path: "/orders?view=open", body: "unchanged body",
      isMaster: false, loginId: login.loginId, hint: workspace.id, requestId: response.headers.get("x-request-id"),
      claimedLogin: null, claimedMaster: null, forwardedHost: null });
  });

  it.each(["workspace ID", "worker"] as const)("when cached placement has the wrong %s then it cannot open another workspace", async (mismatch) => {
    const created = await fixture.identities.createLogin();
    const own = await preparePlacement(fixture, { loginId: created.loginId });
    const other = await preparePlacement(fixture);
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const signedIn = await signInViaRouter({ fixture, workspace: own, login });
    await env.PLACEMENTS.put("origin:" + own.origin, JSON.stringify({
      workspaceId: mismatch === "workspace ID" ? other.id : own.id,
      workerName: mismatch === "worker" ? other.workerName : own.workerName, origin: own.origin,
    }));
    const before = { own: await readWorkspaceState(own), other: await readWorkspaceState(other) };
    const response = await route(page(own.origin, signedIn.cookie), routingServices(fixture, [own, other]));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "core_forbidden", message: "You do not have permission to do this.", requestId: response.headers.get("x-request-id") });
    expect({ own: await readWorkspaceState(own), other: await readWorkspaceState(other) }).toEqual(before);
  });

  it("when no address is registered then a navigation goes to the fixed Hub destination", async () => {
    const before = await readHubState(fixture.identities);
    const response = await route(page("https://unknown.test"), routingServices(fixture, []));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(hubOrigin + "/auth/destination");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it("when a write targets an unknown address then no body is redirected or executed", async () => {
    const response = await route(new Request("https://unknown.test/orders", { method: "POST", body: "private data" }),
      routingServices(fixture, []));
    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
  });

  it("when a person has no local session then a navigation starts sign-in with its safe return path", async () => {
    const workspace = await preparePlacement(fixture);
    const before = await readWorkspaceState(workspace);
    const response = await route(new Request(workspace.origin + "/orders?view=open", { headers: { accept: "text/html" } }),
      routingServices(fixture, [workspace]));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(workspace.origin + "/auth/start?returnTo=%2Forders%3Fview%3Dopen");
    expect(await readWorkspaceState(workspace)).toEqual(before);
  });

  it("when a write has no session then it returns an error without replaying the body after sign-in", async () => {
    const workspace = await preparePlacement(fixture);
    const before = await readWorkspaceState(workspace);
    const response = await route(new Request(workspace.origin + "/orders", { method: "POST", headers: { origin: workspace.origin }, body: "private data" }),
      routingServices(fixture, [workspace]));
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(await readWorkspaceState(workspace)).toEqual(before);
  });

  it("when an external person opens the workspace root then they reach its Portal", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await preparePlacement(fixture, { loginId: created.loginId, kind: "external" });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const signedIn = await signInViaRouter({ fixture, workspace, login });
    expect(signedIn.response.headers.get("location")).toBe(workspace.origin + "/portal");
    expect((await route(page(workspace.origin, signedIn.cookie), routingServices(fixture, [workspace]))).headers.get("location"))
      .toBe(workspace.origin + "/portal");
  });

  it("when membership moves to another workspace then the old address refuses access and the Hub selects the new default", async () => {
    const created = await fixture.identities.createLogin();
    const old = await preparePlacement(fixture, { loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const signedIn = await signInViaRouter({ fixture, workspace: old, login });
    await removeMembership({ identities: fixture.identities, loginId: login.loginId, workspaceId: old.id });
    const current = await preparePlacement(fixture, { loginId: created.loginId });
    const before = await readWorkspaceState(old);
    const response = await route(page(old.origin, signedIn.cookie), routingServices(fixture, [old, current]));
    expect(response.headers.get("location")).toBe(hubOrigin + "/auth/destination");
    expect(response.headers.getSetCookie()).toEqual(expect.arrayContaining([expect.stringContaining("__Host-xpro-session=;")]));
    const destination = await fetchHub(new Request(hubOrigin + "/auth/destination", { headers: { cookie: login.cookie } }), fixture);
    expect(destination.headers.get("location")).toBe(current.origin);
    expect(await readWorkspaceState(old)).toEqual(before);
  });

  it("when a cross-origin write has a valid session then it is still refused without changing records", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await preparePlacement(fixture, { loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const signedIn = await signInViaRouter({ fixture, workspace, login });
    const before = await readWorkspaceState(workspace);
    const response = await route(new Request(workspace.origin + "/orders", { method: "POST",
      headers: { cookie: signedIn.cookie, origin: "https://evil.test" }, body: "private data" }), routingServices(fixture, [workspace]));
    expect(response.status).toBe(403);
    expect(await readWorkspaceState(workspace)).toEqual(before);
  });

  it("when a direct callback supplies fake protocol parameters then routing cannot create a session", async () => {
    const workspace = await preparePlacement(fixture);
    const before = await readWorkspaceState(workspace);
    const response = await route(new Request(workspace.origin + "/auth/callback?code=fake&state=fake&iss=" + encodeURIComponent(hubOrigin + "/api/auth")),
      routingServices(fixture, [workspace]));
    expect(response.status).toBe(400);
    expect(await readWorkspaceState(workspace)).toEqual(before);
  });

  it("when sign-out passes through the router then the native device session and its local rows end", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await preparePlacement(fixture, { loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const signedIn = await signInViaRouter({ fixture, workspace, login });
    const response = await route(new Request(workspace.origin + "/auth/sign-out", { method: "POST",
      headers: { cookie: signedIn.cookie, origin: workspace.origin } }), routingServices(fixture, [workspace]));
    expect(response.status).toBe(200);
    expect(await fixture.identities.auth.api.getSession({ headers: { cookie: login.cookie } })).toBeNull();
    expect((await readWorkspaceState(workspace)).sessions).toEqual([]);
  });

  it("when a master opens a prepared workspace without membership then normal sign-in grants the approved global access", async () => {
    const created = await fixture.identities.createLogin({ role: "admin" });
    const workspace = await preparePlacement(fixture);
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const signedIn = await signInViaRouter({ fixture, workspace, login });
    const response = await route(page(workspace.origin, signedIn.cookie), routingServices(fixture, [workspace]));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspaceId: workspace.id, loginId: login.loginId, kind: "internal" });
  });
});

function page(origin: string, cookie?: string): Request {
  return new Request(origin + "/", { headers: { accept: "text/html", ...(cookie ? { cookie } : {}) } });
}
