import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { sql } from "kysely";
import { createWorkspaceDatabase } from "#database/workspace.db.ts";
import { err, ok } from "true-myth/result";
import { describe, expect, it } from "vitest";
import { save } from "./save.db";

type WorkspaceStub = ReturnType<typeof env.WORKSPACES.getByName>;
type StorageContext = { db: ReturnType<typeof createWorkspaceDatabase>; storage: DurableObjectStorage };
const probeView = "core_save_probe";

// A disposable view exercises SQL atomicity independently of application migrations.
describe("workspace storage transactions", () => {
  it("when a save succeeds then SQL and KV changes commit and its result is returned", async () => {
    const workspace = env.WORKSPACES.getByName(crypto.randomUUID());
    await runInStorage(workspace, async ({ db, storage }) => {
      const result = await save(storage, async () => {
        await db.schema.createView(probeView).as(sql`select 1 as value`).execute();
        await storage.put("marker", "saved");
        expect(await storage.get("marker")).toBe("saved");
        expect((await sql<{ value: number }>`select value from core_save_probe`.execute(db)).rows).toEqual([{ value: 1 }]);
        return ok("saved");
      });
      expect(result.toJSON()).toEqual(ok("saved").toJSON());
      expect(await storage.get("marker")).toBe("saved");
      expect((await sql<{ value: number }>`select value from core_save_probe`.execute(db)).rows).toEqual([{ value: 1 }]);
    });
  });

  it("when a save returns a named failure then SQL and KV changes are rolled back", async () => {
    const workspace = env.WORKSPACES.getByName(crypto.randomUUID());
    const refused = { code: "core_rule_refused" } as const;
    await runInStorage(workspace, async ({ db, storage }) => {
      const result = await save(storage, async () => {
        await db.schema.createView(probeView).as(sql`select 1 as value`).execute();
        await storage.put("marker", "refused");
        return err(refused);
      });
      expect(result.toJSON()).toEqual(err(refused).toJSON());
      expect(await storage.get("marker")).toBeUndefined();
      expect((await sql<{ name: string }>`select name from sqlite_master where type = 'view' and name = ${probeView}`.execute(db)).rows).toEqual([]);
    });
  });

  it("when a save throws after writes then SQL and KV changes are rolled back and the error is propagated", async () => {
    const workspace = env.WORKSPACES.getByName(crypto.randomUUID());
    const failure = new Error("Save failed after its writes");
    await runInStorage(workspace, async ({ db, storage }) => {
      await expect(save(storage, async () => {
        await db.schema.createView(probeView).as(sql`select 1 as value`).execute();
        await storage.put("marker", "failed");
        throw failure;
      })).rejects.toBe(failure);
      expect(await storage.get("marker")).toBeUndefined();
      expect((await sql<{ name: string }>`select name from sqlite_master where type = 'view' and name = ${probeView}`.execute(db)).rows).toEqual([]);
    });
  });

  it("when one workspace rolls back then another workspace keeps its committed state", async () => {
    const first = env.WORKSPACES.getByName(crypto.randomUUID());
    const second = env.WORKSPACES.getByName(crypto.randomUUID());
    await runInStorage(second, async ({ db, storage }) => {
      await save(storage, async () => {
        await db.schema.createView(probeView).as(sql`select 1 as value`).execute();
        await storage.put("marker", "second");
        return ok("saved");
      });
    });
    await runInStorage(first, async ({ db, storage }) => {
      await save(storage, async () => {
        await db.schema.createView(probeView).as(sql`select 1 as value`).execute();
        await storage.put("marker", "first");
        return err({ code: "core_rule_refused" });
      });
      expect(await storage.get("marker")).toBeUndefined();
      expect((await sql<{ name: string }>`select name from sqlite_master where type = 'view' and name = ${probeView}`.execute(db)).rows).toEqual([]);
    });
    await runInStorage(second, async ({ db, storage }) => {
      expect(await storage.get("marker")).toBe("second");
      expect((await sql<{ value: number }>`select value from core_save_probe`.execute(db)).rows).toEqual([{ value: 1 }]);
    });
  });
});

async function runInStorage<Value>(workspace: WorkspaceStub, run: (context: StorageContext) => Promise<Value>): Promise<Value> {
  return await runInDurableObject(workspace, async (_instance, state) => {
    const db = createWorkspaceDatabase(state.storage.sql);
    try {
      return await run({ db, storage: state.storage });
    } finally {
      await db.destroy();
    }
  });
}
