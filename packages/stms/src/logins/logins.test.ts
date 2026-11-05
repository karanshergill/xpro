import { ok } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManagementFixture, prepareManagementServices, expectedLogin, expectManagementRefusal,
  expectManagementFailure, findManagementUser, suspendFixtureLogin, archiveFixtureLogin, unavailableManagementDatabase,
  type ManagementAction, type LoginPage, type LoginDetails } from "#test/login-management";
import { readResetState, type ResetFixture } from "#test/reset-password";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { listLogins as list, searchLogins as search, getLogin as get } from "./logins.server";

// T036 supplies the real actions; these signatures are contracts, not substitutes.
const listLogins: ManagementAction<LoginPage> = list;
const searchLogins: ManagementAction<LoginPage> = search;
const getLogin: ManagementAction<LoginDetails> = get;
let fixture: ResetFixture;
beforeEach(async () => { fixture = await createManagementFixture(); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe("Story 5 — master login list and details", () => {
  it("when the master opens the list then every active and suspended login has the required fields and archived logins stay hidden", async () => {
    await suspendFixtureLogin(fixture);
    await archiveFixtureLogin(fixture, { loginId: fixture.other.loginId, previousStatus: "active" });
    const incomplete = await fixture.signIn.identities.createLogin({ username: null, phone: null });
    const before = await readResetState(fixture);
    const expected = [...before.hub.users].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .filter((row) => row.id !== fixture.other.loginId)
      .map((row) => expectedLogin(row, row.id === fixture.target.loginId ? "suspended" : "active"));
    expect(expected.find((row) => row.loginId === incomplete.loginId)).toMatchObject({ username: null, phone: null });
    expect((await listLogins({}, await prepareManagementServices({ actor: fixture.master }))).toJSON())
      .toEqual(ok({ logins: expected, nextOffset: null }).toJSON());
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the unchanged list is paged then pages are bounded and deterministic with no duplicated or omitted login", async () => {
    const before = await readResetState(fixture);
    const expected = [...before.hub.users].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map((row) => expectedLogin(row, "active"));
    for (let offset = 0; offset < expected.length + 2; offset += 2) {
      const result = await listLogins({ limit: 2, offset }, await prepareManagementServices({ actor: fixture.master }));
      expect(result.toJSON()).toEqual(ok({ logins: expected.slice(offset, offset + 2),
        nextOffset: offset + 2 < expected.length ? offset + 2 : null }).toJSON());
    }
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when the default list has more than 25 rows then it returns only the first bounded page", async () => {
    for (let index = 0; index < 20; index++) {
      await fixture.signIn.identities.auth.api.createUser({ body: {
        email: "page-" + crypto.randomUUID() + "@example.test", name: "Page fixture", role: "user",
      } });
    }
    const before = await readResetState(fixture);
    const expected = [...before.hub.users].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, 25).map((row) => expectedLogin(row, "active"));
    expect(before.hub.users.length).toBeGreaterThan(25);
    expect((await listLogins({}, await prepareManagementServices({ actor: fixture.master }))).toJSON())
      .toEqual(ok({ logins: expected, nextOffset: 25 }).toJSON());
    expect(await readResetState(fixture)).toEqual(before);
  });

  it.each(["name", "email", "username"] as const)(
    "when the master searches by %s then matching logins are shown without returning private fields", async (field) => {
      const before = await readResetState(fixture), row = findManagementUser(before, fixture.target.loginId);
      const value = field === "name" ? "aMbEr" : field === "email" ? row.email.split("@")[0]?.toUpperCase() : row.username?.slice(0, 1).toUpperCase();
      if (!value) throw new Error("The prepared searchable field must exist.");
      const expected = field === "username"
        ? [...before.hub.users].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).map((item) => expectedLogin(item, "active"))
        : [expectedLogin(row, "active")];
      const result = await searchLogins({ query: "  " + value + "  " }, await prepareManagementServices({ actor: fixture.master }));
      expect(result.toJSON()).toEqual(ok({ logins: expected, nextOffset: null }).toJSON());
      expect(await readResetState(fixture)).toEqual(before);
    },
  );

  it.each(["%", "_", "' OR 1=1 --"])("when the query contains %s then it is literal data rather than a wildcard or SQL", async (query) => {
    if (query !== "' OR 1=1 --") await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(
      fixture.target.loginId, { name: query + " Unique machinist" });
    const before = await readResetState(fixture);
    const expected = query === "' OR 1=1 --" ? [] : [expectedLogin(findManagementUser(before, fixture.target.loginId), "active")];
    expect((await searchLogins({ query }, await prepareManagementServices({ actor: fixture.master }))).toJSON())
      .toEqual(ok({ logins: expected, nextOffset: null }).toJSON());
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when a matching login is archived then normal search still hides it", async () => {
    await archiveFixtureLogin(fixture, { loginId: fixture.target.loginId, previousStatus: "active" });
    const before = await readResetState(fixture);
    expect((await searchLogins({ query: "Amber" }, await prepareManagementServices({ actor: fixture.master }))).toJSON())
      .toEqual(ok({ logins: [], nextOffset: null }).toJSON());
    expect(await readResetState(fixture)).toEqual(before);
  });

  it.each(["member", "unassigned", "archived"] as const)("when a master opens a %s login then detail includes only the allowed fields and its real workspace", async (kind) => {
    const loginId = kind === "unassigned" ? fixture.master.loginId : fixture.target.loginId;
    if (kind === "archived") await archiveFixtureLogin(fixture, { loginId, previousStatus: "active" });
    const before = await readResetState(fixture), row = findManagementUser(before, loginId);
    const workspace = before.hub.workspaces.find((item) => item.id === fixture.workspace.id);
    if (!workspace) throw new Error("The real workspace must exist.");
    expect((await getLogin({ loginId }, await prepareManagementServices({ actor: fixture.master }))).toJSON()).toEqual(ok({
      ...expectedLogin(row, kind === "archived" ? "archived" : "active"),
      workspace: kind === "unassigned" ? null : { workspaceId: workspace.id, name: workspace.name },
    }).toJSON());
    expect(await readResetState(fixture)).toEqual(before);
  });

  it.each([
    { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: "2" }, { offset: -1 }, { offset: 0.5 }, { offset: "1" },
  ])("when pagination is invalid (%j) then it returns safe field names", async (submitted) => {
    const fields = Object.keys(submitted);
    await expectManagementRefusal({ fixture, action: listLogins, submitted, actor: fixture.master,
      error: { code: "core_invalid_input", fields } });
  });

  it.each(["", "   ", "x".repeat(201), null, 7])("when the search text is invalid (%s) then the request changes nothing", async (query) => {
    await expectManagementRefusal({ fixture, action: searchLogins, submitted: { query }, actor: fixture.master,
      error: { code: "core_invalid_input", fields: ["query"] } });
  });

  it("when the target does not exist then detail returns the named not-found result", async () => {
    await expectManagementRefusal({ fixture, action: getLogin, submitted: { loginId: crypto.randomUUID() }, actor: fixture.master,
      error: { code: "stms_login_not_found" } });
  });

  it.each([{ limit: 101 }, { offset: -1 }])("when search pagination is invalid (%j) then its own boundary refuses it", async (pagination) => {
    await expectManagementRefusal({ fixture, action: searchLogins, submitted: { query: "Amber", ...pagination }, actor: fixture.master,
      error: { code: "core_invalid_input", fields: Object.keys(pagination) } });
  });

  it("when a detail ID is malformed then its value never appears in the field error", async () => {
    await expectManagementRefusal({ fixture, action: getLogin, submitted: { loginId: "private-target" }, actor: fixture.master,
      error: { code: "core_invalid_input", fields: ["loginId"] } });
  });
});

