import { normalizeSearchText } from "@xpro/accounts";
import { env } from "cloudflare:workers";
import { createHubConnection, saveHub } from "@xpro/core/server";
import type { CoreError } from "@xpro/core/server";
import { CompiledQuery, sql } from "kysely";
import { err, ok } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountServices, beforeAccountPreparation, beforeAccountRead, createAccountFixture, createEmptyAccountFixture, holdAccountBatch, loseAccountBatchReply, readAccountState, seedAccount, seedRetainedNamelessAccount } from "#test/account-management";
import type { AccountFixture } from "#test/account-management";
import { interruptAfterWrite } from "#test/creation-faults.db";
import { createEnrolledMaster } from "#test/master-mfa";
import { createAccount } from "#create-account/create-account.server.ts";
import { prepareAccountCreation } from "#create-account/create-account.db.ts";
import type { ManagementChangeTables } from "#management/changes.db.ts";
import type { CreateAccountInput } from "#create-account/input.ts";
import { renameAccount } from "#rename-account/rename-account.server.ts";
import { prepareAccountRename } from "#rename-account/rename-account.db.ts";
import type { RenameAccountInput } from "#rename-account/input.ts";
import { fingerprintManagementCommand, getManagementOperation } from "#management/operations.db.ts";
import type { ManagementServices } from "#management/operations.ts";
import { accountDetailQuery, getAccount, listAccounts, listAccountsQuery, searchAccounts, searchAccountsQuery } from "./accounts.db";

let fixture: AccountFixture;

it("when no account has been saved then the native directory is genuinely empty without deleting fixture records", async () => {
  const empty = await createEmptyAccountFixture(env.DB);
  try {
    const before = await readAccountState(empty), services = accountServices(empty);
    expect((await listAccounts({}, services)).toJSON()).toEqual(ok({ accounts: [], nextOffset: null }).toJSON());
    expect((await searchAccounts({ query: "anything" }, services)).toJSON()).toEqual(ok({ accounts: [], nextOffset: null }).toJSON());
    expect(await readAccountState(empty)).toEqual(before);
  } finally { await empty.identities.db.destroy(); }
});

