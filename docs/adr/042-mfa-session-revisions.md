# ADR-042: MFA session time and login revisions

**Status:** Accepted for planning | **Date:** 2026-10-30

## Problem

- **Older sessions:** a login's enabled flag does not prove that a particular
  session passed MFA, or when it did so.
- **Delayed verification:** deleting sessions cannot stop an MFA check that
  already consumed its challenge from creating a later session.
- **Older consumers:** existing workspace code can ignore an added MFA field on
  a valid Hub result and keep granting master access.

## Decision

- **Native extensions:** use one login revision copied into native sessions and
  relevant verification records, plus one nullable session MFA completion time.
  Retain native challenge/factor storage and cryptography; add no service or
  separate authentication ledger.
- **Captured authority:** carry the revision from credential verification into
  the exact consumed challenge and issued session. Revocation advances the login
  revision; live access refuses older sessions, even if created afterward.
- **Verification time:** record it after successful factor verification with
  guarded persistence before authorization. Preserve its age when an authorized
  own-password change retains the current device.
- **Authoritative boundary:** the external HubAccess binding refuses unverified
  masters using an existing invalid result. Rich incomplete-MFA states stay in
  the Hub-local limited-access path. Workspace callers cannot opt into it.
- **Planning limit:** this approves the data approach only. Detailed native-write,
  save, concurrency and interruption handling must be reviewed and demonstrated
  before implementation. The release hold remains; no new save exception is accepted.

## Rejected options

- **Enabled flag only:** cannot distinguish verified and password-only sessions.
- **Session creation time:** password rotation can create a session without new MFA.
- **Delete challenges/sessions only:** cannot fence a verification already running.
- **Read the latest revision at completion:** makes an old request appear current.
- **New MFA field only on a valid RPC result:** older consumers may ignore it.
- **Separate recovery service or ledger:** native extension points support the
  required metadata without introducing another store or auth service.

## Impact

- **Storage:** four added native-table columns, targeted challenge lookup and
  one-factor-per-login constraints. Existing session MFA time stays NULL.
- **Requests:** add facts to the existing indexed access snapshot; add no Hub RPC.
  Verification/revocation writes still require their own guarded composition.
- **Evidence:** source review confirms the native extension points. Workerd proof
  must check hook/request isolation and actual write/authorization ordering;
  session revisions alone do not fence stale factor or backup writes.
- **Reference:** [data and session contract](../../specs/002-master-mfa/plan.md#data-and-session-contract).
