import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManagementFixture, prepareManagementServices, expectManagementSaved, suspendFixtureLogin, archiveFixtureLogin,
  unavailableManagementDatabase } from "#test/login-management";
import { readResetState, type ResetFixture } from "#test/reset-password";
import type { SignedInLogin } from "#test/hub-identities";
import { handleSuspendLogin, handleReactivateLogin, handleArchiveLogin, handleRestoreLogin } from "./login-status.server";

let fixture: ResetFixture;
beforeEach(async () => { fixture = await createManagementFixture(); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });
const writes = [
  { name: "suspend", handle: handleSuspendLogin, input: () => ({ loginId: fixture.target.loginId, reason: "stms_unpaid", confirmed: true }),
    action: "stms_login_suspended", userChanges: { banned: 1, banReason: "stms_unpaid", banExpires: null }, endsSessions: true },
  { name: "reactivate", handle: handleReactivateLogin, input: () => ({ loginId: fixture.target.loginId }),
    action: "stms_login_reactivated", userChanges: { banned: 0, banReason: null, banExpires: null }, endsSessions: false },
  { name: "archive", handle: handleArchiveLogin, input: () => ({ loginId: fixture.target.loginId, confirmed: true }),
    action: "stms_login_archived", userChanges: { archivedAt: expect.any(String), statusBeforeArchiving: "active" }, endsSessions: true },
  { name: "restore", handle: handleRestoreLogin, input: () => ({ loginId: fixture.target.loginId }),
    action: "stms_login_restored", userChanges: { archivedAt: null, statusBeforeArchiving: null }, endsSessions: false },
];
type Write = typeof writes[number];

