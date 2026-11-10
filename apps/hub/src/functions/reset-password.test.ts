import { env } from "cloudflare:workers";
import { pageLoginIdHeader } from "@xpro/core";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignedInLogin } from "#test/hub-identities";
import { createResetFixture, readResetState, signInAfterReset, signInWithResetToken, type ResetFixture } from "#test/reset-password";
import { readResetTokens } from "#test/reset-password.db";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { hubRequest } from "#test/sign-in";
import { handleResetPassword } from "./reset-password.server";

let fixture: ResetFixture;
beforeEach(async () => { fixture = await createResetFixture(); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe("authenticated Hub password reset", () => {
  it("when a real master resets a target then the response exposes only its ID and the audit uses the actual master and fresh request ID", async () => {
    const before = await readResetState(fixture);
    const response = await submit(input(), { actor: fixture.master, headers: {
      "x-request-id": "untrusted-request-id", [pageLoginIdHeader]: fixture.master.loginId,
    } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ loginId: fixture.target.loginId });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    const after = await readResetState(fixture);
    expect(after.hub.audits).toHaveLength(before.hub.audits.length + 1);
    expect(after.hub.audits).toEqual(expect.arrayContaining([
      ...before.hub.audits, { id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/), action: "stms_password_reset", outcome: "success",
        actorLoginId: fixture.master.loginId, affectedLoginId: fixture.target.loginId, reason: null, comment: null,
        accountId: null, workspaceId: null, details: null,
        requestId, createdAt: expect.any(String) },
    ]));
    expect((await signInAfterReset({ fixture, login: fixture.target, password: input().newPassword })).response.status).toBe(200);
  });

  it.each(["anonymous claims", "tampered cookie", "ended session"] as const)("when identity is only %s then the request grants no reset authority", async (state) => {
    if (state === "ended session") await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: fixture.master.cookie } });
    const before = await readResetState(fixture);
    const response = await submit(input(), { actor: state === "anonymous claims" ? null : fixture.master,
      headers: state === "tampered cookie" ? { cookie: fixture.master.cookie + "tampered" }
        : { "x-login-id": fixture.master.loginId, "x-is-master": "true" } });
    await expectFailure(response, { status: 401, code: "core_unauthenticated", message: "Sign in to continue." });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it.each(["user", "workspace admin"] as const)("when a signed-in %s asks for a reset then its native cookie cannot grant master authority", async (role) => {
    const actor = await fixture.signIn.identities.signIn();
    if (role === "workspace admin") await fixture.signIn.identities.auth.api.addMember({ body: {
      userId: actor.loginId, organizationId: fixture.workspace.id, role: "admin",
    } });
    const before = await readResetState(fixture);
    await expectFailure(await submit(input(), { actor, headers: { [pageLoginIdHeader]: fixture.master.loginId } }), { status: 403, code: "core_forbidden", message: "You do not have permission to do this." });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it.each(["GET", "foreign Origin", "empty Origin", "foreign address"] as const)("when the request uses %s then it cannot enter the reset action", async (state) => {
    const before = await readResetState(fixture);
    const response = await submit(input(), { actor: fixture.master,
      ...(state === "GET" ? { method: "GET" } : {}),
      ...(state === "foreign Origin" ? { headers: { origin: "https://foreign.example.test" } } : {}),
      ...(state === "empty Origin" ? { headers: { origin: "" } } : {}),
      ...(state === "foreign address" ? { requestOrigin: "https://foreign.example.test" } : {}),
    });
    await expectFailure(response, { status: 403, code: "core_forbidden", message: "You do not have permission to do this." });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the Origin header is absent then the reset is refused without a change", async () => {
    const before = await readResetState(fixture);
    const request = hubRequest("/_serverFn/reset-password", input(), fixture.master.cookie);
    request.headers.delete("origin");
    await expectFailure(await handleResetPassword(input(), { request, settings: fixture.signIn.settings }), {
      status: 403, code: "core_forbidden", message: "You do not have permission to do this.",
    });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when a different master submits an open page's password then the reset is refused before any write", async () => {
    const current = await fixture.signIn.signInMaster(), before = await readResetState(fixture);
    await expectFailure(await submit(input(), { actor: current, headers: { [pageLoginIdHeader]: fixture.master.loginId } }), {
      status: 409, code: "core_identity_changed", message: "Your sign-in has changed. Reload this page to continue.",
    });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when fields are invalid then the boundary returns only safe field names and no submitted password", async () => {
    const before = await readResetState(fixture);
    await expectFailure(await submit({ loginId: "invalid", newPassword: "private" }, { actor: fixture.master }), {
      status: 400, code: "core_invalid_input", message: "Check the submitted details.", fields: ["loginId", "newPassword"],
    });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the body contains authority claims then unknown fields are refused without recording another actor", async () => {
    const before = await readResetState(fixture);
    await expectFailure(await submit({ ...input(), actorLoginId: fixture.other.loginId }, { actor: fixture.master }), {
      status: 400, code: "core_invalid_input", message: "Check the submitted details.", fields: [],
    });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the target is missing then a master gets a safe named not-found response without an audit", async () => {
    const before = await readResetState(fixture);
    await expectFailure(await submit({ ...input(), loginId: crypto.randomUUID() }, { actor: fixture.master }), {
      status: 404, code: "stms_login_not_found", message: "This login could not be found.",
    });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when native session storage fails then each request reports one safe failure and leaves credentials and audit unchanged", async () => {
    const before = await readResetState(fixture);
    await fixture.signIn.identities.db.schema.dropTable("session").execute();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const requestIds = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await submit(input(), { actor: fixture.master });
      await expectFailure(response, { status: 500, code: "core_unexpected_error", message: "Something went wrong. Please try again." });
      requestIds.push(response.headers.get("x-request-id"));
    }
    expect(new Set(requestIds).size).toBe(2);
    expect(log.mock.calls).toEqual(requestIds.map((requestId) => [JSON.stringify({ event: "core_unexpected_error", requestId, app: "hub", operation: "core_hub_function_request" })]));
    expect(await fixture.signIn.identities.db.selectFrom("account").selectAll().orderBy("id").execute()).toEqual(before.hub.credentials);
    expect(await fixture.signIn.identities.db.selectFrom("auditEntries").selectAll().orderBy("id").execute()).toEqual(before.hub.audits);
  });

  it("when the audit save fails then the HTTP failure is safe and no partial password or session change survives", async () => {
    await sql`create trigger test_refuse_http_reset before insert on audit_entries
      when new.action = 'stms_password_reset' begin select raise(abort, 'test_reset_audit_failure'); end`
      .execute(fixture.signIn.identities.db.withoutPlugins());
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const before = await readResetState(fixture);
    const response = await submit(input(), { actor: fixture.master });
    await expectFailure(response, { status: 500, code: "core_unexpected_error", message: "Something went wrong. Please try again." });
    expect(await readResetState(fixture)).toEqual(before);
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "stms_reset_password" })]]);
  });

  it("when reset ends the target's sessions then its actual issued token loses native user-info access while another login's token stays usable", async () => {
    const target = await signInWithResetToken({ fixture, workspace: fixture.workspace, login: fixture.target });
    const other = await signInWithResetToken({ fixture, workspace: fixture.otherWorkspace, login: fixture.other });
    expect((await userInfo(target.accessToken)).status).toBe(200);
    expect((await userInfo(other.accessToken)).status).toBe(200);
    const before = await readResetTokens(fixture);
    const response = await submit(input(), { actor: fixture.master });
    expect(response.status).toBe(200);
    const audit = await fixture.signIn.identities.db.selectFrom("auditEntries").select("createdAt")
      .where("requestId", "=", response.headers.get("x-request-id")).executeTakeFirstOrThrow();
    expect(await readResetTokens(fixture)).toEqual({ ...before, access: before.access.map((row) => row.userId === fixture.target.loginId
      ? { ...row, revoked: row.revoked ?? audit.createdAt, sessionId: null } : row) });
    expect((await userInfo(target.accessToken)).status).toBe(401);
    expect((await userInfo(other.accessToken)).status).toBe(200);
  });
});

