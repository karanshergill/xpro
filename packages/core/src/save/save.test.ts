import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { err, ok } from "true-myth/result";
import { v7 } from "uuid";
import { describe, expect, it } from "vitest";
import { createWorkspaceDatabase, createWorkspaceMigrator } from "#database/workspace.db";
import { save } from "./save.db";

type WorkspaceStub = ReturnType<typeof env.WORKSPACES.getByName>;
type WorkspaceDatabase = ReturnType<typeof createWorkspaceDatabase>;
type WorkspaceContext = { db: WorkspaceDatabase; storage: DurableObjectStorage };
type AuditEntry = ReturnType<typeof makeAuditEntry>;

describe("workspace saves", () => {
  it("when a save succeeds then its records and audit entry are saved together", async () => {
    const workspace = await prepareWorkspace();
    const user = makeWorkspaceUser();
    const audit = makeAuditEntry();
    await runInWorkspace(workspace, async ({ db, storage }) => {
      const result = await save(storage, async () => {
        await db.insertInto("workspaceUsers").values(user).execute();
        const saved = await db.selectFrom("workspaceUsers").selectAll().where("id", "=", user.id).executeTakeFirstOrThrow();
        expect(saved).toEqual(user);
        await db.insertInto("auditEntries").values(audit).execute();
        return ok({ userId: user.id });
      });
      expect(result.toJSON()).toEqual(ok({ userId: user.id }).toJSON());
      expect(await readRecords(db)).toEqual({ users: [user], auditEntries: [audit] });
    });
  });

  it("when a later write fails then earlier records and the audit entry are rolled back", async () => {
    const workspace = await prepareWorkspace();
    const user = makeWorkspaceUser();
    const audit = makeAuditEntry();
    await runInWorkspace(workspace, async ({ db, storage }) => {
      await expect(save(storage, async () => {
        await db.insertInto("workspaceUsers").values(user).execute();
        await db.insertInto("auditEntries").values(audit).execute();
        await db.insertInto("workspaceUsers").values(user).execute();
        return ok({ userId: user.id });
      })).rejects.toThrow();
      expect(await readRecords(db)).toEqual({ users: [], auditEntries: [] });
    });
  });

  it("when a rule returns a named failure after writes then those writes are rolled back", async () => {
    const workspace = await prepareWorkspace();
    const user = makeWorkspaceUser();
    const audit = makeAuditEntry();
    const refused = { code: "core_rule_refused" } as const;
    await runInWorkspace(workspace, async ({ db, storage }) => {
      const result = await save(storage, async () => {
        await db.insertInto("workspaceUsers").values(user).execute();
        await db.insertInto("auditEntries").values(audit).execute();
        return err(refused);
      });
      expect(result.toJSON()).toEqual(err(refused).toJSON());
      expect(await readRecords(db)).toEqual({ users: [], auditEntries: [] });
    });
  });

  it("when one workspace save fails then another workspace's records and audit history stay unchanged", async () => {
    const first = await prepareWorkspace();
    const second = await prepareWorkspace();
    const user = makeWorkspaceUser();
    const audit = makeAuditEntry();
    await runInWorkspace(second, async ({ db, storage }) => {
      await save(storage, async () => {
        await db.insertInto("workspaceUsers").values(user).execute();
        await db.insertInto("auditEntries").values(audit).execute();
        return ok({ userId: user.id });
      });
    });
    const before = await runInWorkspace(second, async ({ db }) => await readRecords(db));
    await runInWorkspace(first, async ({ db, storage }) => {
      await expect(save(storage, async () => {
        await db.insertInto("workspaceUsers").values(user).execute();
        await db.insertInto("auditEntries").values(audit).execute();
        await db.insertInto("workspaceUsers").values(user).execute();
        return ok({ userId: user.id });
      })).rejects.toThrow();
      expect(await readRecords(db)).toEqual({ users: [], auditEntries: [] });
    });
    const after = await runInWorkspace(second, async ({ db }) => await readRecords(db));
    expect(after).toEqual(before);
    expect(after).toEqual({ users: [user], auditEntries: [audit] });
  });

  it.each(auditChanges())("when an audit entry is $name then the change is refused and its original content stays intact", async ({ change }) => {
    const workspace = await prepareWorkspace();
    const audit = makeAuditEntry();
    await runInWorkspace(workspace, async ({ db, storage }) => {
      await save(storage, async () => {
        await db.insertInto("auditEntries").values(audit).execute();
        return ok({ auditId: audit.id });
      });
      await expect(save(storage, async () => {
        await change(db, audit).execute();
        return ok({ auditId: audit.id });
      })).rejects.toThrow();
      expect(await db.selectFrom("auditEntries").selectAll().execute()).toEqual([audit]);
    });
  });

  it("when current migrations run again then existing records and audit history stay unchanged", async () => {
    const workspace = await prepareWorkspace();
    const user = makeWorkspaceUser();
    const audit = makeAuditEntry();
    await runInWorkspace(workspace, async ({ db, storage }) => {
      await save(storage, async () => {
        await db.insertInto("workspaceUsers").values(user).execute();
        await db.insertInto("auditEntries").values(audit).execute();
        return ok({ userId: user.id });
      });
      const before = await readRecords(db);
      const result = await createWorkspaceMigrator(db).migrateToLatest();
      expect(result.error).toBeUndefined();
      expect(result.results).toEqual([]);
      expect(await readRecords(db)).toEqual(before);
    });
  });

  it("when workspace storage upgrades from its previous schema or empty state then records survive and audit protection works", async () => {
    const workspace = env.WORKSPACES.getByName(v7());
    const user = makeWorkspaceUser();
    const audit = makeAuditEntry();
    await runInWorkspace(workspace, async ({ db, storage }) => {
      // Clear only this test's object, including any schema installed by its constructor.
      await storage.deleteAll();
      const migrator = createWorkspaceMigrator(db);
      const available = await migrator.getMigrations();
      expect(available.length).toBeGreaterThan(0);
      // Start empty for the first schema; use the real predecessor once one exists.
      const previous = available.at(-2);
      if (previous) {
        const earlier = await migrator.migrateTo(previous.name);
        expect(earlier.error).toBeUndefined();
        await save(storage, async () => {
          await db.insertInto("workspaceUsers").values(user).execute();
          await db.insertInto("auditEntries").values(audit).execute();
          return ok({ userId: user.id });
        });
      }
      const upgraded = await migrator.migrateToLatest();
      expect(upgraded.error).toBeUndefined();
      expect(upgraded.results?.some((result) => result.status === "Success")).toBe(true);
      expect(await readRecords(db)).toEqual(previous
        ? { users: [user], auditEntries: [audit] }
        : { users: [], auditEntries: [] });
      if (!previous) {
        await save(storage, async () => {
          await db.insertInto("auditEntries").values(audit).execute();
          return ok({ auditId: audit.id });
        });
      }
      await expect(save(storage, async () => {
        await db.deleteFrom("auditEntries").where("id", "=", audit.id).execute();
        return ok({ auditId: audit.id });
      })).rejects.toThrow();
      expect(await db.selectFrom("auditEntries").selectAll().execute()).toEqual([audit]);
    });
  });
});

