import type { CompiledQuery } from "kysely";

export async function saveHub(database: D1Database, queries: readonly CompiledQuery[]): Promise<D1Result[]> {
  const statements = queries.map((query) => database.prepare(query.sql).bind(...query.parameters));
  // D1 results retain database column names; Kysely result plugins do not run here.
  return await database.batch(statements);
}