function input(): { loginId: string; newPassword: string } { return { loginId: fixture.target.loginId, newPassword: "Reset-password456!" }; }

async function submit(value: unknown, options: {
  actor: SignedInLogin | null; headers?: HeadersInit; method?: string; requestOrigin?: string;
}): Promise<Response> {
  const request = hubRequest("/_serverFn/reset-password", value, options.actor?.cookie);
  const headers = new Headers(request.headers);
  for (const [name, content] of new Headers(options.headers)) headers.set(name, content);
  return await handleResetPassword(value, { request: new Request(
    (options.requestOrigin ?? "https://hub.example.test") + "/_serverFn/reset-password", { method: options.method ?? "POST", headers },
  ), settings: { ...fixture.signIn.settings, database: env.DB } });
}

async function expectFailure(response: Response, expected: { status: number; code: string; message: string; fields?: string[] }): Promise<void> {
  const { status, ...body } = expected;
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  expect(await response.json()).toEqual({ ...body, requestId: response.headers.get("x-request-id") });
}

async function userInfo(accessToken: string): Promise<Response> {
  return await handleHubAuthRequest(new Request("https://hub.example.test/api/auth/oauth2/userinfo", {
    headers: { authorization: "Bearer " + accessToken },
  }), fixture.signIn.settings);
}
