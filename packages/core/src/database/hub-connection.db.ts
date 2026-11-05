import { createKyselyAdapter } from "@better-auth/kysely-adapter";
import { CamelCasePlugin, type Kysely } from "kysely";

export async function createHubConnection<Database>(database: D1Database): Promise<Kysely<Database>> {
  const { kysely } = await createKyselyAdapter({ database });
  if (!kysely) throw new Error("Better Auth did not provide its D1 adapter.");
  // The native adapter returns Kysely<any>; each data layer supplies its migrated table view.
  return kysely.withPlugin(new CamelCasePlugin({ maintainNestedObjectKeys: true })) as Kysely<Database>;
}
