import { env } from "cloudflare:workers";
import { save } from "@xpro/core/server";
import { ok } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignInFixture, readWorkspaceState, withWorkspace, type SignInFixture } from "#test/sign-in";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { fetchWorkspace, preparePlacement, signInViaRouter } from "#test/routing";

let fixture: SignInFixture;
beforeEach(async () => { fixture = await createSignInFixture(env.DB); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.identities.db.destroy(); });

describe("Workspace public request boundary", () => {
  it("when the configured workspace reaches another real data object then the object refuses it", async () => {
    const expected = await preparePlacement(fixture);
    const other = await preparePlacement(fixture);
    const before = await readWorkspaceState(other);
    const response = await fetchWorkspace(new Request(expected.origin + "/auth/start"), {
      fixture, workspace: { ...expected, stub: other.stub },
    });
    expect(response.status).toBe(403);
    expect(await readWorkspaceState(other)).toEqual(before);
  });

  it("when a session cookie is copied to another allowed address then that address still requires sign-in", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await preparePlacement(fixture, { loginId: created.loginId, alias: "https://alias.customer.test" });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const signedIn = await signInViaRouter({ fixture, workspace, login });
    const response = await fetchWorkspace(new Request("https://alias.customer.test/orders", {
      headers: { cookie: signedIn.cookie, accept: "application/json" },
    }), { fixture, workspace });
    expect(response.status).toBe(401);
  });

  it("when the Hub session ends without a message then the next public workspace request is refused", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await preparePlacement(fixture, { loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const signedIn = await signInViaRouter({ fixture, workspace, login });
    await fixture.identities.auth.api.signOut({ headers: { cookie: login.cookie } });
    const before = await readWorkspaceState(workspace);
    const response = await fetchWorkspace(new Request(workspace.origin + "/orders", { headers: { cookie: signedIn.cookie } }), { fixture, workspace });
    expect(response.status).toBe(401);
    expect(await readWorkspaceState(workspace)).toEqual(before);
  });

  it("when the local user has been archived then current Hub membership cannot open business requests", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await preparePlacement(fixture, { loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const signedIn = await signInViaRouter({ fixture, workspace, login });
    await withWorkspace(workspace, async ({ db, storage }) => {
      await save(storage, async () => {
        await db.updateTable("workspaceUsers").set({ archivedAt: new Date().toISOString() }).where("loginId", "=", created.loginId).execute();
        return ok(undefined);
      });
    });
    const before = await readWorkspaceState(workspace);
    const response = await fetchWorkspace(new Request(workspace.origin + "/orders", { headers: { cookie: signedIn.cookie } }), { fixture, workspace });
    expect(response.status).toBe(403);
    expect(await readWorkspaceState(workspace)).toEqual(before);
  });

  it("when a deployment has an invalid cookie secret then it refuses the request and exposes no settings", async () => {
    const workspace = await preparePlacement(fixture);
    const before = await readWorkspaceState(workspace);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await fetchWorkspace(new Request(workspace.origin + "/auth/start"), { fixture, workspace: { ...workspace, secret: "invalid-secret" } });
    const requestId = response.headers.get("x-request-id");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "core_unexpected_error", message: "Something went wrong. Please try again.", requestId });
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId, app: "workspace", operation: "core_workspace_object_request" })]]);
    expect(await readWorkspaceState(workspace)).toEqual(before);
  });
});
