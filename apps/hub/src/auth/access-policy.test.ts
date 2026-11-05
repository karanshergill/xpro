import { env } from "cloudflare:workers";
import { createHubIdentities, type HubIdentities, type SignedInLogin } from "#test/hub-identities";
import { saveHub } from "#db/hub-save.db.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let identities: HubIdentities;
const origin = "https://hub.example.test";
beforeEach(async () => { identities = await createHubIdentities(env.DB); });
afterEach(async () => { await identities.db.destroy(); vi.restoreAllMocks(); });

describe("native HTTP access gates", () => {
  it.each(["/list-sessions", "/sign-in/email"])("when %s access validation fails then one safe error is returned and reported once", async (path) => {
    const login = await identities.signIn();
    await identities.db.withoutPlugins().schema.dropTable("login_creations").execute();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await requestAuth(path, login, path === "/sign-in/email"
      ? { method: "POST", body: JSON.stringify({ email: login.email, password: "Access-fixture123!" }) } : {});
    expect(response.status).toBe(500);
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toEqual(expect.any(String));
    expect(await response.json()).toEqual({ code: "core_unexpected_error", message: "Something went wrong. Please try again.", requestId });
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: "core_unexpected_error", requestId, app: "hub", operation: path === "/sign-in/email" ? "accounts_create_hub_session" : "core_validate_access" }));
  });

  it.each(["user", "admin"] as const)("when a %s lacks required MFA/profile completion then native protected routes refuse it", async (role) => {
    const login = await identities.signIn({ role, username: null, name: "", phone: null });
    for (const path of ["/list-sessions", "/organization/list"]) {
      const response = await requestAuth(path, login);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(role === "admin"
        ? { code: "core_mfa_required", message: "Complete multi-factor authentication to continue.", requestId: expect.any(String) }
        : { code: "core_profile_incomplete", message: "Complete the required profile details.",
          requestId: expect.any(String), fields: ["username", "name", "phone"] });
    }
    expect(await identities.db.selectFrom("auditEntries").selectAll().execute()).toEqual([]);
  });

  it("when a profile is complete then native protected routes still work", async () => {
    const login = await identities.signIn();
    const response = await requestAuth("/list-sessions", login);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([expect.objectContaining({ id: login.hubSessionId, userId: login.loginId })]);
  });

  it.each(["user", "admin"] as const)("when a %s lacks required MFA/profile completion then session checks and sign-out remain usable", async (role) => {
    const login = await identities.signIn({ role, username: null, name: "", phone: null });
    const response = await requestAuth("/get-session", login);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { id: login.loginId }, session: { id: login.hubSessionId } });
    expect((await requestAuth("/sign-out", login, { method: "POST", body: "{}" })).status).toBe(200);
    expect(await identities.auth.api.getSession({ headers: { cookie: login.cookie } })).toBeNull();
  });

  it("when xpro uses a trusted server API then the HTTP gate does not replace the action's own authorization", async () => {
    const login = await identities.signIn({ phone: null });
    expect(await identities.auth.api.listSessions({ headers: { cookie: login.cookie } }))
      .toEqual([expect.objectContaining({ id: login.hubSessionId, userId: login.loginId })]);
  });

  it.each(["archived", "creation incomplete"] as const)("when a login becomes %s then it cannot start a new native session", async (state) => {
    const login = await identities.signIn();
    if (state === "archived") {
      await saveHub(env.DB, [identities.db.updateTable("user").set({ archivedAt: new Date().toISOString() }).where("id", "=", login.loginId).compile()]);
    } else {
      const id = crypto.randomUUID();
      await saveHub(env.DB, [
        identities.db.insertInto("loginCreations").values({ id, creatorLoginId: login.loginId, organizationId: null,
          createdLoginId: login.loginId, kind: null, details: "{}", createdAt: new Date().toISOString(), completedAt: null }).compile(),
        identities.db.updateTable("user").set({ loginCreationId: id }).where("id", "=", login.loginId).compile(),
      ]);
    }
    const before = await identities.db.selectFrom("session").selectAll().execute();
    const response = await requestAuth("/sign-in/email", login, { method: "POST", body: JSON.stringify({ email: login.email, password: "Access-fixture123!" }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: state === "archived" ? "core_login_inactive" : "core_creation_incomplete",
      message: state === "archived" ? "This login is not active." : "This login is not ready to use yet.", requestId: expect.any(String) });
    expect(await identities.db.selectFrom("session").selectAll().execute()).toEqual(before);
    const protectedResponse = await requestAuth("/list-sessions", login);
    expect(protectedResponse.status).toBe(403);
    expect(await protectedResponse.json()).toMatchObject({ code: state === "archived" ? "core_login_inactive" : "core_creation_incomplete" });
  });
});

async function requestAuth(path: string, login: SignedInLogin, init: RequestInit = {}): Promise<Response> {
  return await identities.auth.handler(new Request(`${origin}/api/auth${path}`, {
    ...init, headers: { origin, "content-type": "application/json", cookie: login.cookie },
  }));
}
