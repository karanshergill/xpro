import { env } from "cloudflare:workers";
import { Kysely, sql } from "kysely";
import { D1Dialect } from "kysely-d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveHub } from "./hub-save.db";

let db: Kysely<never>;
const probeView = "core_save_probe";

beforeEach(() => {
  db = new Kysely<never>({ dialect: new D1Dialect({ database: env.DB }) });
});
afterEach(async () => {
  await db.destroy();
});

describe("Hub prepared batches", () => {
  it("when values are bound then query results keep the original values and statement order", async () => {
    const first = "first ' ? value";
    const second = "second value";
    const queries = [
      sql`select ${first} as value`.compile(db),
      sql`select ${second} as value`.compile(db),
    ];
    const result = await saveHub(env.DB, queries);
    expect(result.map((statement) => statement.results)).toEqual([[{ value: first }], [{ value: second }]]);
    expect(queries[0]?.parameters).toEqual([first]);
    expect(queries[1]?.parameters).toEqual([second]);
  });

  it("when a batch succeeds then later statements see earlier SQL changes and those changes commit", async () => {
    const result = await saveHub(env.DB, [
      db.schema.createView(probeView).as(sql`select 1 as value`).compile(),
      sql`select value from core_save_probe`.compile(db),
    ]);
    expect(result.map((statement) => statement.results)).toEqual([[], [{ value: 1 }]]);
    expect((await sql<{ value: number }>`select value from core_save_probe`.execute(db)).rows).toEqual([{ value: 1 }]);
  });

  it("when a later statement fails then the earlier SQL change is rolled back", async () => {
    await expect(saveHub(env.DB, [
      db.schema.createView(probeView).as(sql`select 1 as value`).compile(),
      sql`select missing_column from core_save_probe`.compile(db),
    ])).rejects.toThrow();
    expect((await sql<{ name: string }>`select name from sqlite_master where type = 'view' and name = ${probeView}`.execute(db)).rows).toEqual([]);
  });
});
