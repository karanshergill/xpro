# Implementation Plan: Sign-in and Accounts

**Branch**: `001-sign-in-and-accounts` | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

**Reconciled:** 2026-11-01. The date above is the original planning date.

## Summary

The Hub, a separate app, handles central sign-in, profiles and STMS for the
master user. Public sign-up is disabled for now.
Logins, accounts, memberships and sessions live in the Hub's shared database, with its own
append-only audit log. Each workspace app signs people in through the Hub using the standard
sign-in protocol (OpenID Connect) and keeps its own session. Built backend first: setup, then
the save helper and audit log, then each story's server functions with tests, then screens,
then wiring.

## Current implementation and evidence

- **Delivered:** all six story backends and their screens, prepared-address
  routing, native workspace sign-in/logout, mounted draft return and the local
  browser, keyboard/timing and security checks through T043 are implemented.
- **MFA follow-up:** the [master-MFA feature](../002-master-mfa/plan.md) adds native
  guarded enrollment, verification and factor management. Its
  [T056 checkpoint](../002-master-mfa/quickstart.md#t056-final-convergence-checkpoint)
  records current local evidence; it does not approve release.
- **Destinations:** the Hub exposes `/sign-in`, `/mfa`, `/complete-profile`,
  `/create-login`, `/profile` and `/stms/logins` with known-ID management details.
  `/account`, the workspace root and `/portal` provide protected destinations;
  `/no-workspace` shows the informational unassigned message. Account/Portal
  business features are outside this feature.
- **Validation:** T043 passed 1,780 Workers tests in 89 files, 181 browser cases,
  nine type projects, three builds, native schema comparison, frozen install and
  the 427-package audit. The approved copy matches that tested source; focused
  repository rechecks also pass. T044 reconciles documentation without changing
  application behavior or rerunning the full pipeline.
- **Setup:** manual development requires private settings and prepared workspace,
  address and confidential OAuth-client records. No public registration or
  self-service workspace provisioning is enabled. The isolated browser runner
  prepares its own records without changing development data.
- **Acceptance:** the [scenario map](checklists/browser-acceptance.md) and
  [security review](checklists/security-review.md) distinguish local evidence,
  prototype checks and outstanding hosted/manual/privacy work. T045's
  [release review](checklists/release-review.md) is complete and withholds
  deployment and first-client approval. Master MFA is now implemented and checked
  locally; diagnostics, hosted/operational/privacy gates and release approval
  remain outstanding.

## Technical Context

**Language/Version**: TypeScript 6
**Primary Dependencies**: TanStack Start; Better Auth (default password hashing, username,
  admin, organization, JWT and OAuth provider add-ons); Kysely, Better Auth's native Kysely D1 adapter, kysely-durable-objects; Valibot;
  libphonenumber-js; true-myth; uuid v7; temporal-polyfill; TanStack Form;
  Base UI/shadcn controls; Tailwind; Paraglide JS; react-image-crop;
  oauth4webapi and jose
**Image processing**: Cloudflare Images binding for private profile-picture uploads
**Storage**: Hub: D1 for logins, accounts, workspace memberships, sessions and the Hub's audit
  log; R2 for profile pictures. Workspace: its own Durable Object for local user details,
  business permissions, sessions and its audit log
**Testing**: Vitest 4 with Cloudflare's test plugin (tests run inside the Workers runtime);
  Playwright and axe for implemented screens; full feature acceptance remains pending
**Target Platform**: Cloudflare Workers; Workers Paid from the first deploy of sign-in to the
  test environment
**Project Type**: three apps (Hub, workspace app and router) plus Core, Accounts,
  STMS and UI packages
**Performance Goals**: sign in to the right place within 3 seconds (SC-002)
**Constraints**: one workspace per person for now; nothing secret in web addresses except the
  one-time sign-in code (FR-018); local apps run over https on *.localhost
**Scale/Scope**: 6 stories, 30 requirements; first users are xpro's team and early account
  holders

## Constitution Check

Checked against constitution 5.0.0.

| Rule | Result |
|---|---|
| I. Workspace isolation | Pass. Hub holds identity and workspace membership. Business permissions, teams, entities, records and workspace sessions stay local. |
| II. Runs anywhere | Pass for the current D1/SQLite target. Better Auth uses its native Kysely D1 adapter and xpro database access uses Kysely. External workspace database adapters are future work, not tested support. |
| III. Data safety | Pass with five exceptions (below): sign-in auditing, resumable login creation, private initial-master setup, native own-password changes and private picture storage. Other STMS actions are saved in one batch with their audit entry; Better Auth's permanent "remove user" is switched off; workspaces upgrade themselves; the Hub's database is upgraded before each release. |
| IV. Cloudflare and Bun | Pass locally. Native membership, one-workspace and creation flows pass on D1/workerd. Bun, Workers and the approved configuration remain the baseline; hosted dispatch is separate. |
| V. Simple and maintainable | Pass. Reuse Better Auth for identity and membership; keep custom code to xpro-specific rules and storage integration. |
| VI. Tested behaviour | Pass for the declared local scope. Permanent Workers and actual browser checks cover all six stories. Hosted, manual accessibility, privacy and release acceptance remain explicit limits. |
| Architecture rules | Pass. Locally the apps run as separate Workers; Workers for Platforms is switched on before the first client. |

**Sign-in audit exception:** Better Auth saves a sign-in session before the Hub writes its audit entry.
If the Worker stops between those writes, the sign-in can be missing from the audit log.
This rare case is accepted for the initial version; no extra recovery system is built for it.
Revisit if complete sign-in audit coverage becomes a requirement.

**Login creation exception:** Story 6 spans Better Auth's writes in D1 and, when needed,
the workspace's separate database. A later failure may leave incomplete records.
Accept those records only while access is blocked and the same creation request can
finish the missing steps, as set out in [Login creation retries](#login-creation-retries).
Other STMS changes and their audit entries are still saved together.

**Private setup exception:** Better Auth creates the initial
login and its password in separate D1 writes; the Hub records creation afterward.
A failure can leave a login without its password, or a usable login without its
creation audit entry. Setup reports the failure and stops. A repeat never repairs,
promotes or changes an existing login. An operator must inspect and resolve an
interrupted setup before opening the Hub. This small, serial first-time setup
exception does not change the save/audit guarantees for other STMS actions.
Revisit before unattended or concurrent setup is supported; see
[ADR-013](../../docs/adr/013-private-initial-master-setup.md).

**Own-password exception:** keep Better Auth's native current-password check,
hashing, session revocation and replacement cookie. These are separate D1
writes. If the credential write fails, old sessions may have ended while the
old password remains. If replacement-session creation fails after the password
write, the new password remains without a replacement cookie. Report a safe
failure and do not retry automatically. The person signs in normally with the
password that was saved, or asks a master to reset it. Revisit when an atomic
native D1 API is supported or complete rollback becomes a requirement.
See [ADR-025](../../docs/adr/025-native-own-password-changes.md).

**Picture storage exception:** R2 objects and the D1 picture key cannot share a
transaction. Stage the new object, guard the pointer change by its previous key,
then delete the old object. A failed pre-commit save preserves the previous
picture. Confirm lost save replies by reading back; if that fails, keep both
private objects and report a safe error. A stopped Worker or failed cleanup may
leave a private orphan. After a committed change, cleanup failure is logged
without reporting rollback. No automatic write retry or recovery ledger is added.
Revisit when storage usage or strict deletion/retention requires cleanup; see
[ADR-026](../../docs/adr/026-bounded-private-profile-pictures.md).
Other STMS save/audit guarantees remain unchanged.

## First master user

- **Creation:** a private setup step creates the initial master user when xpro is
  first set up, using an explicitly supplied email and password.
- **Reuse:** use Better Auth's user creation, password hashing and admin role support.
- **Public sign-up:** disabled for now. If approved later, it must never grant
  master access.
- **Safe to repeat:** running setup again does not create another master, change
  existing roles or reset passwords.
- **Additional masters:** more master users may be added later, only by an existing
  master user. A management screen is outside this initial feature.
- **Credentials:** no default password or credentials committed to the repository.
- **Keep it small:** no public setup page or separate setup service.
- **Operator:** run one setup at a time, before the Hub accepts writes, and only
  against an empty Hub. Any existing login makes setup stop without changing it.
- **Local command:** use Wrangler's existing local bindings and actual migrations;
  remote bindings stay disabled. Production execution needs separately approved
  deployment settings. The reusable setup action accepts a real D1 binding.
- **Profile:** setup supplies only email and password. The normal profile-completion
  screen now collects the master's missing username, name and phone at first sign-in.
- **Audit:** record successful creation without credentials or personal details;
  its actor is empty because the first master has no existing creator.
- **Tests:** prove setup creates only the selected initial master, a repeat run
  leaves existing logins, roles and passwords unchanged, and public sign-up cannot
  grant master access.

## Workspace membership

- **Hub:** Better Auth's Organization plugin keeps the official membership list
  and controls who may manage members.
- **Login creation:** use the shared permission check for Story 6. Non-master
  creators need current membership and the Organization plugin's `member:create`
  permission for the requested workspace. The Hub then uses Better Auth's server
  APIs to create a non-master login and add its membership, without giving the
  creator global admin access.
- **One organization per workspace:** an organization represents a workspace,
  not the account that owns it.
- **Routing:** use the requested address and placement record to find the workspace app.
  Use Story 2 for the default destination after sign-in. The workspace app applies the
  [shared access checks](./contracts/server-functions.md#access-checks) before allowing access.
  Do not add a separate workspace-ID field to the login.
- **Workspace:** keep internal/external user type, business roles, permissions,
  teams, entities and business records locally.
- **Initial scope:** leave optional teams, dynamic roles and invitations unused.
  Each person still belongs to at most one workspace.
- **Unused endpoints:** block direct HTTP requests for creating, changing or deleting
  organizations and for invitation flows until the corresponding xpro features
  are approved. Prepared-workspace setup uses trusted server-side calls.
  Test that direct requests are refused while setup and login creation still work.
- **Workspace creation:** remains an STMS action in a later feature.
  Use prepared workspaces and memberships for this feature's tests.
- **Validation:** permanent D1/workerd tests now verify the native membership and
  one-workspace rules, permission checks, workspace-local internal/external type,
  audited creation and failed-save retries. Actual browser journeys also connect
  creation to first sign-in and refuse access after native membership removal.

## Login creation retries

Decision record: [ADR-010](../../docs/adr/010-retry-incomplete-login-creation.md).

- **Reference:** after checking input and permissions, save one login creation request
  in the Hub before the first login write. Tie it to the creator, intended workspace
  and non-secret creation details. Set its reference on the new login in the initial
  login write, so an interruption cannot lose that association.
- **Blocked until complete:** a login created by Story 6 cannot use xpro until its
  password record and creation audit entry are saved, along with any required
  membership and workspace user record. This is separate from profile completion
  and suspension.
- **Retry:** keep the same reference after a failed save. Check current permissions
  again and finish only missing steps for that request. Refuse a reference used for
  a different creator, workspace or set of creation details. Matching an email or
  username alone never permits reuse of an existing login.
- **No repeated changes:** retries do not reset a saved password, change existing
  roles or create duplicate logins, memberships, workspace users or creation audit
  entries. Concurrent retries must have the same result as one completed request.
- **Completion:** after confirming all other required records, save the successful
  creation audit entry and the completion marker in one Hub batch. Only then report
  success and allow access. Repeating a completed request returns its original result.
- **Passwords:** never save a readable password in the creation request, logs or
  audit entries. Better Auth continues to hash and manage passwords.
- **Infrastructure:** use the existing Hub and workspace databases. No additional
  service or background retry system is needed; the creator retries the request.
- **Proof:** permanent creation and storage-fault cases cover interruptions between
  writes, lost success, concurrent retries, changed permissions and unrelated
  identifier conflicts. Browser journeys exercise the real interrupted save and
  retry; access remains blocked until one audited completion. See
  [the evidence map](checklists/browser-acceptance.md#story-6-privately-create-a-login).

## Sign-in protection

- **Bots:** Cloudflare Turnstile on sign-in. If public sign-up is approved later,
  add the same protection before enabling it.
- **Attempts:** one Cloudflare Workers rate-limiting binding for both sign-in methods,
  targeting 10 attempts per minute per normalized email or username.
  Counts are approximate and local to each Cloudflare location.
- **Keep it small:** no additional rate-limit database, library, separate IP limit
  or daily failed-attempt counter.
- **Harden later:** add stronger limits if observed abuse bypasses these protections
  or a customer security requirement calls for them.

## Project Structure

### Documentation (this feature)

```text
specs/001-sign-in-and-accounts/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── server-functions.md
├── checklists/          local browser scenario map and security assessment
└── tasks.md             approved task and validation history
```

### Source Code (repository root)

```text
apps/
├── hub/          Hub app: sign-in, my account, STMS screens, Better Auth
│                 (Worker name: xpro-hub)
├── web/          Workspace app (Worker name "xpro" must not change)
└── router/       Small front router: sends each address to the right app
packages/
├── core/         @xpro/core: save helper, audit log, workspace users
├── accounts/     @xpro/accounts: logins and profiles (username, phone and picture rules,
│                 reserved names)
├── stms/         @xpro/stms: managing logins (suspend, reactivate, archive, restore,
│                 reset, change email or username)
└── ui/           @xpro/ui: shared controls and styles
tests/
├── support/      real-runtime fixtures, native identities and fault cases
└── e2e/          guarded three-app browser runner and permanent journeys
```

**Structure Decision**: one folder per action inside each package, holding its logic, input
checks and tests. Apps stay thin: screens, settings and wiring only. `apps/web` keeps its name
until there is a real reason to rename it.

**Build order**: setup → foundations → all six backends, including private creation,
one action at a time with real-runtime tests → screens → connected browser checks.
The [delivery order](tasks.md#dependencies-and-delivery-order) records the completed
backend-first sequence.

## Implementation decisions by delivery task

These sections retain the implementation sequence and decision links. Current
status and aggregate evidence are stated above; earlier checkpoint totals and
prototype results in linked records describe their own revision only.

### T036 indexed read implementation

STMS supplies global-master list/search/detail behind three registered Hub POST
functions. A private normalized name copy and two additive indexes support the
approved literal-prefix and page contracts; native and direct name writers
maintain the copy in their existing write. Three indexed UNION branches avoid
D1's short LIKE pattern limit and broad user scans. The restartable migration
runs serially with name writes paused. No new consistency exception is added.
[ADR-028](../../docs/adr/028-indexed-master-login-reads.md) records matching,
rollout and rollback limits; the
[current checkpoint](./tasks.md#t036-indexed-login-directory-checkpoint) records
verification. The later management writes and screens are recorded below.

### T037 atomic status implementation

STMS suspension/reactivation use native status fields and the existing atomic
Hub batch. An indexed target lookup and conditional audit insert claim the
expected nonarchived state; all subsequent writes require that fresh audit ID.
Suspension revokes all target sessions/active issued tokens, while reactivation
revives none. No new consistency exception, schema or dependency is added.
[ADR-029](../../docs/adr/029-atomic-login-status.md) records this implementation;
[the checkpoint](./tasks.md#t037-suspension-and-reactivation-checkpoint) records
verification. Archive/restore, identifier writes and screens are recorded below.

### T038 retained login archives

STMS archive/restore extend the existing atomic status batch and Hub registration.
Archive derives previous status at commit, retains native suspension and all
identity/history records, and shares claim-gated session/token revocation with
suspension. Restore clears only consistent archive markers; it creates no
membership or access. No new consistency exception, storage or dependency.
[ADR-030](../../docs/adr/030-atomic-login-archiving.md) records these guards;
[the checkpoint](./tasks.md#t038-archiving-and-restoration-checkpoint) records
verification. Identifier writes and screens are recorded below.

### T039 completed identifier backend

STMS changes email/username in one indexed batch with the conditional audit,
actual displaced-name reservation and session/token revocation. Availability
and normalized no-op checks run inside the batch. Real email replacement clears
old verification; passwords, status, roles, stable IDs and membership remain.
The shared native changes module and typed D1 result parameter avoid duplicate
revocation, result casts and a separate pre-read. No new consistency exception,
schema or dependency is added. [ADR-031](../../docs/adr/031-atomic-login-identifiers.md)
and the [checkpoint](./tasks.md#t039-identifier-changes-and-backend-checkpoint)
record the decisions and verification. All backend and screen work is delivered;
T041–T043 record local acceptance. Hosted and release checks remain separate.

### T016 completed profile screen

The Hub now renders only required profile fields with the existing Accounts save
and live access check. A readonly POST server function supports SSR without
widening the public RPC gate; rendered HTML is private/no-store. Used Base UI
controls, TanStack Form, Tailwind tokens and locally compiled Paraglide messages
provide the first UI foundation. Hydration, validation/focus, pointer activation,
confirmation and native signed continuation have real browser regressions.
The isolated browser runner removes its data/processes/artifacts.
[ADR-032](../../docs/adr/032-profile-completion-screen.md) and the
[checkpoint](./tasks.md#t016-profile-completion-screen-checkpoint) record scope and
verification. T022's delivered sign-in and session-return slices follow below.
The remaining delivered screens and local acceptance are recorded below.
Hosted acceptance remains separate from these local checks.


### T022 Hub sign-in screen

- **Native flow:** reuse Better Auth's existing credential methods, CAPTCHA,
  limiter and audit with the username and OAuth provider client plugins.
- **Form:** use the existing Hub controls, translated errors and blur/submit
  validation. Read native input values on submit for silent autofill; normalize
  only the identifier. Keep input after refusals and never retry automatically.
- **Widget:** explicitly render Cloudflare Turnstile with action sign-in.
  Require its public site key, preserve the server hostname/action checks,
  and keep failed or expired challenges disabled until manual retry.
- **Checks:** exercise native authentication with only external SDK/verification
  stand-ins in the guarded browser copy. Also check the actual official widget.
  [ADR-033](../../docs/adr/033-native-hub-sign-in-screen.md) records the decisions.
- **Follow-up:** workspace session return and native browser exchange are
  delivered below. Hosted/release acceptance remains pending.

### T022 mounted workspace session return

- **Page:** keep the working route mounted behind a blocking AlertDialog.
  Internal navigation checks live access first; action refusals open the same
  dialog. Input stays only in the original tab's memory.
- **Return:** use the existing native sign-in in a new tab. Resume only after a
  fresh server read confirms the original login and current workspace access.
  Different logins require an explicit reload; never replay failed writes.
- **Boundary:** the read-only page DTO reuses prepared request access. Compare
  an optional page ID only after authenticating the actual actor. Reuse Core's
  exact-Origin/bounded JSON gate and the existing pinned UI/translation tools.
- **Development:** retain HTTPS across local service hops with Vite-only
  middleware and a real binding regression. Production origin guards and
  runtime/deployment settings stay unchanged.
- **Checks:** real native credentials, callback/token exchange and workspace
  cookies support the guarded browser draft fixture. Worker, type, build,
  accessibility, network-failure and stale-response checks are recorded in the
  [checkpoint](./tasks.md#t022-workspace-session-return-checkpoint) and
  [ADR-034](../../docs/adr/034-mounted-workspace-session-return.md).
- **Limits:** reloads, closed tabs and cross-document navigation lose drafts.
  Before adding protected client loaders, ensure access failures keep the
  working route mounted. Business forms and full hosted acceptance stay pending.
- **Follow-up:** the delivered creation, profile and management screens follow;
  T041–T043 record local acceptance. Hosted acceptance remains separate.

### T027 create-login screen

- **Scope:** expose /create-login to masters and current workspace owners or
  users with native member:create permission. Tenant scope is fixed to their
  own workspace. Masters may create an unassigned login or select a prepared
  workspace and choose internal/external type.
- **Reads:** return only the current creator ID and allowed scope. Masters
  request workspace choices only when needed, in indexed pages of 20, with
  name and primary address to distinguish duplicate names.
- **Save:** reuse the existing creation action. Compare the original page
  creator with fresh authentication before any creation write; the hint grants
  no authority. Every actual save still checks current native permissions.
- **Retry:** keep the submitted reference, details and original password fixed
  in the mounted form after an uncertain result. Retry only on an explicit
  action. Known input/identifier refusals allow a deliberate corrected request
  with a fresh reference; no retry replaces an existing password.
- **Form:** reuse the pinned form, translation and UI tools and shared profile
  rules. Preserve silent autofill, disabled/busy states and accessible errors.
  Clear the password on confirmed completion and offer Create another login.
- **Limits:** closing or reloading loses the in-memory request. Add pending
  request retrieval only when recovery across those boundaries is required;
  the shortcut is marked. No Account, workspace or master is created here.
- **Decision:** see [ADR-035](../../docs/adr/035-private-create-login-screen.md).
  No dependency, migration, runtime or deployment configuration changes.
- **Follow-up:** the delivered reset, own-profile and STMS screens follow below.
  Hosted and release acceptance remain pending.

### T030 master password-reset control

- **Control:** provide a reusable inline form for T040's login detail page.
  Its host supplies the selected login ID/email and original page login ID from
  authorized page data. T030 adds no production route or new modal.
- **Service:** reuse the registered reset action and existing atomic credential,
  token/session and audit save. Comments stay optional; passwords stay ordinary.
  No current password, expiry or forced change is added.
- **Actor:** compare the optional page hint after fresh master authorization and
  before writes. The hint only refuses identity changes and adds no extra read.
- **Form:** reuse existing controls, translations and shared password rules.
  Preserve native autofill, POST/hydration/busy guards, blur/submit checks and
  accessible errors. Guard both field blurs against moving a pressed button.
- **Outcome:** retain values after errors. An unknown reply may follow a complete
  reset; another explicit submission is a new reset, with no automatic retry or
  creation-style replay reference. Explain possible session loss after self-reset.
- **Isolation:** key form state by target and page actor, so secrets and delayed
  responses cannot cross displayed logins. Confirm the response matches the
  target, clear input on success and keep handover outside xpro.
- **Transport:** share the existing Hub fetch adapter with creation. Preserve
  genuine HTTP refusals returned before Start serialization.
- **Scope:** see [ADR-036](../../docs/adr/036-private-password-reset-control.md).
  No dependency, schema, runtime or deployment configuration change.
- **Follow-up:** own-profile and T040's integrated management screens are
  delivered below; hosted and release acceptance remain separate.

### T034 own-profile screen

- **Page:** expose /profile to active, complete logins with separate details,
  picture and password forms. Masters use the same own-profile rules. Email and
  username are read-only; names and phones remain required.
- **Read:** reuse fresh native authentication and protected access, then return
  an indexed, explicit own-profile projection. Compare the original page actor
  on reads and all four writes; no preliminary write-time roundtrip is added.
- **Picture:** pin react-image-crop 11.1.2. Check original bytes/size before
  decoding, select a square and draw bounded PNG output through standard Canvas.
  Keep the existing one-file upload and native sanitation/storage rules.
- **Serving:** authenticate GET/HEAD for the actor's current owned revision.
  Refuse other/stale revisions; send PNG with private/no-store and Cookie variance.
  Show a circle with initials fallback and release selected-file URLs promptly.
- **Forms:** retain autofill, hydration/busy guards, keyboard/submit validation,
  stable pointer activation, accessible errors and per-section drafts. Never
  automatically replay a write or persist passwords in browser storage.
- **Session:** keep blocked drafts mounted and inert; normal sign-in in another
  tab plus a fresh same-actor read permits continuation. Abort superseded reads.
- **Outcome:** preserve actual native replacement cookies and clear successful
  password entry. An unknown response explains possible password/session changes.
  Picture results use one safe revision read; uncertain replies offer readback.
- **Limits:** ADR-025/026 remain unchanged. See
  [ADR-037](../../docs/adr/037-private-own-profile-screen.md). No schema, runtime,
  Vite, Cloudflare or deployment configuration change.
- **Next:** T040 and local checks T041–T043 are delivered below. T045 reviews
  release gates.


### T040 STMS login screens

- **Pages:** expose /stms/logins and /stms/logins/<loginId> to active, complete
  global masters. Redirect the existing /stms destination to the directory.
- **Reuse:** keep the existing indexed readers, seven management writes, atomic
  audits and T030 password-reset control. Add no role-management screen.
- **Actor:** authorized reads return the actual page actor in x-page-login-id.
  Compare the optional original-actor hint after fresh master authorization on
  every management read/write. The hint grants no permission or extra roundtrip.
- **Transport:** public server functions remain JSON POST. Read-only functions
  also support direct SSR invocation on the configured-origin STMS page GETs.
  Render private/no-store HTML with Cookie variation; keep JSON DTOs unchanged.
- **Directory:** keep query/offset in the URL, use Router's search serializer and
  native document links, and strip empty defaults. Preserve literal search text,
  including JSON-looking strings. Show 25 newest-first records and explicit UTC
  dates through Core's single date doorway; use semantic shadcn table parts.
- **Forms:** retain hydration/busy guards, autofill, optional comments, field
  errors and keyboard focus. Initial heading focus preserves scroll to keep
  a native link's target stable during hydration. Each router's supported
  restoration callback preserves the initial document position and restores later
  client navigations. Confirm suspend/archive;
  require a suspension reason
  and a meaningful comment only for Other. Prohibit self-suspend/archive.
- **Outcomes:** refresh metadata after confirmed changes. Keep another section's
  dirty input. Unknown replies offer explicit readback without write replay;
  password-reset uncertainty retains T030's guidance. Confirmed self-changes show
  success before renewed sign-in. Keep blocked drafts mounted and resume only
  after a fresh read as the original master; abort superseded reads.
- **Archives:** restore through a known detail address, retaining prior status.
  Normal directory/search still omit archives; no archive-search API is added.
- **Limits:** [ADR-038](../../docs/adr/038-private-stms-login-screens.md) adds no
  dependency, schema, runtime, configuration or data-safety exception. Final
  local checks are recorded in T041–T043; hosted and release work remains pending.


### T041 local browser acceptance

- **Destinations:** add minimal `/account` and `/portal` headings for the existing
  destination decisions. Reuse fresh Hub account routing and the workspace root
  gate; incomplete creation/profile and anonymous access stay refused.
- **Journeys:** connect actual private creation, optional completion, app/Portal,
  own-profile editing, indexed master search, reset and lifecycle actions. Check
  two-device native sign-out and live membership removal without discarding drafts.
- **Protocol:** use trusted HTTPS on a distinct customer hostname through the real
  local router. Deliver native provider JWKS and back-channel calls through local
  bindings in the guarded test copy; validate actual receiver/session effects.
  Check fresh changed-state rejection, independent consumed-code replay, origin-bound
  cookies, forged routing headers and closed native write routes.
- **Evidence:** map all 43 story scenarios to permanent browser/storage tests in
  the [acceptance checklist](checklists/browser-acceptance.md). Leave storage races
  to real Workers tests; browser clicks do not establish atomicity.
- **Isolation:** generate per-run server certificates from the existing trusted
  CA and keep fixture bindings, faults, data and instrumentation in disposable
  copies. Preserve source app configurations, developer secrets and local data.
- **Limits:** [ADR-039](../../docs/adr/039-local-browser-acceptance.md) adds no
  dependency, schema, runtime or deployment change. Local routing remains the
  approved one-workspace fallback. T042–T043's local checks are recorded below;
  hosted dispatch/images and full feature/release acceptance remain pending.


### T042 keyboard, accessibility and timing checks

- **Coverage:** add dedicated keyboard journeys for sign-in, completion, private
  internal/external creation, own profile/pictures/password, master management
  and ended-session return. Scan all feature pages and relevant dynamic states
  with the existing axe dependency; retain the earlier screen-specific cases.
- **Interaction:** traverse actual Tab stops and activate native controls. Cover
  clipboard paste, silent autofill, busy/error focus and modal containment. Keep
  the exact mounted draft without replay or stored form values; existing Router
  scroll-position storage remains allowed.
- **Timing:** measure SC-002's keyboard submission to correct visible heading
  against 3,000 ms on the declared 50 ms/10 Mbps down/2 Mbps up browser link.
  Measure SC-005's local keyboard search through saved suspension against 60,000
  ms. Record safe goal/time/limit/environment evidence, then remove run artifacts.
- **Limits:** use fresh contexts on shared warm development servers with outside
  Turnstile substituted. Visible-page timing excludes initial form setup and later
  hydration. Hosted production builds, real verification and inclusive/manual
  accessibility acceptance remain separate; see
  [ADR-040](../../docs/adr/040-keyboard-and-timing-acceptance.md).
- **Scope:** no application, dependency, schema, runtime or deployment change.
  T043's local security review is delivered below. Release gates remain T045.

### T043 security review

- **Policy:** apply one shared Core response policy at the Hub, workspace and
  production/local router entries. Set nosniff, deny framing and send no referrer;
  append base/object/frame CSP restrictions while retaining native CSP, cookies,
  status, streaming and upgrade metadata.
- **Evidence:** use actual sign-in success, refusal and storage failure to verify
  safe diagnostic/audit records. Browser cases check issued credentials against
  audit rows and navigation URLs, allow a one-use code only at the exact callback,
  verify real framing refusal and escaped user text, and complete native logout
  with the no-referrer policy. Cross-site null-Origin logout stays refused.
- **Fixture:** await native auth initialization and schema validation before
  disposing the shared browser read-back proxy. Keep genuine errors visible and
  retain a browser regression assertion; do not filter diagnostics.
- **Review:** map each reusable checklist item to evidence and outstanding work in
  the [security review](checklists/security-review.md). Keep deletion requests,
  anonymisation, free-text audit-comment policy and retention explicitly pending.
- **Limits:** [ADR-041](../../docs/adr/041-shared-response-security.md) adds no
  dependency, schema, runtime, Vite, Cloudflare or deployment configuration change.
  Static/edge headers, hosted image/dispatch behavior, production observability
  and source-map exposure remain hosted checks. T044 reconciles this final local
  state; T045 and release acceptance remain pending.
