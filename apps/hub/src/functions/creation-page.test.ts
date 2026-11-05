import { env } from "cloudflare:workers";
import { pageLoginIdHeader } from "@xpro/core";
import { saveHub } from "@xpro/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCreationFixture, creationInput, type CreationFixture } from "#test/create-login";
import type { SignedInLogin } from "#test/hub-identities";
import { unavailableManagementDatabase } from "#test/login-management";
import { hubOrigin, readHubState, readWorkspaceState, removeMembership } from "#test/sign-in";
import { handleCreationPage, validateCreationPage } from "./creation-page.server";
import { handleCreationWorkspaces, validateCreationWorkspaces } from "./creation-workspaces.server";

let fixture: CreationFixture;
beforeEach(async () => { fixture = await createCreationFixture(); });
afterEach(async () => { await fixture.signIn.identities.db.destroy(); vi.restoreAllMocks(); });

describe("Create-login screen data", () => {
  it.each(["master", "owner", "admin"] as const)("when a current %s opens creation then only their permitted scope is disclosed", async (role) => {
    const login = await fixture.actor(role), before = await state();
    for (const method of ["GET", "POST"]) {
      const response = await load(login, { method });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ creatorLoginId: login.loginId, scope: role === "master" ? { kind: "master" }
        : { kind: "workspace", workspace: { workspaceId: fixture.workspace.id, name: "Prepared workspace" } } });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(await state()).toEqual(before);
  });

  it.each(["anonymous", "member", "unassigned", "removed", "ended", "incomplete"] as const)(
    "when the opener is %s then no creation scope or workspace choices are disclosed", async (fault) => {
      const login = fault === "anonymous" ? null : await fixture.actor(fault === "member" ? "member" : "admin");
      if (login && (fault === "removed" || fault === "unassigned")) await removeMembership({
        identities: fixture.signIn.identities, loginId: login.loginId, workspaceId: fixture.workspace.id,
      });
      if (login && fault === "ended") await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: login.cookie } });
      if (login && fault === "incomplete") await saveHub(env.DB, [fixture.signIn.identities.db.updateTable("user")
        .set({ phone: null }).where("id", "=", login.loginId).compile()]);
      const before = await state();
      await expectFailure(await load(login), fault === "anonymous" || fault === "ended" ? 401 : 403,
        fault === "anonymous" || fault === "ended" ? "core_unauthenticated" : fault === "incomplete" ? "core_profile_incomplete" : "core_forbidden");
      await expectFailure(await choices(login), fault === "anonymous" || fault === "ended" ? 401 : 403,
        fault === "anonymous" || fault === "ended" ? "core_unauthenticated" : fault === "incomplete" ? "core_profile_incomplete" : "core_forbidden");
      expect(await state()).toEqual(before);
    });

  it("when a different login submits the first request from an open form then it is refused before any creation write", async () => {
    const opener = await fixture.actor("master"), current = await fixture.actor("master"), before = await state();
    await expectFailure(await load(current, { headers: { [pageLoginIdHeader]: opener.loginId } }), 409, "core_identity_changed");
    await expectFailure(await choices(current, { headers: { [pageLoginIdHeader]: opener.loginId } }), 409, "core_identity_changed");
    await expectFailure(await fixture.submit(creationInput(), { creator: current, headers: { [pageLoginIdHeader]: opener.loginId } }), 409, "core_identity_changed");
    expect(await state()).toEqual(before);
  });

  it("when the page actor matches then normal creation still completes once", async () => {
    const creator = await fixture.actor("owner"), input = creationInput(fixture.workspace);
    const otherBefore = await readWorkspaceState(fixture.other), before = await readHubState(fixture.signIn.identities);
    const response = await fixture.submit(input, { creator, headers: { [pageLoginIdHeader]: creator.loginId } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ creationId: input.creationId, loginId: expect.any(String) });
    const saved = await readHubState(fixture.signIn.identities);
    expect(saved.creations).toEqual([expect.objectContaining({ id: input.creationId, completedAt: expect.any(String) })]);
    expect(saved.audits).toEqual([...before.audits, expect.objectContaining({ action: "accounts_login_created" })]);
    expect(await readWorkspaceState(fixture.other)).toEqual(otherBefore);
  });

  it.each(["wrong page", "wrong URL", "PUT", "missing Origin", "foreign Origin"] as const)(
    "when the page read has %s then it is refused without touching data", async (fault) => {
      const login = await fixture.actor("master"), before = await state();
      await expectFailure(await load(login, {
        ...(fault === "wrong page" ? { path: "/other" } : {}),
        ...(fault === "wrong URL" ? { urlOrigin: "https://foreign.test" } : {}),
        ...(fault === "PUT" ? { method: "PUT" } : {}),
        ...(fault === "missing Origin" ? { method: "POST", origin: null } : {}),
        ...(fault === "foreign Origin" ? { method: "POST", origin: "https://foreign.test" } : {}),
      }), 403, "core_forbidden");
      expect(await state()).toEqual(before);
    });

  it("when identity or scope fields are supplied then strict page input refuses them", async () => {
    const login = await fixture.actor("master"), before = await state();
    await expectFailure(await load(login, { input: { loginId: "private-value", workspaceId: fixture.other.id, role: "admin" } }), 400, "core_invalid_input");
    expect(await state()).toEqual(before);
  });

  it("when page storage fails then the response and single log contain only a safe reference", async () => {
    const login = await fixture.actor("master"), before = await state(), log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await load(login, { database: unavailableManagementDatabase() });
    await expectFailure(response, 500, "core_unexpected_error");
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "accounts_creation_page" })]]);
    expect(await state()).toEqual(before);
  });

  it("when a tenant forges a master hint then global workspace choices remain forbidden", async () => {
    const login = await fixture.actor("owner"), before = await state();
    await expectFailure(await choices(login, { headers: { "x-is-master": "true", "x-workspace-id": fixture.other.id } }), 403, "core_forbidden");
    expect(await state()).toEqual(before);
  });

  it("when a master requests choices then only safe prepared workspace fields are returned", async () => {
    const login = await fixture.actor("master"), before = await state(), response = await choices(login);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspaces: [fixture.workspace, fixture.other]
      .sort((a, b) => b.placementId.localeCompare(a.placementId)).map((item) => ({
        workspaceId: item.id, name: "Prepared workspace", origin: item.origin,
      })), nextCursor: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await state()).toEqual(before);
  });

  it.each([{ cursor: "not-a-cursor" }, { cursor: crypto.randomUUID(), role: "admin" }])(
    "when workspace choice input is invalid ($cursor) then it is refused", async (input) => {
      const login = await fixture.actor("master"), before = await state();
      await expectFailure(await choices(login, { input }), 400, "core_invalid_input");
      expect(await state()).toEqual(before);
    });
});

