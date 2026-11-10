import { env } from "cloudflare:workers";
import { pageLoginIdHeader } from "@xpro/core";
import { saveHub } from "@xpro/core/server";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beforeAccountRead, createAccountFixture, holdAccountBatch, loseAccountBatchReply, readAccountState, seedAccount, seedRetainedNamelessAccount } from "#test/account-management";
import type { AccountFixture } from "#test/account-management";
import { interruptAfterWrite } from "#test/creation-faults.db";
import type { SignedInLogin } from "#test/hub-identities";
import { createEnrolledMaster } from "#test/master-mfa";
import { handleGetManagementOperation } from "./management-operations.server";
import { handleListAccounts, handleSearchAccounts, handleGetAccount, handleCreateAccount, handleRenameAccount } from "./accounts.server";

type Handler = typeof handleListAccounts;
type Options = { actor?: SignedInLogin | null; headers?: HeadersInit; method?: string; path?: string; base?: string; omitOrigin?: boolean };
let fixture: AccountFixture;
beforeEach(async () => { fixture = await createAccountFixture(env.DB); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.identities.db.destroy(); });

describe("native account HTTP journey", () => {
  it("creates, pages, searches, inspects and renames one real account using only allowlisted DTOs and immutable minimal receipts", async () => {
    const input = creation(), before = await state();
    const created = await submit({ handler: handleCreateAccount, input, options: { headers: { [pageLoginIdHeader]: fixture.master.loginId, "x-request-id": "untrusted-diagnostic" } } });
    expect(created.status).toBe(200); checkHeaders(created);
    expect(created.headers.get("x-request-id")).not.toBe("untrusted-diagnostic");
    const receipt: { action: string; accountId: string } = await created.json();
    expect(receipt).toEqual({ action: "stms_account_created", accountId: expect.stringMatching(/^[a-f\d-]{36}$/i) });
    const saved = await state(), account = saved.hub.accounts.find((row) => row.id === receipt.accountId);
    if (!account) throw new Error("The HTTP command must have created a real native account.");
    const audit = saved.hub.audits.find((row) => row.id === input.operationId);
    if (!audit) throw new Error("The HTTP account creation must have its atomic audit.");
    expect(saved).toEqual({ ...before, hub: { ...before.hub, accounts: sorted([...before.hub.accounts, account]), audits: sorted([...before.hub.audits, audit]) } });
    const owner = saved.hub.users.find((row) => row.id === input.holderLoginId);
    if (!owner) throw new Error("The saved holder fixture must exist.");
    const summary = { accountId: account.id, name: "HTTP account", holder: { loginId: owner.id, name: owner.name, username: owner.username, email: owner.email },
      status: "stms_active", revision: 0, createdAt: account.createdAt };
    const listed = await submit({ handler: handleListAccounts, input: { limit: 1 } });
    expect(listed.status).toBe(200); checkHeaders(listed, fixture.master.loginId);
    const ordered = [...saved.hub.accounts].sort((a, b) => a.createdAt === b.createdAt ? a.id < b.id ? 1 : -1 : a.createdAt < b.createdAt ? 1 : -1);
    const first: { accounts: { accountId: string }[]; nextOffset: number | null } = await listed.json();
    expect(first.accounts.map((row) => row.accountId)).toEqual([ordered[0]?.id]); expect(first.nextOffset).toBe(1);
    const found = await submit({ handler: handleSearchAccounts, input: { query: "  HTTP ", limit: 25 } });
    expect(found.status).toBe(200); checkHeaders(found, fixture.master.loginId);
    expect(await found.json()).toEqual({ accounts: [summary], nextOffset: null });
    const detail = await submit({ handler: handleGetAccount, input: { accountId: account.id } });
    expect(detail.status).toBe(200); checkHeaders(detail, fixture.master.loginId);
    expect(await detail.json()).toEqual({ ...summary, updatedAt: account.updatedAt, workspace: null });
    expect(await state()).toEqual(saved);
    const rename = { operationId: crypto.randomUUID(), accountId: account.id, expectedRevision: 0, name: "  Renamed HTTP account  " };
    const changed = await submit({ handler: handleRenameAccount, input: rename });
    expect(changed.status).toBe(200); checkHeaders(changed);
    expect(await changed.json()).toEqual({ action: "stms_account_renamed", accountId: account.id });
    const after = await state(), renameAudit = after.hub.audits.find((row) => row.id === rename.operationId);
    if (!renameAudit) throw new Error("The HTTP rename must have an immutable audit.");
    expect(after).toEqual({ ...saved, hub: { ...saved.hub,
      accounts: saved.hub.accounts.map((row) => row.id === account.id ? { ...row, name: "Renamed HTTP account", nameSearch: "renamed http account",
        revision: 1, updatedAt: expect.any(String) } : row), audits: sorted([...saved.hub.audits, renameAudit]) } });
    const oldPrefix = await submit({ handler: handleSearchAccounts, input: { query: "http" } });
    expect(await oldPrefix.json()).toEqual({ accounts: [], nextOffset: null });
    const newPrefix = await submit({ handler: handleSearchAccounts, input: { query: "renamed http" } });
    expect((await newPrefix.json() as { accounts: { accountId: string }[] }).accounts.map((row) => row.accountId)).toEqual([account.id]);
    expect(await state()).toEqual(after);
  });

  it("keeps retained null labels null and returns only the existing workspace identity/name link", async () => {
    const retained = await seedRetainedNamelessAccount(fixture, env.DB), before = await state();
    const legacy = await submit({ handler: handleGetAccount, input: { accountId: retained.accountId } });
    expect(legacy.status).toBe(200); checkHeaders(legacy, fixture.master.loginId);
    expect(await legacy.json()).toMatchObject({ accountId: retained.accountId, name: null, workspace: null });
    const detail = await submit({ handler: handleGetAccount, input: { accountId: fixture.target.accountId } });
    const account = before.hub.accounts.find((row) => row.id === fixture.target.accountId);
    if (!account) throw new Error("The target account fixture must exist.");
    const owner = before.hub.users.find((row) => row.id === account.ownerLoginId);
    if (!owner) throw new Error("The target holder fixture must exist.");
    expect(await detail.json()).toEqual({ accountId: account.id, name: account.name, status: account.status, revision: account.revision,
      createdAt: account.createdAt, updatedAt: account.updatedAt, holder: { loginId: owner.id, name: owner.name, username: owner.username, email: owner.email },
      workspace: { workspaceId: fixture.target.workspaceId, name: "Preserved native workspace" } });
    expect(await state()).toEqual(before);
  });

  it("maps absent accounts, unavailable holders and stale revisions to safe typed 404/409 responses", async () => {
    const before = await state();
    await failure({ response: await submit({ handler: handleGetAccount, input: { accountId: crypto.randomUUID() } }), status: 404, code: "stms_account_not_found" });
    await failure({ response: await submit({ handler: handleRenameAccount, input: rename({ accountId: crypto.randomUUID() }) }), status: 404, code: "stms_account_not_found" });
    await failure({ response: await submit({ handler: handleCreateAccount, input: creation({ holderLoginId: fixture.target.ownerLoginId }) }), status: 409, code: "stms_account_holder_unavailable" });
    await failure({ response: await submit({ handler: handleRenameAccount, input: rename({ expectedRevision: 1 }) }), status: 409, code: "stms_operation_conflict" });
    expect(await state()).toEqual(before);
  });

  it("rejects undeclared authority/private fields and malformed IDs, names, paging, search and revisions without echoing input", async () => {
    const before = await state();
    const cases: { handler: Handler; input: unknown; fields: string[] }[] = [
      { handler: handleListAccounts, input: { limit: 101 }, fields: ["limit"] },
      { handler: handleListAccounts, input: { offset: -1 }, fields: ["offset"] },
      { handler: handleListAccounts, input: { accountId: fixture.target.accountId }, fields: [] },
      { handler: handleSearchAccounts, input: { query: " " }, fields: ["query"] },
      { handler: handleSearchAccounts, input: { query: "x".repeat(201) }, fields: ["query"] },
      { handler: handleGetAccount, input: { accountId: "invalid" }, fields: ["accountId"] },
      { handler: handleCreateAccount, input: { ...creation(), name: " \t\u00a0" }, fields: ["name"] },
      { handler: handleCreateAccount, input: { ...creation(), holderLoginId: "invalid" }, fields: ["holderLoginId"] },
      { handler: handleCreateAccount, input: { ...creation(), expectedRevision: 0 }, fields: [] },
      { handler: handleRenameAccount, input: { ...rename(), expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, fields: ["expectedRevision"] },
      { handler: handleRenameAccount, input: { ...rename(), name: " " }, fields: ["name"] },
      ...endpoints().map(({ handler, input }) => ({ handler, input: { ...input, loginId: fixture.master.loginId,
        isMaster: true, clientSecret: "private_http_marker" }, fields: [] })),
    ];
    for (const item of cases) {
      const text = await failure({ response: await submit({ handler: item.handler, input: item.input }), status: 400, code: "core_invalid_input", fields: item.fields });
      expect(text).not.toContain("private_http_marker");
    }
    expect(await state()).toEqual(before);
  });

  it("requires exact-Origin POST for public RPC and never turns a read-page GET exception into a mutation exception", async () => {
    const before = await state();
    for (const { handler, input } of endpoints()) {
      for (const options of [{ omitOrigin: true }, { headers: { origin: "https://foreign.invalid" } },
        { base: "https://foreign.invalid" }, { method: "GET", path: "/_serverFn/accounts" }] satisfies Options[]) {
        await failure({ response: await submit({ handler, input, options }), status: 403, code: "core_forbidden" });
      }
    }
    for (const handler of [handleCreateAccount, handleRenameAccount]) {
      await failure({ response: await submit({ handler, input: handler === handleCreateAccount ? creation() : rename(), options: { method: "GET", path: "/stms/accounts" } }), status: 403, code: "core_forbidden" });
    }
    expect(await state()).toEqual(before);
  });

  it("allows native authorized account-page SSR reads while keeping exact unrelated paths forbidden", async () => {
    const before = await state();
    for (const path of ["/stms/accounts", `/stms/accounts/${fixture.target.accountId}`, "/stms/accounts/new"]) {
      const response = await submit({ handler: handleListAccounts, input: {}, options: { method: "GET", path } });
      expect(response.status).toBe(200); checkHeaders(response, fixture.master.loginId);
    }
    for (const path of ["/stms/accounts-extra", "/stms/accounts/new/extra", "/stms/accounts/not-a-uuid", "/account"]) {
      await failure({ response: await submit({ handler: handleListAccounts, input: {}, options: { method: "GET", path } }), status: 403, code: "core_forbidden" });
    }
    expect(await state()).toEqual(before);
  });
});

describe("native account HTTP authority", () => {
  it("denies anonymous callers, actual account holders and native tenant admins despite forged authority headers", async () => {
    await seedAccount(fixture, { ownerLoginId: fixture.holder.loginId });
    const holder = fixture.holder;
    const tenantAdmin = await fixture.identities.signIn();
    if (!fixture.target.workspaceId) throw new Error("The native tenant fixture must exist.");
    await fixture.identities.auth.api.addMember({ body: { userId: tenantAdmin.loginId, organizationId: fixture.target.workspaceId, role: "admin" } });
    const before = await state();
    for (const actor of [null, holder, tenantAdmin]) for (const { handler, input } of endpoints()) {
      await failure({ response: await submit({ handler, input, options: { actor, headers: { "x-login-id": fixture.master.loginId, "x-is-master": "true" } } }), status: actor ? 403 : 401, code: actor ? "core_forbidden" : "core_unauthenticated" });
    }
    expect(await state()).toEqual(before);
  });

  it.each(["expired", "ended", "revision", "role", "mfa", "profile", "suspended", "archived"] as const)(
    "denies every account operation after native %s changes", async (kind) => {
      if (kind === "ended") await fixture.auth.api.signOut({ headers: { cookie: fixture.master.cookie } });
      else {
        const loginId = fixture.master.loginId, sessionId = fixture.master.hubSessionId;
        const queries = {
          expired: sql`update session set "expiresAt" = '2000-01-01T00:00:00.000Z' where id = ${sessionId}`,
          revision: sql`update user set auth_revision = auth_revision + 1 where id = ${loginId}`,
          role: sql`update user set role = 'user' where id = ${loginId}`,
          mfa: sql`update session set mfa_verified_at = null where id = ${sessionId}`,
          profile: sql`update user set username = 'INVALID' where id = ${loginId}`,
          suspended: sql`update user set banned = 1 where id = ${loginId}`,
          archived: sql`update user set archived_at = ${new Date().toISOString()} where id = ${loginId}`,
        };
        await saveHub(env.DB, [queries[kind].compile(fixture.identities.db)]);
      }
      const before = await state(), unauthenticated = ["expired", "ended", "revision"].includes(kind);
      const code = unauthenticated ? "core_unauthenticated" : kind === "role" ? "core_forbidden" : kind === "mfa" ? "core_mfa_required"
        : kind === "profile" ? "core_profile_incomplete" : "core_login_inactive";
      for (const { handler, input } of endpoints()) await failure({ response: await submit({ handler, input }), status: unauthenticated ? 401 : 403, code, fields: kind === "profile" ? ["username"] : undefined });
      expect(await state()).toEqual(kind === "expired" ? { ...before, hub: { ...before.hub,
        sessions: before.hub.sessions.filter((row) => row.id !== fixture.master.hubSessionId) } } : before);
    },
  );

  it("refuses a genuine switch to another master when the stale page actor header accompanies any operation", async () => {
    const current = await createEnrolledMaster(fixture), before = await state();
    for (const { handler, input } of endpoints()) await failure({ response: await submit({ handler, input, options: {
            actor: current, headers: { [pageLoginIdHeader]: fixture.master.loginId },
        } }), status: 409, code: "core_identity_changed" });
    expect(await state()).toEqual(before);
  });

  it.each(["list", "search", "detail", "missing"] as const)(
    "rechecks native authority at the actual %s data snapshot after HTTP request authorization", async (kind) => {
      let before: Snapshot | undefined;
      const database = beforeAccountRead(env.DB, async () => {
        await fixture.auth.api.signOut({ headers: { cookie: fixture.master.cookie } }); before = await state();
      });
      const handler = kind === "list" ? handleListAccounts : kind === "search" ? handleSearchAccounts : handleGetAccount;
      const input = kind === "list" ? {} : kind === "search" ? { query: "original" }
        : { accountId: kind === "missing" ? crypto.randomUUID() : fixture.target.accountId };
      await failure({ response: await submit({ handler, input, options: {}, database }), status: 401, code: "core_unauthenticated" });
      expect(before).toBeDefined(); expect(await state()).toEqual(before);
    },
  );

  it("fences a save if its real master session ends after preparation", async () => {
    const held = holdAccountBatch(env.DB), input = creation();
    const pending = submit({ handler: handleCreateAccount, input, options: {}, database: held.database }); await held.entered;
    let before: Snapshot;
    try { await fixture.auth.api.signOut({ headers: { cookie: fixture.master.cookie } }); before = await state(); } finally { held.release(); }
    await failure({ response: await pending, status: 401, code: "core_unauthenticated" }); expect(await state()).toEqual(before);
  });
});

describe("native account HTTP failures and recovery", () => {
  it.each(["list", "search", "detail"] as const)("reports terminal %s D1 failure once and never fabricates an empty or absent result", async (kind) => {
    const database = beforeAccountRead(env.DB, async () => { await env.DB.prepare('select * from "private_http_account_failure"').all(); });
    const handler = kind === "list" ? handleListAccounts : kind === "search" ? handleSearchAccounts : handleGetAccount;
    const input = kind === "list" ? {} : kind === "search" ? { query: "original" } : { accountId: fixture.target.accountId };
    const before = await state(), reports = captureReports();
    const response = await submit({ handler, input, options: {}, database }), text = await failure({ response, status: 500, code: "core_unexpected_error" });
    expect(text).not.toContain("private_http_account_failure");
    expect(reports).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"),
      app: "hub", operation: `stms_${kind === "list" ? "list_accounts" : kind === "search" ? "search_accounts" : "get_account"}` })]]);
    expect(await state()).toEqual(before);
  });

  it("recovers a lost create reply through authorized read-only status and explicit replay without a second account or audit", async () => {
    const input = creation(), database = interruptAfterWrite(env.DB, (query) => /^insert into "audit_entries"/i.test(query));
    const reports = captureReports(), response = await submit({ handler: handleCreateAccount, input, options: {}, database });
    await failure({ response, status: 500, code: "core_unexpected_error" });
    expect(reports).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "stms_save_management_change" })]]);
    const committed = await state(), audit = committed.hub.audits.find((row) => row.id === input.operationId);
    if (!audit?.details) throw new Error("The lost HTTP reply must follow a real committed command.");
    const receipt: unknown = JSON.parse(audit.details).result;
    const status = await submit({ handler: handleGetManagementOperation, input: { operationId: input.operationId }, options: { headers: { [pageLoginIdHeader]: fixture.master.loginId } } });
    expect(status.status).toBe(200); expect(await status.json()).toEqual({ status: "recorded", result: receipt });
    const replay = await submit({ handler: handleCreateAccount, input });
    expect(replay.status).toBe(200); expect(await replay.json()).toEqual(receipt);
    await failure({ response: await submit({ handler: handleCreateAccount, input: { ...input, name: "Changed uncertain intent" } }), status: 409, code: "stms_operation_conflict" });
    expect(await state()).toEqual(committed);
  });

  it("truthfully returns lost-reply authorization failure while preserving the durable receipt for a currently authorized master", async () => {
    const input = creation(), current = await createEnrolledMaster(fixture);
    const database = loseAccountBatchReply(env.DB, async () => { await fixture.auth.api.signOut({ headers: { cookie: fixture.master.cookie } }); });
    await failure({ response: await submit({ handler: handleCreateAccount, input, options: {}, database }), status: 401, code: "core_unauthenticated" });
    const committed = await state(), audit = committed.hub.audits.find((row) => row.id === input.operationId);
    if (!audit?.details) throw new Error("The 401 must not falsely imply that the account did not commit.");
    const receipt: unknown = JSON.parse(audit.details).result;
    expect(committed.hub.accounts.filter((row) => row.ownerLoginId === input.holderLoginId)).toHaveLength(1);
    await failure({ response: await submit({ handler: handleGetManagementOperation, input: { operationId: input.operationId } }), status: 401, code: "core_unauthenticated" });
    const status = await submit({ handler: handleGetManagementOperation, input: { operationId: input.operationId }, options: { actor: current, headers: { [pageLoginIdHeader]: current.loginId } } });
    expect(status.status).toBe(200); expect(await status.json()).toEqual({ status: "recorded", result: receipt });
    const replay = await submit({ handler: handleCreateAccount, input, options: { actor: current, headers: { [pageLoginIdHeader]: current.loginId } } });
    expect(replay.status).toBe(200); expect(await replay.json()).toEqual(receipt);
    expect(audit.actorLoginId).toBe(fixture.master.loginId); expect(await state()).toEqual(committed);
  });
});