const reads: { name: string; action: ManagementAction<LoginPage | LoginDetails>; submitted(): Record<string, unknown> }[] = [
  { name: "list", action: listLogins, submitted: () => ({}) },
  { name: "search", action: searchLogins, submitted: () => ({ query: "Amber" }) },
  { name: "detail", action: getLogin, submitted: () => ({ loginId: fixture.target.loginId }) },
];
describe.each(reads)("master-only $name", ({ name, action, submitted }) => {
  it.each(["user", "owner", "admin", "member"] as const)("when a non-master %s requests this read then no records are disclosed or changed", async (role) => {
    const actor = role === "user" ? fixture.other : await fixture.signIn.identities.signIn();
    if (role !== "user") await fixture.signIn.identities.auth.api.addMember({ body: {
      userId: actor.loginId, organizationId: fixture.workspace.id, role,
    } });
    await expectManagementRefusal({ fixture, action, submitted: submitted(), actor, error: { code: "core_forbidden" } });
  });

  it("when the caller is anonymous then there is no result or write", async () => {
    await expectManagementRefusal({ fixture, action, submitted: submitted(), actor: null, error: { code: "core_unauthenticated" } });
  });

  it("when an otherwise valid read contains forged authority or unknown query fields then strict input refuses it", async () => {
    await expectManagementRefusal({ fixture, action, submitted: { ...submitted(), actorLoginId: fixture.other.loginId, isMaster: true },
      actor: fixture.master, error: { code: "core_invalid_input", fields: [] } });
  });

  it("when the database read fails then it cannot masquerade as an empty list and it logs only a safe request event", async () => {
    await expectManagementFailure({ fixture, action, operation: name === "detail" ? "stms_get_login" : "stms_" + name + "_logins", submitted: submitted(), database: unavailableManagementDatabase() });
  });
});

describe("current global authority and disabled read routes", () => {
  it("when a master is demoted between requests then the next list request is forbidden", async () => {
    expect((await listLogins({}, await prepareManagementServices({ actor: fixture.master }))).isOk).toBe(true);
    await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.master.loginId, { role: "user" });
    await expectManagementRefusal({ fixture, action: listLogins, submitted: {}, actor: fixture.master, error: { code: "core_forbidden" } });
  });

  it.each(["/admin/list-users", "/admin/get-user"] as const)("when a master directly requests native %s then it cannot bypass the xpro read boundary", async (path) => {
    const before = await readResetState(fixture);
    const response = await handleHubAuthRequest(new Request("https://hub.example.test/api/auth" + path + "?id=" + fixture.target.loginId,
      { headers: { cookie: fixture.master.cookie } }), fixture.signIn.settings);
    expect(response.status).toBe(404);
    expect(await readResetState(fixture)).toEqual(before);
  });
});
