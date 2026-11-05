# ADR-022: Authorize and resume native login creation

**Status:** Accepted | **Date:** 2026-10-28

## Problem

- **Private creation:** native user creation and member addition trust server code.
  A workspace creator must not need xpro master privileges to use them.
- **Interrupted writes:** the native user may exist without its password or
  membership. A retry must repair only that request's missing records.
- **Task boundary:** T025 prepares native records; T026 owns local saving,
  final confirmation/audit/completion and public/private transport.

## Decision

- **Live authority:** the Hub builds request-local services from the actual native
  session and shared Core access checks. Accounts refuses inactive or incomplete
  creators. Non-masters must name a workspace and pass its native Organization
  `member:create` check on every attempt, including completed repeats.
- **Saved intent:** validate the whole input using existing profile/password rules.
  Bind the creator, workspace/type and canonical non-secret profile through the
  T024 helper. A password is never part of this stored request.
- **Native writes:** keep Better Auth in the Hub. Accounts receives a small native
  identity capability, rather than importing the Hub or adding an auth dependency.
  Call server `createUser` with the saved snapshot and role `user`, without session
  headers; xpro has already authorized the action. Add only missing native members
  with role `member`. Never promote a workspace creator to global admin.
- **Recovery:** look up the target only by its unique initial creation link.
  A normalized email or username can refuse a new identity, never select one to
  adopt. After a native error, re-read that link to resolve a concurrent write.
- **Password:** use the installed 1.7.12 native `findCredentialAccount`, configured
  `password.hash` and `internalAdapter.linkAccount` helpers. An existing credential
  is left alone, including when a retry supplies a different valid password.
  The existing unique index handles concurrent repairs; confirm its winner.
  Refuse an existing unusable credential instead of resetting it.
- **Membership:** preserve an existing role in the intended workspace. Refuse
  an incompatible membership; use the existing uniqueness constraint for races.
- **Checkpoint:** `createLogin` returns an internal `PreparedLoginCreation`, not
  public creation success. Pending markers stay pending. T026 must verify the
  local record and other required records before its single audited Hub batch.
  Saved completed references may be replayed only after current authorization
  and intent checks, with a matching initial link and created-login pointer.

## Alternatives rejected

- **Global admin for workspace owners:** grants unrelated platform powers.
- **Public native write endpoints:** bypasses xpro's saved intent and completion.
- **Find by email and reuse:** can take over an unrelated identity.
- **Reset a password on retry:** changes an existing credential without consent.
- **Custom hashing or auth records:** duplicates behavior Better Auth already owns.
- **Complete before the workspace save:** permits access to unfinished creation.

## Verification and limits at T025

- **Runtime:** real D1 and native APIs check current permissions, changed intents,
  unrelated duplicates, committed-write interruptions, credential repair, role and
  password preservation, and eight concurrent fresh/repair attempts. Pending
  native sign-in remains blocked. Shared query plans use indexes.
- **Replay fixture:** completed-marker checks seed the saved replay condition
  through real D1 saves. They do not prove T026's completion batch or transport.
- **Mutation:** removing the permission check fails four tests; inverting the
  credential-presence guard fails three. Exact sources are restored before the
  full run, which passes 706 collected tests in 43 files.
- **Test correction:** native membership queries bypass the naming converter, so
  permission changes really affect Better Auth's camelCase columns. The pending
  Story 6 fixture uses the same correction; its full suite still awaits T026.
- **Pending:** no public creation action, workspace-user save or creation
  completion is introduced here. The 87 full Story 6 cases still cannot collect.
- **Constitution:** uses ADR-010's existing sequential creation exception. No new
  service, schema, dependency, configuration change or save-policy exception.
- **Follow-up:** [ADR-023](./023-complete-creation-and-private-workspace-save.md)
  composes this checkpoint with the real workspace save and final batch. Its
  original 87 acceptance cases now execute; deployed dispatch remains a release check.

## References

- [Better Auth server creation and native password writes, 1.7.12](https://github.com/better-auth/better-auth/blob/v1.7.12/packages/better-auth/src/plugins/admin/routes.ts)
- [Native credential helpers, 1.7.12](https://github.com/better-auth/better-auth/blob/v1.7.12/packages/better-auth/src/db/internal-adapter.ts)
- [Organization permission and member APIs](https://better-auth.com/docs/plugins/organization)
- [Organization permission implementation, 1.7.12](https://github.com/better-auth/better-auth/blob/v1.7.12/packages/better-auth/src/plugins/organization/organization.ts)
