# Implementation Plan: STMS account and workspace management

- **Feature:** `006-account-workspace-management`.
- **Working branch:** `main`; no branch change was performed.
- **Date:** 2026-11-07.
- **Spec:** [Approved specification](spec.md).
- **Status:** local proofs, preflight, schema, strict operation contracts, guarded commits, recorded-result recovery and the HTTP operation-status boundary are implemented and locally verified. The US1 account application journey is implemented and locally verified. Workspace creation/recovery, handover, lifecycle and hosted/cross-story acceptance remain pending.

## Summary

- **Scope:** implement the approved account/workspace lifecycle, recoverable creation and ownership handover. Keep the STMS name and existing production release hold.
- **Existing boundaries:** retain the Hub for identity and management, the workspace app for tenant data, and the router for address resolution. Keep business operations in the existing module packages.
- **Authoritative state:** keep account ownership, account/workspace status, creation progress and native organization membership in the Hub database. Workspace business data remains isolated in its own storage.
- **Atomic changes:** use the existing Kysely and `saveHub` pattern for related ownership, membership, lifecycle and audit changes. No provider calls or waiting inside a database save.
- **Recoverable provisioning:** save a stable creation intent before outside work. Resume from recorded progress and reconcile uncertain outcomes before repeating operations. Use trusted, prebuilt workspace artifacts; do not build application source inside a Hub request.
- **Live enforcement:** extend the shared access checks with authoritative workspace readiness and suspension. Routing caches and browser state cannot grant access.
- **Preserved contracts:** retain native login/MFA behavior, existing stored codes, immutable audit history and deployed resource identities.
- **Approval boundary:** this plan approves no application edits, dependency upgrades, migrations, resource creation or deployment. Those require the subsequent reviewed design and exact changes.

## Technical Context

- **Language and tooling:** TypeScript 6.0.3, the existing Bun workspaces and Node-based development/build tools. Application code continues to run on Cloudflare Workers/workerd.
- **Application stack:** TanStack Start 1.168.60, TanStack Router 1.170.41 and React 19.3.0. Reuse the existing server-function, component and translation conventions.
- **Authentication:** Better Auth 1.7.12, including the installed organization and MFA integrations. Keep native identity, credential and membership records; add no second authentication system.
- **Data access:** Kysely 0.28.18. Hub D1 remains authoritative for tenant management and access facts; each workspace retains its own SQLite Durable Object storage for business data.
- **Validation and results:** reuse Valibot 1.5.0, true-myth 9.4.0 and the existing Core input, error, request-context and save helpers.
- **Build and deployment tools:** retain Vite 8.3.5, Cloudflare Vite plugin 1.57.2 and the project-local Wrangler 4.136.2. Preserve existing compatibility settings and resource identities.
- **Verification:** use Vitest 4.1.12 with the existing Cloudflare test integration and Playwright 1.64.1 through the isolated browser wrapper. New behavior must be checked through real identity, storage and access paths.
- **Performance constraints:** management reads must be bounded, paginated and index-backed. Outside calls must not hold a database transaction. Workspace setup must expose recorded progress rather than keep a browser request waiting for a build.
- **Scale and scope:** retain one account per holder and one workspace per account/login. Verify isolation using separate workspaces and exercise concurrent creation, resumption and stale-management requests.
- **Change limits:** no dependency upgrade, new public registration path, production deployment or unreviewed configuration change is included. The provisioning executor and artifact-delivery details require their own design review.

## Constitution Check

- **Workspace isolation:** retain one isolated app and its own storage per workspace. Shared routing and identity do not grant cross-tenant data access.
- **Runtime and tooling:** preserve Cloudflare Workers, Bun and the installed versions. Any new provisioning executor or binding requires a separately reviewed configuration.
- **Atomic business changes:** account, ownership, membership and lifecycle changes must commit with their audit records in one Hub save. Do not treat separate native API calls as one transaction.
- **Outside operations:** provider calls happen outside database saves. Record intent first, reconcile uncertain results and recheck current conditions before activation. Do not claim atomicity across the database and Cloudflare APIs.
- **Migration safety:** use forward, additive migrations. Report ambiguous or conflicting existing records for explicit review; do not infer ownership or rewrite history silently. Verify old/new code compatibility before enabling the feature.
- **Maintainability:** reuse existing modules, native authentication and Core helpers. Add no general-purpose provisioning or job framework without a demonstrated requirement.
- **Verification:** require real storage/access tests and an approved two-workspace provisioning proof. Compiling, mocked provider replies or a successful upload alone do not prove the end-to-end feature.
- **Change control:** approved planning text does not approve application patches, database changes, new resources or deployment.
- **Portability:** keep workspace business rules framework-free and storage-location-independent. Cloudflare-specific provisioning remains at the platform boundary; this feature does not add an external database backend.
- **Ordinary xpro workspace:** xpro's own workspace follows the same tenant isolation and lifecycle rules. Tenant ownership never grants global master authority.
- **Code ownership:** deploy only reviewed xpro-built artifacts. This feature accepts no tenant-authored Worker code or arbitrary script uploads.
- **Decision records:** record the private Workflow executor and credential-recovery decisions in ADRs, including alternatives and consequences, before implementation tasks are approved.
- **Gate status:** post-design review found no constitutional exception. Runtime proof and exact resource/configuration approvals remain required before feature acceptance.

