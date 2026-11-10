# ADR-051: Recoverable workspace credentials

**Status:** Accepted for implementation planning | **Date:** 2026-11-07

## Problem

- **Recovery:** native client registration requires authenticated authority and returns the confidential secret only once. A lost reply must not force replacement credentials.

## Decision

- **Allocation:** allocate the client ID, client secret and workspace-session secret once, and save an encrypted, purpose-bound envelope before registration.
- **Encryption:** use the existing Better Auth crypto and secret configuration.
- **Registration:** register through a dedicated request-local auth instance using the supported client-ID/client-secret generation hooks. The hooks are instance options, not request-body fields.
- **Authority:** perform registration in the authenticated Hub operation before Workflow dispatch. Never persist the operator's cookie.
- **Reconciliation:** reconcile a lost reply using the recorded client ID and expected client configuration. A mismatch becomes Needs attention; do not overwrite or rotate.
- **Transport:** pass secrets only through private calls to deployment bindings. Do not place them in Workflow history, DTOs, logs or audits.
- **Retention:** remove the staging envelope after verified completion. If decryption fails before completion, stop rather than inventing replacement credentials.

## Rejected alternatives

- **Persisted authority:** persisting a master cookie in the Workflow.
- **Unstable secrets:** generating a new secret on each retry.
- **Native bypass:** bypassing native registration with direct OAuth-table writes.

## Impact

- **Proof:** requires a real workerd proof of registration, lost-reply recovery and subsequent sign-in.
- **Compatibility:** preserves native authentication behavior and stable credentials.
- **Key retention:** recovery depends on retaining the required encryption key.

## References

- [Implementation plan](../../specs/006-account-workspace-management/plan.md).
- [Data model](../../specs/006-account-workspace-management/data-model.md).
- [Better Auth storage and generation options](https://better-auth.com/docs/plugins/oauth-provider/reference#storage-and-generation), checked against installed 1.7.12 interfaces.
