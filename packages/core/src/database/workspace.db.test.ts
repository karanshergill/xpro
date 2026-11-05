import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { sql } from "kysely";
import { ok } from "true-myth/result";
import { v7 } from "uuid";
import { describe, expect, it } from "vitest";
import { save } from "#save/save.db.ts";
import { createWorkspaceDatabase, upgradeWorkspaceDatabase } from "./workspace.db";

type WorkspaceStub = ReturnType<typeof env.WORKSPACES.getByName>;
type WorkspaceDatabase = ReturnType<typeof createWorkspaceDatabase>;
type WorkspaceContext = { db: WorkspaceDatabase; storage: DurableObjectStorage };
const createdAt = "2026-10-27T00:00:00.000Z";

describe("workspace schema and startup", () => {
  it("when a workspace starts then its actual migrations finish before its schema is read", async () => {
    await runInWorkspace(makeWorkspace(), async ({ db }) => {
      const tables = (await sql<{ name: string; type: string; strict: number }>`pragma table_list`.execute(db)).rows;
      for (const name of ["workspace_users", "sessions", "audit_entries"]) {
        expect(tables.find((table) => table.name === name)?.strict, name).toBe(1);
      }
      for (const name of ["kysely_migration", "kysely_migration_lock"]) {
        expect(tables.find((table) => table.name === name), name).toBeDefined();
      }
      const unexpected = tables.filter((table) => table.type === "table" && table.strict !== 1
        && !["kysely_migration", "kysely_migration_lock"].includes(table.name)
        && !table.name.startsWith("sqlite_") && !table.name.startsWith("_cf_"));
      expect(unexpected).toEqual([]);
    });
  });

  it("when first requests arrive together then each sees the completed startup schema", async () => {
    const workspace = makeWorkspace();
    const read = async () => await runInWorkspace(workspace, async ({ db }) => await db.selectFrom("workspaceUsers").selectAll().execute());
    expect(await Promise.all([read(), read()])).toEqual([[], []]);
  });

  it.each(["internal", "external"] as const)("when a workspace restarts then its %s user, sessions, audit history and other business state survive", async (kind) => {
    const workspace = makeWorkspace();
    const user = makeUser(kind);
    const session = makeSession(user.loginId);
    const audit = makeAuditEntry(user.loginId);
    const businessState = { permissions: ["example_read"], nested_key: { preserved_key: true } };
    await runInWorkspace(workspace, async ({ db, storage }) => {
      await save(storage, async () => {
        await db.insertInto("workspaceUsers").values(user).execute();
        await db.insertInto("sessions").values(session).execute();
        await db.insertInto("auditEntries").values(audit).execute();
        await storage.put("business_state", businessState);
        return ok(user.id);
      });
    });
    await evictDurableObject(workspace);
    await runInWorkspace(workspace, async ({ db, storage }) => {
      expect(await db.selectFrom("workspaceUsers").selectAll().execute()).toEqual([user]);
      expect(await db.selectFrom("sessions").selectAll().execute()).toEqual([session]);
      expect(await db.selectFrom("auditEntries").selectAll().execute()).toEqual([audit]);
      expect(await storage.get("business_state")).toEqual(businessState);
    });
  });

  it("when two local users refer to one Hub login then the duplicate is refused and the original stays intact", async () => {
    const user = makeUser();
    await runInWorkspace(makeWorkspace(), async ({ db, storage }) => {
      await save(storage, async () => { await db.insertInto("workspaceUsers").values(user).execute(); return ok(user.id); });
      await expect(save(storage, async () => {
        await db.insertInto("workspaceUsers").values({ ...user, id: v7() }).execute();
        return ok(user.id);
      })).rejects.toThrow();
      expect(await db.selectFrom("workspaceUsers").selectAll().execute()).toEqual([user]);
    });
  });

  it("when a stored user kind is invalid then the database refuses it without changing the user", async () => {
    const user = makeUser();
    await runInWorkspace(makeWorkspace(), async ({ db, storage }) => {
      await save(storage, async () => { await db.insertInto("workspaceUsers").values(user).execute(); return ok(user.id); });
      await expect(save(storage, async () => {
        await sql`update workspace_users set kind = ${"unsupported"} where id = ${user.id}`.execute(db);
        return ok(user.id);
      })).rejects.toThrow();
      expect(await db.selectFrom("workspaceUsers").selectAll().execute()).toEqual([user]);
    });
  });

  it("when a local session identifies a Hub login with no local user then storage accepts it", async () => {
    const session = makeSession(v7());
    await runInWorkspace(makeWorkspace(), async ({ db, storage }) => {
      await save(storage, async () => { await db.insertInto("sessions").values(session).execute(); return ok(session.id); });
      expect(await db.selectFrom("workspaceUsers").selectAll().execute()).toEqual([]);
      expect(await db.selectFrom("sessions").selectAll().execute()).toEqual([session]);
    });
  });

  it("when more than one local session comes from a Hub session then every matching session can be found", async () => {
    const first = makeSession(v7());
    const second = { ...first, id: v7() };
    await runInWorkspace(makeWorkspace(), async ({ db, storage }) => {
      await save(storage, async () => { await db.insertInto("sessions").values([first, second]).execute(); return ok(first.id); });
      expect(await db.selectFrom("sessions").selectAll().where("hubSessionId", "=", first.hubSessionId).orderBy("id").execute())
        .toEqual([first, second].sort((left, right) => left.id.localeCompare(right.id)));
    });
  });

  it("when a Hub identifier is stored then the reference column is indexed locally", async () => {
    await runInWorkspace(makeWorkspace(), async ({ db }) => {
      const references = {
        workspace_users: ["login_id"], sessions: ["login_id", "hub_session_id"], audit_entries: ["actor_login_id", "affected_login_id"],
      };
      for (const [table, columns] of Object.entries(references)) {
        const indexes = (await sql<{ name: string }>`pragma index_list(${sql.lit(table)})`.execute(db)).rows;
        const firstColumns: (string | null | undefined)[] = [];
        for (const index of indexes) {
          const fields = (await sql<{ seqno: number; name: string | null }>`pragma index_info(${sql.lit(index.name)})`.execute(db)).rows;
          firstColumns.push(fields.find((field) => field.seqno === 0)?.name);
        }
        for (const column of columns) expect(firstColumns, `${table}.${column}`).toContain(column);
      }
    });
  });

  it("when recording an upgrade fails then its DDL and migration record roll back and retry preserves business data", async () => {
    const user = makeUser();
    const audit = makeAuditEntry(user.loginId);
    await runInWorkspace(makeWorkspace(), async ({ db, storage }) => {
      await save(storage, async () => {
        await db.insertInto("workspaceUsers").values(user).execute();
        await db.insertInto("auditEntries").values(audit).execute();
        return ok(user.id);
      });
      // Damage this test's real installation and refuse its next bookkeeping write.
      await db.schema.dropTable("sessions").execute();
      await sql`delete from kysely_migration`.execute(db);
      await sql`create trigger core_test_refuse_migration before insert on kysely_migration
        begin select raise(abort, 'core_test_migration_refused'); end`.execute(db);
      await expect(upgradeWorkspaceDatabase(storage)).rejects.toThrow("core_test_migration_refused");
      expect((await sql<{ name: string }>`select name from sqlite_master where type = 'table' and name = 'sessions'`.execute(db)).rows).toEqual([]);
      expect((await sql`select name from kysely_migration`.execute(db)).rows).toEqual([]);
      expect(await db.selectFrom("workspaceUsers").selectAll().execute()).toEqual([user]);
      expect(await db.selectFrom("auditEntries").selectAll().execute()).toEqual([audit]);
      await sql`drop trigger core_test_refuse_migration`.execute(db);
      await upgradeWorkspaceDatabase(storage);
      expect(await db.selectFrom("sessions").selectAll().execute()).toEqual([]);
      expect(await db.selectFrom("workspaceUsers").selectAll().execute()).toEqual([user]);
      expect(await db.selectFrom("auditEntries").selectAll().execute()).toEqual([audit]);
    });
  });

  it("when an empty stored workspace is reconstructed then startup installs the actual schema again", async () => {
    const workspace = makeWorkspace();
    await runInWorkspace(workspace, async ({ storage }) => { await storage.deleteAll(); });
    await evictDurableObject(workspace);
    await runInWorkspace(workspace, async ({ db }) => {
      expect(await db.selectFrom("workspaceUsers").selectAll().execute()).toEqual([]);
      expect(await db.selectFrom("sessions").selectAll().execute()).toEqual([]);
      expect(await db.selectFrom("auditEntries").selectAll().execute()).toEqual([]);
      expect((await sql`select name from kysely_migration`.execute(db)).rows).toHaveLength(1);
    });
  });

  it("when newer code has recorded a later migration then older startup preserves the history and existing data", async () => {
    const workspace = makeWorkspace();
    const user = makeUser();
    const futureMigration = "9999-01-01-000000-future-version";
    const history = await runInWorkspace(workspace, async ({ db, storage }) => {
      await save(storage, async () => { await db.insertInto("workspaceUsers").values(user).execute(); return ok(user.id); });
      // Simulate the bookkeeping left by a newer additive release, using the real schema.
      await storage.transaction(async () => {
        await sql`insert into kysely_migration (name, timestamp) values (${futureMigration}, ${"9999-01-01T00:00:00.000Z"})`.execute(db);
      });
      return (await sql`select name, timestamp from kysely_migration order by name`.execute(db)).rows;
    });
    await evictDurableObject(workspace);
    await runInWorkspace(workspace, async ({ db }) => {
      expect(await db.selectFrom("workspaceUsers").selectAll().execute()).toEqual([user]);
      expect((await sql`select name, timestamp from kysely_migration order by name`.execute(db)).rows).toEqual(history);
    });
  });
});

function makeWorkspace(): WorkspaceStub { return env.WORKSPACES.getByName(v7()); }

async function runInWorkspace<Value>(workspace: WorkspaceStub, run: (context: WorkspaceContext) => Promise<Value>): Promise<Value> {
  return await runInDurableObject(workspace, async (_instance, state) => {
    const db = createWorkspaceDatabase(state.storage.sql);
    try { return await run({ db, storage: state.storage }); }
    finally { await db.destroy(); }
  });
}

function makeUser(kind: "internal" | "external" = "internal") {
  return { id: v7(), loginId: v7(), kind, createdAt, archivedAt: createdAt };
}

function makeSession(loginId: string) {
  return { id: v7(), loginId, hubSessionId: v7(), expiresAt: "2026-11-26T00:00:00.000Z" };
}

function makeAuditEntry(affectedLoginId: string) {
  return {
    id: v7(), action: "core_schema_checked", outcome: "success", actorLoginId: v7(), affectedLoginId,
    reason: null, comment: null, requestId: crypto.randomUUID(), createdAt,
  };
}