type Snapshot = Awaited<ReturnType<typeof state>>;
function state() { return readAccountState(fixture); }
function creation(input: Partial<{ operationId: string; holderLoginId: string; name: string }> = {}) {
  return { operationId: crypto.randomUUID(), holderLoginId: fixture.holder.loginId, name: "  HTTP account  ", ...input };
}
function rename(input: Partial<{ operationId: string; accountId: string; expectedRevision: number; name: string }> = {}) {
  return { operationId: crypto.randomUUID(), accountId: fixture.target.accountId, expectedRevision: 0, name: "Renamed HTTP target", ...input };
}
function endpoints(): { handler: Handler; input: Record<string, unknown> }[] {
  return [{ handler: handleListAccounts, input: {} }, { handler: handleSearchAccounts, input: { query: "original" } },
    { handler: handleGetAccount, input: { accountId: fixture.target.accountId } }, { handler: handleCreateAccount, input: creation() },
    { handler: handleRenameAccount, input: rename() }];
}
function makeRequest(options: Options): Request {
  const actor = options.actor === undefined ? fixture.master : options.actor;
  const headers = new Headers({ origin: fixture.origin, "content-type": "application/json", ...(actor ? { cookie: actor.cookie } : {}) });
  for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
  if (options.omitOrigin) headers.delete("origin");
  const method = options.method ?? "POST";
  return new Request((options.base ?? fixture.origin) + (options.path ?? "/_serverFn/accounts"), { method, headers, ...(method === "POST" ? { body: "{}" } : {}) });
}
async function submit({ handler, input, options = {}, database = env.DB }: { handler: Handler; input: unknown; options?: Options; database?: D1Database }): Promise<Response> {
  return await handler(input, { request: makeRequest(options), settings: { ...fixture.settings, database } });
}
function checkHeaders(response: Response, actor?: string): void {
  expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("x-request-id")).toMatch(/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i);
  expect(response.headers.get(pageLoginIdHeader)).toBe(actor ?? null);
}
async function failure({ response, status, code, fields }: { response: Response; status: number; code: string; fields?: string[] }): Promise<string> {
  expect(response.status).toBe(status); checkHeaders(response);
  const text = await response.text();
  expect(JSON.parse(text)).toEqual({ code, message: expect.any(String), requestId: response.headers.get("x-request-id"), ...(fields === undefined ? {} : { fields }) });
  return text;
}
function sorted<Row extends { id: string }>(rows: Row[]): Row[] { return [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
function captureReports(): unknown[][] {
  const reports: unknown[][] = []; vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { reports.push(args); }); return reports;
}
