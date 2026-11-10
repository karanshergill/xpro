import { sql, type Kysely } from "kysely";

const accountColumns = [
  { table: "accounts", name: "name", statement: "alter table accounts add column name text" },
  { table: "accounts", name: "name_search", statement: "alter table accounts add column name_search text" },
  { table: "accounts", name: "status", statement: "alter table accounts add column status text not null default 'stms_active' constraint accounts_status check(status in ('stms_active', 'stms_suspended'))" },
  { table: "accounts", name: "revision", statement: "alter table accounts add column revision integer not null default 0 constraint accounts_revision_range check(typeof(revision) = 'integer' and revision between 0 and 9007199254740991)" },
  { table: "accounts", name: "updated_at", statement: "alter table accounts add column updated_at text" },
];
const auditColumns = [
  { table: "audit_entries", name: "account_id", statement: "alter table audit_entries add column account_id text references accounts(id) on delete restrict" },
  { table: "audit_entries", name: "workspace_id", statement: "alter table audit_entries add column workspace_id text references workspaces(id) on delete restrict" },
  { table: "audit_entries", name: "details", statement: "alter table audit_entries add column details text constraint audit_entries_details_json check(details is null or json_valid(details))" },
];

// Search copies are maintained by the API; SQLite lower() does not implement
// Unicode lowercase.
const accountStatements = [
  `create trigger if not exists accounts_validate_insert before insert on accounts
begin
  select raise(abort, 'accounts_name_required') where not (${nonblank("new.name")});
  select raise(abort, 'accounts_name_search_required') where not (${nonblank("new.name_search")});
  select raise(abort, 'accounts_created_at_utc') where not (${canonicalUtc("new.created_at")});
  select raise(abort, 'accounts_updated_at_utc') where not (${canonicalUtc("new.updated_at")});
end`,
  `create trigger if not exists accounts_validate_update before update on accounts
begin
  select raise(abort, 'accounts_name_required') where not ((new.name is null and new.name_search is null and old.name is null and old.name_search is null) or (${nonblank("new.name")}));
  select raise(abort, 'accounts_name_search_required') where not ((new.name is null and new.name_search is null and old.name is null and old.name_search is null) or (${nonblank("new.name_search")}));
  select raise(abort, 'accounts_created_at_utc') where not (${canonicalUtc("new.created_at")});
  select raise(abort, 'accounts_updated_at_utc') where not (${canonicalUtc("new.updated_at")});
end`,
  `drop index if exists accounts_owner_login_id_idx`,
  `create index if not exists accounts_created_at_id_idx on accounts(created_at, id)`,
  `create index if not exists accounts_name_search_id_idx on accounts(name_search, id)`,
];
const workspaceStatements = [
  `create table if not exists workspaces (
  id text not null primary key references organization(id) on delete restrict,
  account_id text not null unique references accounts(id) on delete restrict,
  status text not null default 'stms_active' constraint workspaces_status check(status in ('stms_active', 'stms_suspended')),
  revision integer not null default 0 constraint workspaces_revision_range check(typeof(revision) = 'integer' and revision between 0 and 9007199254740991),
  region_hint text not null constraint workspaces_region_hint check(${nonblank("region_hint")}),
  name_search text not null constraint workspaces_name_search check(${nonblank("name_search")}),
  created_at text not null constraint workspaces_created_at_utc check(${canonicalUtc("created_at")}),
  updated_at text not null constraint workspaces_updated_at_utc check(${canonicalUtc("updated_at")})
) strict`,
  `create trigger if not exists workspaces_name_insert before insert on workspaces
when exists (select 1 from organization where id = new.id and not (${nonblank("name")}))
begin select raise(abort, 'workspaces_name_required'); end`,
  `create trigger if not exists organization_workspace_name_update before update of name on organization
when exists (select 1 from workspaces where id = old.id) and not (${nonblank("new.name")})
begin select raise(abort, 'organization_workspace_name_required'); end`,
  `create trigger if not exists workspaces_identity_update before update on workspaces
when new.id is not old.id or new.account_id is not old.account_id or new.region_hint is not old.region_hint
begin select raise(abort, 'workspaces_identity_immutable'); end`,
  `create trigger if not exists workspaces_identity_replace before insert on workspaces
when exists (select 1 from workspaces where (id = new.id or account_id = new.account_id) and (id is not new.id or account_id is not new.account_id or region_hint is not new.region_hint))
begin select raise(abort, 'workspaces_identity_immutable'); end`,
  `create index if not exists workspaces_created_at_id_idx on workspaces(created_at, id)`,
  `create index if not exists workspaces_name_search_id_idx on workspaces(name_search, id)`,
  `create table if not exists workspace_creations (
  id text not null primary key,
  workspace_id text not null unique references workspaces(id) on delete restrict,
  initiator_login_id text not null references user(id) on delete restrict,
  attempt_login_id text not null references user(id) on delete restrict,
  attempt_session_id text not null,
  attempt_revision integer not null default 0 constraint workspace_creations_attempt_revision_range check(typeof(attempt_revision) = 'integer' and attempt_revision between 0 and 9007199254740991),
  phase text not null constraint workspace_creations_phase check(phase in ('stms_registered', 'stms_client_ready', 'stms_artifact_verified', 'stms_worker_verified', 'stms_owner_prepared', 'stms_complete')),
  worker_name text not null unique constraint workspace_creations_worker_name check(length(worker_name) between 4 and 63 and (worker_name = 'xpro' or worker_name like 'xpro-%') and worker_name = lower(worker_name) and worker_name not glob '*[^a-z0-9-]*'),
  origin text not null unique constraint workspace_creations_origin check(origin like 'https://%' and origin = lower(origin)),
  release_id text not null constraint workspace_creations_release_id check(${nonblank("release_id")}),
  client_id text not null unique,
  credential_envelope text,
  error_code text,
  completed_at text,
  created_at text not null constraint workspace_creations_created_at_utc check(${canonicalUtc("created_at")}),
  updated_at text not null constraint workspace_creations_updated_at_utc check(${canonicalUtc("updated_at")}),
  constraint workspace_creations_completion check(
    (phase = 'stms_complete' and credential_envelope is null and (${canonicalUtc("completed_at")}))
    or (phase <> 'stms_complete' and completed_at is null and (${nonblank("credential_envelope")}))
  )
) strict`,
  `create trigger if not exists workspace_creations_identity_update before update on workspace_creations
when new.id is not old.id or new.workspace_id is not old.workspace_id or new.initiator_login_id is not old.initiator_login_id or new.worker_name is not old.worker_name or new.origin is not old.origin or new.release_id is not old.release_id or new.client_id is not old.client_id
begin select raise(abort, 'workspace_creations_identity_immutable'); end`,
  `create trigger if not exists workspace_creations_identity_replace before insert on workspace_creations
when exists (select 1 from workspace_creations where (id = new.id or workspace_id = new.workspace_id or worker_name = new.worker_name or origin = new.origin or client_id = new.client_id) and (id is not new.id or workspace_id is not new.workspace_id or initiator_login_id is not new.initiator_login_id or worker_name is not new.worker_name or origin is not new.origin or release_id is not new.release_id or client_id is not new.client_id))
begin select raise(abort, 'workspace_creations_identity_immutable'); end`,
  `create index if not exists workspace_creations_initiator_login_id_idx on workspace_creations(initiator_login_id)`,
  `create index if not exists workspace_creations_attempt_login_id_idx on workspace_creations(attempt_login_id)`,
];
const auditStatements = [
  `create index if not exists audit_entries_account_id_idx on audit_entries(account_id)`,
  `create index if not exists audit_entries_workspace_id_idx on audit_entries(workspace_id)`,
];

