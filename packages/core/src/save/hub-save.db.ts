import type { CompiledQuery } from "kysely";

export async function saveHub<Row = unknown>(database: D1Database, queries: readonly CompiledQuery[]): Promise<D1Result<Row>[]> {
  const statements = queries.map((query) => database.prepare(query.sql).bind(...query.parameters));
  // D1 results retain database column names; Kysely result plugins do not run here.
  return await database.batch<Row>(statements);
}