## Data ownership

- **Native records:** keep Better Auth's user, organization and member tables and identifiers. The organization ID remains the workspace ID; organization.name remains the workspace's canonical display name; member.role remains authoritative for workspace ownership.
- **Accounts:** retain accounts.owner_login_id as the account holder. Add the account name, indexed search value, active/suspended status, revision and update time. Enforce one account per holder with a database constraint.
- **Workspace state:** add an xpro-owned workspaces record keyed by the native organization ID. It holds the unique account link, independent active/suspended status, revision and chosen initial region. Do not duplicate the workspace-owner role here.
- **Creation record:** add one durable workspace_creations record per workspace. It owns the creation identity, immutable resource allocation and release reference, progress, current attempt, safe failure code and completion marker.
- **Readiness:** the creation completion marker is authoritative. A missing or incomplete creation record cannot be treated as Ready. Publish placement/address records only with the guarded completion transition.
- **Local user data:** internal/external kind and workspace-user history stay in workspace storage. Account holding and native owner/member roles stay in the Hub; a local user record alone never grants access.
- **Audit extension:** add account/workspace references and a validated details value to the existing immutable audit record. Each new action permits only its declared IDs, state changes and ownership changes—not arbitrary request data, names, credentials or provider responses.
- **Database constraints:** enforce unique holder, account-to-workspace and workspace-to-creation relationships, valid state codes and restricted references in the database as well as in operations.
- **Retained development/test data:** inspect records that actually exist and are to be kept. If required names, links or ownership facts are missing, use an explicitly reviewed mapping for those rows. Empty stores need no mapping. Add no general-purpose adoption UI or framework, and do not reset data without separate approval.
- **Migration boundary:** implement schema changes only in new dated migrations. Preserve released migrations, native table names and existing stored codes.

## Provisioning execution

- **Private executor:** add an internal apps/platform Worker, packaged as @xpro/platform, hosting a native WorkspaceProvisioning Workflow. It has no public tenant-facing route.
- **Hub ownership:** the Hub authenticates start/resume requests, owns native identity operations and commits tenant state. The executor cannot declare a workspace Ready merely because an upload succeeded.
- **Provider boundary:** the private executor handles Cloudflare resource and asset operations using a fixed, approved account/namespace and trusted release artifact. Browser input cannot supply provider credentials, arbitrary scripts or target accounts.
- **Durable attempts:** give each creation attempt a stable Workflow identity derived from its recorded creation and attempt revision. Repeated start requests find that attempt rather than create parallel independent work.
- **Fencing:** read the current creation before advancing each stage. Every checkpoint and final activation must match the current attempt and business revisions; an obsolete Workflow cannot commit stale ownership or readiness.
- **Browser independence:** once dispatched, a Workflow continues without the STMS tab. Reopening STMS reads the recorded state and offers resume when intervention is required.
- **Failure handling:** retry only operations whose outcome is known and safe to repeat. Reconcile an uncertain provider result before another write; otherwise record Needs attention. Do not automatically delete resources that might belong to a completed or newer operation.
- **Secret boundary:** Workflow parameters, returned step results and visible errors contain only approved identifiers and receipts—not credentials, raw provider responses or browser session cookies.
- **Configuration gate:** the new Worker, Workflow binding, artifact access and permissions require their own exact configuration review before implementation or deployment. Existing Worker identities and the guarded test release path remain unchanged.

## Provisioning credentials

- **Allocate once:** generate the workspace client ID, client secret and workspace-session secret once for the recorded creation. Persist a purpose-bound encrypted envelope before registration or deployment. Resumption and ownership handover reuse this material.
- **Existing cryptography:** use the installed Better Auth encryption helpers and Hub secret configuration. Validate the envelope's creation and environment identifiers after decryption; do not introduce a custom cipher or plaintext credential column.
- **Request-local generation:** construct a dedicated request-local auth instance with Better Auth's supported client-ID and client-secret generation hooks for the one trusted registration operation. The hooks are instance options, not API-call arguments. Do not reuse that instance for unrelated client creation or use module-global request state.
- **Native registration:** retain the existing confidential authorization-code client, PKCE, exact redirect URI and back-channel logout configuration. Keep public client-management routes unavailable.
- **Reconciliation:** after an uncertain registration result, look up the recorded client ID and verify its expected configuration. A mismatched existing client produces Needs attention; do not overwrite it or silently rotate credentials.
- **Private delivery:** send credentials only through trusted server bindings and the provider's secret-binding mechanism. Browser DTOs, Workflow parameters/results, logs and audit details never contain them.
- **Authorization lifetime:** background activation must still pass the Hub's current authorization checks for the recorded attempt. If its authority is no longer valid, stop at Needs attention and require an authorized resume.
- **Key loss:** inability to decrypt or verify the saved material stops the operation. Do not generate replacement credentials for an existing creation automatically.
- **Proof gate:** verify native registration, concurrent requests, lost responses, decryption failure and unchanged unrelated clients in workerd before enabling this path.

