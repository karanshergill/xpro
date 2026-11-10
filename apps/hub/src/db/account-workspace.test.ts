import { env } from "cloudflare:workers";
import { saveHub } from "@xpro/core/server";
import { sql, type CompiledQuery, type RawBuilder } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { interruptAfterWrite } from "#test/creation-faults.db";
import type { HubIdentities } from "#test/hub-identities";
import { createHubAuth } from "#auth/auth.server.ts";
// The operator preflight lives outside src and has no runtime package alias.
import { readAccountWorkspacePreflight } from "../../scripts/account-workspace-preflight.db";
import { createHubDatabase, createHubMigrator } from "./hub.db";

type Database = HubIdentities["db"];
type Auth = HubIdentities["auth"];
type StoredRow = Record<string, unknown>;
type Table = "accounts" | "audit_entries" | "user" | "account" | "session" | "organization" | "member"
  | "verification" | "workspace_placements" | "workspace_addresses" | "workspaces" | "workspace_creations";
type Storage = Partial<Record<Table, StoredRow[]>>;
type Login = { id: string; cookie: string; sessionId: string };
type Allocation = { login: Login; accountId: string; workspaceId: string; creationId: string };
const predecessor = "2026-10-31-014344-master-mfa";
const timestamp = "2026-10-30T12:34:56.789Z";
const later = "2026-11-07T01:02:03.456Z";
const password = "Migration-password123!";
const preservedTables: Table[] = ["user", "account", "session", "organization", "member", "verification",
  "workspace_placements", "workspace_addresses"];
let db: Database;
let auth: Auth;

beforeEach(async () => {
  db = await createHubDatabase(env.DB);
  expect((await createHubMigrator(db).migrateTo(predecessor)).error).toBeUndefined();
  auth = await createHubAuth({ database: env.DB, baseURL: "https://migration.example.test",
    secret: crypto.randomUUID() + crypto.randomUUID() });
  await (await auth.$context).checkSchema?.();
});
afterEach(async () => { await db.destroy(); });

