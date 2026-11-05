import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  const db = database.withoutPlugins();
  await db.schema.createTable("workspace_placements").ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("organization_id", "text", (column) => column.notNull().unique().references("organization.id").onDelete("restrict"))
    .addColumn("worker_name", "text", (column) => column.notNull().unique())
    .addColumn("created_at", "text", (column) => column.notNull())
    .addCheckConstraint("workspace_placements_worker_name", sql`length(worker_name) between 4 and 63 and (worker_name = 'xpro' or worker_name like 'xpro-%') and worker_name = lower(worker_name) and worker_name not glob '*[^a-z0-9-]*'`)
    .modifyEnd(sql`STRICT`).execute();
  await db.schema.createTable("workspace_addresses").ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("workspace_placement_id", "text", (column) => column.notNull().references("workspace_placements.id").onDelete("restrict"))
    .addColumn("origin", "text", (column) => column.notNull().unique())
    .addColumn("is_primary", "integer", (column) => column.notNull())
    .addColumn("created_at", "text", (column) => column.notNull())
    .addCheckConstraint("workspace_addresses_origin", sql`origin like 'https://%' and origin = lower(origin)`)
    .addCheckConstraint("workspace_addresses_is_primary", sql`is_primary in (0, 1)`)
    .modifyEnd(sql`STRICT`).execute();
  await db.schema.createIndex("workspace_addresses_workspace_placement_id_idx").ifNotExists()
    .on("workspace_addresses").column("workspace_placement_id").execute();
  await db.schema.createIndex("workspace_addresses_one_primary").ifNotExists().unique()
    .on("workspace_addresses").column("workspace_placement_id").where(sql.ref("is_primary"), "=", sql.lit(1)).execute();
}
