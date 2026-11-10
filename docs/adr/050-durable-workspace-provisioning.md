# ADR-050: Durable workspace provisioning

**Status:** Accepted for implementation planning | **Date:** 2026-11-07

## Problem

- **Durability:** provisioning spans database commits and external operations. It must survive a closed browser without exposing an unfinished workspace.

## Decision

- **Executor:** use a private `apps/platform` Worker with a native `WorkspaceProvisioning` Workflow.
- **Authority:** keep Hub D1 authoritative for intent, immutable allocation, progress and completion. The Workflow cannot grant access independently.
- **Artifacts:** deploy reviewed, prebuilt releases from a dedicated private R2 bucket. Pin the release for each creation; do not build source inside Workers.
- **Environment:** use the approved account/dispatch namespace and distinct owned-domain origins. Configure resources only after separate approval.
- **Recovery:** reconcile uncertain external results before repeating writes. Fence checkpoints and activation by the current attempt.
- **Privacy:** keep credentials, upload tokens and raw provider responses out of durable Workflow outputs.

## Rejected alternatives

- **Browser-driven steps or a long Hub request:** execution depends on the request lifetime.
- **A custom job framework:** duplicates native durable execution.
- **Runtime builds or arbitrary artifact URLs:** expand the execution and trust boundary unnecessarily.

## Impact

- **Configuration:** adds a private app and explicitly approved bindings/resources.
- **Proof:** requires real upload, asset, storage-isolation and interruption proofs before completion.
- **Boundary:** adds no automatic resource deletion and does not unblock production T064.

## References

- [Implementation plan](../../specs/006-account-workspace-management/plan.md).
- [Provisioning contract](../../specs/006-account-workspace-management/contracts/provisioning.md).
- [Workflow rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/).
- [Asset deployment](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/static-assets/).
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
