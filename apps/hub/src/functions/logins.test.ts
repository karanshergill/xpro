import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManagementFixture, expectedLogin, findManagementUser, unavailableManagementDatabase } from "#test/login-management";
import { readResetState, type ResetFixture } from "#test/reset-password";
import type { SignedInLogin } from "#test/hub-identities";
import { handleListLogins, handleSearchLogins, handleGetLogin } from "./logins.server";

let fixture: ResetFixture;
beforeEach(async () => { fixture = await createManagementFixture(); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });
const reads = [
  { name: "list", handle: handleListLogins, input: () => ({ limit: 2 }) },
  { name: "search", handle: handleSearchLogins, input: () => ({ query: "Amber" }) },
  { name: "detail", handle: handleGetLogin, input: () => ({ loginId: fixture.target.loginId }) },
];
type Read = typeof reads[number];

describe.each(reads)("authenticated master $name HTTP", (read) => {
  it("when the actual master requests data then the response contains only the allowed DTO and changes no stored state", async () => {
    const before = await readResetState(fixture);
    const response = await submit(read, read.input(), { headers: { "x-request-id": "untrusted-id" } });
    expect(response.status).toBe(200); checkHeaders(response);
    expect(response.headers.get("x-request-id")).not.toBe("untrusted-id");
    const row = findManagementUser(before, fixture.target.loginId);
    const expected = read.name === "list" ? {
      logins: [...before.hub.users].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .slice(0, 2).map((item) => expectedLogin(item, "active")), nextOffset: 2,
    } : read.name === "search" ? { logins: [expectedLogin(row, "active")], nextOffset: null }
      : { ...expectedLogin(row, "active"), workspace: { workspaceId: fixture.workspace.id,
        name: before.hub.workspaces.find((workspace) => workspace.id === fixture.workspace.id)?.name } };
    expect(await response.json()).toEqual(expected);
    expect(await readResetState(fixture)).toEqual(before);
  });

  it.each(["anonymous", "tampered cookie", "ended session"] as const)(
    "when authentication is %s then header hints cannot grant data access", async (state) => {
      if (state === "ended session") await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: fixture.master.cookie } });
      const before = await readResetState(fixture);
      const response = await submit(read, read.input(), { actor: state === "anonymous" ? null : fixture.master,
        headers: { "x-login-id": fixture.master.loginId, "x-is-master": "true",
          ...(state === "tampered cookie" ? { cookie: fixture.master.cookie + "tampered" } : {}) } });
      await failure(response, 401, "core_unauthenticated", "Sign in to continue.");
      expect(await readResetState(fixture)).toEqual(before);
    },
  );

  it.each(["user", "owner", "admin"] as const)("when a non-master %s uses a real cookie then the response discloses no login data", async (role) => {
    const actor = role === "user" ? fixture.other : await fixture.signIn.identities.signIn();
    if (role !== "user") await fixture.signIn.identities.auth.api.addMember({ body: {
      userId: actor.loginId, organizationId: fixture.workspace.id, role,
    } });
    const before = await readResetState(fixture);
    await failure(await submit(read, read.input(), { actor, headers: { "x-login-id": fixture.master.loginId, "x-is-master": "true" } }),
      403, "core_forbidden", "You do not have permission to do this.");
    expect(await readResetState(fixture)).toEqual(before);
  });

  it.each(["GET", "foreign Origin", "missing Origin", "wrong URL"] as const)(
    "when a read uses %s then the exact-Origin POST boundary refuses it", async (state) => {
      const before = await readResetState(fixture);
      await failure(await submit(read, read.input(), {
        ...(state === "GET" ? { method: "GET" } : {}),
        ...(state === "foreign Origin" ? { headers: { origin: "https://foreign.invalid" } } : {}),
        ...(state === "missing Origin" ? { shouldOmitOrigin: true } : {}),
        ...(state === "wrong URL" ? { origin: "https://foreign.invalid" } : {}),
      }), 403, "core_forbidden", "You do not have permission to do this.");
      expect(await readResetState(fixture)).toEqual(before);
    },
  );

  it("when a body supplies private projection or authority fields then only safe field errors are returned", async () => {
    const before = await readResetState(fixture);
    await failure(await submit(read, { ...read.input(), actorLoginId: fixture.other.loginId, includePassword: true }),
      400, "core_invalid_input", "Check the submitted details.", []);
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the database is unavailable then one safe error is returned without native messages, tokens or false empty data", async () => {
    const before = await readResetState(fixture), log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = makeRequest();
    const response = await read.handle(read.input(), { request, settings: {
      ...fixture.signIn.settings, database: unavailableManagementDatabase(),
    } });
    await failure(response, 500, "core_unexpected_error", "Something went wrong. Please try again.");
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "core_hub_function_request" })]]);
    expect(await readResetState(fixture)).toEqual(before);
  });
});

describe("master read HTTP results", () => {
  it("when a known UUID is not a login then detail returns the named safe 404", async () => {
    const before = await readResetState(fixture);
    const response = await handleGetLogin({ loginId: crypto.randomUUID() }, { request: makeRequest(), settings: fixture.signIn.settings });
    await failure(response, 404, "stms_login_not_found", "This login could not be found.");
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when a search is blank then the safe response identifies the known field without echoing values", async () => {
    const before = await readResetState(fixture);
    const response = await handleSearchLogins({ query: "   " }, { request: makeRequest(), settings: fixture.signIn.settings });
    await failure(response, 400, "core_invalid_input", "Check the submitted details.", ["query"]);
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the master is demoted after an earlier successful read then the next HTTP request is forbidden", async () => {
    expect((await handleListLogins({}, { request: makeRequest(), settings: fixture.signIn.settings })).status).toBe(200);
    await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.master.loginId, { role: "user" });
    const before = await readResetState(fixture);
    await failure(await handleListLogins({}, { request: makeRequest(), settings: fixture.signIn.settings }),
      403, "core_forbidden", "You do not have permission to do this.");
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
  return new Request((options.origin ?? "https://hub.example.test") + "/_serverFn/master-read", {
    method, headers, ...(method === "POST" ? { body: "{}" } : {}),
  });
}

async function submit(read: Read, input: unknown, options: Parameters<typeof makeRequest>[0] = {}): Promise<Response> {
  return await read.handle(input, { request: makeRequest(options), settings: fixture.signIn.settings });
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
