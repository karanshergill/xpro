# ADR-027: Bound master login-management reads and transitions

**Status:** Accepted | **Date:** 2026-10-29

## Problem

- **Contract:** Story 5 leaves pagination, search matching and repeats unspecified.
  T035 needs concrete inputs without choosing the future storage implementation.
- **Native limits:** installed Better Auth 1.7.12 searches name/email in its admin
  list API and can turn a failed read into an empty list. Native banning changes
  the user before ending sessions. Neither supplies xpro's atomic audit contract.

## Decision

- **Scope:** establish test contracts; T036–T039 supply the actions and indexed
  storage. Keep native authentication and existing save/audit guarantees. No
  additional save exception is accepted.
- **Pages:** default 25, maximum 100, nonnegative integer offset. Return explicit
  summaries and `nextOffset`; read one extra row instead of requiring a total.
  Order newest creation time then ID. Offset pages are not concurrent snapshots.
- **Search:** trimmed, case-insensitive literal prefixes, 1–200 characters, across
  name, email and username. Punctuation is data. Verify indexes in T036.
- **Visibility:** normal list/search hides archives; known-ID detail can read
  them for restoration. Incomplete logins remain visible with nullable fields.
- **Transitions:** confirmation for suspension/archive. Repeated or inapplicable
  transitions return `stms_login_state_conflict` without another audit. Exactly
  one of two concurrent identical transitions commits.
- **Identifiers:** unchanged normalized values are complete no-ops. Changes end
  all target sessions/tokens and commit with their audit; username changes also
  reserve the previous username. Restore never revives sessions or membership.
- **Retries:** accept no replay key and never retry automatically. A lost reply
  may follow a committed atomic batch. Read current state before resubmitting.

## Alternatives rejected

- **Unbounded lists or required totals:** unnecessary read work and response size.
- **Substring search now:** imposes a broader index design. Revisit when users
  need matches inside a name or identifier.
- **Replay ledger:** adds persistence and recovery beyond guarded transitions.
- **Native multi-call writes without an atomic audit:** fail the existing save
  rule; T037–T039 must verify their actual implementation.

## Verification and limits

- **Tests first:** missing real actions remain missing; no stub makes the
  checkpoint green. Fixture controls do not prove the future actions work.
- **Sources:** matching official 1.7 documentation and installed 1.7.12 source:
  [Admin](https://better-auth.com/docs/plugins/admin),
  [username](https://better-auth.com/docs/plugins/username) and
  [database hooks](https://better-auth.com/docs/concepts/database).