describe("native account creation", () => {
  beforeEach(async () => { fixture = await createAccountFixture(env.DB); });
  afterEach(async () => { vi.restoreAllMocks(); await fixture.identities.db.destroy(); });
  it("creates one trimmed labelled account and minimal attributable audit, without membership, role, workspace, client or unrelated changes", async () => {
    const input = creation({ name: "  New account  " }), services = request(), before = await state();
    const result = await createAccount(input, services);
    expect(result.isOk).toBe(true);
    if (result.isErr || !("accountId" in result.value)) throw new Error("An account creation receipt is required.");
    expect(result.value).toEqual({ action: "stms_account_created", accountId: expect.any(String) });
    await expectCreated({ input, accountId: result.value.accountId, before, services });
    const detail = await getAccount({ accountId: result.value.accountId }, request());
    const createdState = await state(), createdId = result.value.accountId;
    const createdRow = createdState.hub.accounts.find((row) => row.id === createdId);
    if (!createdRow) throw new Error("The saved account fixture must exist.");
    expect(detail.isOk && detail.value).toEqual({ ...accountSummary(createdRow, createdState),
      updatedAt: expect.any(String), workspace: null });
  });

  it("allows an active creation-complete holder with an incomplete personal profile", async () => {
    const holder = await fixture.identities.createLogin({ username: null, phone: null });
    const input = creation({ holderLoginId: holder.loginId }), services = request(), before = await state();
    const result = await createAccount(input, services);
    if (result.isErr || !("accountId" in result.value)) throw new Error("A profile-incomplete holder must remain eligible.");
    await expectCreated({ input, accountId: result.value.accountId, before, services });
  });

  it("creates an account for an existing workspace member without moving or changing that membership", async () => {
    const input = creation(), services = request();
    if (!fixture.other.workspaceId) throw new Error("The pre-existing workspace fixture must exist.");
    await fixture.identities.auth.api.addMember({ body: { userId: input.holderLoginId,
      organizationId: fixture.other.workspaceId, role: "member" } });
    const before = await state(), result = await createAccount(input, services);
    expect(result.isOk).toBe(true);
    if (result.isErr || !("accountId" in result.value)) throw new Error("The account creation must return its real identity.");
    await expectCreated({ input, accountId: result.value.accountId, before, services });
  });

  it.each(["missing", "suspended", "archived", "unfinished", "wrong completion", "already held"] as const)(
    "refuses an initially %s holder without any mutation", async (kind) => {
      const input = creation();
      if (kind === "missing") input.holderLoginId = crypto.randomUUID();
      else await makeHolderUnavailable(kind, input.holderLoginId);
      const before = await state();
      expect((await createAccount(input, request())).toJSON()).toEqual(err({ code: "stms_account_holder_unavailable" }).toJSON());
      expect(await state()).toEqual(before);
      expect((await getManagementOperation(input.operationId, request())).toJSON()).toEqual(ok({ status: "not_recorded" }).toJSON());
    },
  );

  it("retains the approved uncapped nonblank label schema and supports the full bounded search prefix", async () => {
    const name = "N".repeat(256), input = creation({ name }), services = request(), before = await state();
    const result = await createAccount(input, services);
    if (result.isErr || !("accountId" in result.value)) throw new Error("The approved display-name schema has no new arbitrary cap.");
    await expectCreated({ input, accountId: result.value.accountId, before, services });
    const found = await searchAccounts({ query: name.slice(0, 200) }, request());
    expect(found.isOk && found.value.accounts.map((row) => row.accountId)).toEqual([result.value.accountId]);
  });

  it("accepts the current linked completion under the existing creation policy", async () => {
    await seedCreationRecord(fixture.holder.loginId, { createdLoginId: fixture.holder.loginId, completedAt: new Date().toISOString() });
    const result = await createAccount(creation(), request());
    expect(result.isOk).toBe(true);
  });

  it.each(["suspended", "archived", "unfinished", "already held"] as const)(
    "fences a holder becoming %s after preparation at the actual guarded save", async (kind) => {
      const input = creation(), held = holdAccountBatch(env.DB);
      const pending = createAccount(input, request({ database: held.database }));
      await held.entered;
      let before: Snapshot;
      try { await makeHolderUnavailable(kind, input.holderLoginId); before = await state(); } finally { held.release(); }
      expect((await pending).toJSON()).toEqual(err({ code: "stms_operation_conflict" }).toJSON());
      expect(await state()).toEqual(before);
    },
  );

  it("lets the unique-holder race record only one account and one operation without reassignment", async () => {
    const firstInput = creation(), secondInput = creation({ name: "A different account label" });
    const first = holdAccountBatch(env.DB), second = holdAccountBatch(env.DB), before = await state();
    const firstServices = request({ database: first.database }), secondServices = request({ database: second.database });
    const runs = [createAccount(firstInput, firstServices), createAccount(secondInput, secondServices)];
    await Promise.all([first.entered, second.entered]); first.release(); second.release();
    const results = await Promise.all(runs);
    expect(results.filter((result) => result.isOk)).toHaveLength(1);
    expect(results.filter((result) => result.isErr).map((result) => result.toJSON())).toEqual([err({ code: "stms_operation_conflict" }).toJSON()]);
    const winner = results[0]?.isOk ? { result: results[0], input: firstInput, services: firstServices }
      : { result: results[1], input: secondInput, services: secondServices };
    if (!winner.result?.isOk || !("accountId" in winner.result.value)) throw new Error("Exactly one holder assignment must win.");
    await expectCreated({ input: winner.input, accountId: winner.result.value.accountId, before, services: winner.services });
  });

  it("concurrent duplicate keys allocate once and return the same original account ID", async () => {
    const input = creation(), first = holdAccountBatch(env.DB), second = holdAccountBatch(env.DB), before = await state();
    const runs = [createAccount(input, request({ database: first.database })), createAccount(input, request({ database: second.database }))];
    await Promise.all([first.entered, second.entered]); first.release(); second.release();
    const results = await Promise.all(runs);
    expect(results[0]?.isOk).toBe(true); expect(results[1]?.toJSON()).toEqual(results[0]?.toJSON());
    const after = await state();
    expect(after.hub.accounts.length - before.hub.accounts.length).toBe(1);
    expect(after.hub.audits.filter((row) => row.id === input.operationId)).toHaveLength(1);
    expect((await createAccount({ ...input, name: "  " + input.name + "  " }, request())).toJSON()).toEqual(results[0]?.toJSON());
    expect(await state()).toEqual(after);
  });

  it("permits duplicate display names for different holders", async () => {
    const secondHolder = await fixture.identities.createLogin(), name = "Repeated label";
    const first = await createAccount(creation({ name }), request());
    const second = await createAccount(creation({ name, holderLoginId: secondHolder.loginId }), request());
    expect(first.isOk && second.isOk && first.value).not.toEqual(second.isOk && second.value);
    expect(first.isOk && second.isOk).toBe(true);
    const page = await searchAccounts({ query: "repeated" }, request());
    expect(page.isOk && page.value.accounts.map((account) => account.name)).toEqual([name, name]);
  });

  it("rolls the audit back when an actual account insert trigger refuses the business write", async () => {
    await sql`create trigger test_refuse_account_insert before insert on accounts
      begin select raise(abort, 'private_account_insert_failure'); end`.execute(fixture.identities.db.withoutPlugins());
    const input = creation(), services = request(), before = await state(), reports = captureReports();
    expect((await createAccount(input, services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expectReports({ reports, services, operation: "stms_save_management_change" });
    expect(await state()).toEqual(before);
    expect((await getManagementOperation(input.operationId, request())).toJSON()).toEqual(ok({ status: "not_recorded" }).toJSON());
  });
});

describe("native account reads", () => {
  beforeEach(async () => { fixture = await createAccountFixture(env.DB); });
  afterEach(async () => { vi.restoreAllMocks(); await fixture.identities.db.destroy(); });


  it("pages newest first with a stable ID tie-breaker, including suspended accounts and the default page boundary", async () => {
    const time = "2027-01-01T00:00:00.000Z";
    for (let index = 0; index < 26; index++) await seedAccount(fixture, {
    name: `Paged ${index}`, createdAt: time, status: index % 2 ? "stms_suspended" : "stms_active",
});
    const before = await state(), ordered = [...before.hub.accounts].sort((a, b) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.createdAt < b.createdAt ? 1 : -1);
    const first = await listAccounts({}, request());
    expect(first.isOk && first.value).toEqual({ accounts: ordered.slice(0, 25).map((row) => accountSummary(row, before)), nextOffset: 25 });
    const second = await listAccounts({ offset: 25 }, request());
    expect(second.isOk && second.value).toEqual({ accounts: ordered.slice(25).map((row) => accountSummary(row, before)), nextOffset: null });
    const small = await listAccounts({ limit: 2, offset: 2 }, request());
    expect(small.isOk && small.value).toEqual({ accounts: ordered.slice(2, 4).map((row) => accountSummary(row, before)), nextOffset: 4 });
    expect((await listAccounts({ limit: 100, offset: 100 }, request())).toJSON()).toEqual(ok({ accounts: [], nextOffset: null }).toJSON());
    expect(await state()).toEqual(before);
  });

  it("uses bounded normalized literal prefixes, not substring or wildcard semantics", async () => {
    for (const name of ["  ÄLPHA special%_label  ", "Älpha second", "Not Älpha", "Plain specialxxlabel", "Literal%_value", "\u{10ffff}edge"]) {
      const holder = await fixture.identities.createLogin();
      expect((await createAccount(creation({ holderLoginId: holder.loginId, name }), request())).isOk).toBe(true);
    }
    const before = await state();
    const expected = (prefix: string) => before.hub.accounts.filter((row) => row.nameSearch?.startsWith(normalizeSearchText(prefix)))
      .sort((a, b) => a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1).map((row) => accountSummary(row, before));
    for (const query of ["  ÄLPHA ", "literal%_", "\u{10ffff}", "absent"]) {
      const result = await searchAccounts({ query }, request());
      expect(result.isOk && result.value).toEqual({ accounts: expected(query), nextOffset: null });
    }
    const first = await searchAccounts({ query: "älpha", limit: 1 }, request());
    expect(first.isOk && first.value).toEqual({ accounts: expected("älpha").slice(0, 1), nextOffset: 1 });
    const last = await searchAccounts({ query: "älpha", limit: 1, offset: 1 }, request());
    expect(last.isOk && last.value).toEqual({ accounts: expected("älpha").slice(1), nextOffset: null });
    expect(await state()).toEqual(before);
  });

  it("preserves a retained null label until explicit rename, while details expose only the linked workspace identity", async () => {
    const retained = await seedRetainedNamelessAccount(fixture, env.DB);
    const before = await state(), row = before.hub.accounts.find((account) => account.id === retained.accountId);
    if (!row) throw new Error("The retained account fixture must exist.");
    expect((await getAccount({ accountId: retained.accountId }, request())).toJSON()).toEqual(ok({ ...accountSummary(row, before),
      updatedAt: row.updatedAt, workspace: null }).toJSON());
    const list = await listAccounts({}, request());
    expect(list.isOk && list.value.accounts.find((account) => account.accountId === retained.accountId)?.name).toBeNull();
    const target = before.hub.accounts.find((account) => account.id === fixture.target.accountId);
    if (!target) throw new Error("The target account fixture must exist.");
    const detail = await getAccount({ accountId: fixture.target.accountId }, request());
    expect(detail.isOk && detail.value).toEqual({ ...accountSummary(target, before), updatedAt: target.updatedAt,
      workspace: { workspaceId: fixture.target.workspaceId, name: "Preserved native workspace" } });
    expect(await state()).toEqual(before);
    expect((await renameAccount(rename({ accountId: retained.accountId, name: "Explicit label" }), request())).isOk).toBe(true);
    const renamed = await getAccount({ accountId: retained.accountId }, request());
    expect(renamed.isOk && renamed.value.name).toBe("Explicit label");
  });

  it("distinguishes no matches and missing details from actual terminal storage failure without leaking the exception", async () => {
    const before = await state();
    expect((await searchAccounts({ query: "no such account" }, request())).toJSON()).toEqual(ok({ accounts: [], nextOffset: null }).toJSON());
    expect((await getAccount({ accountId: crypto.randomUUID() }, request())).toJSON()).toEqual(err({ code: "stms_account_not_found" }).toJSON());
    for (const [run, operation] of [
      [(services: ManagementServices) => listAccounts({}, services), "stms_list_accounts"],
      [(services: ManagementServices) => searchAccounts({ query: "original" }, services), "stms_search_accounts"],
      [(services: ManagementServices) => getAccount({ accountId: fixture.target.accountId }, services), "stms_get_account"],
    ] as const) {
      const database = beforeAccountRead(env.DB, async () => { await env.DB.prepare('select * from "private_account_read_failure"').all(); });
      const services = request({ database }), reports = captureReports();
      expect((await run(services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
      expectReports({ reports, services, operation }); vi.restoreAllMocks();
    }
    expect(await state()).toEqual(before);
  });

  it.each(["list", "search", "detail", "empty", "missing"] as const)(
    "does not disclose %s data if the real session ends immediately before the authority/data snapshot", async (kind) => {
      let before: Snapshot | undefined;
      const database = beforeAccountRead(env.DB, async () => {
        await fixture.auth.api.signOut({ headers: { cookie: fixture.master.cookie } }); before = await state();
      });
      const services = request({ database });
      const result = kind === "list" ? await listAccounts({}, services)
        : kind === "search" || kind === "empty" ? await searchAccounts({ query: kind === "empty" ? "absent" : "original" }, services)
        : await getAccount({ accountId: kind === "missing" ? crypto.randomUUID() : fixture.target.accountId }, services);
      expect(result.toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
      expect(before).toBeDefined(); expect(await state()).toEqual(before);
    },
  );

  it("plans account reads, holder eligibility and the commit guard against native indexes", async () => {
    const db = (await createHubConnection<unknown>(env.DB)).withoutPlugins(), before = await state();
    try {
      const list = listAccountsQuery({ limit: 25, offset: 0 });
      const search = searchAccountsQuery({ query: "ori", limit: 25, offset: 0 });
      const detail = accountDetailQuery(fixture.target.accountId);
      const plans: string[][] = [];
      for (const query of [list, search, detail]) {
        const result = await sql<{ detail: string }>`explain query plan ${query}`.execute(db);
        plans.push(result.rows.map((row) => row.detail));
      }
      expect(plans[0]?.some((line) => line.includes("accounts_created_at_id_idx"))).toBe(true);
      expect(plans[1]?.some((line) => /SEARCH a USING INDEX accounts_name_search_id_idx/.test(line))).toBe(true);
      expect(plans[2]?.some((line) => /SEARCH a USING INDEX/.test(line))).toBe(true);
      for (const plan of plans) expect(plan.some((line) => /SEARCH h USING INDEX/.test(line))).toBe(true);
      expect(plans[2]?.some((line) => /SEARCH w USING INDEX/.test(line))).toBe(true);
      const captured: { query: string; parameters: unknown[] }[] = [];
      const database = new Proxy(env.DB, { get(target, key) {
        if (key === "prepare") return (query: string) => {
          const statement = target.prepare(query);
          return new Proxy(statement, { get(prepared, property) {
            if (property === "bind") return (...parameters: unknown[]) => {
              captured.push({ query, parameters }); return prepared.bind(...parameters);
            };
            const value: unknown = Reflect.get(prepared, property, prepared);
            return typeof value === "function" ? value.bind(prepared) : value;
          } });
        };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const preparing = (await createHubConnection<ManagementChangeTables>(database)).withoutPlugins();
      try {
        const prepared = await prepareAccountCreation(preparing, creation());
        if (prepared.isErr) throw new Error("The native holder fixture must be eligible for preparation.");
        const renamed = await prepareAccountRename(preparing, rename());
        if (renamed.isErr) throw new Error("The native account fixture must be eligible for rename preparation.");
        const preparationDetails: string[] = [];
        for (const { query, parameters } of captured) {
          const result = await db.executeQuery<{ detail: string }>(CompiledQuery.raw("explain query plan " + query, parameters));
          preparationDetails.push(...result.rows.map((row) => row.detail));
        }
        const guardDetails = (await sql<{ detail: string }>`explain query plan select case when ${prepared.value.canApply} then 1 else 0 end`.execute(db)).rows.map((row) => row.detail);
        for (const details of [preparationDetails, guardDetails]) {
          expect(details.some((line) => /SEARCH u USING INDEX sqlite_autoindex_user_1/.test(line))).toBe(true);
          expect(details.some((line) => /SEARCH c USING INDEX sqlite_autoindex_login_creations_1/.test(line))).toBe(true);
          expect(details.some((line) => /SEARCH a USING COVERING INDEX accounts_owner_login_id_unique/.test(line))).toBe(true);

        }
        const renameGuardDetails = (await sql<{ detail: string }>`explain query plan select case when ${renamed.value.canApply} then 1 else 0 end`.execute(db)).rows.map((row) => row.detail);
        const renameWriteDetails: string[][] = [];
        for (const query of renamed.value.queries) {
          const result = await db.executeQuery<{ detail: string }>({ ...query, sql: "explain query plan " + query.sql });
          renameWriteDetails.push(result.rows.map((row) => row.detail));
        }
        for (const details of [preparationDetails, renameGuardDetails, ...renameWriteDetails]) {
          expect(details.some((line) => /SEARCH accounts USING INDEX sqlite_autoindex_accounts_1/.test(line))).toBe(true);
        }
        for (const details of [preparationDetails, guardDetails, renameGuardDetails, ...renameWriteDetails]) {
          expect(details.filter((line) => /\bSCAN (?:u|c|a|user|login_creations|accounts)\b/.test(line))).toEqual([]);
        }
      } finally { await preparing.destroy(); }
    } finally { await db.destroy(); }
    expect(await state()).toEqual(before);
  });
});

describe("native account renaming and operation recovery", () => {
  beforeEach(async () => { fixture = await createAccountFixture(env.DB); });
  afterEach(async () => { vi.restoreAllMocks(); await fixture.identities.db.destroy(); });
  it.each([["create", false], ["rename", false], ["create", true], ["rename", true]] as const)(
    "recovers %s with changed-intent=%s when a native competitor commits between absent-key lookup and preparation", async (kind, changed) => {
      const input = kind === "create" ? creation() : rename();
      const competing = { ...input, name: changed ? "A different committed intent" : input.name };
      const run = (value: unknown, services: ManagementServices) => kind === "create" ? createAccount(value, services) : renameAccount(value, services);
      let winning: Awaited<ReturnType<typeof run>> | undefined, committed: Snapshot | undefined;
      const database = beforeAccountPreparation(env.DB, async () => {
        winning = await run(competing, request());
        if (winning.isErr) throw new Error("The native competing command must actually commit.");
        committed = await state();
      });
      const result = await run(input, request({ database }));
      expect(winning?.isOk).toBe(true); expect(committed).toBeDefined();
      expect(result.toJSON()).toEqual(changed ? err({ code: "stms_operation_conflict" }).toJSON() : winning?.toJSON());
      expect(await state()).toEqual(committed);
    },
  );

  it("renames a suspended account even with a now-inactive holder, preserving the entire tenant identity and unrelated state", async () => {
    await saveHub(env.DB, [sql`update accounts set status = 'stms_suspended' where id = ${fixture.target.accountId}`.compile(fixture.identities.db),
      sql`update user set banned = 1, archived_at = ${new Date().toISOString()} where id = ${fixture.target.ownerLoginId}`.compile(fixture.identities.db)]);
    const input = rename({ name: "  New CASE label  " }), services = request(), before = await state();
    expect((await renameAccount(input, services)).toJSON()).toEqual(ok(renameReceipt(input)).toJSON());
    await expectRenamed({ input, before, services });
    const search = await searchAccounts({ query: "new case" }, request());
    expect(search.isOk && search.value.accounts.map((row) => row.accountId)).toEqual([input.accountId]);
  });

  it("treats same-label and case-only renames as distinct revisioned audited commands", async () => {
    let revision = 0;
    for (const name of ["Original account", "ORIGINAL ACCOUNT", "Original account"]) {
      const input = rename({ expectedRevision: revision++, name }), services = request(), before = await state();
      expect((await renameAccount(input, services)).toJSON()).toEqual(ok(renameReceipt(input)).toJSON());
      await expectRenamed({ input, before, services });
    }
  });

  it("refuses absent targets, stale versions and overflow without changing any business or audit state", async () => {
    for (const [input, code] of [[rename({ accountId: crypto.randomUUID() }), "stms_account_not_found"],
      [rename({ expectedRevision: 1 }), "stms_operation_conflict"]] as const) {
      const before = await state();
      expect((await renameAccount(input, request())).toJSON()).toEqual(err({ code }).toJSON()); expect(await state()).toEqual(before);
    }
    await saveHub(env.DB, [sql`update accounts set revision = ${Number.MAX_SAFE_INTEGER} where id = ${fixture.target.accountId}`.compile(fixture.identities.db)]);
    const before = await state();
    expect((await renameAccount(rename({ expectedRevision: Number.MAX_SAFE_INTEGER }), request())).toJSON())
      .toEqual(err({ code: "stms_operation_conflict" }).toJSON());
    expect(await state()).toEqual(before);
  });

  it("fences a rename whose version changes after preparation", async () => {
    const input = rename(), held = holdAccountBatch(env.DB);
    const pending = renameAccount(input, request({ database: held.database })); await held.entered;
    let before: Snapshot;
    try {
      expect((await renameAccount(rename({ name: "Concurrent rename" }), request())).isOk).toBe(true); before = await state();
    } finally { held.release(); }
    expect((await pending).toJSON()).toEqual(err({ code: "stms_operation_conflict" }).toJSON()); expect(await state()).toEqual(before);
  });

  it("rolls the audit back on native rename failure", async () => {
    await sql`create trigger test_refuse_account_rename before update of name on accounts
      begin select raise(abort, 'private_account_rename_failure'); end`.execute(fixture.identities.db.withoutPlugins());
    const input = rename(), services = request(), before = await state(), reports = captureReports();
    expect((await renameAccount(input, services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expectReports({ reports, services, operation: "stms_save_management_change" }); expect(await state()).toEqual(before);
  });

  it.each(["create", "rename"] as const)("recovers a real committed %s with a lost connection through status and same-intent replay", async (kind) => {
    const input = kind === "create" ? creation() : rename();
    const database = interruptAfterWrite(env.DB, (query) => /^insert into "audit_entries"/i.test(query));
    const services = request({ database }), reports = captureReports();
    const result = kind === "create" ? await createAccount(input, services) : await renameAccount(input, services);
    expect(result.toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON()); expectReports({ reports, services, operation: "stms_save_management_change" });
    const committed = await state(), audit = committed.hub.audits.find((row) => row.id === input.operationId);
    if (!audit?.details) throw new Error("The lost reply must follow a genuinely committed audit.");
    const receipt: unknown = JSON.parse(audit.details).result;
    expect((await getManagementOperation(input.operationId, request())).toJSON()).toEqual(ok({ status: "recorded", result: receipt }).toJSON());
    const replay = kind === "create" ? await createAccount(input, request()) : await renameAccount(input, request());
    expect(replay.toJSON()).toEqual(ok(receipt).toJSON()); expect(await state()).toEqual(committed);
  });

  it("returns truthful current authorization failure even when the batch committed before its lost reply", async () => {
    const input = creation(), current = await createEnrolledMaster(fixture);
    const database = loseAccountBatchReply(env.DB, async () => {
      await fixture.auth.api.signOut({ headers: { cookie: fixture.master.cookie } });
    });
    expect((await createAccount(input, request({ database }))).toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
    const committed = await state(), audit = committed.hub.audits.find((row) => row.id === input.operationId);
    if (!audit?.details) throw new Error("Authorization failure must not erase the genuinely committed operation.");
    const receipt: unknown = JSON.parse(audit.details).result;
    expect(committed.hub.accounts.filter((row) => row.ownerLoginId === input.holderLoginId)).toHaveLength(1);
    expect((await getManagementOperation(input.operationId, request())).toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
    const services = request({ session: current });
    expect((await getManagementOperation(input.operationId, services)).toJSON()).toEqual(ok({ status: "recorded", result: receipt }).toJSON());
    expect((await createAccount(input, services)).toJSON()).toEqual(ok(receipt).toJSON());
    expect(await state()).toEqual(committed);
  });

  it("replays original create and rename receipts after target changes, rejects changed intent, and keeps original attribution across masters", async () => {
    const input = creation(), created = await createAccount(input, request());
    if (created.isErr || !("accountId" in created.value)) throw new Error("Creation must succeed before replay.");
    const renamed = rename({ accountId: created.value.accountId });
    expect((await renameAccount(renamed, request())).isOk).toBe(true);
    expect((await renameAccount(rename({ accountId: created.value.accountId, expectedRevision: 1, name: "Later label" }), request())).isOk).toBe(true);
    await saveHub(env.DB, [sql`update user set banned = 1 where id = ${input.holderLoginId}`.compile(fixture.identities.db)]);
    const current = await createEnrolledMaster(fixture);
    await fixture.auth.api.signOut({ headers: { cookie: fixture.master.cookie } });
    const before = await state(), services = request({ session: current });
    expect((await createAccount({ ...input, name: "  " + input.name + "  " }, services)).toJSON()).toEqual(created.toJSON());
    expect((await renameAccount({ ...renamed, name: "  " + renamed.name + "  " }, services)).toJSON()).toEqual(ok(renameReceipt(renamed)).toJSON());
    for (const changed of [{ ...input, name: input.name.toUpperCase() }, { ...input, holderLoginId: fixture.target.ownerLoginId }]) {
      expect((await createAccount(changed, services)).toJSON()).toEqual(err({ code: "stms_operation_conflict" }).toJSON());
    }
    for (const changed of [{ ...renamed, name: renamed.name.toUpperCase() }, { ...renamed, accountId: fixture.other.accountId },
      { ...renamed, expectedRevision: 1 }]) expect((await renameAccount(changed, services)).toJSON()).toEqual(err({ code: "stms_operation_conflict" }).toJSON());
    expect((await renameAccount({ ...renamed, operationId: input.operationId }, services)).toJSON()).toEqual(err({ code: "stms_operation_conflict" }).toJSON());
    expect(before.hub.audits.filter((row) => [input.operationId, renamed.operationId].includes(row.id)).map((row) => row.actorLoginId))
      .toEqual([fixture.master.loginId, fixture.master.loginId]);
    expect(await state()).toEqual(before);
    expect((await createAccount(input, request())).toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect((await renameAccount(renamed, request())).toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
  });
});

describe("strict native account boundaries", () => {
  beforeEach(async () => { fixture = await createAccountFixture(env.DB); });
  afterEach(async () => { vi.restoreAllMocks(); await fixture.identities.db.destroy(); });
  it("refuses invalid, blank, unsafe and undeclared command fields with unchanged state", async () => {
    const before = await state();
    const cases = [
      () => createAccount({ ...creation(), name: " \u00a0\t " }, request()),
      () => createAccount({ ...creation(), holderLoginId: "not-a-uuid" }, request()),
      () => createAccount({ ...creation(), operationId: "request-diagnostic" }, request()),
      () => createAccount({ ...creation(), expectedRevision: 0 }, request()),
      () => renameAccount({ ...rename(), name: "\n" }, request()),
      ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, "0", null].map((expectedRevision) =>
        () => renameAccount({ ...rename(), expectedRevision }, request())),
      () => renameAccount({ ...rename(), isMaster: true }, request()),
      () => getAccount({ accountId: fixture.target.accountId, includeSecrets: true }, request()),
      () => listAccounts({ limit: 101 }, request()), () => listAccounts({ offset: -1 }, request()),
      () => listAccounts({ offset: Number.MAX_SAFE_INTEGER + 1 }, request()), () => listAccounts({ status: "active" }, request()),
      () => searchAccounts({ query: " " }, request()), () => searchAccounts({ query: "a".repeat(201) }, request()),
      () => searchAccounts({ query: "\ud800" }, request()),
    ];
    for (const run of cases) { const result = await run(); expect(result.isErr && result.error.code).toBe("core_invalid_input"); }
    expect(await state()).toEqual(before);
  });

  const revocations = [
    ["ended", { code: "core_unauthenticated" }], ["expired", { code: "core_unauthenticated" }],
    ["role", { code: "core_forbidden" }], ["suspended", { code: "core_login_inactive" }], ["archived", { code: "core_login_inactive" }],
    ["profile", { code: "core_profile_incomplete", fields: ["username"] }], ["creation", { code: "core_creation_incomplete" }],
    ["revision", { code: "core_unauthenticated" }], ["factor", { code: "core_unauthenticated" }],
    ["mfa", { code: "core_mfa_required" }],
  ] satisfies readonly (readonly [string, CoreError])[];
  it.each(revocations)("denies native %s revocation on pending save, subsequent reads, new commands and recorded replay", async (kind, denial) => {
    const original = creation(); expect((await createAccount(original, request())).isOk).toBe(true);
    const input = rename(), held = holdAccountBatch(env.DB);
    const pending = renameAccount(input, request({ database: held.database })); await held.entered;
    let before: Snapshot;
    try { await revokeMaster(kind); before = await state(); } finally { held.release(); }
    expect((await pending).toJSON()).toEqual(err(denial).toJSON());
    for (const result of [await listAccounts({}, request()), await searchAccounts({ query: "original" }, request()),
      await getAccount({ accountId: fixture.target.accountId }, request()), await createAccount(original, request()),
      await renameAccount(rename(), request()), await getManagementOperation(original.operationId, request())]) {
      expect(result.toJSON()).toEqual(err(denial).toJSON());
    }
    expect(await state()).toEqual(before);
  });

  it("denies anonymous callers and actual native account holders", async () => {
    await seedAccount(fixture, { ownerLoginId: fixture.holder.loginId });
    const holder = fixture.holder;
    const before = await state();
    for (const session of [null, holder]) {
      const services = request({ session }), denial = { code: session ? "core_forbidden" : "core_unauthenticated" };
      for (const result of [await listAccounts({}, services), await searchAccounts({ query: "original" }, services),
        await getAccount({ accountId: fixture.target.accountId }, services), await createAccount(creation(), services),
        await renameAccount(rename(), services)]) expect(result.toJSON()).toEqual(err(denial).toJSON());
    }
    expect(await state()).toEqual(before);
  });
});

type Snapshot = Awaited<ReturnType<typeof state>>;
function state() { return readAccountState(fixture); }
function request(input: Parameters<typeof accountServices>[1] = {}) { return accountServices(fixture, input); }
function creation(input: Partial<CreateAccountInput> = {}): CreateAccountInput {
  return { operationId: crypto.randomUUID(), name: "New account", holderLoginId: fixture.holder.loginId, ...input };
}
function rename(input: Partial<RenameAccountInput> = {}): RenameAccountInput {
  return { operationId: crypto.randomUUID(), accountId: fixture.target.accountId, expectedRevision: 0, name: "Renamed account", ...input };
}
function renameReceipt(input: RenameAccountInput) { return { action: "stms_account_renamed" as const, accountId: input.accountId }; }
function accountSummary(row: Snapshot["hub"]["accounts"][number], snapshot: Snapshot) {
  const holder = snapshot.hub.users.find((user) => user.id === row.ownerLoginId);
  if (!holder) throw new Error("Each native account must retain its existing holder identity.");
  return { accountId: row.id, name: row.name,
    holder: { loginId: holder.id, name: holder.name, username: holder.username, email: holder.email },
    status: row.status, revision: row.revision, createdAt: row.createdAt };
}
async function expectCreated({ input, accountId, before, services }: { input: CreateAccountInput; accountId: string; before: Snapshot; services: ManagementServices }): Promise<void> {
  const after = await state(), row = after.hub.accounts.find((account) => account.id === accountId), audit = after.hub.audits.find((entry) => entry.id === input.operationId);
  expect(accountId).toMatch(/^[a-f\d-]{36}$/i);
  expect(row).toEqual({ id: accountId, ownerLoginId: input.holderLoginId, name: input.name.trim(), nameSearch: normalizeSearchText(input.name),
    status: "stms_active", revision: 0, createdAt: expect.any(String), updatedAt: expect.any(String) });
  expect(row?.createdAt).toBe(row?.updatedAt); expect(row?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  const receipt = { action: "stms_account_created" as const, accountId };
  expect(audit).toEqual({ id: input.operationId, action: receipt.action, outcome: "success", actorLoginId: services.session?.loginId,
    affectedLoginId: input.holderLoginId, reason: null, comment: null, accountId, workspaceId: null, requestId: services.context.requestId,
    createdAt: expect.any(String), details: JSON.stringify({ version: 1, fingerprint: await fingerprintManagementCommand(receipt.action,
      { name: input.name.trim(), holderLoginId: input.holderLoginId }), result: receipt }) });
  if (!row || !audit) throw new Error("The real account and audit must both be present.");
  expect(after).toEqual({ ...before, hub: { ...before.hub, accounts: sorted([...before.hub.accounts, row]), audits: sorted([...before.hub.audits, audit]) } });
}
async function expectRenamed({ input, before, services }: { input: RenameAccountInput; before: Snapshot; services: ManagementServices }): Promise<void> {
  const after = await state(), audit = after.hub.audits.find((entry) => entry.id === input.operationId);
  expect(audit).toEqual({ id: input.operationId, action: "stms_account_renamed", outcome: "success", actorLoginId: services.session?.loginId,
    affectedLoginId: null, reason: null, comment: null, accountId: input.accountId, workspaceId: null, requestId: services.context.requestId,
    createdAt: expect.any(String), details: JSON.stringify({ version: 1, fingerprint: await fingerprintManagementCommand("stms_account_renamed",
      { accountId: input.accountId, expectedRevision: input.expectedRevision, name: input.name.trim() }), result: renameReceipt(input) }) });
  if (!audit) throw new Error("An immutable account rename audit must be present.");
  expect(after).toEqual({ ...before, hub: { ...before.hub, accounts: before.hub.accounts.map((row) => row.id === input.accountId
    ? { ...row, name: input.name.trim(), nameSearch: normalizeSearchText(input.name), revision: row.revision + 1, updatedAt: expect.any(String) } : row),
    audits: sorted([...before.hub.audits, audit]) } });
}
function sorted<Row extends { id: string }>(rows: Row[]): Row[] { return [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
function captureReports(): unknown[][] {
  const reports: unknown[][] = []; vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { reports.push(args); }); return reports;
}
function expectReports({ reports, services, operation }: { reports: unknown[][]; services: ManagementServices; operation: string }): void {
  expect(reports).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: services.context.requestId, app: "hub", operation })]]);
}
async function seedCreationRecord(loginId: string, creation: { createdLoginId: string; completedAt: string | null }): Promise<void> {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await saveHub(env.DB, [fixture.identities.db.insertInto("loginCreations").values({ id, creatorLoginId: fixture.master.loginId,
    organizationId: null, createdLoginId: creation.createdLoginId, kind: null, details: "{}", createdAt: now, completedAt: creation.completedAt }).compile(),
    sql`update user set login_creation_id = ${id} where id = ${loginId}`.compile(fixture.identities.db)]);
}
async function makeHolderUnavailable(kind: string, loginId: string): Promise<void> {
  if (kind === "unfinished" || kind === "wrong completion") { await seedCreationRecord(loginId, { createdLoginId: kind === "wrong completion" ? fixture.master.loginId : loginId, completedAt: kind === "wrong completion" ? new Date().toISOString() : null }); return; }
  if (kind === "already held") { expect((await createAccount(creation({ holderLoginId: loginId, name: "Existing assignment" }), request())).isOk).toBe(true); return; }
  await saveHub(env.DB, [(kind === "suspended" ? sql`update user set banned = 1 where id = ${loginId}`
    : sql`update user set archived_at = ${new Date().toISOString()} where id = ${loginId}`).compile(fixture.identities.db)]);
}
async function revokeMaster(kind: string): Promise<void> {
  const loginId = fixture.master.loginId, sessionId = fixture.master.hubSessionId;
  if (kind === "ended") { await fixture.auth.api.signOut({ headers: { cookie: fixture.master.cookie } }); return; }
  if (kind === "creation") { await seedCreationRecord(loginId, { createdLoginId: loginId, completedAt: null }); return; }
  const queries = {
    expired: sql`update session set "expiresAt" = '2000-01-01T00:00:00.000Z' where id = ${sessionId}`,
    role: sql`update user set role = 'user' where id = ${loginId}`,
    suspended: sql`update user set banned = 1 where id = ${loginId}`,
    archived: sql`update user set archived_at = ${new Date().toISOString()} where id = ${loginId}`,
    profile: sql`update user set username = 'INVALID' where id = ${loginId}`,
    revision: sql`update user set auth_revision = auth_revision + 1 where id = ${loginId}`,
    factor: sql`delete from "twoFactor" where "userId" = ${loginId}`,
    mfa: sql`update session set mfa_verified_at = null where id = ${sessionId}`,
  };
  const query = queries[kind as keyof typeof queries]; if (!query) throw new Error("Unknown native revocation scenario.");
  await saveHub(env.DB, [query.compile(fixture.identities.db)]);
}
