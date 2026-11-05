import { sql } from "kysely";
import { saveHub } from "@xpro/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManagementFixture, prepareManagementServices, expectManagementSaved, findManagementUser,
  unavailableManagementDatabase } from "#test/login-management";
import { readResetState, type ResetFixture } from "#test/reset-password";
import type { SignedInLogin } from "#test/hub-identities";
import { handleChangeEmail, handleChangeUsername } from "./login-identifiers.server";

let fixture: ResetFixture;
beforeEach(async () => { fixture = await createManagementFixture(); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });
const changes = [
  { field: "email" as const, handle: handleChangeEmail, next: "http-update@example.test", audit: "stms_email_changed" },
  { field: "username" as const, handle: handleChangeUsername, next: "httpname", audit: "stms_username_changed" },
];
type Change = typeof changes[number];

describe.each(changes)("authenticated master $field HTTP", (change) => {
  it("when the master changes an identifier then only the login ID returns and a fresh request identifies the actual master", async () => {
    const before = await readResetState(fixture), row = findManagementUser(before, fixture.target.loginId);
    const services = await prepareManagementServices({ actor: fixture.master });
    const response = await submit(change, input(change), { headers: { "x-request-id": "untrusted-id" } });
    expect(response.status).toBe(200); checkHeaders(response);
    expect(response.headers.get("x-request-id")).not.toBe("untrusted-id");
    expect(await response.json()).toEqual({ loginId: fixture.target.loginId });
    services.context.requestId = requestId(response);
    await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: change.field === "email" ? { email: change.next } : { username: change.next, displayUsername: change.next },
      sessions: before.hub.sessions.filter((item) => item.userId !== fixture.target.loginId), action: change.audit,
      reservations: change.field === "email" ? before.hub.reservations : expect.arrayContaining([...before.hub.reservations, {
        id: expect.any(String), username: row.username, addedAt: expect.any(String),
      }]) });
  });

  it("when the submitted normalized value is unchanged then no timestamp, reservation, session or audit changes", async () => {
    const before = await readResetState(fixture), row = findManagementUser(before, fixture.target.loginId);
    const value = change.field === "email" ? " " + row.email.toUpperCase() + " " : row.username;
    const response = await submit(change, { loginId: fixture.target.loginId, [change.field]: value });
    expect(response.status).toBe(200); checkHeaders(response);
    expect(await response.json()).toEqual({ loginId: fixture.target.loginId });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it.each(["anonymous", "tampered cookie", "ended session"] as const)(
    "when authentication is %s then header hints cannot authorize an identifier change", async (state) => {
      if (state === "ended session") await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: fixture.master.cookie } });
      const before = await readResetState(fixture);
      await failure(await submit(change, input(change), { actor: state === "anonymous" ? null : fixture.master,
        headers: { "x-login-id": fixture.master.loginId, "x-is-master": "true",
          ...(state === "tampered cookie" ? { cookie: fixture.master.cookie + "tampered" } : {}) } }), { status: 401, code: "core_unauthenticated", message: "Sign in to continue." });
      expect(await readResetState(fixture)).toEqual(before);
    },
  );

  it.each(["user", "owner", "admin"] as const)(
    "when a tenant %s has a real cookie then the role cannot grant global identifier access", async (role) => {
      const actor = role === "user" ? fixture.other : await fixture.signIn.identities.signIn();
      if (role !== "user") await fixture.signIn.identities.auth.api.addMember({ body: {
        userId: actor.loginId, organizationId: fixture.workspace.id, role,
      } });
      const before = await readResetState(fixture);
      await failure(await submit(change, input(change), { actor }), { status: 403, code: "core_forbidden", message: "You do not have permission to do this." });
      expect(await readResetState(fixture)).toEqual(before);
    },
  );

  it.each(["GET", "foreign Origin", "missing Origin", "wrong URL"] as const)(
    "when the request has %s then no identity or audit changes", async (state) => {
      const before = await readResetState(fixture);
      await failure(await submit(change, input(change), {
        ...(state === "GET" ? { method: "GET" } : {}),
        ...(state === "foreign Origin" ? { headers: { origin: "https://foreign.invalid" } } : {}),
        ...(state === "missing Origin" ? { shouldOmitOrigin: true } : {}),
        ...(state === "wrong URL" ? { origin: "https://foreign.invalid" } : {}),
      }), { status: 403, code: "core_forbidden", message: "You do not have permission to do this." });
      expect(await readResetState(fixture)).toEqual(before);
    },
  );

  it("when unknown authority and lifecycle fields are supplied then the validation response echoes none of them", async () => {
    const before = await readResetState(fixture);
    await failure(await submit(change, { ...input(change), actorLoginId: fixture.other.loginId, role: "admin", banned: false }), { status: 400, code: "core_invalid_input", message: "Check the submitted details.", fields: [] });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the target is missing then a safe 404 creates no reservation or audit", async () => {
    const before = await readResetState(fixture);
    await failure(await submit(change, { ...input(change), loginId: crypto.randomUUID() }), { status: 404, code: "stms_login_not_found", message: "This login could not be found." });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when another login owns the identifier then the named conflict leaves all records unchanged", async () => {
    const before = await readResetState(fixture), other = findManagementUser(before, fixture.other.loginId);
    await failure(await submit(change, { loginId: fixture.target.loginId, [change.field]: other[change.field] }), { status: 409, code: change.field === "email" ? "accounts_email_taken" : "accounts_username_taken", message: change.field === "email" ? "This email address is already in use." : "This username is already in use." });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the database cannot be reached then one safe error event is logged", async () => {
    const before = await readResetState(fixture), log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await change.handle(input(change), { request: makeRequest(), settings: {
      ...fixture.signIn.settings, database: unavailableManagementDatabase(),
    } });
    await failure(response, { status: 500, code: "core_unexpected_error", message: "Something went wrong. Please try again." });
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: requestId(response), app: "hub", operation: "core_hub_function_request" })]]);
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the audit insert fails then the HTTP error hides native details and the complete change rolls back", async () => {
    await sql`create trigger test_refuse_http_identifier before insert on audit_entries
      begin select raise(abort, 'private_identifier_http_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
    const before = await readResetState(fixture), log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await submit(change, input(change));
    await failure(response, { status: 500, code: "core_unexpected_error", message: "Something went wrong. Please try again." });
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: requestId(response), app: "hub", operation: change.field === "email" ? "stms_change_email" : "stms_change_username" })]]);
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the master is demoted then the next HTTP change is refused", async () => {
    await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.master.loginId, { role: "user" });
    const before = await readResetState(fixture);
    await failure(await submit(change, input(change)), { status: 403, code: "core_forbidden", message: "You do not have permission to do this." });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the master changes their own identifier then the response succeeds and their acting cookie stops working", async () => {
    const services = await prepareManagementServices({ actor: fixture.master }), before = await readResetState(fixture);
    const row = findManagementUser(before, fixture.master.loginId);
    const response = await submit(change, { ...input(change), loginId: fixture.master.loginId });
    expect(response.status).toBe(200); checkHeaders(response);
    expect(await response.json()).toEqual({ loginId: fixture.master.loginId });
    services.context.requestId = requestId(response);
    await expectManagementSaved({ fixture, before, services, loginId: fixture.master.loginId,
      userChanges: change.field === "email" ? { email: change.next } : { username: change.next, displayUsername: change.next },
      sessions: before.hub.sessions.filter((item) => item.userId !== fixture.master.loginId), action: change.audit,
      reservations: change.field === "email" ? before.hub.reservations : expect.arrayContaining([...before.hub.reservations, {
        id: expect.any(String), username: row.username, addedAt: expect.any(String),
      }]) });
    expect(await fixture.signIn.identities.auth.api.getSession({ headers: { cookie: fixture.master.cookie } })).toBeNull();
  });
});

describe("identifier HTTP field rules", () => {
  it("when a username violates the existing format then the named safe result is returned", async () => {
    const before = await readResetState(fixture);
    await failure(await handleChangeUsername({ loginId: fixture.target.loginId, username: "UPPER" },
      { request: makeRequest(), settings: fixture.signIn.settings }), { status: 400, code: "accounts_username_invalid", message: "Check the username format." });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when a username is reserved then its conflict exposes no reservation details", async () => {
    await saveHub(fixture.signIn.settings.database, [fixture.signIn.identities.db.insertInto("reservedUsernames").values({
      id: crypto.randomUUID(), username: "retired", addedAt: new Date().toISOString(),
    }).compile()]);
    const before = await readResetState(fixture);
    await failure(await handleChangeUsername({ loginId: fixture.target.loginId, username: "retired" },
      { request: makeRequest(), settings: fixture.signIn.settings }), { status: 409, code: "accounts_username_reserved", message: "This username is reserved." });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the email is invalid then only the known field is returned", async () => {
    const before = await readResetState(fixture);
    await failure(await handleChangeEmail({ loginId: fixture.target.loginId, email: "private-invalid" },
      { request: makeRequest(), settings: fixture.signIn.settings }), { status: 400, code: "core_invalid_input", message: "Check the submitted details.", fields: ["email"] });
    expect(await readResetState(fixture)).toEqual(before);
  });
});

function input(change: Change): { loginId: string; email?: string; username?: string } {
  return { loginId: fixture.target.loginId, [change.field]: change.next };
}
function makeRequest(options: {
  actor?: SignedInLogin | null; headers?: HeadersInit; method?: string; origin?: string; shouldOmitOrigin?: boolean;
} = {}): Request {
  const actor = options.actor === undefined ? fixture.master : options.actor;
  const headers = new Headers({ origin: "https://hub.example.test", ...(actor ? { cookie: actor.cookie } : {}) });
  for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
  if (options.shouldOmitOrigin) headers.delete("origin");
  const method = options.method ?? "POST";
  return new Request((options.origin ?? "https://hub.example.test") + "/_serverFn/identifier-change",
    { method, headers, ...(method === "POST" ? { body: "{}" } : {}) });
}
async function submit(change: Change, data: unknown, options: Parameters<typeof makeRequest>[0] = {}): Promise<Response> {
  return await change.handle(data, { request: makeRequest(options), settings: fixture.signIn.settings });
}
function checkHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(requestId(response)).toMatch(/^[0-9a-f-]{36}$/);
}
function requestId(response: Response): string {
  const value = response.headers.get("x-request-id");
  if (!value) throw new Error("The identifier response must have its request ID.");
  return value;
}
async function failure(response: Response, expected: { status: number; code: string; message: string; fields?: string[] }): Promise<void> {
  const { status, code, message, fields } = expected;
  expect(response.status).toBe(status); checkHeaders(response);
  expect(await response.json()).toEqual({ code, message, requestId: requestId(response), ...(fields ? { fields } : {}) });
}