describe.each(writes)("authenticated master $name HTTP", (write) => {
  beforeEach(async () => {
    if (write.name === "reactivate") await suspendFixtureLogin(fixture);
    if (write.name === "restore") await archiveFixtureLogin(fixture, { loginId: fixture.target.loginId, previousStatus: "active" });
  });

  it("when the real master submits the change then only the login ID returns and one audit identifies that master and fresh request", async () => {
    const before = await readResetState(fixture);
    const response = await submit(write, write.input(), { headers: { "x-request-id": "untrusted-id" } });
    checkHeaders(response); expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).not.toBe("untrusted-id");
    expect(await response.json()).toEqual({ loginId: fixture.target.loginId });
    const services = await prepareManagementServices({ actor: fixture.master });
    const requestId = response.headers.get("x-request-id");
    if (!requestId) throw new Error("The HTTP response must have a request ID.");
    services.context.requestId = requestId;
    await expectManagementSaved({ fixture, before, services, loginId: fixture.target.loginId,
      userChanges: write.userChanges,
      sessions: write.endsSessions ? before.hub.sessions.filter((row) => row.userId !== fixture.target.loginId) : before.hub.sessions,
      action: write.action,
      ...(write.name === "suspend" ? { reason: "stms_unpaid" } : {}) });
  });

  it.each(["anonymous", "tampered cookie", "ended session"] as const)(
    "when authentication is %s then header hints cannot authorize a global change", async (state) => {
      if (state === "ended session") await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: fixture.master.cookie } });
      const before = await readResetState(fixture);
      await failure(await submit(write, write.input(), { actor: state === "anonymous" ? null : fixture.master,
        headers: { "x-login-id": fixture.master.loginId, "x-is-master": "true",
          ...(state === "tampered cookie" ? { cookie: fixture.master.cookie + "tampered" } : {}) } }),
        401, "core_unauthenticated", "Sign in to continue.");
      expect(await readResetState(fixture)).toEqual(before);
    },
  );

  it.each(["user", "owner", "admin"] as const)(
    "when a tenant %s has a real cookie then their role cannot grant global authority", async (role) => {
      const actor = role === "user" ? fixture.other : await fixture.signIn.identities.signIn();
      if (role !== "user") await fixture.signIn.identities.auth.api.addMember({ body: {
        userId: actor.loginId, organizationId: fixture.workspace.id, role,
      } });
      const before = await readResetState(fixture);
      await failure(await submit(write, write.input(), { actor }), 403, "core_forbidden", "You do not have permission to do this.");
      expect(await readResetState(fixture)).toEqual(before);
    },
  );

  it.each(["GET", "foreign Origin", "missing Origin", "wrong URL"] as const)(
    "when the request has %s then it is refused before changing anything", async (state) => {
      const before = await readResetState(fixture);
      await failure(await submit(write, write.input(), {
        ...(state === "GET" ? { method: "GET" } : {}),
        ...(state === "foreign Origin" ? { headers: { origin: "https://foreign.invalid" } } : {}),
        ...(state === "missing Origin" ? { shouldOmitOrigin: true } : {}),
        ...(state === "wrong URL" ? { origin: "https://foreign.invalid" } : {}),
      }), 403, "core_forbidden", "You do not have permission to do this.");
      expect(await readResetState(fixture)).toEqual(before);
    },
  );

  it("when unknown authority fields are submitted then the safe validation response never echoes their names or values", async () => {
    const before = await readResetState(fixture);
    await failure(await submit(write, { ...write.input(), isMaster: true, actorLoginId: fixture.other.loginId }),
      400, "core_invalid_input", "Check the submitted details.", []);
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the target does not exist then the named 404 creates no orphan audit", async () => {
    const before = await readResetState(fixture);
    await failure(await submit(write, { ...write.input(), loginId: crypto.randomUUID() }),
      404, "stms_login_not_found", "This login could not be found.");
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the target cannot make this transition then a safe conflict changes nothing", async () => {
    expect((await submit(write, write.input())).status).toBe(200);
    const before = await readResetState(fixture);
    await failure(await submit(write, write.input()), 409, "stms_login_state_conflict", "This login's status has changed. Refresh and try again.");
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the database cannot be reached then only one safe error event is logged", async () => {
    const before = await readResetState(fixture), log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await write.handle(write.input(), { request: makeRequest(), settings: {
      ...fixture.signIn.settings, database: unavailableManagementDatabase(),
    } });
    await failure(response, 500, "core_unexpected_error", "Something went wrong. Please try again.");
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "core_hub_function_request" })]]);
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the atomic audit write fails then the HTTP error hides native details and every stored record is preserved", async () => {
    await sql`create trigger test_refuse_http_status before insert on audit_entries
      begin select raise(abort, 'private_status_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
    const before = await readResetState(fixture), log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await submit(write, write.input());
    await failure(response, 500, "core_unexpected_error", "Something went wrong. Please try again.");
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "stms_" + write.name + "_login" })]]);
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the master is demoted then the next HTTP request cannot save", async () => {
    await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.master.loginId, { role: "user" });
    const before = await readResetState(fixture);
    await failure(await submit(write, write.input()), 403, "core_forbidden", "You do not have permission to do this.");
    expect(await readResetState(fixture)).toEqual(before);
  });
});

describe("login status HTTP field rules", () => {
  it("when the master tries self-suspension then the named refusal leaves every session active", async () => {
    const before = await readResetState(fixture);
    await failure(await handleSuspendLogin({ loginId: fixture.master.loginId, reason: "stms_unpaid", confirmed: true },
      { request: makeRequest(), settings: fixture.signIn.settings }),
      403, "stms_self_suspend_forbidden", "You cannot suspend your own login.");
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the master tries self-archiving then every record and acting session remains", async () => {
    const before = await readResetState(fixture);
    await failure(await handleArchiveLogin({ loginId: fixture.master.loginId, confirmed: true },
      { request: makeRequest(), settings: fixture.signIn.settings }),
      403, "stms_self_archive_forbidden", "You cannot archive your own login.");
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when Other has a blank comment then only the known comment field is returned", async () => {
    const before = await readResetState(fixture);
    await failure(await handleSuspendLogin({ loginId: fixture.target.loginId, reason: "stms_other", confirmed: true, comment: "  " },
      { request: makeRequest(), settings: fixture.signIn.settings }),
      400, "core_invalid_input", "Check the submitted details.", ["comment"]);
    expect(await readResetState(fixture)).toEqual(before);
  });
});

function makeRequest(options: {
  actor?: SignedInLogin | null; headers?: HeadersInit; method?: string; origin?: string; shouldOmitOrigin?: boolean;
} = {}): Request {
  const actor = options.actor === undefined ? fixture.master : options.actor;
  const headers = new Headers({ origin: "https://hub.example.test", ...(actor ? { cookie: actor.cookie } : {}) });
  for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
  if (options.shouldOmitOrigin) headers.delete("origin");
  const method = options.method ?? "POST";
  return new Request((options.origin ?? "https://hub.example.test") + "/_serverFn/status-change",
    { method, headers, ...(method === "POST" ? { body: "{}" } : {}) });
}
async function submit(write: Write, input: unknown, options: Parameters<typeof makeRequest>[0] = {}): Promise<Response> {
  return await write.handle(input, { request: makeRequest(options), settings: fixture.signIn.settings });
}
function checkHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
}
async function failure(response: Response, status: number, code: string, message: string, fields?: string[]): Promise<void> {
  expect(response.status).toBe(status); checkHeaders(response);
  expect(await response.json()).toEqual({ code, message, requestId: response.headers.get("x-request-id"), ...(fields ? { fields } : {}) });
}
