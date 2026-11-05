import { env } from "cloudflare:workers";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { pageLoginIdHeader } from "@xpro/core";
import { maxJsonBodyBytes } from "@xpro/core/server";
import { createSignInFixture, readHubState, readWorkspaceState, removeMembership, signInAtWorkspace, type SignInFixture } from "#test/sign-in";
import { fetchWorkspace, preparePlacement, type PreparedWorkspace } from "#test/routing";
import { handleWorkspacePage, validateWorkspacePage } from "./workspace-page.server";

let fixture: SignInFixture;
beforeEach(async () => { fixture = await createSignInFixture(env.DB); });
afterEach(async () => { await fixture.identities.db.destroy(); });

describe("prepared workspace page identity and UI precondition", () => {
  it.each(["internal", "external"] as const)("when a %s user reads page data then it returns only the already-checked actor without changing records", async (kind) => {
    const login = await fixture.identities.signIn();
    const workspace = await preparePlacement(fixture, { loginId: login.loginId, kind });
    const signedIn = await signInAtWorkspace({ fixture, workspace, login });
    const before = await snapshot(workspace);
    const response = await request(workspace, { cookie: signedIn.cookie, expectedLoginId: login.loginId });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ loginId: login.loginId });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await snapshot(workspace)).toEqual(before);
  });

  it("when a master has no local user then its current authorized identity is still readable", async () => {
    const login = await fixture.signInMaster();
    const workspace = await preparePlacement(fixture);
    const signedIn = await signInAtWorkspace({ fixture, workspace, login });
    expect(await (await request(workspace, { cookie: signedIn.cookie })).json()).toEqual({ loginId: login.loginId });
  });

  it.each(["POST", "GET"])("when an old document sends %s as another current login then no reader or action is executed", async (method) => {
    const original = await fixture.signInMaster(), other = await fixture.signInMaster();
    const workspace = await preparePlacement(fixture);
    const signedIn = await signInAtWorkspace({ fixture, workspace, login: other });
    const before = await snapshot(workspace); let renderCount = 0;
    const response = await fetchWorkspace(new Request(workspace.origin + (method === "POST" ? "/_serverFn/page" : "/orders"), {
      method, headers: { cookie: signedIn.cookie, origin: workspace.origin, [pageLoginIdHeader]: original.loginId,
        ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      ...(method === "POST" ? { body: "{}" } : {}),
    }), { fixture, workspace, render: async () => { renderCount++; return Response.json({ unexpected: true }); } });
    await expectFailure(response, { status: 409, code: "core_identity_changed" });
    expect(renderCount).toBe(0); expect(await snapshot(workspace)).toEqual(before);
  });

  it("when a cookie is absent then a submitted master ID cannot authenticate the request", async () => {
    const master = await fixture.signInMaster(), workspace = await preparePlacement(fixture);
    await expectFailure(await request(workspace, { expectedLoginId: master.loginId }), { status: 401, code: "core_unauthenticated" });
  });

  it("when the Hub session ends then the old cookie and matching page hint are refused", async () => {
    const login = await fixture.identities.signIn(), workspace = await preparePlacement(fixture, { loginId: login.loginId });
    const signedIn = await signInAtWorkspace({ fixture, workspace, login });
    await fixture.identities.auth.api.signOut({ headers: { cookie: login.cookie } });
    const before = await snapshot(workspace);
    await expectFailure(await request(workspace, { cookie: signedIn.cookie, expectedLoginId: login.loginId }), { status: 401, code: "core_unauthenticated" });
    expect(await snapshot(workspace)).toEqual(before);
  });

  it("when membership is removed then a valid login cannot resume the workspace page", async () => {
    const login = await fixture.identities.signIn(), workspace = await preparePlacement(fixture, { loginId: login.loginId });
    const signedIn = await signInAtWorkspace({ fixture, workspace, login });
    await removeMembership({ identities: fixture.identities, loginId: login.loginId, workspaceId: workspace.id });
    const before = await snapshot(workspace);
    await expectFailure(await request(workspace, { cookie: signedIn.cookie, expectedLoginId: login.loginId }), { status: 403, code: "core_forbidden" });
    expect(await snapshot(workspace)).toEqual(before);
  });

  it("when a caller submits identity as page data then strict empty input refuses it", async () => {
    const login = await fixture.identities.signIn(), workspace = await preparePlacement(fixture, { loginId: login.loginId });
    const signedIn = await signInAtWorkspace({ fixture, workspace, login });
    const before = await snapshot(workspace);
    await expectFailure(await request(workspace, { cookie: signedIn.cookie, input: { loginId: "private-value", isMaster: true } }), { status: 400, code: "core_invalid_input" });
    expect(await snapshot(workspace)).toEqual(before);
  });

  it.each([
    { method: "GET", contentType: "application/json", body: undefined, status: 403, code: "core_forbidden" },
    { method: "POST", contentType: "text/plain", body: "{}", status: 415, code: "core_unsupported_media_type" },
    { method: "POST", contentType: "application/json", body: "invalid-private-value", status: 400, code: "core_invalid_input" },
    { method: "POST", contentType: "application/json", body: "x".repeat(maxJsonBodyBytes + 1), status: 413, code: "core_request_too_large" },
  ])("when a workspace RPC request fails the $status boundary then Start never receives it", async (input) => {
    const workspace = await preparePlacement(fixture), before = await snapshot(workspace);
    let renderCount = 0;
    const response = await fetchWorkspace(new Request(workspace.origin + "/_serverFn/page", {
      method: input.method, headers: { origin: workspace.origin, "content-type": input.contentType },
      ...(input.body === undefined ? {} : { body: input.body }),
    }), { fixture, workspace, render: async () => { renderCount++; return Response.json({ unexpected: true }); } });
    await expectFailure(response, input);
    expect(renderCount).toBe(0);
    expect(await snapshot(workspace)).toEqual(before);
  });
});

async function request(workspace: PreparedWorkspace, options: { cookie?: string; expectedLoginId?: string; input?: unknown } = {}): Promise<Response> {
  return await fetchWorkspace(new Request(workspace.origin + "/_serverFn/page", { method: "POST",
    headers: { origin: workspace.origin, "content-type": "application/json", ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.expectedLoginId ? { [pageLoginIdHeader]: options.expectedLoginId } : {}) }, body: "{}" }),
  { fixture, workspace, render: async (_request, context) => handleWorkspacePage(validateWorkspacePage(options.input ?? {}), context) });
}

async function snapshot(workspace: PreparedWorkspace) {
  return { hub: await readHubState(fixture.identities), workspace: await readWorkspaceState(workspace) };
}

async function expectFailure(response: Response, expected: { status: number; code: string }): Promise<void> {
  expect(response.status).toBe(expected.status);
  expect(await response.json()).toEqual({ code: expected.code, message: expect.any(String), requestId: response.headers.get("x-request-id"),
    ...(expected.code === "core_invalid_input" ? { fields: [] } : {}) });
  expect(response.headers.get("cache-control")).toBe("no-store");
}
