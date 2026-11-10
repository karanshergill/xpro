import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignInFixture, hubRequest, readCookies, signInPassword, type SignInFixture } from "#test/sign-in";
import { handleHubAuthRequest } from "./oidc.server";

let fixture: SignInFixture;
beforeEach(async () => { fixture = await createSignInFixture(env.DB); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.identities.db.destroy(); });

describe("authentication privacy", () => {
  it("when credentials succeed or fail then audit and diagnostic records contain no submitted or issued secrets", async () => {
    const person = await fixture.identities.createLogin(), diagnostics: unknown[][] = [];
    for (const method of ["debug", "info", "log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation((...args) => { diagnostics.push(args); });
    const wrong = "Private-wrong-password456!", bot = "private-bot-response-" + crypto.randomUUID();
    const refused = hubRequest("/api/auth/sign-in/email", { email: person.email, password: wrong }); refused.headers.set("x-captcha-response", bot);
    expect((await handleHubAuthRequest(refused, fixture.settings)).status).toBe(401);
    const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", { email: person.email, password: signInPassword }), fixture.settings);
    expect(response.status).toBe(200);
    const cookie = readCookies(response), session = await fixture.identities.auth.api.getSession({ headers: { cookie } });
    if (!session) throw new Error("The genuine sign-in did not issue a session.");
    const audits = await fixture.identities.db.selectFrom("auditEntries").selectAll().execute();
    expect(audits).toHaveLength(2);
    expect(audits.map(({ outcome }) => outcome).sort()).toEqual(["refused", "success"]);
    for (const entry of audits) {
      expect(Object.keys(entry).sort()).toEqual(["accountId", "action", "actorLoginId", "affectedLoginId", "comment", "createdAt", "details", "id", "outcome", "reason", "requestId", "workspaceId"].sort());
      expect(entry).toMatchObject({ accountId: null, workspaceId: null, details: null });
      expect(entry.action).toBe("accounts_sign_in"); expect(entry.comment).toBeNull();
      expect(entry.reason).toBe(entry.outcome === "success" ? null : "accounts_credentials_invalid");
      expect(entry.actorLoginId).toBe(entry.outcome === "success" ? person.loginId : null);
      expect(entry.affectedLoginId).toBe(entry.outcome === "success" ? person.loginId : null);
    }
    const artifact = JSON.stringify({ audits, diagnostics });
    const secrets = [person.email, signInPassword, wrong, bot, fixture.settings.secret, fixture.settings.turnstileSecret,
      cookie, session.session.token, session.session.id];
    expect(secrets.some((value) => typeof value === "string" && value.length > 0 && artifact.includes(value))).toBe(false);
    for (const call of diagnostics) {
      expect(call).toHaveLength(1); const message = call[0];
      if (typeof message !== "string") throw new Error("Diagnostics must be safe JSON text.");
      expect(JSON.parse(message)).toEqual({ event: "core_unexpected_error", requestId: expect.any(String), app: "hub", operation: "accounts_hub_auth_request" });
    }
  });

  it("when native credential storage fails then diagnostics hide private input and the response stays generic", async () => {
    const person = await fixture.identities.createLogin(), diagnostics: unknown[][] = [];
    for (const method of ["debug", "info", "log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation((...args) => { diagnostics.push(args); });
    await fixture.identities.db.schema.dropTable("account").execute();
    const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", { email: person.email, password: signInPassword }), fixture.settings);
    expect(response.status).toBe(500);
    const body = await response.json(); expect(body).toEqual({ code: "core_unexpected_error", message: "Something went wrong. Please try again.", requestId: response.headers.get("x-request-id") });
    expect(diagnostics).toHaveLength(1); expect(diagnostics[0]).toEqual([JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "accounts_hub_auth_request" })]);
    expect(await fixture.identities.db.selectFrom("auditEntries").selectAll().execute()).toEqual([]);
    const artifact = JSON.stringify({ diagnostics, body });
    expect([person.email, signInPassword, fixture.settings.secret].some((secret) => artifact.includes(secret))).toBe(false);
  });

  it.each(["same-origin", "cross-site"])("when a no-referrer confirmation has null Origin and %s metadata then native CSRF validation remains enforced", async (site) => {
    const person = await fixture.identities.signIn();
    const prompt = await handleHubAuthRequest(new Request("https://hub.example.test/api/auth/oauth2/end-session", {
      headers: { cookie: person.cookie, accept: "text/html", "sec-fetch-mode": "navigate" },
    }), fixture.settings);
    expect(prompt.status).toBe(200);
    const response = await handleHubAuthRequest(new Request("https://hub.example.test/api/auth/oauth2/end-session/confirm", {
      method: "POST", headers: { cookie: person.cookie + "; " + readCookies(prompt), origin: "null", "sec-fetch-site": site,
        "sec-fetch-mode": "navigate", accept: "text/html", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ action: "confirm" }),
    }), fixture.settings);
    expect(response.status).toBe(site === "same-origin" ? 200 : 403);
    const session = await fixture.identities.auth.api.getSession({ headers: { cookie: person.cookie } });
    expect(Boolean(session)).toBe(site !== "same-origin");
  });

});