## Atomic management and handover

- **Fresh authority:** authenticate each request through the existing master boundary. The guarded save must also reject changed actor/session authority, stale target revisions and ineligible successors.
- **One business commit:** use the established conditional audit-claim pattern and one saveHub batch for account/workspace changes, native membership changes, revisions and audit details. Every dependent write must require the successful claim.
- **Native membership:** update the existing member records and roles, rather than adding a separate ownership table. Verify through native permission checks that a former owner loses owner-only powers on the next request.
- **Ready successor:** read internal-user eligibility from workspace storage before the save, then recheck the matching Hub membership and active login in the batch. A failed eligibility read causes no mutation.
- **Local-data boundary:** Ready-workspace handover does not rewrite or delete workspace-user history. This feature adds no local kind/archival mutation path; any future such path must coordinate with ownership eligibility before being enabled.
- **Ordinary transfer:** grant the selected successor's owner role and remove the old owner's transferred role in the same batch. Preserve the old user's ordinary membership and unrelated members.
- **Departure:** transfer all selected responsibilities and remove the departing person's Hub membership in that same batch. Retain their personal login, history and unrelated global authority.
- **Before Ready:** update the holder and intended initial owner together. Invalidate stale creation authority and reconcile any partial owner assignment before activation; do not create a second workspace.
- **No global logout:** handover does not rotate credentials or end unrelated Hub sessions. Fresh workspace and permission checks enforce the changed rights.
- **Unknown response:** after a lost reply, read the authoritative state. Do not automatically replay a transfer against a possibly changed owner.
- **Proof gate:** verify real native permission behavior, concurrent changes, failed later batch statements, removed-member sessions and unchanged unrelated users before enabling handover.

## Workspace access enforcement

- **Separate facts:** extend the shared Hub access result with the requested workspace's identity, readiness and account/workspace suspension state. Keep these separate from personal login validity and MFA.
- **Protected requests:** the shared Core policy must refuse an unfinished workspace for everyone. For a Ready workspace, ordinary users also require active account/workspace state and current membership; global masters retain the approved suspension exception.
- **Personal actions:** profile completion, personal profile access and sign-out keep their existing rules. Tenant suspension must not be translated into a personal-login suspension.
- **Authoritative read:** obtain tenant state with the live Hub access query. Do not rely on browser data, token claims, cached membership or the router's KV record.
- **Native authentication:** keep OAuth responsible for authenticating the login. Possessing an OAuth token does not replace the live workspace authorization check.
- **Private setup:** any pre-Ready initialization capability is restricted to the recorded provisioning operation. It must not expose ordinary workspace pages or business actions.
- **Contract cutover:** version the changed internal access contract, update every consumer and fail closed when required workspace facts or the supported contract version are missing. Do not silently treat an old response as Ready.
- **Rollout gate:** deploy and verify compatible Hub and workspace consumers before enabling tenant lifecycle operations. A rollback candidate must preserve the new authorization checks; a pre-feature binary is not an eligible rollback once these controls are in use.
- **User outcomes:** map workspace refusals to explicit, privacy-safe page and JSON responses. Preserve drafts where the existing session-return flow applies and avoid redirect loops.
- **Router boundary:** retain routing for a suspended Ready workspace so masters can reach it. KV remains a routing cache, not an authorization decision or a mechanism for revoking access.

## Research

Design decisions, rejected alternatives, sources and required implementation proofs are recorded in [research.md](research.md). No hosted or implementation success is claimed by that research.

## Data model and lifecycle

The records, constraints, creation phases and retained-data rules are defined in [data-model.md](data-model.md). Readiness is the guarded completion marker, not the existence of a Worker or placement cache.

## Provisioning contract

Operator inputs, private execution boundaries, stage receipts and activation conditions are specified in [contracts/provisioning.md](contracts/provisioning.md). The implementation must satisfy the contract's reconciliation and fencing rules before hosted verification.

## Access contract

The versioned Hub facts, authorization order and non-looping refusal behavior are defined in [contracts/access.md](contracts/access.md). Tenant restrictions must not be represented as an expired personal login.

