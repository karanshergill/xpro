import { sql, type Kysely } from "kysely";

// Native 1.7.12 schema, with the approved private columns and revision checks.
const columns = [
  { table: "user", name: "twoFactorEnabled", statement: 'alter table "user" add column "twoFactorEnabled" integer default 0' },
  { table: "user", name: "auth_revision", statement: 'alter table "user" add column "auth_revision" integer default 0 not null constraint user_auth_revision_range check(typeof(auth_revision) = \'integer\' and auth_revision between 0 and 9007199254740991)' },
  { table: "session", name: "auth_revision", statement: 'alter table "session" add column "auth_revision" integer default 0 not null constraint session_auth_revision_range check(typeof(auth_revision) = \'integer\' and auth_revision between 0 and 9007199254740991)' },
  { table: "session", name: "mfa_verified_at", statement: 'alter table "session" add column "mfa_verified_at" text' },
  { table: "verification", name: "auth_revision", statement: 'alter table "verification" add column "auth_revision" integer constraint verification_auth_revision_range check(auth_revision is null or (typeof(auth_revision) = \'integer\' and auth_revision between 0 and 9007199254740991))' },
];
const statements = [
  'create table if not exists "twoFactor" ("id" text not null primary key, "secret" text not null, "backupCodes" text not null, "userId" text not null references "user" ("id") on delete cascade, "verified" integer, "failedVerificationCount" integer, "lockedUntil" date)',
  'create index if not exists "twoFactor_secret_idx" on "twoFactor" ("secret")',
  'create unique index if not exists "twoFactor_userId_idx" on "twoFactor" ("userId")',
  'create index if not exists verification_mfa_login_idx on verification(value) where auth_revision is not null',
];

export async function up(database: Kysely<unknown>): Promise<void> {
  const db = database.withoutPlugins(), tables = await db.introspection.getTables();
  // D1 DDL and migration bookkeeping are separate. A rerun must retain every
  // statement that committed before an interrupted migration.
  for (const column of columns) {
    const exists = tables.find((table) => table.name === column.table)?.columns.some((stored) => stored.name === column.name);
    if (!exists) await sql.raw(column.statement).execute(db);
  }
  for (const statement of statements) await sql.raw(statement).execute(db);
}
