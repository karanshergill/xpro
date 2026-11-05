---
paths:
  - "**/*.db.ts"
  - "**/migrations/**"
---

# Database conventions

Applies to code that reads or writes a database.

## Tables

- **Database files:** files that talk to the database end in `.db.ts`.
- **Names:** database names are lower-case with underscores, use no
  abbreviations except well-known ones, have no type prefixes and are
  never SQL keywords. Tables are plural, columns singular.
- **Keys:** each table's own key is `id`. A column pointing to another
  record is named after it, ending in `_id`.
- **Name endings:** `_at` for moments in time (UTC), `_on` for dates,
  `is_` or `has_` at the start of true/false columns, `_count` for
  counts. Scaled numbers state their scale in the name.
- **Strict tables:** every table is STRICT, so SQLite refuses values of
  the wrong type. A test fails if any table is not strict.
- **Better Auth's tables:** Better Auth's own tables keep its names and
  are not strict, because renaming them adds settings to every add-on and
  risks breaking upgrades. The strict-table test skips those tables
  and Kysely's two migration bookkeeping tables. Fields we add to auth
  tables still follow our naming rules. Better Auth keeps its native
  internal delete actions; a database trigger refuses physical login
  deletion. xpro-owned links use RESTRICT.
- **Migration bookkeeping:** `kysely_migration` and
  `kysely_migration_lock` keep Kysely's native names, columns and
  non-STRICT definitions. They contain framework state, not business data.
- **Hub references in workspace storage:** login and Hub-session IDs
  point outside the workspace database. Index them locally; SQLite cannot
  enforce foreign keys across these databases. A session or audit actor
  does not require a local workspace-user row. Shared access checks
  validate Hub identity and permission.
- **Rules in the database too:** unique, foreign-key and value checks are
  database constraints, not only checks in code.
- **Named checks:** every value check has a clear name, so its error can
  be turned into a proper message for the user.
- **Index and check names:** index and check names start with their
  table's name, so an error points straight to the table.
- **Indexed links:** every column pointing to another record has its own
  index, because SQLite does not add one.
- **No cascade deletes:** deleting a record that others point to fails.
  Removing linked records is a named action in code, so each removal
  reaches the audit log.

## Values and formats

- **Money:** stored as a whole number in the currency's smallest unit,
  with its currency beside it.
- **Exact numbers:** quantities, rates and other exact decimals are
  stored as whole numbers at a fixed scale per column, never as SQLite's
  decimal type, which rounds. Every save checks the value fits within
  JavaScript's safe whole-number range, because the database hands
  numbers back as JavaScript numbers.
- **True/false:** stored as 0 or 1, and the database accepts only those.
- **Dates and moments:** dates are stored as `YYYY-MM-DD`. Moments in time
  are stored in UTC, always in one fixed text format, so they sort
  correctly.
- **Accents and case:** SQLite's built-in `lower()` and `NOCASE` fold only
  ASCII case; they do not remove accents. Searchable names get a trimmed,
  JavaScript-lowercase copy made in code and maintained in the same name write.
  The Hub's private `user.name_search` uses literal BINARY prefix ranges, not
  full Unicode case folding. Native email/username columns keep their existing
  unique `lower(trim(...))` expression indexes. Search must match the exact
  indexed expressions; verify all branches in the real query plan (ADR-028).
- **Custom field values:** follow the same rules inside a record's custom
  data as built-in fields.
- **Code names:** tables and columns are snake_case in the database and
  camelCase in code, converted by Kysely's `CamelCasePlugin` with keys
  inside stored JSON left unchanged. The shared `createHubConnection` in
  `@xpro/core/server` uses Better Auth's D1 adapter. Each data layer provides
  its typed table view; the Hub keeps its complete model and migrations.
  Use native auth APIs for identity and credentials. The first-sign-in profile
  action uses an explicit Kysely update because its username audit must commit
  in the same D1 batch (ADR-016). Own-profile saving updates name and private
  phone together in one indexed statement (ADR-025). Password reset uses the
  configured native hash and explicit credential, token and session writes so all changes and its audit
  share one batch (ADR-024). Keep its native-schema and revocation tests on auth
  upgrades. Direct queries naming native camelCase columns must use
  `db.withoutPlugins()`.

