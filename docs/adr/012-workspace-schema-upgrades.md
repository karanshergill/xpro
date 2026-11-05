# ADR-012: Workspace schema and startup upgrades

**Status:** Accepted | **Date:** 2026-10-27

## Problem

- **Startup:** each workspace must finish its own schema upgrade before handling
  requests and retain business data after eviction or restart.
- **Atomicity:** SQL BEGIN is unsupported by Durable Object storage, and Kysely
  returns migration failures rather than throwing them.
- **Restart:** the pinned dialect's generic introspector fails on protected
  Cloudflare tables after key-value data has been saved.

## Decision

- **Schema:** use one frozen initial Kysely migration for STRICT workspace users,
  local sessions and immutable audit entries. Keep internal/external type and
  archival state local. Leave existing business state unchanged.
- **References:** index Hub login and session IDs locally. They cannot be SQLite
  foreign keys across databases. Sessions and audit actors do not require a local
  workspace user; the shared access checks remain authoritative.
- **Entry point:** expose the shared upgrader through `@xpro/core/server` and call
  it only from the workspace constructor's startup lock. Preserve the Worker name,
  Durable Object class, bindings and configuration.
- **Transaction:** wrap the actual Kysely migrator in `storage.transaction()` and
  throw returned errors. Disable Kysely's interactive transactions. This groups
  schema changes and migration bookkeeping in one native transaction.
- **Older code:** use Kysely's migration information to skip execution when all
  migrations known to this version have run. This preserves later migration
  records during an application rollback. Pending upgrades still use Kysely's
  normal order and missing-migration checks.
- **Introspection:** keep the native SQLite introspector and apply a small Kysely
  query filter to its schema queries, excluding protected `_cf_*` tables. Other
  queries and native table, view and column metadata handling stay unchanged.
- **Scope:** mark the pinned dialect's storage-type assertion and introspection
  workaround with their limits and removal triggers. Reuse the shared connection
  in storage tests rather than duplicating those compatibility fixes.
- **Fixtures:** retain the real Hub HTTP sign-in fixture. Extend it through the
  workspace callback and session flow in T019, after T018 implements the callback.
  Schema tests use actual migrations and the existing real save helper; they do
  not establish authenticated workspace access.

## Rejected options

- **Custom migration runner:** Kysely already provides ordering and bookkeeping.
- **Kysely SQL transactions:** the platform rejects raw transaction commands.
- **Reduced introspection metadata:** the dialect's one-off schema helper omits
  views and full native metadata. Filtering the native implementation preserves it.
- **Broad startup lock:** normal actions keep the existing save transaction and do
  not hold the startup lock or perform outside calls during an upgrade.

## Impact

- **Recovery:** an upgrade failure rolls back DDL and bookkeeping together; the
  failed workspace does not proceed with an incomplete schema. Retrying preserves
  existing business records and audit history.
- **Checks:** real workerd tests cover concurrent startup, eviction, key-value
  persistence, failed migration recording, retry, older-code startup and audit immutability. Hub
  migrations remain separate from each workspace's startup upgrade.

## References

- [SQLite storage transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction)
- [Constructor startup locking](https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile)
- [Eviction test helpers](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/#durable-objects)
- [Pinned SQLite introspector](https://github.com/kysely-org/kysely/blob/v0.28.18/src/dialect/sqlite/sqlite-introspector.ts)
- [Durable Object dialect](https://github.com/jeffwilde/kysely-durable-objects)
