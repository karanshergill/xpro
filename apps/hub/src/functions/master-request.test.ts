import { env } from "cloudflare:workers";
import { pageLoginIdHeader } from "@xpro/core";
import { saveHub } from "@xpro/core/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createManagementFixture } from "#test/login-management";
import { readResetState, type ResetFixture } from "#test/reset-password";
import { handleListLogins, handleSearchLogins, handleGetLogin } from "./logins.server";
import { handleSuspendLogin, handleReactivateLogin, handleArchiveLogin, handleRestoreLogin } from "./login-status.server";
import { handleChangeEmail, handleChangeUsername } from "./login-identifiers.server";
import { handleResetPassword } from "./reset-password.server";

const origin = "https://hub.example.test";
let fixture: ResetFixture;
beforeEach(async () => { fixture = await createManagementFixture(); });
afterEach(async () => { await fixture.signIn.identities.db.destroy(); });
const reads = [
  { name: "list", handle: handleListLogins, input: (): unknown => ({}), path: (): string => "/stms/logins" },
  { name: "search", handle: handleSearchLogins, input: (): unknown => ({ query: "Amber" }), path: (): string => "/stms/logins/" },
  { name: "detail", handle: handleGetLogin, input: (): unknown => ({ loginId: fixture.target.loginId }), path: (): string => "/stms/logins/" + fixture.target.loginId },
  { name: "account holder choices", handle: handleListLogins, input: (): unknown => ({}), path: (): string => "/stms/accounts/new" },
];

describe.each(reads)("Master $name page reader", (action) => {
  it.each(["GET", "POST"])("when a master reads using %s then the actual page actor is exposed without writes or native session data", async (method) => {
    const before = await readResetState(fixture);
    const response = await action.handle(action.input(), services(request(action.path(), { method })));
    expect(response.status).toBe(200); expect(response.headers.get(pageLoginIdHeader)).toBe(fixture.master.loginId);
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.text(); expect(body).not.toContain("session_token"); expect(body).not.toContain("password"); expect(body).not.toContain("pictureKey");
    expect(await readResetState(fixture)).toEqual(before);
  });

  it.each(["anonymous", "tenant", "ended session", "inactive", "incomplete profile"])("when an SSR reader is called by %s then no actor or login data is disclosed", async (state) => {
    if (state === "ended session") await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: fixture.master.cookie } });
    if (state === "inactive" || state === "incomplete profile") await saveHub(env.DB, [fixture.signIn.identities.db.updateTable("user")
      .set(state === "inactive" ? { banned: 1 } : { phone: null }).where("id", "=", fixture.master.loginId).compile()]);
    const before = await readResetState(fixture);
    const response = await action.handle(action.input(), services(request(action.path(), { headers: {
      cookie: state === "anonymous" ? "" : state === "tenant" ? fixture.target.cookie : fixture.master.cookie,
      [pageLoginIdHeader]: fixture.master.loginId, "x-is-master": "true",
    } })));
    await expectFailure(response, state === "anonymous" || state === "ended session" ? "core_unauthenticated" : state === "tenant" ? "core_forbidden"
      : state === "inactive" ? "core_login_inactive" : "core_profile_incomplete");
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when a page belongs to a different master identity then readback cannot replace its draft with another actor's result", async () => {
    const response = await action.handle(action.input(), services(request(action.path(), { headers: { [pageLoginIdHeader]: fixture.target.loginId } })));
    await expectFailure(response, "core_identity_changed");
  });
});

