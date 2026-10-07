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
  risks breaking upgrades. The strict-table test skips only those tables,
  and fields we add to them still follow our naming rules.
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
- **Accents and case:** SQLite ignores case and accents only for A to Z.
  Emails and searchable names get a lower-cased search copy made in
  code, and uniqueness and search use that copy.
- **Custom field values:** follow the same rules inside a record's custom
  data as built-in fields.
- **Code names:** tables and columns are snake_case in the database and
  camelCase in code, converted by Kysely's `CamelCasePlugin` with keys
  inside stored JSON left unchanged.

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
  1,000 rows, never as one huge statement.

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
- **Shared database saves:** the shared database cannot keep a
  transaction open, so an all-or-nothing change to it is sent as one
  batch.

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
- **When they run:** workspace databases upgrade themselves when new code
  first runs. The shared database is upgraded before the release.
- **Tested:** every upgrade runs in tests against a database built from
  all earlier upgrades.
