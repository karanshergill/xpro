import { env } from "cloudflare:workers";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { createHubConnection } from "@xpro/core/server";
import { up as initialHub } from "#db/migrations/2026-10-27-010000-initial-hub.ts";
import { up as addPlacements } from "#db/migrations/2026-10-28-100900-workspace-placements.ts";

describe("Placement database upgrade", () => {
  it("when a conflicting view interrupts the real upgrade then rerunning finishes the partially created schema", async () => {
    const db = await createHubConnection<unknown>(env.DB);
    try {
      await initialHub(db);
      await sql`create view workspace_addresses as select 1 as id`.execute(db);
      await expect(addPlacements(db)).rejects.toThrow();
      expect((await sql<{ name: string }>`select name from sqlite_master where name = 'workspace_placements'`.execute(db)).rows)
        .toEqual([{ name: "workspace_placements" }]);
      await sql`drop view workspace_addresses`.execute(db);
      await addPlacements(db);
      await addPlacements(db);
      const tables = db.withTables<{ workspacePlacements: { id: string }; workspaceAddresses: { id: string } }>();
      expect(await tables.selectFrom("workspacePlacements").selectAll().execute()).toEqual([]);
      expect(await tables.selectFrom("workspaceAddresses").selectAll().execute()).toEqual([]);
    } finally { await db.destroy(); }
  });
});
