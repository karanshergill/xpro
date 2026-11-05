# ADR-015: Share the Hub connection without moving feature tables

**Status:** Accepted | **Date:** 2026-10-27

## Problem

- **Module queries:** Accounts needs to check Hub usernames without importing
  application code. More Hub modules will need the same database integration.
- **Existing setup:** the Hub already uses Better Auth's native D1 Kysely adapter
  with the required camel-case mapping and nested JSON preservation.

## Decision

- **One constructor:** move that existing connection constructor into Core as
  `createHubConnection<Database>`, exported through `@xpro/core/server`.
- **Owned models:** callers provide their typed table view. The Hub keeps its
  full model and migrations; Accounts declares only the columns its query needs.
  Keep the existing Hub factory name as a typed alias of the shared constructor.
- **Server boundary:** export database helpers through `@xpro/accounts/server`.
  Browser-safe profile validation stays in the package's ordinary entry point.
- **Existing dependencies:** declare the already-pinned adapter in Core, and
  Kysely/true-myth in Accounts. Keep the Hub adapter declaration because its
  supported offline schema-generation script also imports it directly.
- **Availability:** check normalized ownership and reservations in one indexed,
  bound statement. Return only the username or a named refusal. Do not cache or
  reserve it; existing uniqueness constraints and reservation triggers still
  decide whether a later save may succeed.
- **Unexpected failures:** database helpers throw; their authorized server caller
  owns safe error reporting. No public availability route is introduced. Disable
  the unused native route, which does not check xpro's reserved-name table.

## Rejected alternatives

- **Import the Hub app from Accounts:** reverses the module dependency direction.
- **Copy the connection into each module:** duplicates adapter and mapping setup.
- **Move every Hub table into Core:** puts feature models into shared infrastructure.
- **Replace the adapter or add another service:** the current adapter and D1
  constraints already support this read path.

## Impact and verification

- **Storage:** no migration, Worker name, binding or runtime-setting change.
- **Reuse:** existing Hub migrations, auth/access checks and private setup continue
  through the same adapter. Auth schema generation still matches the migrations.
- **Checks:** real workerd/D1 tests cover availability, unchanged neighboring
  records, current ownership, failures and both index plans. Targeted mutations
  confirm that reservation refusal and phone-extension refusal are protected.
- **Scope:** T015 still supplies profile saving and its authenticated Hub entry.

## References

- [Better Auth relational adapters](https://better-auth.com/docs/adapters/other-relational-databases)
- [Kysely compiled queries](https://kysely.dev/docs/recipes/splitting-query-building-and-execution)
- [Kysely expression builder](https://kysely.dev/docs/recipes/expressions)
