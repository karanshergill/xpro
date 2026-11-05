# ADR-031: Atomic master identifier changes

**Status:** Accepted | **Date:** 2026-10-29

## Problem

- **Atomicity:** changing an identifier, revoking access, reserving an old username
  and recording the master audit must commit together.
- **Races:** availability checked before a separate write can become stale.
  Requests that submit the same normalized value must remain complete no-ops.
- **Native state:** keep passwords, login IDs, roles, status and membership.
  Verification of the old email does not verify a replacement address.

## Decision

- **Authority/input:** current complete global master only; self-changes are
  allowed. Reuse Accounts' email schema and strict username rules. Comments
  remain optional; bodies cannot choose the actor or change unrelated fields.
- **One batch:** use an indexed target SELECT with normalized current value and
  taken/reserved flags, a conditional new audit claim, the identifier update
  and the existing three claim-gated access/token revocations. Username changes
  also reserve the displaced username before updating it.
- **Availability:** all namespace probes and the claim run in the same D1 batch.
  Match the existing `lower(trim(email))` / `lower(trim(username))` indexes and
  reserved-name lookup. Keep final unique constraints and native reservation
  triggers. Return the existing named taken/reserved results, without parsing
  native exception strings or making another availability round trip.
- **No-op:** compare the normalized current value before availability flags.
  An unchanged value creates no reservation, audit, timestamp, verification or
  session change, even when that current username also has a reservation.
- **Reservation:** derive the actual old normalized username from the row inside
  the batch. Skip missing/blank values; keep an already existing reservation's
  ID and timestamp. Identical same-target requests yield one change/audit and
  one no-op. Different successive changes reserve each displaced value.
- **Email:** store the existing schema's trimmed/lowercase value. Clear
  `emailVerified` only for a real address change. A normalized no-op and a
  username change preserve the flag. Existing verification routes remain disabled.
- **Username:** use the existing lowercase 4–8 character rules; synchronize
  `username` and `displayUsername`. The previous name cannot be reassigned.
- **Access/history:** revoke active target access/refresh tokens before deleting
  all native sessions. Preserve earlier revocation times, other logins, native
  passwords, stable login IDs, profile/status, membership and tenant history.
  Suspended/archived targets remain inactive; self-change ends the acting session.
- **Shared code:** rename the internal status database module to `changes.db.ts`
  and expand its native table view. Status and identifier predicates stay
  separate; share the concrete audit builder, claim guard and revocation queries.
  Existing status APIs keep their behavior.
- **Types:** Core's save helper forwards D1's existing `batch<Row>` type parameter,
  defaulting to unknown. It adds no runtime behavior; the known first SELECT
  result is typed without a cast, extra parser or separate read.
- **HTTP:** register two Hub POST functions using `withHubRequest`, the real native
  cookie, exact configured Origin, existing 64 KiB JSON gate, strict fields and
  fresh request ID/no-store. Return only `{ loginId }` or safe named errors.
  Native routes that bypass xpro's audited changes stay disabled.
- **Failure/retry:** a failed statement rolls back identity, reservation, audit
  and revocation. A lost reply can follow a complete commit; never retry
  automatically. Read current state before resubmitting. A fresh identical value
  is then a no-op for an authorized master.

## Alternatives rejected

- **Separate native update/revoke/audit:** fails the atomic save contract.
- **Pre-read availability:** adds a round trip and cannot arbitrate a later claim.
- **Reserve a previously read username:** can miss the actual displaced value.
- **Carry verification to another address:** misrepresents mailbox ownership.
- **Replay table, lock or new verification workflow:** unnecessary for this task.

## Verification and limits

- **Behavior:** all 69 original identifier cases pass, including two workspaces,
  native old/new sign-in, self-change, inactive targets, concurrent namespace
  claims and rollback at every write stage.
- **Added:** 17 storage and 41 Hub HTTP cases cover verified-email state, null and
  existing reservations, legacy normalized no-ops, identical concurrent changes,
  successive names, native competing creation and lost replies.
- **Plans:** all six email and seven username statements use existing indexes;
  no table scan or new index is needed.
- **Mutation:** weakened master access, split batches, ungated old-name reservation
  and wrong token scope fail the original tests. Exact source is restored.
- **Native HTTPS:** both registrations enforce safe boundaries. Real changes and
  no-ops update directory reads correctly, end target devices and the acting
  master's self-change cookie, preserve unrelated access, and create three
  correlated audits/two old-name reservations in the proof. Read-back confirms
  exact identity/verification changes with retained credentials, roles and
  membership. Native sign-in rejects old identifiers and accepts new ones with
  the same password; old-username reassignment is refused.
- **Checkpoint:** backend tasks are complete. Screens and complete browser/hosted
  acceptance are still pending; the approved delivery order resumes at T016.

## References

- [Better Auth Admin](https://better-auth.com/docs/plugins/admin)
- [Username normalization and display values](https://better-auth.com/docs/plugins/username)
- [Native user fields](https://better-auth.com/docs/concepts/database)
- [D1 atomic batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [Kysely insert subqueries](https://kysely.dev/docs/examples/insert/insert-subquery)
