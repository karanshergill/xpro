# ADR-010: Retry incomplete login creation

**Status:** Accepted | **Date:** 2026-10-24

## Problem

- Better Auth's sequential writes, the Hub's audit entry and the workspace's
  user record do not share one transaction. A later failure can leave part of
  a new login saved, and a fresh creation attempt can then fail as a duplicate.

## Decision

- **Reference:** save one login creation request tied to its creator, intended
  workspace and non-secret creation details before the first login write.
  Link the new login to it in that initial write.
- **Access:** keep the new login blocked until creation is complete.
- **Retry:** check current permissions and finish only missing steps for the same
  request. Preserve saved passwords and records; refuse unrelated existing logins.
- **Completion:** confirm all required records, then save the successful creation
  audit entry and completion marker in one Hub batch. Repeating a completed request
  returns its original result.
- **Scope:** this is an approved exception to all-or-nothing saves for Story 6.
  Other STMS actions keep their save and audit rules. The detailed contract is in
  [Login creation retries](../../specs/001-sign-in-and-accounts/plan.md#login-creation-retries).

## Rejected options

- **One transaction across D1 and workspace storage:** these APIs do not provide it.
- **Delete partial logins:** conflicts with retaining logins and their history.
- **Separate retry service:** the creator can retry through the existing apps.

## Impact

- **Recovery:** a failed creation can be finished without making a second login.
- **Cost:** save a creation reference and check completion during access checks.
  Incomplete records remain until the creator successfully retries.
- **Validation:** failure and concurrent-retry tests must pass before this flow
  is treated as working. The earlier prototype exposed the problem; it did not
  validate this fix.
