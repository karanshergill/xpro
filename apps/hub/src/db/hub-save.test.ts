import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { v7 } from "uuid";
import { createHubDatabase, createHubMigrator } from "./hub.db";
import { saveHub } from "./hub-save.db";

type HubDatabase = Awaited<ReturnType<typeof createHubDatabase>>;
type AuditEntry = ReturnType<typeof makeAuditEntry>;
let db: HubDatabase;

beforeEach(async () => {
  db = await createHubDatabase(env.DB);
});
afterEach(async () => {
  await db.destroy();
});

describe("Hub saves", () => {
  it("when a batch succeeds then the record and its audit entry are saved together", async () => {
    await prepareDatabase();
    const reserved = makeReservedUsername();
    const audit = makeAuditEntry();
    await saveHub(env.DB, [
      db.insertInto("reservedUsernames").values(reserved).compile(),
      db.insertInto("auditEntries").values(audit).compile(),
    ]);
    expect(await readRecords()).toEqual({ reservedUsernames: [reserved],
      auditEntries: [{ ...audit, accountId: null, workspaceId: null, details: null }] });
  });

  it("when a later statement fails then earlier changes and their audit are rolled back while unrelated records stay unchanged", async () => {
    await prepareDatabase();
    const unrelated = makeReservedUsername();
    const originalAudit = makeAuditEntry();
    await saveHub(env.DB, [
      db.insertInto("reservedUsernames").values(unrelated).compile(),
      db.insertInto("auditEntries").values(originalAudit).compile(),
    ]);
    const before = await readRecords();
    expect(before).toEqual({ reservedUsernames: [unrelated],
      auditEntries: [{ ...originalAudit, accountId: null, workspaceId: null, details: null }] });
    const reserved = makeReservedUsername();
    const audit = makeAuditEntry();
    await expect(saveHub(env.DB, [
      db.insertInto("reservedUsernames").values(reserved).compile(),
      db.insertInto("auditEntries").values(audit).compile(),
      db.insertInto("reservedUsernames").values(reserved).compile(),
    ])).rejects.toThrow();
    expect(await readRecords()).toEqual(before);
  });

  it.each(auditChanges())("when a Hub audit entry is $name then the change is refused and its original content stays intact", async ({ change }) => {
    await prepareDatabase();
    const audit = makeAuditEntry();
    await saveHub(env.DB, [db.insertInto("auditEntries").values(audit).compile()]);
    await expect(saveHub(env.DB, [change(db, audit).compile()])).rejects.toThrow();
    expect(await db.selectFrom("auditEntries").selectAll().execute())
      .toEqual([{ ...audit, accountId: null, workspaceId: null, details: null }]);
  });

  it("when Hub migrations run again then existing records and audit history stay unchanged", async () => {
    await prepareDatabase();
    const reserved = makeReservedUsername();
    const audit = makeAuditEntry();
    await saveHub(env.DB, [
      db.insertInto("reservedUsernames").values(reserved).compile(),
      db.insertInto("auditEntries").values(audit).compile(),
    ]);
    const before = await readRecords();
    const result = await createHubMigrator(db).migrateToLatest();
    expect(result.error).toBeUndefined();
    expect(result.results).toEqual([]);
    expect(await readRecords()).toEqual(before);
  });

  it("when the Hub upgrades from its previous schema or empty state then records survive and audit protection works", async () => {
    const migrator = createHubMigrator(db);
    const available = await migrator.getMigrations();
    expect(available.length).toBeGreaterThan(0);
    // Start empty for the first schema; use the real predecessor once one exists.
    const previous = available.at(-2);
    const reserved = makeReservedUsername();
    const audit = makeAuditEntry();
    if (previous) {
      const earlier = await migrator.migrateTo(previous.name);
      expect(earlier.error).toBeUndefined();
      await saveHub(env.DB, [
        db.insertInto("reservedUsernames").values(reserved).compile(),
        db.insertInto("auditEntries").values(audit).compile(),
      ]);
    }
    const upgraded = await migrator.migrateToLatest();
    expect(upgraded.error).toBeUndefined();
    expect(upgraded.results?.some((result) => result.status === "Success")).toBe(true);
    expect(await readRecords()).toEqual(previous
      ? { reservedUsernames: [reserved], auditEntries: [{ ...audit, accountId: null, workspaceId: null, details: null }] }
      : { reservedUsernames: [], auditEntries: [] });
    if (!previous) {
      await saveHub(env.DB, [db.insertInto("auditEntries").values(audit).compile()]);
    }
    await expect(saveHub(env.DB, [db.deleteFrom("auditEntries").where("id", "=", audit.id).compile()])).rejects.toThrow();
    expect(await db.selectFrom("auditEntries").selectAll().execute())
      .toEqual([{ ...audit, accountId: null, workspaceId: null, details: null }]);
  });
});

function auditChanges() {
  return [
    {
      name: "updated",
      change: (database: HubDatabase, audit: AuditEntry) => database.updateTable("auditEntries")
        .set({ comment: "edited" }).where("id", "=", audit.id),
    },
    {
      name: "deleted",
      change: (database: HubDatabase, audit: AuditEntry) => database.deleteFrom("auditEntries").where("id", "=", audit.id),
    },
    {
      name: "replaced",
      change: (database: HubDatabase, audit: AuditEntry) => database.replaceInto("auditEntries").values({ ...audit, comment: "edited" }),
    },
    {
      name: "upserted",
      change: (database: HubDatabase, audit: AuditEntry) => database.insertInto("auditEntries").values(audit)
        .onConflict((conflict) => conflict.column("id").doUpdateSet({ comment: "edited" })),
    },
  ];
}

async function prepareDatabase(): Promise<void> {
  const result = await createHubMigrator(db).migrateToLatest();
  expect(result.error).toBeUndefined();
}

async function readRecords() {
  return {
    reservedUsernames: await db.selectFrom("reservedUsernames").selectAll().orderBy("id").execute(),
    auditEntries: await db.selectFrom("auditEntries").selectAll().orderBy("id").execute(),
  };
}

function makeReservedUsername() {
  const id = v7();
  return { id, username: `x${id.slice(-7)}`, addedAt: "2026-10-26T00:00:00.000Z" };
}

function makeAuditEntry() {
  return {
    id: v7(),
    action: "core_save_checked",
    outcome: "success" as const,
    actorLoginId: null,
    affectedLoginId: null,
    reason: null,
    comment: null,
    requestId: crypto.randomUUID(),
    createdAt: "2026-10-26T00:00:00.000Z",
  };
}
