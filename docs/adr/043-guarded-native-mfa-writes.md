# ADR-043: Guarded native MFA writes

**Status:** Accepted for planning | **Date:** 2026-10-30

## Problem

- **Split writes:** native factor activation and disabling update multiple D1
  records sequentially. A stopped request can leave mismatched flags and factors.
- **Delayed writers:** checking a session before a request or refusing its final
  session does not stop its pending write from changing newer factor material.
- **Existing guarantees:** the approved recovery policy accepts no new save
  exception. Native cryptography and verification should remain in Better Auth.

## Decision

- **Guarded native adapter:** create the existing Kysely/D1 adapter first, attach
  Hub-owned guards to its public security-write methods and pass it to native
  Better Auth. Preserve its identity, schema checks, conversion, atomic methods
  and sequential callback semantics. Await the resulting Hub auth factory.
- **Audited phases:** use existing Kysely/`saveHub` conditional batches for related
  MFA flags, factor material, revision/revocation and audit changes. A later native
  follow-up can acknowledge only its exact committed phase. Unrelated native
  operations retain their native implementation.
- **Captured proof:** guard factor, backup, counter, password and completion writes
  with request-local source authority. Carry only the winning revision to a new
  native session. Unknown security-write shapes fail closed. Keep all four fields
  approved in ADR-042; add no extra revision column or authentication ledger.
- **First proof:** demonstrate this composition with real native auth in workerd
  as the first approved implementation task. If required writes cannot use
  supported interfaces safely, return for design review rather than weaken the contract.

## Rejected options

- **Unchanged native writes:** sequential D1 operations cannot provide the required
  audited phase boundaries or fence a request already in progress.
- **Before/after checks only:** leave a race between checking state and mutating it.
- **Extra revisions and SQL triggers:** add schema and trigger protocols when the
  existing adapter boundary can express conditional writes; revisit only if the
  required workerd proof disproves the chosen composition.
- **Custom factor implementation:** duplicates native verification, encryption,
  code consumption and cookie handling without an established need.

## Impact

- **Scope:** one Hub-owned guard layer and a focused async-factory caller update;
  no new service, runtime setting, package upgrade or Hub RPC. Public request-local
  helpers may be referenced through the already-resolved core package directly.
- **Maintenance:** retain native schema/hook compatibility tests on auth upgrades.
  The proposal is source-supported, not yet demonstrated by application tests.
- **Failures:** coherent pending enrollment is resumable; failed delivery does not
  undo committed settings or consumed codes. Keep the existing own-password
  exception and release hold. Accept no additional MFA save exception.
- **Reference:** [MFA flow and failure handling](../../specs/002-master-mfa/plan.md#mfa-flow-and-failure-handling).
