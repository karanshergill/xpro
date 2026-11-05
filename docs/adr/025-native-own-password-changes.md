# ADR-025: Keep native own-password changes and save profiles together

**Status:** Accepted | **Date:** 2026-10-29

## Problem

- **Profile:** name and phone must change together for the signed-in person.
  Phone is a private native field; the public native update-user route does not
  provide the required profile action.
- **Password:** Better Auth already verifies current passwords, hashes new ones,
  revokes old sessions and creates a replacement cookie. Its D1 adapter does not
  support an interactive transaction across those native calls.
- **Save rule:** retaining the planned native password behavior requires an
  explicit, limited exception to all-or-nothing saving.

## Decision

- **Profile save:** use one indexed Kysely update through the existing Hub save
  helper for the actor's name, normalized phone and timestamp. Reuse Accounts'
  validation. Keep identity, lifecycle, picture and membership fields outside
  this input and write.
- **Password API:** check xpro's 12–64-character rule, then call trusted native
  `changePassword` with the real request headers and `revokeOtherSessions: true`.
  Keep native current-password verification and configured hashing. A master
  uses the same own-password action.
- **Current device:** native 1.7.12 deletes old sessions, updates the credential,
  creates a replacement session and serializes its cookie. Discard its
  token-bearing JSON; return only `{ loginId }` as HTTP JSON and append the
  actual native cookies as response headers.
- **MFA integration:** [ADR-043's guards](./043-guarded-native-mfa-writes.md)
  retain the original session/expiry, revision and credential proof around
  native work. The guarded password batch advances the revision, retires old
  access/main MFA challenges and records a basic audit together. Only the
  authorized current device may retain its original MFA time at that exact
  winning revision. Enrollment remains intact; ordinary logins need no MFA.
  This strengthens individual saves within the existing sequential exception.
- **Scoped exception:** own-password changes retain native sequential D1 writes.
  A failed credential write can leave the old password with ended sessions.
  If replacement-session creation fails after the password write, the new
  password remains with no replacement session. Token revocation and native
  logout hooks also belong to this sequence.
- **Failed response:** return one safe unexpected error with no success cookie;
  never expose native messages, passwords or tokens. Do not automatically retry
  or accept a replay key. An unknown result may have changed the password.
- **Recovery:** after a failed or interrupted change, sign in normally with the
  new password if it was saved, otherwise the previous password. A master can
  reset the password through the existing audited action if needed.
- **Upgrade trigger:** use an atomic native own-password API when D1 support is
  available. Revisit earlier if complete rollback becomes a product requirement.
  Master resets keep the atomic audit/save rule in
  [ADR-024](./024-atomic-password-reset.md).
- **Hub boundary:** register both POST server functions before the screen. Reuse
  the exact-Origin and bounded JSON gate, native session reading and live
  protected-access check. Native duplicate write routes stay disabled.
- **Errors:** share one request-local reporting callback between the native
  password API and its Hub action so a failure produces one safe event.

## Alternatives rejected

- **Custom password/session SQL:** duplicates native current-password, cookie and
  lifecycle logic for an action already covered by the dependency.
- **Adapter transaction shim:** D1 does not support the interactive transaction
  that these native calls would need.
- **A recovery ledger or automatic replay:** adds a workflow beyond the initial
  profile/password requirement and cannot assume an interrupted result failed.

## Verification and limits

- **Runtime:** original profile/password acceptance cases and additional indexed
  storage, session-race and HTTP cases use actual authentication, hashing, D1,
  issued provider tokens and two workspace databases.
- **Failures:** real triggers cover session deletion, credential update and
  replacement-session creation. They assert the actual native state and a safe
  HTTP refusal, including absence of a success cookie.
- **Delivery:** task checkpoints record the final test, mutation, build and
  native HTTPS results. Pictures remain T033 and screens T034.

## References

- [Better Auth session revocation and transaction limits](https://better-auth.com/docs/concepts/session-management)
- [Native password implementation in 1.7.12](https://github.com/better-auth/better-auth/blob/v1.7.12/packages/better-auth/src/api/routes/update-user.ts)
- [Native server response headers](https://better-auth.com/docs/concepts/api)
- [D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
