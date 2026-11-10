import { env } from "cloudflare:workers";
import { saveHub } from "@xpro/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignInFixture, hubOrigin, readHubState, type SignInFixture } from "#test/sign-in";
import { fetchHub, preparePlacement, route, routingServices } from "#test/routing";
import { handleHubAuthRequest } from "#test/sign-in-actions";

let fixture: SignInFixture;
beforeEach(async () => { fixture = await createSignInFixture(env.DB); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.identities.db.destroy(); });

describe("Hub destination routing", () => {
  it.each(["/", "/auth/destination"])("when an anonymous visitor opens %s then the Hub sends them to sign-in", async (path) => {
    const before = await readHubState(fixture.identities);
    const response = await fetchHub(new Request(hubOrigin + path), fixture);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(hubOrigin + "/sign-in");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it.each([false, true])("when a master requests a default (membership present: %s) then the Hub selects STMS", async (hasMembership) => {
    const created = await fixture.identities.createLogin({ role: "admin" });
    if (hasMembership) await preparePlacement(fixture, { loginId: created.loginId });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const before = await readHubState(fixture.identities);
    const response = await route(new Request(hubOrigin + "/auth/destination", { headers: { cookie: login.cookie } }), routingServices(fixture, []));
    expect(response.headers.get("location")).toBe(hubOrigin + "/stms");
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it.each(["GET", "HEAD"])("when an anonymous visitor opens the account page with %s then sign-in is required", async (method) => {
    const before = await readHubState(fixture.identities);
    const response = await fetchHub(new Request(hubOrigin + "/account", { method }), fixture);
    expect(response.status).toBe(302); expect(response.headers.get("location")).toBe(hubOrigin + "/sign-in");
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it("when a login without an Account opens the account page then its actual destination is used", async () => {
    const login = await fixture.identities.signIn();
    const before = await readHubState(fixture.identities);
    const response = await fetchHub(new Request(hubOrigin + "/account", { headers: { cookie: login.cookie } }), fixture);
    expect(response.status).toBe(302); expect(response.headers.get("location")).toBe(hubOrigin + "/no-workspace");
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it("when an account holder has no workspace then the Hub selects their account page", async () => {
    const created = await fixture.identities.createLogin();
    const createdAt = new Date().toISOString();
    await saveHub(env.DB, [fixture.identities.db.insertInto("accounts").values({
      id: crypto.randomUUID(), ownerLoginId: created.loginId, name: "Fixture account", nameSearch: "fixture account",
      createdAt, updatedAt: createdAt,
    }).compile()]);
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const response = await destination(login.cookie);
    expect(response.headers.get("location")).toBe(hubOrigin + "/account");
  });

  it("when a member has default and custom addresses then the Hub chooses the prepared primary address", async () => {
    const created = await fixture.identities.createLogin();
    const workspace = await preparePlacement(fixture, { loginId: created.loginId, alias: "https://erp.customer.test" });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const before = await readHubState(fixture.identities);
    const response = await destination(login.cookie);
    expect(response.headers.get("location")).toBe(workspace.origin);
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it.each(["missing", "forbidden"] as const)("when the requested workspace is %s then the person reaches their own prepared workspace", async (state) => {
    const created = await fixture.identities.createLogin();
    const own = await preparePlacement(fixture, { loginId: created.loginId });
    const requestedId = state === "missing" ? crypto.randomUUID() : (await preparePlacement(fixture)).id;
    const login = await fixture.signIn(created, handleHubAuthRequest);
    expect((await destination(login.cookie, "?requestedWorkspaceId=" + requestedId)).headers.get("location")).toBe(own.origin);
  });

  it("when a master explicitly requests an existing prepared workspace then it takes precedence over STMS", async () => {
    const created = await fixture.identities.createLogin({ role: "admin" });
    const workspace = await preparePlacement(fixture);
    const login = await fixture.signIn(created, handleHubAuthRequest);
    expect((await destination(login.cookie, "?requestedWorkspaceId=" + workspace.id)).headers.get("location")).toBe(workspace.origin);
  });

  it("when a person belongs to no workspace or account then the browser is sent to the workspace-access message without creating either", async () => {
    const created = await fixture.identities.createLogin();
    const login = await fixture.signIn(created, handleHubAuthRequest);
    const before = await readHubState(fixture.identities);
    const response = await destination(login.cookie);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(hubOrigin + "/no-workspace");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it("when the profile is unfinished then destination routing still requires completion", async () => {
    const created = await fixture.identities.createLogin({ username: null, name: "", phone: null });
    const login = await fixture.signIn(created, handleHubAuthRequest);
    expect((await destination(login.cookie)).headers.get("location")).toBe(hubOrigin + "/complete-profile");
  });

  it.each(["?requestedWorkspaceId=https://evil.test", "?requestedWorkspaceId=bad", "?requestedWorkspaceId=bad&requestedWorkspaceId=bad"])(
    "when a caller sends invalid destination input (%s) then no supplied address is used", async (query) => {
      const login = await fixture.identities.signIn();
      const response = await destination(login.cookie, query);
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it("when the Hub is requested under another origin then it never treats that origin as an approved address", async () => {
    const login = await fixture.identities.signIn();
    expect((await fetchHub(new Request("https://evil.test/auth/destination", { headers: { cookie: login.cookie } }), fixture)).status).toBe(403);
  });

  it("when native destination session lookup fails then one safe error hides database details", async () => {
    const login = await fixture.identities.signIn();
    await fixture.identities.db.schema.dropTable("session").execute();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await destination(login.cookie);
    const requestId = response.headers.get("x-request-id");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "core_unexpected_error",
      message: "Something went wrong. Please try again.", requestId });
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId, app: "hub", operation: "core_hub_request" })]]);
  });
});

async function destination(cookie: string, query = ""): Promise<Response> {
  return await fetchHub(new Request(hubOrigin + "/auth/destination" + query, { headers: { cookie } }), fixture);
}
