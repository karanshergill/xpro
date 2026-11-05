# ADR-011: Hub auth schema and migrations

**Status:** Accepted | **Date:** 2026-10-27

## Problem

- **Schema:** Better Auth owns the authentication tables and plugin fields;
  xpro adds business links, uniqueness rules and immutable audit history.
- **D1:** the separate kysely-d1 adapter's generic SQLite introspection queries
  protected Cloudflare tables and prevents the native Kysely migrator from running.
- **Conventions:** native auth relationships and Kysely bookkeeping differ from
  xpro's naming, strict-table and deletion rules.

## Decision

- **Adapter:** directly declare the already-installed Better Auth Kysely adapter
  at 1.7.12 and use its native D1 connection. Remove kysely-d1.
- **Generation:** use Better Auth's supported getMigrations tooling with the
  real auth options and plugins. Build an in-memory schema from actual application
  migrations before generating the next additive SQL change. Preserve released snapshots.
- **Creation link:** register the server-owned field with auth, but add its
  physical foreign-key metadata only during schema generation. Registering that
  reference at runtime makes auth try to join an xpro table as a native auth model.
- **Native tables:** preserve Better Auth's names, non-STRICT definitions and
  internal cleanup relationships. Refuse physical login deletion with a database
  trigger. xpro-owned links use RESTRICT.
- **Own tables:** use STRICT tables and database constraints for business links,
  normalized identity uniqueness, one workspace and one password account per login.
  Refuse audit updates, deletions and replacement inserts.
- **Bookkeeping:** preserve Kysely's two native migration tables; they are excluded
  from xpro's naming, key and strict-table rules.
- **Execution:** run Hub migrations serially before release, outside request handlers.
  D1 cannot run interactive transactions or provide Kysely's migration lock.
  The initial DDL is safe to retry; later migrations must handle interruption too.
  Business saves continue through D1's all-or-nothing batch helper.

## Rejected options

- **Custom migration engine or introspector:** the approved auth library already
  supplies the D1 integration, and Kysely already supplies migration bookkeeping.
- **Dependency patch or runtime changes:** unnecessary with the native adapter.
- **Rewrite native auth relationships:** adds upgrade risk and changes library cleanup.
- **Fake test schema:** cannot prove the application migrations or real authentication.

## Impact

- **Compatibility:** auth configuration, generated schema and migration behaviour
  are checked together in real workerd tests. Bun's built-in Node SQLite support
  runs tooling only; production remains on Workers and D1.
- **Scope:** this supplies the schema and migration runner. Deployment wiring,
  xpro's action-level auditing and workspace migrations remain separate tasks.

## References

- [Better Auth programmatic migrations](https://better-auth.com/docs/concepts/database#programmatic-migrations)
- [Native D1 adapter](https://github.com/better-auth/better-auth/blob/v1.7.12/packages/kysely-adapter/src/d1-sqlite-dialect.ts)
- [Kysely D1 introspection issue](https://github.com/kysely-org/kysely/issues/1571)
- [D1 statements and PRAGMAs](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