## Management interfaces

The operator reads, mutations, handover commands and lost-response behavior are defined in [contracts/management.md](contracts/management.md). Existing STMS transport and authorization conventions remain in force.

## Screens

- **Keep the existing design:** extend StmsShell, fields, tables, confirmations and session recovery. No new dashboard, theme or component library.
- **Accounts:** /stms/accounts, /stms/accounts/new and /stms/accounts/$accountId. Show the holder, account status and linked workspace. Create a workspace from its account detail page.
- **Workspaces:** /stms/workspaces and /stms/workspaces/$workspaceId. Show the account, owner, setup progress and both independent suspension states.
- **Navigation:** add Accounts and Workspaces alongside the existing login-management links.
- **Progress:** show the recorded phase and Creating, Needs attention or Ready, not an invented percentage. Refresh read-only progress while a creation is active; never resubmit creation automatically.
- **Handover:** show current and proposed responsibilities, eligibility failures, and whether membership will be removed. Departure explicitly warns that global master authority is separate.
- **Lifecycle changes:** suspension confirms the target and consequence and collects a reason. Reactivation names the selected restriction and leaves other restrictions visible.
- **Forms and lists:** retain non-secret drafts, use inline errors plus a summary, preserve the existing changed-actor protection, and provide semantic table headers, keyboard paging and visible focus.
- **Unavailable page:** implement the approved fixed Hub destination with profile/sign-out access and no redirect loop.
- **Verification:** inspect the real screens at desktop, tablet and phone widths, in both themes and with longer/RTL text. Exercise keyboard-only completion and the existing session-return flow.

## Project Structure

### Documentation (this feature)

- **Specification:** [spec.md](spec.md) and [requirements checklist](checklists/requirements.md).
- **Design:** [research](research.md), [data model](data-model.md), [management contract](contracts/management.md), [provisioning contract](contracts/provisioning.md) and [access contract](contracts/access.md).
- **Validation:** [quickstart.md](quickstart.md).
- **Implementation tasks:** [tasks.md](tasks.md) is the approved execution ledger. T001–T002 and T004–T016 are complete locally, including the [US1 account journey](quickstart.md#account-management-verification-t010-t016). Workspace creation (T017 onward) is next; T003 configuration approvals and hosted/cross-story acceptance remain open.

### Source Code (repository root)

| Location | Responsibility |
|---|---|
| `packages/stms/src/` | Account/workspace actions, validation, queries, guarded saves and shared provisioning DTOs |
| `apps/hub/src/db/` | New dated migrations and Hub database types |
| `apps/hub/src/functions/`, `features/stms/`, `routes/stms/` | Authenticated server functions and management screens |
| `apps/hub/src/auth/` and provisioning integration | Native client registration, private control entrypoint and activation |
| New `apps/platform/` | Private Workflow, artifact verification and provider calls; no direct business-database ownership |
| `packages/core/src/access/` and workspace-user contracts | Versioned access facts, safe errors and shared private interfaces |
| `apps/web/src/workspace/` | Private initialization, live access enforcement and safe refusal behavior |
| `apps/router/src/` | Ready-workspace routing; no cached authorization |
| `scripts/` and existing test projects | Guarded artifact/release tooling and real-runtime verification |

Business rules remain framework-free. Apps use package public interfaces; no cross-app source imports.

## Implementation sequence

1. **Native feasibility proofs:** verify recoverable OAuth registration and Workflow behavior in workerd; obtain exact resource approval for the minimal hosted upload/isolation proof.
2. **Hub model and actions:** migrations, retained-data checks, account/workspace reads, atomic ownership/lifecycle changes and audit-backed deduplication.
3. **Access cutover:** versioned Hub facts, all consumers, fixed unavailable page and incompatible-release refusal.
4. **Provisioning:** trusted artifact packaging, private executor, reconciled stages, owner initialization and guarded activation.
5. **Screens:** account/workspace journeys using the proven operations and existing recovery patterns.
6. **Acceptance:** all specified scenarios, concurrent requests, interruptions, two-workspace isolation, keyboard/session checks and documentation.

Independent local domain work can continue while hosted-resource approval is pending. Hosted provisioning evidence remains a completion gate; production T064 remains separate.

## Verification

Run the scenarios and approved-environment checks in [quickstart.md](quickstart.md). Each specification acceptance scenario needs a matching behavior test. Hosted provider behavior and browser interaction require their own observed evidence; local test doubles are insufficient.

## Decision records

- [ADR-050: Durable workspace provisioning](../../docs/adr/050-durable-workspace-provisioning.md).
- [ADR-051: Recoverable workspace credentials](../../docs/adr/051-recoverable-workspace-credentials.md).
- [ADR-052: Atomic tenant control and live access](../../docs/adr/052-atomic-tenant-control-and-live-access.md).