function auditChanges() {
  return [
    {
      name: "updated",
      change: (db: WorkspaceDatabase, audit: AuditEntry) => db.updateTable("auditEntries")
        .set({ comment: "edited" }).where("id", "=", audit.id),
    },
    {
      name: "deleted",
      change: (db: WorkspaceDatabase, audit: AuditEntry) => db.deleteFrom("auditEntries").where("id", "=", audit.id),
    },
    {
      name: "replaced",
      change: (db: WorkspaceDatabase, audit: AuditEntry) => db.replaceInto("auditEntries").values({ ...audit, comment: "edited" }),
    },
    {
      name: "upserted",
      change: (db: WorkspaceDatabase, audit: AuditEntry) => db.insertInto("auditEntries").values(audit)
        .onConflict((conflict) => conflict.column("id").doUpdateSet({ comment: "edited" })),
    },
  ];
}

async function prepareWorkspace(): Promise<WorkspaceStub> {
  const workspace = env.WORKSPACES.getByName(v7());
  await runInWorkspace(workspace, async ({ db }) => {
    const result = await createWorkspaceMigrator(db).migrateToLatest();
    expect(result.error).toBeUndefined();
  });
  return workspace;
}

async function runInWorkspace<Value>(workspace: WorkspaceStub, run: (context: WorkspaceContext) => Promise<Value>): Promise<Value> {
  return await runInDurableObject(workspace, async (_instance, state) => {
    const db = createWorkspaceDatabase(state.storage.sql);
    try {
      return await run({ db, storage: state.storage });
    } finally {
      await db.destroy();
    }
  });
}

async function readRecords(db: WorkspaceDatabase) {
  return {
    users: await db.selectFrom("workspaceUsers").selectAll().orderBy("id").execute(),
    auditEntries: await db.selectFrom("auditEntries").selectAll().orderBy("id").execute(),
  };
}

function makeWorkspaceUser() {
  return { id: v7(), loginId: v7(), kind: "internal" as const, createdAt: "2026-10-26T00:00:00.000Z", archivedAt: null };
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
