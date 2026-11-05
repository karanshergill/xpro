import { env } from "cloudflare:workers";
import { saveHub } from "@xpro/core/server";
import { createSignInFixture, hubRequest, signInPassword, type SignInFixture } from "#test/sign-in";
import { CompiledQuery, sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleHubAuthRequest } from "./oidc.server";
import { loginIdentifierQuery } from "./sign-in.db";

let fixture: SignInFixture;
beforeEach(async () => { fixture = await createSignInFixture(env.DB); });
afterEach(async () => { await fixture.identities.db.destroy(); vi.restoreAllMocks(); });

describe("native credential boundary", () => {
  it("when a credential source is looked up by email or username then the shared database uses its normalized unique indexes", async () => {
    const login = await fixture.identities.createLogin();
    const db = fixture.identities.db;
    for (const method of ["email", "username"] as const) {
      const query = loginIdentifierQuery(db, { method, identifier: method === "email" ? login.email.toUpperCase() : "fixture" });
      const plan = await db.withoutPlugins().executeQuery<{ detail: string }>(CompiledQuery.raw(`explain query plan ${query.sql}`, [...query.parameters]));
      expect(plan.rows.some(({ detail }) => detail.includes(`user_${method}_normalized_unique`))).toBe(true);
      expect(plan.rows.filter(({ detail }) => /\bSCAN\b/.test(detail))).toEqual([]);
    }
  });

  it.each([false, true])("when a pending login creation signs in (correct password: %s) then it remains blocked and only verified identity is audited", async (hasCorrectPassword) => {
    const login = await fixture.identities.createLogin();
    const id = crypto.randomUUID();
    await saveHub(env.DB, [fixture.identities.db.insertInto("loginCreations").values({ id,
      creatorLoginId: login.loginId, organizationId: null, createdLoginId: login.loginId, kind: null,
      details: "{}", createdAt: new Date().toISOString(), completedAt: null }).compile(),
      fixture.identities.db.updateTable("user").set({ loginCreationId: id }).where("id", "=", login.loginId).compile()]);
    const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", {
      email: login.email, password: hasCorrectPassword ? signInPassword : "Wrong-password123!",
    }), fixture.settings);
    const code = hasCorrectPassword ? "core_creation_incomplete" : "accounts_credentials_invalid";
    expect(response.status).toBe(hasCorrectPassword ? 403 : 401);
    expect(await response.json()).toMatchObject({ code, requestId: response.headers.get("x-request-id") });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await fixture.identities.db.selectFrom("session").selectAll().execute()).toEqual([]);
    expect(await fixture.identities.db.selectFrom("auditEntries").selectAll().execute()).toEqual([
      expect.objectContaining({ action: "accounts_sign_in", outcome: "refused", reason: code,
        actorLoginId: null, affectedLoginId: hasCorrectPassword ? login.loginId : null }),
    ]);
  });

  it("when native credential storage fails then its internal failure is replaced by the safe public error", async () => {
    const login = await fixture.identities.createLogin();
    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => {});
    await fixture.identities.db.schema.dropTable("account").execute();
    const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", { email: login.email, password: signInPassword }), fixture.settings);
    const requestId = response.headers.get("x-request-id");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "core_unexpected_error", message: "Something went wrong. Please try again.", requestId });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(diagnostics.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId, app: "hub", operation: "accounts_hub_auth_request" })]]);
  });

  it("when recording the credential audit fails then the response and one diagnostic disclose no credentials or internal error", async () => {
    const login = await fixture.identities.createLogin();
    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => {});
    await sql`create trigger refuse_sign_in_audit before insert on audit_entries
      when new.action = 'accounts_sign_in' begin select raise(abort, 'private-audit-failure'); end`.execute(fixture.identities.db);
    const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", { email: login.email, password: signInPassword }), fixture.settings);
    const requestId = response.headers.get("x-request-id");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "core_unexpected_error", message: "Something went wrong. Please try again.", requestId });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(diagnostics.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId, app: "hub", operation: "accounts_hub_auth_request" })]]);
    expect(await fixture.identities.db.selectFrom("auditEntries").selectAll().execute()).toEqual([]);
    // The approved native-session/audit exception leaves a session after this failed
    // second write; it is never presented to this browser as successful sign-in.
    expect(await fixture.identities.db.withoutPlugins().selectFrom("session").select("userId").execute()).toEqual([{ userId: login.loginId }]);
  });
});
