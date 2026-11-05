# ADR-029: Atomic suspension and reactivation

**Status:** Accepted | **Date:** 2026-10-29

## Problem

- **Atomicity:** native Better Auth banning updates the user before deleting
  sessions; xpro's audit would be another write. Those calls cannot share an
  interactive D1 transaction.
- **Concurrency:** two masters must not produce two audits for one transition.
  Archived or already transitioned logins must remain unchanged.
- **Hooks:** direct session deletion skips the provider's token-revocation
  hooks. Ending sessions must preserve the approved all-token rule.

## Decision

- **Native model:** keep Better Auth 1.7.12's `banned`, `banReason` and
  `banExpires` fields and native sign-in refusal. No new schema or dependency.
  The native HTTP ban/unban routes remain disabled.
- **Authority:** current complete global master; tenant roles grant no global
  access. Refuse self-suspension. Require literal confirmation and one fixed
  reason. Only Other requires a meaningful comment; preserve optional comments.
- **Transitions:** nonarchived active (`banned` 0 or NULL) to suspended, or
  nonarchived suspended (`banned` 1) to active. Suspend without expiry; reactivate
  clears reason and expiry. Preserve role, credentials, profile and membership.
- **One batch:** use Core's existing `saveHub`. An indexed ID lookup starts the
  batch, then an audit `INSERT ... SELECT` claims the expected target state.
  Every following mutation requires that exact fresh audit ID. D1 commits all
  statements together or rolls them back.
- **Result:** the lookup distinguishes missing targets; the claim's affected-row
  count distinguishes success from a state conflict. No separate D1 lookup
  round trip, lock, replay table or recovery process.
- **Revocation:** suspension revokes active target access and refresh tokens
  before deleting all target sessions. Preserve earlier revocation timestamps
  and other logins. Reactivation creates or revives no session/token.
- **Workspace access:** retained workspace cookies fail the existing live Hub
  check on the next action. As for password reset, idle-screen notification
  remains a marked shortcut; add logout messages when immediate idle-screen
  sign-out becomes a requirement.
- **HTTP:** register two thin Hub POST functions behind the existing exact-Origin
  and 64 KiB JSON gate. Reuse `withHubRequest`, real native cookies and local
  live access checks. Return only `{ loginId }`, fresh request ID and no-store;
  use safe named 404/409/self-suspension errors.
- **Unknown reply:** the complete change may have committed. Report a safe
  failure without retrying; read current state before submitting again. A fresh
  repeat of a completed transition conflicts without another audit.

## Alternatives rejected

- **Separate native calls:** cannot meet atomic change, revocation and audit.
- **Read then unguarded save:** permits duplicate transitions and stale changes.
- **Queue or extra coordination:** unnecessary for one database and one batch.

## Verification and limits

- **Behavior:** all 58 T035 cases pass against real authentication, D1 and two
  workspace databases, including concurrent claims and seven rollback stages.
  Six additional storage cases cover legacy nullable status/expiry, lost replies
  and query plans. Thirty-six HTTP cases cover live authority and safe failures.
- **Indexes:** all six suspension and three reactivation statements use existing
  target, audit, token and session indexes without a table scan. Bound parameter
  counts remain within D1's limit.
- **Mutation:** weakened master access, split batches and incorrect access-token
  scope fail the original tests. Exact source is restored.
- **Native HTTPS:** both registered Start functions enforce authority, Origin,
  method, size and fields. Suspension ends two real native devices; reactivation
  does not restore them. Read-back confirms two master/request-correlated audits
  and unchanged credentials, membership and unrelated records.
- **Upgrade:** recheck native schema and revocation tests before an auth/provider
  upgrade, secondary session storage or new native user/session hooks.
  Screens, hosted acceptance and T038–T039 writes remain outside this task.

## References

- [Better Auth Admin](https://better-auth.com/docs/plugins/admin)
- [OAuth provider session and token lifecycle](https://better-auth.com/docs/plugins/oauth-provider)
- [D1 atomic batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [D1 result metadata](https://developers.cloudflare.com/d1/worker-api/return-object/)
- [Kysely expressions](https://kysely.dev/docs/recipes/expressions)