const backfillBatchSize = 100;

export async function up(database: Kysely<unknown>): Promise<void> {
  const db = database.withoutPlugins().withTables<{
    accounts: { id: string; created_at: string; updated_at: string | null };
  }>();
  // This must be the first mutation: duplicate retained holders refuse the
  // upgrade without changing their data or any application schema.
  await sql`create unique index if not exists accounts_owner_login_id_unique on accounts(owner_login_id)`.execute(db);
  const tables = await db.introspection.getTables();
  // D1 can commit any statement before losing its reply. Introspection plus
  // IF NOT EXISTS resumes that exact schema without rebuilding retained tables.
  for (const column of accountColumns) {
    const exists = tables.find((table) => table.name === column.table)?.columns.some((stored) => stored.name === column.name);
    if (!exists) await sql.raw(column.statement).execute(db);
  }
  // Writers are stopped during migration. A keyset cursor avoids rescanning
  // filled prefixes; a fresh run resumes by selecting only missing timestamps.
  let lastId: string | null = null;
  for (;;) {
    let query = db.selectFrom("accounts").select("id").where("updated_at", "is", null);
    if (lastId !== null) query = query.where("id", ">", lastId);
    const rows = await query.orderBy("id").limit(backfillBatchSize).execute();
    const last = rows.at(-1);
    if (!last) break;
    await db.updateTable("accounts").set({ updated_at: sql<string>`created_at` })
      .where("id", "in", rows.map((row) => row.id)).where("updated_at", "is", null).execute();
    lastId = last.id;
  }
  for (const statement of accountStatements) await sql.raw(statement).execute(db);
  for (const statement of workspaceStatements) await sql.raw(statement).execute(db);
  // Adding nullable columns does not rewrite audit history or bypass its
  // immutable triggers. Never backfill old audit entries.
  for (const column of auditColumns) {
    const exists = tables.find((table) => table.name === column.table)?.columns.some((stored) => stored.name === column.name);
    if (!exists) await sql.raw(column.statement).execute(db);
  }
  for (const statement of auditStatements) await sql.raw(statement).execute(db);
}

// Only fixed migration-owned column expressions are passed to these helpers.
function nonblank(column: string): string {
  // SQLite trim needs the complete ECMAScript whitespace set explicitly.
  return `${column} is not null and length(trim(${column}, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279))) > 0`;
}

function canonicalUtc(column: string): string {
  // The round trip enforces the exact format and normalizes calendar overflow.
  // typeof rejects NULL even when both sides of the IS comparison are NULL.
  return `typeof(${column}) = 'text' and length(${column}) = 24 and strftime('%Y-%m-%dT%H:%M:%fZ', ${column}, '+0 days') is ${column}`;
}
