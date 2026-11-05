import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  const db = database.withoutPlugins();
  // Hub identifiers refer across databases; local-user existence does not grant access.
  await db.schema.createTable("workspace_users").ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("login_id", "text", (column) => column.notNull().unique())
    .addColumn("kind", "text", (column) => column.notNull())
    .addColumn("created_at", "text", (column) => column.notNull())
    .addColumn("archived_at", "text")
    .addCheckConstraint("workspace_users_kind", sql`kind in ('internal', 'external')`)
    .modifyEnd(sql`STRICT`).execute();
  await db.schema.createTable("sessions").ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("login_id", "text", (column) => column.notNull())
    .addColumn("hub_session_id", "text", (column) => column.notNull())
    .addColumn("expires_at", "text", (column) => column.notNull())
    .modifyEnd(sql`STRICT`).execute();
  await db.schema.createTable("audit_entries").ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("action", "text", (column) => column.notNull())
    .addColumn("outcome", "text", (column) => column.notNull())
    .addColumn("actor_login_id", "text")
    .addColumn("affected_login_id", "text")
    .addColumn("reason", "text")
    .addColumn("comment", "text")
    .addColumn("request_id", "text", (column) => column.notNull())
    .addColumn("created_at", "text", (column) => column.notNull())
    .modifyEnd(sql`STRICT`).execute();

  await db.schema.createIndex("sessions_login_id_idx").ifNotExists().on("sessions").column("login_id").execute();
  await db.schema.createIndex("sessions_hub_session_id_idx").ifNotExists().on("sessions").column("hub_session_id").execute();
  await db.schema.createIndex("audit_entries_actor_login_id_idx").ifNotExists().on("audit_entries").column("actor_login_id").execute();
  await db.schema.createIndex("audit_entries_affected_login_id_idx").ifNotExists().on("audit_entries").column("affected_login_id").execute();

  await sql`create trigger if not exists audit_entries_refuse_update before update on audit_entries
    begin select raise(abort, 'audit_entries_immutable'); end`.execute(db);
  await sql`create trigger if not exists audit_entries_refuse_delete before delete on audit_entries
    begin select raise(abort, 'audit_entries_immutable'); end`.execute(db);
  // REPLACE may skip DELETE triggers. Refuse it before conflict handling starts.
  await sql`create trigger if not exists audit_entries_refuse_replacement before insert on audit_entries
    when exists (select 1 from audit_entries where id = new.id)
    begin select raise(abort, 'audit_entries_immutable'); end`.execute(db);
}
