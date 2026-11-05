import { sql, type Kysely } from "kysely";
import { authSchemaStatements } from "./2026-10-27-010000-auth.generated";

export async function up(database: Kysely<unknown>): Promise<void> {
  // Migration identifiers are physical names; never apply application naming plugins.
  const db = database.withoutPlugins();
  for (const statement of authSchemaStatements) await sql.raw(statement).execute(db);

  await db.schema.createTable("accounts").ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("owner_login_id", "text", (column) => column.notNull().references("user.id").onDelete("restrict"))
    .addColumn("created_at", "text", (column) => column.notNull())
    .modifyEnd(sql`STRICT`).execute();
  await db.schema.createTable("reserved_usernames").ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("username", "text", (column) => column.notNull().unique())
    .addColumn("added_at", "text", (column) => column.notNull())
    .addCheckConstraint("reserved_usernames_normalized", sql`username = lower(trim(username))`)
    .modifyEnd(sql`STRICT`).execute();
  await db.schema.createTable("login_creations").ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("creator_login_id", "text", (column) => column.notNull().references("user.id").onDelete("restrict"))
    .addColumn("organization_id", "text", (column) => column.references("organization.id").onDelete("restrict"))
    .addColumn("created_login_id", "text", (column) => column.unique().references("user.id").onDelete("restrict"))
    .addColumn("kind", "text")
    .addColumn("details", "text", (column) => column.notNull())
    .addColumn("created_at", "text", (column) => column.notNull())
    .addColumn("completed_at", "text")
    .addCheckConstraint("login_creations_kind", sql`kind is null or kind in ('internal', 'external')`)
    .addCheckConstraint("login_creations_details_json", sql`json_valid(details)`)
    .modifyEnd(sql`STRICT`).execute();
  await db.schema.createTable("audit_entries").ifNotExists()
    .addColumn("id", "text", (column) => column.primaryKey().notNull())
    .addColumn("action", "text", (column) => column.notNull())
    .addColumn("outcome", "text", (column) => column.notNull())
    .addColumn("actor_login_id", "text", (column) => column.references("user.id").onDelete("restrict"))
    .addColumn("affected_login_id", "text", (column) => column.references("user.id").onDelete("restrict"))
    .addColumn("reason", "text")
    .addColumn("comment", "text")
    .addColumn("request_id", "text", (column) => column.notNull())
    .addColumn("created_at", "text", (column) => column.notNull())
    .modifyEnd(sql`STRICT`).execute();

  await db.schema.createIndex("accounts_owner_login_id_idx").ifNotExists().on("accounts").column("owner_login_id").execute();
  await db.schema.createIndex("login_creations_creator_login_id_idx").ifNotExists().on("login_creations").column("creator_login_id").execute();
  await db.schema.createIndex("login_creations_organization_id_idx").ifNotExists().on("login_creations").column("organization_id").execute();
  await db.schema.createIndex("audit_entries_actor_login_id_idx").ifNotExists().on("audit_entries").column("actor_login_id").execute();
  await db.schema.createIndex("audit_entries_affected_login_id_idx").ifNotExists().on("audit_entries").column("affected_login_id").execute();
  await db.schema.createIndex("invitation_inviter_id_idx").ifNotExists().on("invitation").column("inviterId").execute();
  await db.schema.createIndex("member_one_workspace_per_login").ifNotExists().unique().on("member").column("userId").execute();
  await db.schema.createIndex("account_one_password_per_login").ifNotExists().unique().on("account").column("userId")
    .where(sql.ref("providerId"), "=", sql.lit("credential")).execute();
  await db.schema.createIndex("user_email_normalized_unique").ifNotExists().unique().on("user")
    .expression(sql`lower(trim(email))`).execute();
  await db.schema.createIndex("user_username_normalized_unique").ifNotExists().unique().on("user")
    .expression(sql`lower(trim(username))`).execute();

  await sql`create trigger if not exists user_refuse_delete before delete on "user"
    begin select raise(abort, 'user_refuse_delete'); end`.execute(db);
  await sql`create trigger if not exists user_reserved_username_insert before insert on "user"
    when exists (select 1 from reserved_usernames where username = lower(trim(new.username)))
    begin select raise(abort, 'user_reserved_username'); end`.execute(db);
  await sql`create trigger if not exists user_reserved_username_update before update of username on "user"
    when exists (select 1 from reserved_usernames where username = lower(trim(new.username)))
    begin select raise(abort, 'user_reserved_username'); end`.execute(db);
  await sql`create trigger if not exists audit_entries_refuse_update before update on audit_entries
    begin select raise(abort, 'audit_entries_immutable'); end`.execute(db);
  await sql`create trigger if not exists audit_entries_refuse_delete before delete on audit_entries
    begin select raise(abort, 'audit_entries_immutable'); end`.execute(db);
  // REPLACE may skip DELETE triggers. This also refuses conflict-updates before they run.
  await sql`create trigger if not exists audit_entries_refuse_replacement before insert on audit_entries
    when exists (select 1 from audit_entries where id = new.id)
    begin select raise(abort, 'audit_entries_immutable'); end`.execute(db);
}
