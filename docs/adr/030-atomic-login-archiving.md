# ADR-030: Atomic login archiving and restoration

**Status:** Accepted | **Date:** 2026-10-29

## Problem

- **Retention:** Better Auth's native removal deletes the user, sessions and
  credentials. xpro must retain identifiers, profile, pictures and business history.
- **Status:** archiving must remember active/suspended status without clearing a
  suspension reason. Restoration must not revive devices, tokens or membership.
- **Atomicity:** archive state, access revocation and audit must commit together.

## Decision

- **Existing storage:** use the existing private `archived_at` and
  `status_before_archiving` fields. Native suspension fields remain unchanged
  through archive and restore. No schema, dependency or configuration change.
- **Authority:** current complete global master only. Require archive confirmation;
  comments are optional and there is no mandatory reason. Refuse self-archiving;
  another master remains an eligible target. Restore accepts only the login ID.
- **Archive:** claim a nonarchived target through a new conditional audit row in
  the existing atomic batch. Set archive time and derive the previous status
  with SQL CASE from the row's current `banned` value inside that batch.
  A suspension committed after request preparation is therefore remembered.
- **Retain:** keep native ban/reason/expiry, role, passwords, email/username and
  profile values. Keep the private R2 picture, workspace membership and local
  business records. Existing unique indexes continue reserving identifiers.
- **Revoke:** reuse the claim-gated access/refresh-token revocation and session
  deletion shared with suspension. Preserve earlier revocation times and other
  logins; revoke tokens before deleting sessions.
- **Restore:** require an archive and valid previous status matching the retained
  native state: active with `banned` 0/NULL, suspended with 1. Clear only archive
  markers and update the timestamp. Missing or inconsistent history conflicts;
  do not guess a status or silently clear a suspension.
- **Membership and access:** retain existing membership, but do not recreate one
  removed while archived. Restore creates no session or token. Live Hub checks
  stop retained workspace cookies on the next action; idle-screen notifications
  keep the existing documented shortcut.
- **Shared code:** four fixed action codes select their own claim predicates;
  callers no longer supply a separate expected-ban flag. Both suspension and
  archive use the same three guarded revocation statements. Password reset keeps
  its existing implementation.
- **HTTP:** add two functions to the existing Hub status registration. Reuse live
  native cookies, `withHubRequest`, exact Origin, POST, the 64 KiB JSON gate,
  fresh request IDs, no-store and explicit `{ loginId }` output.
- **Repeats and failures:** missing target is 404; inapplicable/repeated transition
  is 409; self-archive is 403. One concurrent identical request wins and audits.
  A failed statement rolls everything back. A lost reply can follow a complete
  commit; report a safe error, do not retry automatically, and read current state.

## Alternatives rejected

- **Native removal or delete hooks:** lose retained records or split the audited
  state/access changes across native calls.
- **Read status before the batch:** can remember stale state under concurrency.
- **Recreate membership or sessions on restore:** grants access beyond removing
  the archive and can reverse a later membership decision.
- **A new archive service, queue or replay table:** unnecessary for this database.

## Verification and limits

- **Workers:** all 40 original archive/restore cases pass, including two workspaces,
  R2 retention, uniqueness, suspension reasons, concurrent claims and seven failure
  stages. Add ten storage cases; extend the shared HTTP suite from 36 to 71.
  Existing suspension and storage cases continue passing.
- **Storage:** nullable native status, suspension just before the archive batch,
  invalid/inconsistent history and lost replies are tested. All six archive and
  three restore statements use existing indexes without a table scan.
- **Mutation:** weakened master access, split batches, clearing suspension on restore
  and swapped previous-status labels fail the original suite. Exact source is restored.
- **Native HTTPS:** both registrations enforce safe boundaries. Active and suspended
  targets archive/restore; list/detail visibility is correct, old devices remain
  ended, four audits identify the master/requests, R2 bytes and canonical records
  are retained. A fresh sign-in uses the same active password; a restored suspended
  login is still refused. Complete browser and hosted acceptance remain pending.
- **Upgrades:** recheck native schema, private fields and token lifecycle before
  changing auth/provider versions or enabling new native user/session hooks.

## References

- [Better Auth Admin](https://better-auth.com/docs/plugins/admin)
- [Private additional fields](https://better-auth.com/docs/concepts/database)
- [OAuth provider lifecycle](https://better-auth.com/docs/plugins/oauth-provider)
- [D1 atomic batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [Kysely expressions](https://kysely.dev/docs/recipes/expressions)