describe("account and workspace forward migration", () => {
  it("when the predecessor is empty then the registry creates empty strict allocation storage", async () => {
    await migrate();
    expect(await storage(["accounts", "workspaces", "workspace_creations", "audit_entries"])).toEqual({
      accounts: [], workspaces: [], workspace_creations: [], audit_entries: [],
    });
    const tables = await sql<{ name: string; strict: number }>`select name, strict from pragma_table_list
      where name in ('accounts', 'workspaces', 'workspace_creations', 'audit_entries') order by name`.execute(db);
    expect(tables.rows).toEqual([
      { name: "accounts", strict: 1 }, { name: "audit_entries", strict: 1 },
      { name: "workspace_creations", strict: 1 }, { name: "workspaces", strict: 1 },
    ]);
    expect(await readAccountWorkspacePreflight(env.DB)).toEqual({ status: "clear", issues: [] });
  });

  it("when retained native identities and unnamed accounts are upgraded then values and live sessions survive without invented mappings", async () => {
    const retained = await retain();
    const before = await storage(preservedTables);
    const oldAudit = await rows("audit_entries");
    await migrate();
    expect(await storage(preservedTables)).toEqual(before);
    expect(await rows("accounts")).toEqual([{ id: retained.accountId, owner_login_id: retained.login.id,
      created_at: timestamp, name: null, name_search: null, status: "stms_active", revision: 0, updated_at: timestamp }]);
    expect(await rows("audit_entries")).toEqual(oldAudit.map((row) => ({ ...row,
      account_id: null, workspace_id: null, details: null })));
    expect(await rows("workspaces")).toEqual([]);
    expect(await rows("workspace_creations")).toEqual([]);
    expect((await auth.api.getSession({ headers: { cookie: retained.login.cookie } }))?.session.id).toBe(retained.login.sessionId);
    expect(await readAccountWorkspacePreflight(env.DB)).toEqual({ status: "needs_review", issues: [
      { code: "stms_missing_account_name", recordIds: [retained.accountId], hasMore: false },
      { code: "stms_missing_workspace_account", recordIds: [retained.workspaceId], hasMore: false },
    ] });
    const upgraded = await storage([...preservedTables, "accounts", "audit_entries", "workspaces", "workspace_creations"]);
    await migrate();
    expect(await storage([...preservedTables, "accounts", "audit_entries", "workspaces", "workspace_creations"])).toEqual(upgraded);
    await expectUnchanged(sql`update audit_entries set comment = 'rewritten'`, /audit_entries_immutable/);
    await expectUnchanged(sql`delete from audit_entries`, /audit_entries_immutable/);
    await expectUnchanged(sql`insert or replace into audit_entries
      (id, action, outcome, request_id, created_at) values (${retained.auditId}, 'rewrite', 'success', 'replacement', ${later})`,
    /audit_entries_immutable/);
  });

  it("when a retained holder owns duplicate accounts then migration refuses before changing schema or data", async () => {
    const retained = await retain();
    await execute(sql`insert into accounts (id, owner_login_id, created_at)
      values (${crypto.randomUUID()}, ${retained.login.id}, ${later})`);
    const before = await storage([...preservedTables, "accounts", "audit_entries"]);
    const schema = await schemaRows();
    const accountColumns = await sql`select * from pragma_table_xinfo('accounts')`.execute(db);
    expect((await createHubMigrator(db).migrateToLatest()).error).toBeDefined();
    expect(await schemaRows()).toEqual(schema);
    expect((await sql`select * from pragma_table_xinfo('accounts')`.execute(db)).rows).toEqual(accountColumns.rows);
    expect(await storage([...preservedTables, "accounts", "audit_entries"])).toEqual(before);
  });

  it.each([
    ["account label", /^alter table accounts add column name\b/],
    ["account revision", /^alter table accounts add column revision\b/],
    ["account timestamp", /^alter table accounts add column updated_at\b/],
    ["workspace table", /^create table (?:if not exists )?workspaces\b/],
    ["creation table", /^create table (?:if not exists )?workspace_creations\b/],
    ["audit account link", /^alter table audit_entries add column account_id\b/],
    ["audit workspace link", /^alter table audit_entries add column workspace_id\b/],
    ["audit details", /^alter table audit_entries add column details\b/],
  ] as const)("when committed %s DDL loses its reply then a fresh registry run preserves records and completes the migration", async (_label, target) => {
    const retained = await retain();
    const before = await storage(preservedTables);
    await interrupt(target);
    const fresh: Database = await createHubDatabase(env.DB);
    try {
      expect((await createHubMigrator(fresh).migrateToLatest()).error).toBeUndefined();
      expect(await storage(preservedTables, fresh)).toEqual(before);
      expect(await rows("accounts", fresh)).toEqual([{ id: retained.accountId, owner_login_id: retained.login.id,
        created_at: timestamp, name: null, name_search: null, status: "stms_active", revision: 0, updated_at: timestamp }]);
      const complete = await storage(["accounts", "audit_entries", "workspaces", "workspace_creations"], fresh);
      expect((await createHubMigrator(fresh).migrateToLatest()).error).toBeUndefined();
      expect(await storage(["accounts", "audit_entries", "workspaces", "workspace_creations"], fresh)).toEqual(complete);
      expect((await auth.api.getSession({ headers: { cookie: retained.login.cookie } }))?.session.id).toBe(retained.login.sessionId);
    } finally { await fresh.destroy(); }
  });

  it("when a retained unnamed account is reviewed then it may stay unnamed but a named account cannot be cleared", async () => {
    const retained = await retain();
    await migrate();
    await execute(sql`update accounts set status = 'stms_suspended', revision = 1 where id = ${retained.accountId}`);
    expect((await rows("accounts"))[0]).toMatchObject({ name: null, name_search: null, status: "stms_suspended", revision: 1 });
    await expectUnchanged(sql`update accounts set name = 'Named' where id = ${retained.accountId}`);
    await execute(sql`update accounts set name = 'Équipe', name_search = 'équipe', updated_at = ${later}
      where id = ${retained.accountId}`);
    await expectUnchanged(sql`update accounts set name = null, name_search = null where id = ${retained.accountId}`);
    await migrate();
    expect((await rows("accounts"))[0]).toMatchObject({ name: "Équipe", name_search: "équipe", updated_at: later });
  });

  it("when allocation uniqueness or foreign keys are violated then no existing allocation changes", async () => {
    await migrate();
    const first = await allocate(), second = await prepareAllocation();
    await expectUnchanged(sql`insert into accounts (id, owner_login_id, name, name_search, created_at, updated_at)
      values (${crypto.randomUUID()}, ${first.login.id}, 'Duplicate', 'duplicate', ${timestamp}, ${timestamp})`);
    const spareOwner = await login();
    const spareWorkspace = await nativeWorkspace(spareOwner);
    await expectUnchanged(sql`insert into workspaces (id, account_id, region_hint, name_search, created_at, updated_at)
      values (${spareWorkspace}, ${first.accountId}, 'wnam', 'duplicate', ${timestamp}, ${timestamp})`);
    const original = (await rows("workspace_creations"))[0];
    if (!original) throw new Error("Missing creation fixture.");
    const duplicateWorkspace = { ...creationInput(first), id: crypto.randomUUID() };
    await expectCreationRejected(duplicateWorkspace);
    for (const column of ["workerName", "origin", "clientId"] as const) {
      const physicalColumn = column === "workerName" ? "worker_name" : column === "clientId" ? "client_id" : "origin";
      const value = original[physicalColumn];
      if (typeof value !== "string") throw new Error("Missing native allocation identity.");
      await expectCreationRejected({ ...creationInput(second), [column]: value });
    }
    await expectCreationRejected({ ...creationInput(second), initiatorLoginId: crypto.randomUUID() });
    await expectCreationRejected({ ...creationInput(second), attemptLoginId: crypto.randomUUID() });
    await expectCreationRejected({ ...creationInput(second), workspaceId: crypto.randomUUID() });
    await expectUnchanged(sql`insert into workspaces (id, account_id, region_hint, name_search, created_at, updated_at)
      values (${spareWorkspace}, ${crypto.randomUUID()}, 'wnam', 'missing', ${timestamp}, ${timestamp})`);
    const spareAccount = crypto.randomUUID();
    await execute(sql`insert into accounts (id, owner_login_id, name, name_search, created_at, updated_at)
      values (${spareAccount}, ${spareOwner.id}, 'Spare', 'spare', ${timestamp}, ${timestamp})`);
    await expectUnchanged(sql`insert into workspaces (id, account_id, region_hint, name_search, created_at, updated_at)
      values (${crypto.randomUUID()}, ${spareAccount}, 'wnam', 'missing', ${timestamp}, ${timestamp})`);
  });

  it("when replacement conflicts with workspace allocation keys then immutable allocation survives without child references", async () => {
    await migrate();
    const allocation = await prepareAllocation();
    const otherOwner = await login(), otherWorkspaceId = await nativeWorkspace(otherOwner);
    expect(await rows("workspace_creations")).toEqual([]);
    expect(await rows("audit_entries")).toEqual([]);
    await expectUnchanged(sql`insert or replace into workspaces
      (id, account_id, region_hint, name_search, created_at, updated_at)
      values (${allocation.workspaceId}, ${allocation.accountId}, 'weur', 'replacement', ${later}, ${later})`);
    await expectUnchanged(sql`insert or replace into workspaces
      (id, account_id, region_hint, name_search, created_at, updated_at)
      values (${otherWorkspaceId}, ${allocation.accountId}, 'wnam', 'replacement', ${later}, ${later})`);
  });

  it("when replacement conflicts with creation allocation keys then immutable identity survives", async () => {
    await migrate();
    const allocation = await allocate(), other = await prepareAllocation();
    const original = (await rows("workspace_creations")).find((row) => row.id === allocation.creationId);
    if (!original) throw new Error("Missing creation fixture.");
    await expectUnchanged(replacementCreationQuery({ ...creationInput(allocation), releaseId: "replacement-release" }));
    await expectUnchanged(replacementCreationQuery({ ...creationInput(allocation), id: crypto.randomUUID() }));
    for (const column of ["workerName", "origin", "clientId"] as const) {
      const physicalColumn = column === "workerName" ? "worker_name" : column === "clientId" ? "client_id" : "origin";
      const value = original[physicalColumn];
      if (typeof value !== "string") throw new Error("Missing immutable creation identity.");
      await expectUnchanged(replacementCreationQuery({ ...creationInput(other), [column]: value }));
    }
  });

  it("when creation fields violate routing and required-value checks then no creation is saved", async () => {
    await migrate();
    const allocation = await prepareAllocation();
    for (const workerName of ["bad-name", "XPRO-UPPER", "xpro_has_underscores", "xpro-" + "a".repeat(59)]) {
      await expectCreationRejected({ ...creationInput(allocation), workerName });
    }
    for (const origin of ["http://workspace.example.test", "https://UPPER.example.test"]) {
      await expectCreationRejected({ ...creationInput(allocation), origin });
    }
    for (const releaseId of ["", " \t\n\u00a0"]) {
      await expectCreationRejected({ ...creationInput(allocation), releaseId });
    }
    for (const credentialEnvelope of [null, "", " \t\n\u00a0"]) {
      await expectCreationRejected({ ...creationInput(allocation), credentialEnvelope });
    }
    for (const phase of ["unknown", "stms_complete"]) {
      await expectCreationRejected({ ...creationInput(allocation), phase });
    }
    for (const value of [null, "2026-02-30T01:02:03.456Z", "not-a-time"]) {
      await expectCreationRejected({ ...creationInput(allocation), createdAt: value });
      await expectCreationRejected({ ...creationInput(allocation), updatedAt: value });
      await expectCreationRejected({ ...creationInput(allocation), phase: "stms_complete", credentialEnvelope: null, completedAt: value });
    }
  });

  it("when required labels are blank or account labels are absent then inserts and updates are rejected", async () => {
    await migrate();
    const allocation = await allocate();
    const other = await login();
    for (const blank of ["", " ", "\t\n\r", "\u00a0", "\u2003\ufeff"]) {
      for (const column of ["name", "name_search"]) {
        await expectUnchanged(sql`update accounts set ${sql.ref(column)} = ${blank} where id = ${allocation.accountId}`);
      }
      for (const column of ["name_search", "region_hint"]) {
        await expectUnchanged(sql`update workspaces set ${sql.ref(column)} = ${blank} where id = ${allocation.workspaceId}`);
      }
      await expectUnchanged(sql`update workspace_creations set credential_envelope = ${blank} where id = ${allocation.creationId}`);
      await expectUnchanged(sql`insert into accounts (id, owner_login_id, name, name_search, created_at, updated_at)
        values (${crypto.randomUUID()}, ${other.id}, ${blank}, 'valid', ${timestamp}, ${timestamp})`);
    }
    await expectUnchanged(sql`insert into accounts (id, owner_login_id, name, name_search, created_at, updated_at)
      values (${crypto.randomUUID()}, ${other.id}, null, null, ${timestamp}, ${timestamp})`);
  });

  it("when new workspace labels or references are invalid then no mapping is stored", async () => {
    await migrate();
    const owner = await login(), accountId = crypto.randomUUID(), workspaceId = await nativeWorkspace(owner);
    await execute(sql`insert into accounts (id, owner_login_id, name, name_search, created_at, updated_at)
      values (${accountId}, ${owner.id}, 'New', 'new', ${timestamp}, ${timestamp})`);
    for (const blank of ["", " \t\n\u00a0", "\u2003\ufeff"]) {
      await expectUnchanged(sql`insert into workspaces (id, account_id, region_hint, name_search, created_at, updated_at)
        values (${workspaceId}, ${accountId}, ${blank}, 'workspace', ${timestamp}, ${timestamp})`);
      await expectUnchanged(sql`insert into workspaces (id, account_id, region_hint, name_search, created_at, updated_at)
        values (${workspaceId}, ${accountId}, 'wnam', ${blank}, ${timestamp}, ${timestamp})`);
    }
    await expectUnchanged(sql`insert into accounts (id, owner_login_id, name, name_search, created_at, updated_at)
      values (${crypto.randomUUID()}, ${crypto.randomUUID()}, 'Missing owner', 'missing owner', ${timestamp}, ${timestamp})`);
  });

  it("when a new mapping refers to a blank canonical workspace name then the mapping is refused", async () => {
    await migrate();
    const owner = await login(), accountId = crypto.randomUUID(), workspaceId = await nativeWorkspace(owner);
    await execute(sql`insert into accounts (id, owner_login_id, name, name_search, created_at, updated_at)
      values (${accountId}, ${owner.id}, 'New', 'new', ${timestamp}, ${timestamp})`);
    for (const blank of ["", " \t\n\u00a0", "\u2003\ufeff"]) {
      await execute(sql`update organization set name = ${blank} where id = ${workspaceId}`);
      await expectUnchanged(sql`insert into workspaces (id, account_id, region_hint, name_search, created_at, updated_at)
        values (${workspaceId}, ${accountId}, 'wnam', 'workspace', ${timestamp}, ${timestamp})`, /workspaces_name_required/);
    }
  });

  it("when a mapped workspace is renamed then a blank canonical name is refused and valid names preserve allocation", async () => {
    await migrate();
    const allocation = await allocate();
    for (const blank of ["", " \t\n\u00a0", "\u2003\ufeff"]) {
      await expectUnchanged(sql`update organization set name = ${blank} where id = ${allocation.workspaceId}`,
        /organization_workspace_name_required/);
    }
    const workspaces = await rows("workspaces"), creations = await rows("workspace_creations");
    await execute(sql`update organization set name = 'Renamed workspace' where id = ${allocation.workspaceId}`);
    expect((await rows("organization")).find((row) => row.id === allocation.workspaceId)?.name).toBe("Renamed workspace");
    expect(await rows("workspaces")).toEqual(workspaces);
    expect(await rows("workspace_creations")).toEqual(creations);
  });

  it("when status or revision is outside its domain then storage refuses it and accepts safe integer boundaries", async () => {
    await migrate();
    const allocation = await allocate();
    for (const table of ["accounts", "workspaces", "workspace_creations"] as const) {
      const id = table === "accounts" ? allocation.accountId : table === "workspaces" ? allocation.workspaceId : allocation.creationId;
      const column = table === "workspace_creations" ? "attempt_revision" : "revision";
      for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "not-an-integer", null]) {
        await expectUnchanged(sql`update ${sql.table(table)} set ${sql.ref(column)} = ${value} where id = ${id}`);
      }
      for (const value of [0, Number.MAX_SAFE_INTEGER]) {
        await execute(sql`update ${sql.table(table)} set ${sql.ref(column)} = ${value} where id = ${id}`);
        expect((await rows(table)).find((row) => row.id === id)?.[column]).toBe(value);
      }
      if (table !== "workspace_creations") {
        await expectUnchanged(sql`update ${sql.table(table)} set status = 'active' where id = ${id}`);
        await expectUnchanged(sql`update ${sql.table(table)} set status = null where id = ${id}`);
        await execute(sql`update ${sql.table(table)} set status = 'stms_suspended' where id = ${id}`);
        expect((await rows(table)).find((row) => row.id === id)?.status).toBe("stms_suspended");
      }
    }
  });

  it("when timestamps are missing noncanonical or impossible then new allocation storage refuses them", async () => {
    await migrate();
    const allocation = await allocate();
    const other = await login(), before = await allStorage();
    for (const value of [null, "", "2026-11-07", "2026-11-07T01:02:03Z", "2026-11-07T01:02:03.456+00:00",
      "2026-02-30T01:02:03.456Z", "2026-13-07T01:02:03.456Z", "2026-11-07T25:02:03.456Z"]) {
      for (const table of ["accounts", "workspaces", "workspace_creations"] as const) {
        const id = table === "accounts" ? allocation.accountId : table === "workspaces" ? allocation.workspaceId : allocation.creationId;
        for (const column of ["created_at", "updated_at"]) {
          await expect(execute(sql`update ${sql.table(table)} set ${sql.ref(column)} = ${value} where id = ${id}`)).rejects.toThrow();
        }
      }
      await expect(execute(sql`insert into accounts (id, owner_login_id, name, name_search, created_at, updated_at)
        values (${crypto.randomUUID()}, ${other.id}, 'New', 'new', ${value}, ${timestamp})`)).rejects.toThrow();
      await expect(execute(sql`insert into accounts (id, owner_login_id, name, name_search, created_at, updated_at)
        values (${crypto.randomUUID()}, ${other.id}, 'New', 'new', ${timestamp}, ${value})`)).rejects.toThrow();
    }
    expect(await allStorage()).toEqual(before);
  });

  it("when an allocated identity is changed then immutable links and routing identity stay fixed", async () => {
    await migrate();
    const allocation = await allocate(), other = await allocate();
    for (const [column, value] of [["id", other.workspaceId], ["account_id", other.accountId], ["region_hint", "weur"]]) {
      await expectUnchanged(sql`update workspaces set ${sql.ref(column)} = ${value} where id = ${allocation.workspaceId}`);
    }
    for (const [column, value] of [["id", crypto.randomUUID()], ["workspace_id", other.workspaceId],
      ["initiator_login_id", other.login.id], ["worker_name", "xpro-changed"], ["origin", "https://changed.example.test"],
      ["release_id", "release-changed"], ["client_id", "opaque-changed"]]) {
      await expectUnchanged(sql`update workspace_creations set ${sql.ref(column)} = ${value} where id = ${allocation.creationId}`);
    }
    await execute(sql`update workspace_creations set attempt_login_id = ${other.login.id},
      attempt_session_id = 'expired-native-session', attempt_revision = 1, error_code = 'stms_retry',
      credential_envelope = 'encrypted-retry-envelope', updated_at = ${later} where id = ${allocation.creationId}`);
    expect((await rows("workspace_creations")).find((row) => row.id === allocation.creationId)).toMatchObject({
      attempt_login_id: other.login.id, attempt_session_id: "expired-native-session", attempt_revision: 1,
      error_code: "stms_retry", credential_envelope: "encrypted-retry-envelope", updated_at: later,
    });
  });

  it("when creation progresses or completes then completion and encrypted-envelope invariants hold", async () => {
    await migrate();
    const allocation = await allocate();
    for (const phase of ["stms_registered", "stms_client_ready", "stms_artifact_verified", "stms_worker_verified", "stms_owner_prepared"]) {
      await execute(sql`update workspace_creations set phase = ${phase} where id = ${allocation.creationId}`);
      expect((await rows("workspace_creations"))[0]).toMatchObject({ phase, completed_at: null, credential_envelope: "encrypted-envelope" });
      await expectUnchanged(sql`update workspace_creations set credential_envelope = null where id = ${allocation.creationId}`);
      await expectUnchanged(sql`update workspace_creations set completed_at = ${later} where id = ${allocation.creationId}`);
    }
    await expectUnchanged(sql`update workspace_creations set phase = 'unknown' where id = ${allocation.creationId}`);
    await expectUnchanged(sql`update workspace_creations set phase = 'stms_complete' where id = ${allocation.creationId}`);
    await expectUnchanged(sql`update workspace_creations set phase = 'stms_complete', completed_at = ${later}
      where id = ${allocation.creationId}`);
    await expectUnchanged(sql`update workspace_creations set phase = 'stms_complete', credential_envelope = null,
      completed_at = 'not-a-time' where id = ${allocation.creationId}`);
    await execute(sql`update workspace_creations set phase = 'stms_complete', credential_envelope = null,
      completed_at = ${later} where id = ${allocation.creationId}`);
    expect((await rows("workspace_creations"))[0]).toMatchObject({ phase: "stms_complete", completed_at: later, credential_envelope: null });
    await expectUnchanged(sql`update workspace_creations set completed_at = null where id = ${allocation.creationId}`);
    await expectUnchanged(sql`update workspace_creations set credential_envelope = 'encrypted-again' where id = ${allocation.creationId}`);
  });

  it("when linked records are deleted then restrictions hold but native session deletion remains normal", async () => {
    await migrate();
    const allocation = await allocate();
    await execute(sql`insert into audit_entries (id, action, outcome, request_id, created_at, account_id, workspace_id, details)
      values (${crypto.randomUUID()}, 'stms_workspace_created', 'success', 'request', ${later},
        ${allocation.accountId}, ${allocation.workspaceId}, ${JSON.stringify({ revision: 0 })})`);
    for (const [table, id] of [["accounts", allocation.accountId], ["workspaces", allocation.workspaceId],
      ["organization", allocation.workspaceId], ["user", allocation.login.id]]) {
      await expectUnchanged(sql`delete from ${sql.table(table)} where id = ${id}`);
    }
    await expectUnchanged(sql`insert into audit_entries (id, action, outcome, request_id, created_at, details)
      values (${crypto.randomUUID()}, 'test', 'success', 'invalid-json', ${later}, '{broken')`);
    for (const column of ["account_id", "workspace_id"]) {
      await expectUnchanged(sql`insert into audit_entries (id, action, outcome, request_id, created_at, ${sql.ref(column)})
        values (${crypto.randomUUID()}, 'test', 'success', 'missing-link', ${later}, ${crypto.randomUUID()})`);
    }
    const creation = await rows("workspace_creations");
    await auth.api.signOut({ headers: { cookie: allocation.login.cookie } });
    expect(await rows("session")).toEqual([]);
    expect(await rows("workspace_creations")).toEqual(creation);
    expect(await auth.api.getSession({ headers: { cookie: allocation.login.cookie } })).toBeNull();
  });

  it("when audit links are the only remaining references then their target cannot be deleted", async () => {
    await migrate();
    const allocation = await allocate();
    await execute(sql`delete from workspace_creations where id = ${allocation.creationId}`);
    await execute(sql`insert into audit_entries (id, action, outcome, request_id, created_at, workspace_id)
      values (${crypto.randomUUID()}, 'stms_workspace_created', 'success', 'workspace-link', ${later}, ${allocation.workspaceId})`);
    await expectUnchanged(sql`delete from workspaces where id = ${allocation.workspaceId}`);
    const accountOwner = await login(), accountId = crypto.randomUUID();
    await execute(sql`insert into accounts (id, owner_login_id, name, name_search, created_at, updated_at)
      values (${accountId}, ${accountOwner.id}, 'Audit target', 'audit target', ${timestamp}, ${timestamp})`);
    await execute(sql`insert into audit_entries (id, action, outcome, request_id, created_at, account_id, details)
      values (${crypto.randomUUID()}, 'stms_account_created', 'success', 'account-link', ${later}, ${accountId}, null)`);
    await expectUnchanged(sql`delete from accounts where id = ${accountId}`);
  });

  it("when a mapped workspace lacks a creation then preflight identifies it without changing stored state", async () => {
    await migrate();
    const allocation = await allocate();
    await execute(sql`delete from workspace_creations where id = ${allocation.creationId}`);
    const before = await allStorage();
    expect(await readAccountWorkspacePreflight(env.DB)).toEqual({ status: "needs_review", issues: [
      { code: "stms_missing_workspace_creation", recordIds: [allocation.workspaceId], hasMore: false },
    ] });
    expect(await allStorage()).toEqual(before);
  });

  it("when a valid mapping has a legitimate unfinished creation then preflight is clear without completing it", async () => {
    await migrate();
    await allocate();
    const before = await allStorage();
    expect(await readAccountWorkspacePreflight(env.DB)).toEqual({ status: "clear", issues: [] });
    expect(await allStorage()).toEqual(before);
  });

  it("when migration stops with workspaces available but no creation table then preflight reports the missing creation safely", async () => {
    const retained = await retain();
    await interrupt(/^create table (?:if not exists )?workspaces\b/);
    await execute(sql`update accounts set name = 'Reviewed account', name_search = 'reviewed account' where id = ${retained.accountId}`);
    await insertWorkspace(retained);
    const before = await storage([...preservedTables, "accounts", "audit_entries", "workspaces"]);
    expect(await readAccountWorkspacePreflight(env.DB)).toEqual({ status: "needs_review", issues: [
      { code: "stms_missing_workspace_creation", recordIds: [retained.workspaceId], hasMore: false },
    ] });
    expect(await storage([...preservedTables, "accounts", "audit_entries", "workspaces"])).toEqual(before);
    await migrate();
    expect(await readAccountWorkspacePreflight(env.DB)).toEqual({ status: "needs_review", issues: [
      { code: "stms_missing_workspace_creation", recordIds: [retained.workspaceId], hasMore: false },
    ] });
  });
});

