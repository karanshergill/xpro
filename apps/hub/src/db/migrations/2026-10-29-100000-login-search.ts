import { normalizeSearchText } from "@xpro/accounts";
import { sql, type Kysely } from "kysely";

export type SearchNameTables = { user: { id: string; name: string; name_search: string | null } };
// Each changed row uses four parameters, within D1's 100-parameter statement limit.
const backfillBatchSize = 25;

export async function up(database: Kysely<unknown>): Promise<void> {
  const db = database.withoutPlugins().withTables<SearchNameTables>();
  const tables = await db.introspection.getTables();
  if (!tables.find((table) => table.name === "user")?.columns.some((column) => column.name === "name_search")) {
    await db.schema.alterTable("user").addColumn("name_search", "text").execute();
  }
  await db.schema.createIndex("user_login_list_idx").ifNotExists().on("user").columns(["archived_at", "createdAt", "id"]).execute();
  await db.schema.createIndex("user_login_name_prefix_idx").ifNotExists().on("user").columns(["name_search", "id"]).execute();
  await fillMissingLoginSearchNames(db);
}

export async function fillMissingLoginSearchNames(database: Kysely<SearchNameTables>): Promise<void> {
  const db = database.withoutPlugins();
  while (true) {
    const rows = await db.selectFrom("user").select(["id", "name"]).where("name_search", "is", null)
      .orderBy("id").limit(backfillBatchSize).execute();
    if (rows.length === 0) break;
    // Each chunk commits independently. Repeated runs resume from indexed NULL
    // copies; a concurrent name change cannot overwrite a newer derived value.
    const cases = rows.map((row) => sql`when id = ${row.id} and name = ${row.name} then ${normalizeSearchText(row.name)}`);
    await db.updateTable("user").set({ name_search: sql<string>`case ${sql.join(cases, sql` `)} else name_search end` })
      .where("id", "in", rows.map((row) => row.id)).execute();
  }
}