describe("STMS SSR read boundary", () => {
  it.each(["/profile", "/_serverFn/list", "/stms", "/stms/logins/not-an-id", "/stms/logins/extra/path", "/stms/accounts/new/extra", "/stms/accounts/not-an-id", "/stms/accounts/newer", "/stms/accounts//new", "/stms/accounts/------------------------------------", "/stms/accounts/%6eew", "/stms/workspaces"])("when a GET is for %s then the SSR exception cannot be used from that path", async (path) => {
    await expectFailure(await handleListLogins({}, services(request(path))), "core_forbidden");
  });
  it.each(["HEAD", "PUT", "DELETE"])("when the method is %s then no page read is allowed", async (method) => {
    await expectFailure(await handleListLogins({}, services(request("/stms/logins", { method }))), "core_forbidden");
  });
  it.each(["missing Origin", "foreign Origin", "foreign URL"])("when POST uses %s then the existing exact-origin gate remains effective", async (state) => {
    await expectFailure(await handleListLogins({}, services(request("/_serverFn/read", { method: "POST",
      ...(state === "foreign URL" ? { base: "https://foreign.test" } : {}), headers: { origin: state === "missing Origin" ? "" : state === "foreign Origin" ? "https://foreign.test" : origin } }))), "core_forbidden");
  });
});

describe("Original master page identity", () => {
  const actions = [
    { name: "suspend", handle: handleSuspendLogin, input: (): unknown => ({ loginId: fixture.target.loginId, reason: "stms_unpaid", confirmed: true }) },
    { name: "reactivate", handle: handleReactivateLogin, input: (): unknown => ({ loginId: fixture.target.loginId }) },
    { name: "archive", handle: handleArchiveLogin, input: (): unknown => ({ loginId: fixture.target.loginId, confirmed: true }) },
    { name: "restore", handle: handleRestoreLogin, input: (): unknown => ({ loginId: fixture.target.loginId }) },
    { name: "email", handle: handleChangeEmail, input: (): unknown => ({ loginId: fixture.target.loginId, email: "changed-" + crypto.randomUUID() + "@example.test" }) },
    { name: "username", handle: handleChangeUsername, input: (): unknown => ({ loginId: fixture.target.loginId, username: "newuser" }) },
    { name: "password", handle: handleResetPassword, input: (): unknown => ({ loginId: fixture.target.loginId, newPassword: "Changed-password123!" }) },
  ];
  it.each(actions)("when the page actor differs then $name cannot change any record", async (action) => {
    const before = await readResetState(fixture);
    await expectFailure(await action.handle(action.input(), services(request("/_serverFn/action", { method: "POST", headers: { [pageLoginIdHeader]: fixture.other.loginId } }))), "core_identity_changed");
    expect(await readResetState(fixture)).toEqual(before);
  });
});

function request(path: string, options: { method?: string; headers?: HeadersInit; base?: string } = {}): Request {
  const headers = new Headers({ cookie: fixture.master.cookie, origin });
  for (const [key, value] of new Headers(options.headers)) headers.set(key, value);
  return new Request((options.base ?? origin) + path, { method: options.method ?? "GET", headers });
}
function services(request: Request): { request: Request; settings: ResetFixture["signIn"]["settings"] } { return { request, settings: fixture.signIn.settings }; }
async function expectFailure(response: Response, code: string): Promise<void> {
  expect(response.ok).toBe(false); expect(response.headers.get(pageLoginIdHeader)).toBeNull(); expect(response.headers.get("set-cookie")).toBeNull();
  const body = await response.json(); expect(body).toMatchObject({ code, requestId: response.headers.get("x-request-id") });
  expect(Object.keys(body as object).sort()).toEqual(["code", "message", "requestId", ...(code === "core_profile_incomplete" ? ["fields"] : [])].sort());
}

const accountPagePaths = ["/stms/accounts", "/stms/accounts/", "/stms/accounts/new", "/stms/accounts/new/",
  "/stms/accounts/01234567-89ab-7def-8123-456789abcdef", "/stms/accounts/01234567-89AB-7DEF-8123-456789ABCDEF/"];
describe.each(accountPagePaths)("Account SSR read at %s", (path) => {
  it("when the native master reads the directory then real holder data and the original page actor are returned without writes", async () => {
    const before = await readResetState(fixture);
    const response = await handleListLogins({}, services(request(path, { headers: { [pageLoginIdHeader]: fixture.master.loginId } })));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ logins: expect.arrayContaining([expect.objectContaining({ loginId: fixture.target.loginId })]) });
    expect(response.headers.get(pageLoginIdHeader)).toBe(fixture.master.loginId);
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("set-cookie")).toBeNull();
    expect(await readResetState(fixture)).toEqual(before);
  });
});