async function migrate(): Promise<void> {
  expect((await createHubMigrator(db).migrateToLatest()).error).toBeUndefined();
}

async function login(): Promise<Login> {
  const email = `migration-${crypto.randomUUID()}@example.test`;
  const { user } = await auth.api.createUser({ body: { email, password, name: "Migration fixture", role: "user",
    data: { username: `u${crypto.randomUUID().replaceAll("-", "").slice(0, 7)}` } } });
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map((part) => part.split(";")[0]).join("; ");
  const session = await auth.api.getSession({ headers: { cookie } });
  if (!session) throw new Error("Native migration fixture session missing.");
  return { id: user.id, cookie, sessionId: session.session.id };
}

async function nativeWorkspace(owner: Login): Promise<string> {
  const workspace = await auth.api.createOrganization({ body: {
    name: "Native workspace", slug: `migration-${crypto.randomUUID()}`, userId: owner.id,
  } });
  if (!workspace) throw new Error("Native migration fixture workspace missing.");
  return workspace.id;
}

async function retain(): Promise<Allocation & { auditId: string }> {
  const owner = await login();
  const accountId = crypto.randomUUID(), workspaceId = await nativeWorkspace(owner), auditId = crypto.randomUUID();
  await execute(sql`insert into accounts (id, owner_login_id, created_at) values (${accountId}, ${owner.id}, ${timestamp})`);
  await execute(sql`insert into audit_entries (id, action, outcome, actor_login_id, affected_login_id, reason, comment, request_id, created_at)
    values (${auditId}, 'stms_retained', 'success', ${owner.id}, ${owner.id}, 'kept reason', 'kept comment', 'retained-request', ${timestamp})`);
  const placementId = crypto.randomUUID();
  await execute(sql`insert into workspace_placements (id, organization_id, worker_name, created_at)
    values (${placementId}, ${workspaceId}, ${"xpro-" + crypto.randomUUID()}, ${timestamp})`);
  await execute(sql`insert into workspace_addresses (id, workspace_placement_id, origin, is_primary, created_at)
    values (${crypto.randomUUID()}, ${placementId}, ${"https://" + crypto.randomUUID() + ".example.test"}, 1, ${timestamp})`);
  await (await auth.$context).internalAdapter.createVerificationValue({
    identifier: "preserved-" + crypto.randomUUID(), value: "preserved-verification", expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { login: owner, accountId, workspaceId, creationId: crypto.randomUUID(), auditId };
}

async function prepareAllocation(): Promise<Allocation> {
  const owner = await login();
  const allocation = { login: owner, accountId: crypto.randomUUID(), workspaceId: await nativeWorkspace(owner), creationId: crypto.randomUUID() };
  await execute(sql`insert into accounts (id, owner_login_id, name, name_search, created_at, updated_at)
    values (${allocation.accountId}, ${owner.id}, 'Équipe', 'équipe', ${timestamp}, ${timestamp})`);
  await insertWorkspace(allocation);
  return allocation;
}

async function allocate(): Promise<Allocation> {
  const allocation = await prepareAllocation();
  await execute(creationQuery(creationInput(allocation)));
  expect((await rows("accounts")).find((row) => row.id === allocation.accountId)).toMatchObject({ status: "stms_active", revision: 0 });
  expect((await rows("workspaces")).find((row) => row.id === allocation.workspaceId)).toMatchObject({ status: "stms_active", revision: 0 });
  expect((await rows("workspace_creations")).find((row) => row.id === allocation.creationId)).toMatchObject({ attempt_revision: 0 });
  return allocation;
}

async function insertWorkspace(allocation: Pick<Allocation, "workspaceId" | "accountId">): Promise<void> {
  await execute(sql`insert into workspaces (id, account_id, region_hint, name_search, created_at, updated_at)
    values (${allocation.workspaceId}, ${allocation.accountId}, 'wnam', 'native workspace', ${timestamp}, ${timestamp})`);
}

async function execute(query: { compile(database: Database): CompiledQuery }): Promise<void> {
  await saveHub(env.DB, [query.compile(db)]);
}

async function rows(table: Table, database: Database = db): Promise<StoredRow[]> {
  return (await sql<StoredRow>`select * from ${sql.table(table)} order by id`.execute(database.withoutPlugins())).rows;
}

async function storage(tables: Table[], database: Database = db): Promise<Storage> {
  const result: Storage = {};
  for (const table of tables) result[table] = await rows(table, database);
  return result;
}

async function allStorage(): Promise<Storage> {
  return await storage([...preservedTables, "accounts", "audit_entries", "workspaces", "workspace_creations"]);
}

async function schemaRows(): Promise<StoredRow[]> {
  return (await sql<StoredRow>`select type, name, tbl_name from sqlite_master
    where name not like 'sqlite_%' order by type, name`.execute(db.withoutPlugins())).rows;
}

async function expectUnchanged(query: { compile(database: Database): CompiledQuery }, error?: RegExp): Promise<void> {
  const before = await allStorage();
  if (error) await expect(execute(query)).rejects.toThrow(error);
  else await expect(execute(query)).rejects.toThrow();
  expect(await allStorage()).toEqual(before);
}

async function interrupt(target: RegExp): Promise<void> {
  const interrupted: Database = await createHubDatabase(interruptAfterWrite(env.DB,
    (query) => target.test(query.replaceAll('"', "").toLowerCase())));
  try { expect((await createHubMigrator(interrupted).migrateToLatest()).error).toBeDefined(); }
  finally { await interrupted.destroy(); }
}


type CreationFixture = {
  id: string; workspaceId: string; initiatorLoginId: string; attemptLoginId: string; attemptSessionId: string;
  workerName: string; origin: string; releaseId: string; clientId: string; phase: string;
  credentialEnvelope: string | null; completedAt: string | null; createdAt: string | null; updatedAt: string | null;
};

function creationInput(allocation: Allocation): CreationFixture {
  return {
    id: allocation.creationId, workspaceId: allocation.workspaceId, initiatorLoginId: allocation.login.id,
    attemptLoginId: allocation.login.id, attemptSessionId: allocation.login.sessionId,
    workerName: "xpro-" + crypto.randomUUID(), origin: "https://" + crypto.randomUUID() + ".example.test",
    releaseId: "release-1", clientId: "native/opaque:" + crypto.randomUUID(), phase: "stms_registered",
    credentialEnvelope: "encrypted-envelope", completedAt: null, createdAt: timestamp, updatedAt: timestamp,
  };
}

function creationQuery(row: CreationFixture): RawBuilder<unknown> {
  return sql`insert into workspace_creations
    (id, workspace_id, initiator_login_id, attempt_login_id, attempt_session_id, phase, worker_name,
     origin, release_id, client_id, credential_envelope, completed_at, created_at, updated_at)
    values (${row.id}, ${row.workspaceId}, ${row.initiatorLoginId}, ${row.attemptLoginId}, ${row.attemptSessionId},
      ${row.phase}, ${row.workerName}, ${row.origin}, ${row.releaseId}, ${row.clientId}, ${row.credentialEnvelope},
      ${row.completedAt}, ${row.createdAt}, ${row.updatedAt})`;
}

async function expectCreationRejected(row: CreationFixture): Promise<void> {
  await expectUnchanged(creationQuery(row));
}

function replacementCreationQuery(row: CreationFixture): RawBuilder<unknown> {
  return sql`insert or replace into workspace_creations
    (id, workspace_id, initiator_login_id, attempt_login_id, attempt_session_id, phase, worker_name,
     origin, release_id, client_id, credential_envelope, completed_at, created_at, updated_at)
    values (${row.id}, ${row.workspaceId}, ${row.initiatorLoginId}, ${row.attemptLoginId}, ${row.attemptSessionId},
      ${row.phase}, ${row.workerName}, ${row.origin}, ${row.releaseId}, ${row.clientId}, ${row.credentialEnvelope},
      ${row.completedAt}, ${row.createdAt}, ${row.updatedAt})`;
}
