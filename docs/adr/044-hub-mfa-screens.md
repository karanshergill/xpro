# ADR-044: Hub MFA screens and initial setup display

**Status:** Accepted for planning | **Date:** 2026-10-30

The initial manual-only display is extended by [ADR-048](048-local-authenticator-qr.md).
The original screen and native-auth decisions below remain the historical basis.

## Problem

- **Multiple entry states:** a master may need first setup, an existing challenge,
  interrupted-setup recovery or management of verified MFA.
- **Existing navigation:** sign-in, profile completion and destination selection
  already carry the provider's signed continuation. Extra routing systems or
  client flags would duplicate that state without granting authority.
- **Setup display:** no QR renderer is currently used by the project. The initial
  phase should keep dependencies and custom code small while allowing enrollment.

## Decision

- **One MFA page:** use `/mfa` for setup and second-factor entry, resolved from
  native server state. Link to its replacement form from `/profile`, keep backup
  generation on `/profile`, and reuse `/complete-profile`
  as the provider's existing post-login entry. Keep redirects explicit until
  credential inputs are cleared and any new backup set can be copied/downloaded.
  Submit replacement on `/mfa` itself so private setup material stays in that
  component; an allowlisted display intent never supplies server authority.
- **Native continuation:** retain signed provider queries and fixed Hub paths.
  Every mutation and authorization still uses the approved server guards.
- **Manual initial setup:** show a copyable native setup key with instructions for
  time-based enrollment, then verify a native authenticator code. Use the platform
  URL parser and existing inputs; introduce no QR renderer at this stage.
- **Private memory:** setup material comes from an explicit trusted action and
  remains in local component state. Refresh uses pending-setup verification or
  explicit restart; it never silently creates new factors.

## Rejected options

- **Separate page for every MFA step:** adds routes when the native state already
  distinguishes setup and verification; reconsider if the journey becomes broader.
- **Independent return-URL/session store:** duplicates signed provider state and
  introduces a second continuation mechanism.
- **QR renderer immediately:** adds a dependency review for an initial workflow
  that can use the native manual key. Add a reviewed local renderer when master
  onboarding reveals entry errors or scanning becomes a release requirement.
- **External QR service:** sends authentication material outside the private flow.

## Impact

- **Usability:** masters initially enter or copy a setup key into their app, then
  save backup codes. Scanning a QR code is deferred explicitly.
- **Changes:** one route plus focused sign-in/profile/destination updates using
  existing components; no new Worker configuration or runtime dependency here.
- **Limit:** component state is lost on refresh; recover through the approved
  pending setup or backup-generation actions. Keep the release hold and first
  workerd proof gate. Approval of this design does not approve application coding.
- **Reference:** [screens and routes](../../specs/002-master-mfa/plan.md#screens-and-routes).