## Queries

- **Works in both databases:** use only database features that work in
  both SQLite (Durable Objects) and PostgreSQL. Where they differ, keep
  the difference inside the data layer. SQLite accepts some queries
  PostgreSQL rejects, such as grouped queries that include ungrouped
  columns; these are not written.
- **Let the database do it:** use recursive queries for hierarchies and
  window functions for running totals, instead of building them in
  application code.
- **Raw SQL is rare:** queries are built with Kysely. Hand-written SQL
  goes only through Kysely's `sql` tag with bound values, and every piece
  of it is covered by a test, because a misspelled column in double
  quotes silently becomes text in SQLite.
- **Indexed shared queries:** every query on the shared database uses an
  index, because that database serves every workspace one query at a
  time. A test checks each query's plan and fails on a full table read.
- **Big changes in chunks:** changes to many rows run in chunks of about
  1,000 rows, or fewer when platform limits require, never one huge statement.
  D1 statements allow 100 bound parameters; the Hub name-search backfill uses
  25 rows with four parameters per row.

## Saves

- **Checked on save:** a record's rules are checked again just before it
  is written, whichever code path saves it.
- **One save helper:** every save with more than one step goes through the
  save helper's explicit transaction, never relying on writes being
  grouped automatically.
- **Nothing outside inside a save:** a save never calls an outside service
  or waits on a timer, because the workspace runs one save at a time and
  everyone else would wait. Outside calls happen after the save, through
  outgoing messages.
- **Private initial setup exception:** native Better Auth login/password creation
  and the initial-master audit are separate writes. Run this setup serially before
  the Hub accepts writes; an interruption requires operator review. Repeats never
  change existing logins. See ADR-013. This does not relax other STMS saves.
- **Shared database saves:** the shared database cannot keep a
  transaction open, so an all-or-nothing change to it is sent as one
  batch through `saveHub` from `@xpro/core/server`. The Hub's existing helper
  re-exports that implementation.
- **Native own-password exception:** use the trusted native password API and
  retain its sequential D1 writes. A failure can end sessions before changing
  the password, or save the password before replacement-session creation fails.
  Return a safe error without a success cookie and do not retry automatically.
  Revisit when an atomic native D1 API is available or complete rollback is
  required; see ADR-025. Audited master resets follow ADR-024's atomic batch.

- **Private picture exception:** R2 objects and their D1 key cannot share a
  transaction. Stage the new file, guard the key update by its previous value,
  then delete the old file. Confirm lost replies by reading back; if confirmation
  fails, retain files that could be active. Committed changes remain successful
  if old-file cleanup fails, with a safe log. Private orphans may remain; add
  cleanup when storage usage or strict deletion/retention requires it. See ADR-026.

## Database upgrades

- **Kysely migrations:** every schema change is a Kysely migration.
- **Upgrade file names:** each upgrade file name starts with the date and
  time it was written, year first, because upgrades run in name order
  and Kysely refuses one that sorts before an upgrade already run.
- **Forward only:** upgrades are never undone or edited once released. A
  mistake is fixed by a new upgrade, because SQLite cannot roll back a
  schema change halfway.
- **Old code keeps working:** a rollback always runs old code on the new
  data, so each upgrade only adds. Removing or renaming is done in a
  later release, once no running code uses the old shape.
- **Hub DDL:** run the Kysely migrator serially before release and
  inspect its returned error. D1 cannot use interactive transactions or
  a migration lock. Initial CREATE statements are safe to retry; future
  migrations must also account for interruption. Business saves still
  use the all-or-nothing D1 batch helper.
- **Workspace DDL:** the constructor calls `upgradeWorkspaceDatabase`
  from `@xpro/core/server` inside its startup lock. Native storage
  transactions group the real Kysely migrations and their bookkeeping;
  returned migration errors are thrown so the whole upgrade rolls back.
  If all migrations known to this code have run, leave later history
  untouched so older code can reopen a newer additive schema.
  The shared connection filters protected Cloudflare tables only during
  native introspection. Never put ordinary requests in the startup lock.
- **When they run:** workspace databases upgrade themselves when new code
  first runs. The shared database is upgraded before the release.
- **Tested:** every upgrade runs in tests against a database built from
  all earlier upgrades.
