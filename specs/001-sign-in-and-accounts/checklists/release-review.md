# Release review: Sign-in and Accounts

- **Decision:** RELEASE BLOCKED. The local implementation and release review are
  complete; production deployment and first-real-client approval are withheld.
- **Scope:** retain the original T045 assessment of all 23 release requirements
  and 21 source/patch shortcuts on 2026-10-30. The 2026-11-01
  [T056 convergence](../../002-master-mfa/quickstart.md#t056-final-convergence-checkpoint)
  adds current local MFA evidence and reviews all 23 current shortcut occurrences.
  That T056 update changed documentation only. The later
  [diagnostics checkpoint](../../003-error-diagnostics/quickstart.md) records
  the application logging changes and their separate hosted limits.
  The [T061 Flagship checkpoint](../../005-flagship/quickstart.md#local-verification-t061)
  adds local native picture-upload controls and fresh candidate verification.
  The [T063 checkpoint](../../004-cloudflare-test/quickstart.md#hosted-verification-t063)
  adds completed hosted test evidence on 2026-11-05; T064 remains open.
- **Meaning:** completing T045 records the review, not completion of the release
  checklist or full feature acceptance. Its unchecked requirements remain open.
  Approval of this report authorises documentation only.

## Required before release approval

- **Diagnostics:** Core records a safe event, request ID and fixed app/operation
  labels. The [local checkpoint](../../003-error-diagnostics/quickstart.md) covers
  every reporter caller and permanent privacy/correlation checks. T063 verified
  the named test collector, privacy, retention and received alert. Test configs
  enable Logs, Traces and Issues with query redaction and invocation logs off.
  Verify production collection, retention and ongoing alerts for T064.
- **Release path:** the [shared command](../../../docs/RELEASING.md) now provides
  an explicit test target, local three-app packaging, guarded ordered publication
  and private partial receipts. Its [corrected test publication](../../../docs/RELEASING.md#t064-corrected-test-publication-2026-11-05)
  passed in the reviewed Hub/private workspace/router order, with matching
  native/provider version IDs, preserved bindings and scoped smoke checks.
  CI use remains unverified. Choose and verify the production target/resources,
  rollout/rollback versions and migration procedure before release approval.
- **Hosted acceptance:** T063 verified the declared native identity, routing,
  staff-creation, revocation and picture-control journeys. Production hostnames
  and DNS/TLS, broader image fidelity, asset/edge policies and representative
  performance remain separate checks for the release target.
- **Operations and privacy:** provide the remaining backup/restore, load,
  monitoring, incident, feature-flag/version, release-note, secret-scan and privacy
  evidence listed below. Confirm any controls managed outside this repository
  against the actual release target; their absence here does not prove they do
  not exist elsewhere.
- **Gate:** until these requirements are satisfied and separately approved,
  retain the release hold and do not onboard the first real client. This is a
  review decision. MFA and hosted test evidence are recorded below; the shared
  production deployment workflow remains outstanding.

## Every-release checklist

The row order matches the reusable checklist. Partial means supporting evidence
exists while at least one requirement or target remains unverified.

| ID | Requirement | Assessment |
|---|---|---|
| R01 | Dry-run every app and confirm account | Test target verified. T063 confirmed the fixed account, packaged all three targets and read back the deployments/bindings. Repeat pre-release checks against the actual production target. |
| R02 | Checks pass on Cloudflare test environment | Verified for T063's declared hosted journeys; its checkpoint records scope and image-boundary limits. Broader image fidelity, asset/edge policies and release-target performance remain open. The full permanent suite remains dated local evidence. |
| R03 | Forward migrations and old-code compatibility | Partial. Real migration/rollback/startup tests pass locally; Hub migrations run serially and workspace upgrades are transactional. No deployed old/new release pair was tested. Retain the search name-copy rollback restriction in [ADR-028](../../../docs/adr/028-indexed-master-login-reads.md). |
| R04 | Known rollback version | Partial. T063 recorded test deployment references. A production rollback version, compatible old/new release pair and identified release/tag remain unverified. |
| R05 | Hub-first staged rollout | Test sequence verified: Hub, private workspace, router, then placement publication. Production cohorts and rollout evidence remain open. |
| R06 | One named-environment deploy path, local and CI | Partial. The shared Node-hosted command requires the reviewed test environment, previews all three apps and coordinates guarded publication with private partial receipts. CLI tests and native local packaging pass with corrected environment handling and native dry-run target checks. The corrected command published all three intended test Workers in the reviewed order; native/provider version readback, preserved bindings and scoped smoke checks passed. Chosen CI-runner evidence and production configuration remain outstanding. |
| R07 | Live reported version matches release | Partial. T063 recorded test deployment references; the corrected T064 publication additionally matched all three native receipt IDs against provider state. An application release-version endpoint/binding and production release match remain unimplemented/unverified. |
| R08 | New features behind flags, default off | Partial. T063 verified the native hosted picture policy, pilot targeting, displayed limits, server pause, invalid fallback and exact paused restoration. Production configuration and the remaining mapped controls still belong to their approved owning features. |
| R09 | Workspace versions reported and visible in STMS | Not implemented in these screens; STMS currently manages logins, not deployment versions. |
| R10 | No secrets in Git | Partial. No private environment/certificate paths are tracked; developer private files remain ignored and preserved. No installed secret scanner was available, and full history/release-artifact scanning was not performed. Do not claim a complete secret scan. |
| R11 | Page-size/speed budget checked in CI | Pending. T042 has declared local timing checks; no CI size/speed budget enforcement is configured. |
| R12 | Security checklist review passed | Partial. T043 records local controls; T063 adds scoped hosted access, revocation, picture and collector-privacy evidence. Remaining production and product-privacy requirements, including R23, keep the reusable checklist open. |
| R13 | Shortcut comments reviewed | Reviewed. The inventory covers 23 active source/patch occurrences. S23 is retired by local QR rendering; S24 records the existing attended hosted-setup limit. Production diagnostics and operations remain release gates. |
| R14 | Release notes written | Pending. No release-note artifact for an identified release is present. This assessment and task history are not release notes. |

## Before the first real client

| ID | Requirement | Assessment |
|---|---|---|
| R15 | Backup restoration rehearsed | Unverified. Persistence, eviction and transaction tests are not a hosted backup/restore rehearsal. |
| R16 | Heaviest workspace load tested | Unverified. Local functional concurrency and timing tests are not an agreed production-scale load test. |
| R17 | Searchable logs and traceable errors | Test target verified. T063 correlated native Logs/Traces/Issues, inspected synthetic collector privacy and recorded retention. Production collection, privacy and retention still need target-specific evidence. |
| R18 | Incident playbook rehearsed | No repository playbook or rehearsal evidence was found. Obtain the actual operational record before approval. |
| R19 | Error/uptime alerts configured | Partial. One service-scoped native test alert fired automatically and was received; its temporary policy/automation were then removed. Persistent production error and uptime alerts remain unconfigured/unverified. |
| R20 | Failed-sign-in/permission-change alerts | Safe audits exist; alert rules and a verified firing exercise remain unverified. |
| R21 | Public security.txt | No served `/.well-known/security.txt` artifact/route was found. Verify the intended hosted response and contact before release. |
| R22 | Master two-step sign-in | Implemented. [T056](../../002-master-mfa/quickstart.md#t056-final-convergence-checkpoint) covers native enforcement and factor-management cases locally. T063 adds owner-confirmed hosted QR enrollment and observed protected access. Production enforcement remains mandatory. |
| R23 | Legal privacy/data-handling review | No legal review evidence was assessed. [Deletion/anonymisation, retention and audit-comment policy](security-review.md#privacy) remain explicit product gaps. |

## Shortcut inventory

Each source comment states both its present limit and when to upgrade it. The
rows preserve those approved limits; they do not reopen the five accepted save
exceptions or add a recovery system. Local evidence refers to the unchanged
shortcut owners and permanent tests verified at T043, refreshed for MFA at
T056 and reviewed again at T061. The T063 closeout retires the manual-only QR
entry S23 and adds the already approved attended-setup entry S24. There are 23
active occurrences; each states both its limit and an upgrade trigger.

| ID | Source | Limit and upgrade trigger | Disposition |
|---|---|---|---|
| S01 | [Initial setup](../../../apps/hub/src/auth/initial-master.db.ts#L20) | Serial private setup has no concurrent claim. Add a database claim before concurrent setup. | Retain for operator-run, serial setup before Hub writes. |
| S02 | [Setup audit](../../../apps/hub/src/auth/initial-master.db.ts#L29) | Login/password/audit writes are separate. Add resumable setup before unattended/concurrent initialization. | Retain the accepted one-time exception; privately inspect interrupted setup. |
| S03 | [Sign-in audit](../../../apps/hub/src/auth/oidc.server.ts#L80) | Session and audit commit separately. Add coordination when complete audit coverage is required. | Retain the approved rare-interruption limit; no new ledger. |
| S04 | [Identifier limits](../../../apps/hub/src/auth/sign-in-protection.server.ts#L21) | Counters are approximate per location. Strengthen on observed bypass or stricter customer requirement. | Retain the native limiter and Turnstile; local refusal tests pass. |
| S05 | [Creation form](../../../apps/hub/src/features/create-login/create-login-form.tsx#L21) | Retry data stays in the mounted form. Add creator-owned retrieval when closed/reloaded-tab recovery is required. | Retain; incomplete logins stay blocked and real retry/lost-reply cases pass. |
| S06 | [Local creation](../../../apps/hub/src/functions/workspace-users.server.ts#L20) | Local adapter reaches one prepared app. Verify staging dispatch before deployed cross-workspace creation. | Retain the local limit; T063 verified deployed Hub-to-workspace staff creation for the prepared test workspace. |
| S07 | [Hub HTTPS shim](../../../apps/hub/vite.config.ts#L23) | Local service hops lose HTTPS. Remove when the platform preserves it; retain the binding regression. | Retain on the pinned local plugin; no production configuration change. |
| S08 | [Local router](../../../apps/router/src/local.server.ts#L11) | One prepared local app. Use staging dispatch before verifying deployed workspace routing. | Retain the local limit; T063 verified routing to the private test workspace through Workers for Platforms. |
| S09 | [KV placement](../../../apps/router/src/routing.server.ts#L44) | KV may lag. Add explicit invalidation before live address remapping. | Retain for prepared addresses; workspace identity/access remain authoritative. |
| S10 | [Pending sign-in](../../../apps/web/src/auth/oidc.server.ts#L69) | One pending flow per browser/workspace. Use separate transaction cookies when simultaneous flows are required. | Retain; state/nonce/PKCE and consumed-code checks remain intact. |
| S11 | [Mounted navigation](../../../apps/web/src/auth/session-expiry.tsx#L46) | Current workspace routes have no protected client loaders. Bind future loaders to this guard before adding them. | Retain for current routes; mounted-draft return cases pass. |
| S12 | [Web HTTPS shim](../../../apps/web/vite.config.ts#L24) | Same local service-hop limit as Hub; remove when platform support permits. | Retain the existing local regression and exact production-origin checks. |
| S13 | [Own password](../../../packages/accounts/src/change-password/change-password.server.ts#L19) | Native D1 failure may end sessions before changing the password. Adopt an atomic native API when supported. | Retain ADR-025 and safe uncertainty handling; no automatic replay. |
| S14 | [Picture cleanup](../../../packages/accounts/src/picture/picture-storage.server.ts#L61) | Old private objects can remain after cleanup failure. Add cleanup when usage or deletion/retention requires it. | Retain ADR-026; strict retention policy may trigger this upgrade. |
| S15 | [Storage types](../../../packages/core/src/database/workspace.db.ts#L21) | Dialect 0.2.2 lacks the platform record constraint. Remove assertion when compatible types are published. | Retain the narrow pinned compatibility assertion; runtime storage tests pass. |
| S16 | [Introspection](../../../packages/core/src/database/workspace.db.ts#L55) | Generic introspection reads protected internal tables. Remove filter when the dialect provides a safe implementation. | Retain; real restart/eviction and migration cases protect this limit. |
| S17 | [Diagnostics](../../../packages/core/src/server/errors.server.ts#L42) | Fixed locations without exception internals. Add reviewed private diagnostics if location and request ID cannot isolate failures. | Retain the safe labels; T063 verified the test collector and received alert. Production collection and ongoing monitoring remain R17/R19 gates. |
| S18 | [Lifecycle revocation](../../../packages/stms/src/logins/changes.db.ts#L74) | Live Hub checks refuse the next action. Add logout delivery when idle screens must sign out immediately. | Retain the accepted next-action contract; atomic revocation tests pass. |
| S19 | [Directory paging](../../../packages/stms/src/logins/logins.db.ts#L38) | Offsets read skipped rows. Adopt seek cursors when deep-page cost becomes significant. | Retain the approved initial offset contract; no premature pagination redesign. |
| S20 | [Reset revocation](../../../packages/stms/src/reset-password/reset-password.db.ts#L47) | Same next-action limit; add delivery if idle-screen sign-out becomes required. | Retain the atomic credential/session/token/audit batch and live access refusal. |
| S21 | [Provider patch](../../../patches/@better-auth%252Foauth-provider@1.7.12.patch#L7) | workerd rejects native redirect-error mode. Remove when the provider supports redirect refusal without the patch. | Retain the Bun-managed pinned patch and actual back-channel/redirect tests. |
| S22 | [MFA sign-in audit](../../../apps/hub/src/auth/mfa/http.server.ts#L35) | Native session and sign-in audit commit separately. Add coordination if complete sign-in audit coverage becomes required. | Retain the existing S03 sign-in-audit exception; factor-setting phases remain atomically audited. No additional MFA save exception. |
| S23 | [Authenticator QR](../../../apps/hub/src/features/mfa/mfa-screen.tsx#L108) | Retired: the manual-only display limit ended with the reviewed local QR renderer. | Closed by ADR-048 and owner-confirmed hosted scanning; manual-key entry remains a fallback. |
| S24 | [Hosted setup](../../../apps/hub/scripts/cloudflare-test.ts#L54) | Attended native D1 writes and operator files do not commit together. Add resumable setup before unattended execution. | Retain the approved attended setup and stop-on-failure rule; T063 initialization and file checks passed. |

## Evidence, cleanup and approvals

- **Baseline:** T043 passed 1,780 Workers tests in 89 files, 181 browser cases,
  nine type projects, three local builds, native schema comparison, frozen install
  and a clean 427-package audit. Its applied-source focused rechecks passed too.
  T044/T045 do not change that application or claim another full test run.
- **MFA refresh:** T056 passed 2,104 Workers tests in 114 files, all 225 browser
  checks including 44 MFA cases, all type projects and three local app builds.
  Native schema comparison and frozen install passed; the current JSON audit
  returned no advisory records. Public Web/Hub assets contain no source maps or
  source-map markers. Six native identity and four Core MFA refusals failed when
  their guards were temporarily removed; exact restored source passed the full
  checks. Both independent implementation reviews have no required finding.
- **Review method:** inspect scripts, configs, auth/plugins, migrations, public
  routes, the shortcut owners and their existing regression coverage. Current
  official documentation was retrieved through Context7 and checked against
  the installed versions. No dependency upgrade is proposed by this review.
- **Flagship refresh:** the [T061 checkpoint](../../005-flagship/quickstart.md#local-verification-t061)
  records 2,200 Workers tests in 117 files, all 234 browser/integration checks,
  all type projects and three local builds in the isolated candidate. Schema
  comparison, frozen install and the 427-package audit passed; public assets
  contain no source maps or source-map markers. It also records native/local CLI
  evidence and explicit provider-failure/stale-client fixture boundaries. The
  policy preserves access, storage, audit and cleanup rules. All 23 existing
  shortcut occurrences retain their accepted limits and upgrade triggers.
  Later test-target permissions, terms, hosted updates and restoration were
  verified at T063. R08 stays partial for the remaining production scope.
- **MFA closure:** the [T056 evidence](../../002-master-mfa/quickstart.md#t056-final-convergence-checkpoint)
  records the completed local feature and its 19-scenario map. Better Auth's native
  cryptography and public adapter/context interfaces remain in use. Role or
  enabled flags alone do not authorize a master session. Password confirmation,
  recent verification, captured revisions and conditional writes protect factor
  management; recovery with no factors remains deferred. Local completion does
  not provide hosted or first-client approval.
- **Hosted checkpoint:** [T063](../../004-cloudflare-test/quickstart.md#hosted-verification-t063)
  records the actual test deployment, native journeys, picture-control boundaries,
  collector privacy/retention and one owner-received automatic alert. The flag
  was restored and temporary alert resources removed. This is test-target
  evidence; the production release gates above remain open.
- **Deployment reference:** [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)
  define environment selection. T063 records the approved test procedure; R06
  still requires a shared production release workflow.
- **Cleanup:** remove only this task's disposable review/check files and owned
  processes. Preserve developer certificates, private settings, local data,
  pre-existing outputs/caches and unrelated work. Keep only the intentional
  review diff until it is approved and applied; then remove that artifact too.
- **Next work:** T064 reviews the remaining production deployment, rollout,
  backup/load, monitoring and security/privacy items above. Release approval
  requires evidence for the actual target and separate deployment/configuration
  authorisation. None is supplied by checking off T045's review task.
