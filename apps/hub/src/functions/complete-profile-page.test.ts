import { env } from "cloudflare:workers";
import { saveHub } from "@xpro/core/server";
import type { HubIdentities, SignedInLogin } from "#test/hub-identities";
import { createEnrolledMaster, createMfaFixture, type MfaFixture } from "#test/master-mfa";
import { unavailableManagementDatabase } from "#test/login-management";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleCompletionPage, validateCompletionPage } from "./complete-profile-page.server";

const origin = "https://hub.example.test";
let identities: HubIdentities;
let mfa: MfaFixture;
beforeEach(async () => { mfa = await createMfaFixture(env.DB); identities = mfa.identities; });
afterEach(async () => { await identities.db.destroy(); vi.restoreAllMocks(); });

describe("private profile-completion page data", () => {
  const combinations = [
    ["username"], ["name"], ["phone"], ["username", "name"], ["username", "phone"],
    ["name", "phone"], ["username", "name", "phone"],
  ] as const;
  it.each(combinations)("when a profile lacks %s then the page receives only those required field names", async (...fields) => {
    const login = await identities.signIn({
      ...(fields.includes("username") ? { username: null } : {}),
      ...(fields.includes("name") ? { name: " " } : {}),
      ...(fields.includes("phone") ? { phone: null } : {}),
    });
    const other = await identities.signIn();
    await identities.auth.api.createOrganization({ body: { name: "Other workspace", slug: "other-" + crypto.randomUUID(), userId: other.loginId } });
    const before = await readState();
    const response = await load(login);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fields });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readState()).toEqual(before);
  });

  it.each(["user", "admin"] as const)("when a complete %s opens completion then no profile form is required", async (role) => {
    const login = role === "admin" ? await createEnrolledMaster(mfa) : await identities.signIn();
    const before = await readState();
    expect(await (await load(login)).json()).toEqual({ fields: [] });
    expect(await readState()).toEqual(before);
  });

  it("when a browser requests page data through POST then the same cookie and Origin checks apply", async () => {
    const login = await identities.signIn({ phone: null });
    expect(await (await load(login, { method: "POST" })).json()).toEqual({ fields: ["phone"] });
  });

  it.each(["anonymous", "tampered", "ended"] as const)("when the cookie is %s then no field state is disclosed", async (fault) => {
    const login = await identities.signIn({ username: null });
    if (fault === "ended") await identities.auth.api.signOut({ headers: { cookie: login.cookie } });
    const before = await readState();
    const response = await load(fault === "anonymous" ? null : login, {
      ...(fault === "tampered" ? { cookie: login.cookie + "changed" } : {}),
      headers: { "x-login-id": login.loginId, "x-is-master": "true" },
    });
    await expectFailure(response, { status: 401, code: "core_unauthenticated" });
    expect(await readState()).toEqual(before);
  });

  it.each(["banned", "archivedAt"] as const)("when a signed-in login becomes %s then its page data is refused", async (field) => {
    const login = await identities.signIn({ username: null });
    await saveHub(env.DB, [identities.db.updateTable("user").set(field, field === "banned" ? 1 : new Date().toISOString())
      .where("id", "=", login.loginId).compile()]);
    const before = await readState();
    await expectFailure(await load(login), { status: 403, code: "core_login_inactive" });
    expect(await readState()).toEqual(before);
  });

  it("when creation is unfinished then completion page data cannot bypass its access gate", async () => {
    const login = await identities.signIn({ phone: null }), id = crypto.randomUUID();
    await saveHub(env.DB, [
      identities.db.insertInto("loginCreations").values({ id, creatorLoginId: login.loginId, createdLoginId: login.loginId,
        organizationId: null, kind: null, details: "{}", createdAt: new Date().toISOString(), completedAt: null }).compile(),
      identities.db.updateTable("user").set({ loginCreationId: id }).where("id", "=", login.loginId).compile(),
    ]);
    const before = await readState();
    await expectFailure(await load(login), { status: 403, code: "core_creation_incomplete" });
    expect(await readState()).toEqual(before);
  });

  it.each(["wrong page", "wrong URL", "PUT", "missing POST Origin", "foreign POST Origin"] as const)(
    "when a page read has %s then it is refused without changing data", async (fault) => {
      const login = await identities.signIn({ phone: null });
      const before = await readState();
      const response = await load(login, {
        ...(fault === "wrong page" ? { path: "/other" } : {}),
        ...(fault === "wrong URL" ? { baseURL: "https://foreign.example.test" } : {}),
        ...(fault === "PUT" ? { method: "PUT" } : {}),
        ...(fault === "missing POST Origin" ? { method: "POST", origin: null } : {}),
        ...(fault === "foreign POST Origin" ? { method: "POST", origin: "https://foreign.example.test" } : {}),
      });
      await expectFailure(response, { status: 403, code: "core_forbidden" });
      expect(await readState()).toEqual(before);
    },
  );

  it("when a caller supplies identity fields then strict input refuses them without exposing their values", async () => {
    const login = await identities.signIn({ name: "" });
    const before = await readState();
    const response = await load(login, { input: { loginId: "private-id", role: "admin" } });
    await expectFailure(response, { status: 400, code: "core_invalid_input" });
    expect(await readState()).toEqual(before);
  });

  it("when storage is unavailable then only a safe correlated failure is returned and logged", async () => {
    const login = await identities.signIn({ name: "" });
    const before = await readState(), log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await load(login, { database: unavailableManagementDatabase() });
    await expectFailure(response, { status: 500, code: "core_unexpected_error" });
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "accounts_completion_page" })]]);
    expect(await readState()).toEqual(before);
  });
});

async function load(login: SignedInLogin | null, options: {
  method?: string; path?: string; baseURL?: string; origin?: string | null; cookie?: string;
  headers?: Record<string, string>; input?: unknown; database?: D1Database;
} = {}): Promise<Response> {
  const method = options.method ?? "GET";
  const headers = new Headers({ ...(login ? { cookie: options.cookie ?? login.cookie } : {}), ...options.headers });
  if (method === "POST" && options.origin !== null) headers.set("origin", options.origin ?? origin);
  return await handleCompletionPage(validateCompletionPage(options.input ?? {}), {
    request: new Request((options.baseURL ?? origin) + (options.path ?? "/complete-profile"), { method, headers }),
    settings: { database: options.database ?? env.DB, baseURL: origin, secret: (await identities.auth.$context).secret },
  });
}

async function expectFailure(response: Response, expected: { status: number; code: string }): Promise<void> {
  expect(response.status).toBe(expected.status);
  expect(await response.json()).toEqual({ code: expected.code, message: expect.any(String),
    requestId: response.headers.get("x-request-id"), ...(expected.code === "core_invalid_input" ? { fields: [] } : {}) });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.getSetCookie()).toEqual([]);
}

async function readState() {
  return {
    users: await identities.db.selectFrom("user").selectAll().orderBy("id").execute(),
    accounts: await identities.db.selectFrom("account").selectAll().orderBy("id").execute(),
    sessions: await identities.db.selectFrom("session").selectAll().orderBy("id").execute(),
    members: await identities.db.selectFrom("member").selectAll().orderBy("id").execute(),
    audits: await identities.db.selectFrom("auditEntries").selectAll().orderBy("id").execute(),
  };
}