async function load(login: SignedInLogin | null, options: {
  method?: string; path?: string; urlOrigin?: string; origin?: string | null; headers?: Record<string, string>; input?: unknown; database?: D1Database;
} = {}): Promise<Response> {
  const method = options.method ?? "GET", headers = new Headers({ ...(login ? { cookie: login.cookie } : {}), ...options.headers });
  if (method === "POST" && options.origin !== null) headers.set("origin", options.origin ?? hubOrigin);
  return await handleCreationPage(validateCreationPage(options.input ?? {}), {
    request: new Request((options.urlOrigin ?? hubOrigin) + (options.path ?? "/create-login"), { method, headers }),
    settings: { ...fixture.signIn.settings, database: options.database ?? env.DB },
  });
}
async function choices(login: SignedInLogin | null, options: { input?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
  return await handleCreationWorkspaces(validateCreationWorkspaces(options.input ?? {}), {
    request: new Request(hubOrigin + "/_server/creation-workspaces", { method: "POST",
      headers: { origin: hubOrigin, ...(login ? { cookie: login.cookie } : {}), ...options.headers } }),
    settings: fixture.signIn.settings,
  });
}
async function expectFailure(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ code, message: expect.any(String), requestId: response.headers.get("x-request-id"),
    ...(code === "core_invalid_input" ? { fields: expect.any(Array) } : code === "core_profile_incomplete" ? { fields: ["phone"] } : {}) });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.getSetCookie()).toEqual([]);
}
async function state() {
  return { hub: await readHubState(fixture.signIn.identities), workspace: await readWorkspaceState(fixture.workspace), other: await readWorkspaceState(fixture.other) };
}
