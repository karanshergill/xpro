# ADR-021: Save the creation reference in the first login write

**Status:** Accepted | **Date:** 2026-10-28

## Problem

- **Interruption:** native user and password creation are separate writes.
  The first user row must identify its saved creation request even if the
  request stops before the native API returns.
- **Trust:** submitted body fields cannot choose this association.
- **Scope:** T024 supplies storage and the initial link, not the full creation flow.

## Decision

- **Saved intent:** reuse the existing Hub table. Save creator, intended
  workspace/type and canonical email, username, name and international phone.
  Reject password fields. Use the existing save helper and primary key.
- **Repeat:** an ID conflict never overwrites the record. Read the indexed row
  and compare its creator, target and non-secret details. Return its original
  state only for the same intent; otherwise return a conflict.
- **Native hook:** trusted server code supplies the saved snapshot through
  `createHubAuth({ loginCreation })`. Capture a private copy. Before the native
  user insert, require a pending snapshot, matching profile and non-master role.
  Write its ID as `login_creation_id`, overriding submitted data.
- **Other setup:** without this setting, native body data cannot attach a
  creation link. Existing trusted initial-master setup remains available.
  Preserve the current access/session hooks and blocked HTTP routes.
- **Recovery lookup:** find the new user through the unique initial link,
  never by an unrelated matching email or username.
- **Constraints:** reuse the existing foreign key, unique user/request links
  and single-credential index. No migration, dependency or new service is needed.
- **Completion:** leave the request's completion fields alone here. T025 handles
  live creator permission and recovery; T026 confirms the other records and
  saves `created_login_id`, the completion marker and audit in the final batch.

## Alternatives rejected

- **Link after user creation:** leaves an unlinked user if execution stops first.
- **Trust native body data:** lets a caller select the association.
- **Overwrite a repeated request:** changes the saved intent or adopts another login.
- **Keep a global current reference:** mixes concurrent creation requests.
- **Extra lookup inside the hook:** the caller already holds the saved snapshot;
  current permission belongs to the action, and storage constraints protect the link.

## Verification and limits at T024

- **Runtime:** 43 new tests use real D1 and native APIs. They cover normalization,
  concurrent claims, changed intents, indexed queries, body tampering, first-write
  interruption, snapshot isolation and preserved session/HTTP gates.
- **Mutation:** reversing the native profile guard fails 11 tests; reversing the
  saved-creator check fails five. Both sources are restored before the full run.
- **Pending:** the 87 Story 6 cases still need the T025/T026 implementation.
  This does not prove full creation, private workspace transport or browser UI.
- **Constitution:** this uses ADR-010's existing Story 6 exception. No new exception
  or change to other STMS save/audit guarantees is introduced.
- **Follow-up:** [ADR-023](./023-complete-creation-and-private-workspace-save.md)
  delivers completion/transport and returns `core_forbidden` for a different
  creator. The initial link and same-creator intent checks remain in place.

## References

- [Better Auth database hooks](https://better-auth.com/docs/concepts/database#database-hooks)
- [Better Auth 1.7.12 native creation writes](https://github.com/better-auth/better-auth/blob/v1.7.12/packages/better-auth/src/plugins/admin/routes.ts)
- [Kysely conflict handling](https://github.com/kysely-org/kysely/blob/master/src/query-builder/on-conflict-builder.ts)
