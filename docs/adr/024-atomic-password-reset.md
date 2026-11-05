# ADR-024: Save password reset and revocation with its audit

**Status:** Accepted | **Date:** 2026-10-29

## Problem

- **Atomicity:** native admin password reset, session revocation and an xpro
  audit are separate writes. D1 cannot keep an interactive transaction open
  across those calls. A partial reset would break the approved STMS save rule.
- **Lifecycle:** the OAuth provider revokes issued tokens through session-delete
  hooks. Deleting a session directly instead sets token `sessionId` links to null;
  a batch must preserve token revocation explicitly.

## Decision

- **Authority:** STMS uses the shared protected-access result and permits only
  global masters. Keep Accounts' existing password rules and optional comments.
  Input cannot choose the actor or confer authority.
- **Native hashing:** the Hub supplies the configured Better Auth
  `auth.$context.password.hash`. There is no custom hash, reduced strength,
  temporary expiry or forced password change.
- **Credential:** use the existing unique credential-per-login index to insert
  a missing native credential or update its password. Preserve an existing ID,
  creation time and other account fields. Native camelCase columns and the
  physical audit table use an explicit Kysely view without naming plugins.
- **One batch:** send the credential upsert, access-token revocation,
  refresh-token revocation, session deletion and creation of one audit through
  Core's existing `saveHub`. A failed statement rolls back every write.
- **Token scope:** revoke active token records for the affected login before
  deleting its sessions. Preserve existing revocation times and every other
  login's records. Refresh grants remain disabled; their native stored records
  still follow the same reset rule.
- **Access:** live Hub checks refuse retained workspace cookies on their next
  action. Reset does not send logout messages to idle screens; its shortcut
  comment calls for notifications if immediate idle-screen sign-out is required.
  No workspace RPC or new coordination service is needed.
- **Boundary:** register the real Hub POST function before its screen. Use the
  signed native cookie, the shared live Hub check, exact Origin, existing 64 KiB
  pre-deserialization limit, safe field errors and an allow-listed `{ loginId }`.
  Native HTTP routes that could bypass these rules stay disabled.
- **History:** record `stms_password_reset`, actual master, affected login,
  request ID and optional comment. Preserve status, profile, membership and
  tenant data, including when resetting another master or the acting master.
- **Unknown reply:** a lost batch reply can follow a committed reset. Do not
  retry automatically. A deliberately submitted new reset is a new audited
  action; this API accepts no idempotency key or recovery workflow.
- **Package:** declare STMS's direct use of the already locked true-myth and
  UUID versions. Its production modules have no import-time effects; marking
  the package accordingly keeps unused reset code out of routing. If a future
  module needs import-time registration, update that annotation before adding it.

## Alternatives rejected

- **Sequential native reset/revoke/audit:** cannot guarantee all-or-nothing saving.
- **A custom hash or adapter transaction shim:** duplicates native cryptography
  or claims transaction support D1 does not provide.
- **A queue, lock or recovery ledger:** unnecessary for this single-database
  action. No automatic retry or cross-workspace fanout is introduced.

## Verification and limits

- **Behavior:** all 44 T028 cases and 24 additional storage/HTTP cases pass.
  Native user-info access stops for an issued target token, while another
  login's token remains usable. Triggers cover credential, token, session and
  audit failures; a lost-reply case proves the committed batch stays complete.
- **Queries:** the target lookup and all five save statements are checked with
  real query plans against existing indexes. No schema change is required.
- **Mutation:** splitting the batch fails seven tests; weakening the master
  gate fails eight; changing token scope fails three. Exact sources are restored
  before the final 910-test run, seven type checks and three builds.
- **Build:** the package annotation removes the accidental router increase from
  350,309 to 72,199 bytes, its previous size. The reset remains registered in the
  Hub. Frozen install, native schema comparison and 333-package audit pass.
- **HTTPS:** eight checks against the running local Hub exercise native Start
  serialization, method/Origin/byte refusals, anonymous and non-master refusal,
  safe field errors, a real reset and refusal of the old native session.
  Native sign-in then rejects the old password, accepts the new one and confirms
  one audit matching the actual master and HTTP request. The Hub is stopped afterward.
- **Upgrades:** this data layer deliberately depends on Better Auth 1.7.12's
  credential and provider schema. Recheck these tests and native hooks before
  upgrading, adding secondary session storage or enabling new credential hooks.
- **Scope:** the reset control remains T030. Hosted dispatch and complete browser
  acceptance keep their existing staging/release checks.

## References

- [Better Auth admin password and session APIs](https://better-auth.com/docs/plugins/admin)
- [Native password context](https://github.com/better-auth/better-auth/blob/v1.7.12/packages/better-auth/src/context/create-context.ts)
- [OAuth provider tokens and logout](https://better-auth.com/docs/plugins/oauth-provider)
- [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [Kysely conflict handling](https://kysely-org.github.io/kysely-apidoc/classes/OnConflictBuilder.html)
- [Package side-effect annotations](https://esbuild.github.io/api/#ignore-annotations)
