# ADR-052: Atomic tenant control and live access

**Status:** Accepted for implementation planning | **Date:** 2026-11-07

## Problem

- **Consistency:** ownership, membership, lifecycle state and audit history must not diverge. Existing sessions must not bypass changed tenant access.

## Decision

- **Authority:** keep account holding, workspace lifecycle and native membership authoritative in Hub D1. Keep workspace-user kind and history in workspace storage.
- **Atomicity:** apply related business changes and their audit record in one guarded `saveHub` batch, checking current authority, eligibility and expected revisions.
- **Handover:** a departure transfers all responsibilities held in that tenant and removes membership together. An ordinary owner transfer preserves ordinary membership.
- **Deduplication:** reuse the immutable audit entry ID for command deduplication, with a validated fingerprint and minimal recorded result.
- **Access:** enforce tenant access through versioned live Hub facts on protected requests, not tokens or routing caches.
- **Master boundary:** preserve the master exception for completed suspended workspaces, but never allow unfinished workspaces.
- **Refusal:** use a fixed unavailable page for tenant restrictions, without clearing personal sessions or redirecting back automatically.

## Rejected alternatives

- **Separate writes:** sequential native mutations presented as atomic.
- **Conflicting authority:** duplicate owner authority in workspace storage.
- **Stale authority:** cached tenant permissions in sessions or routing.
- **Duplicate ledger:** a separate command ledger duplicating the required immutable audit result.

## Impact

- **Proof:** requires concurrency, stale-request and real native-permission tests.
- **Cutover:** requires all access-contract consumers to migrate together and incompatible rollback artifacts to be refused.
- **History:** handover does not revoke a separate global master role or rewrite personal history.

## References

- [Implementation plan](../../specs/006-account-workspace-management/plan.md).
- [Management contract](../../specs/006-account-workspace-management/contracts/management.md).
- [Access contract](../../specs/006-account-workspace-management/contracts/access.md).
- [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
