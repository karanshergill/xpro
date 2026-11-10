# Tasks: Sign-in and Accounts

**Status:** 45 of 45 local implementation and review tasks are delivered: T001–T045.
Backend, screens, local cross-story journeys and dedicated keyboard/timing checks
are delivered, including the local security review. T043's historical baseline
passed 1,780 Workers tests in 89 files, 181 browser checks, nine type projects and
three local builds. The [master-MFA follow-up](../002-master-mfa/tasks.md) and its
[T056 evidence](../002-master-mfa/quickstart.md#t056-final-convergence-checkpoint)
record the later implementation and project-wide checks. The release review
retains **RELEASE BLOCKED**: diagnostics, hosted/operational/privacy gates and
release approval remain outstanding. Local task completion does not pass the
release checklist or implement the named-environment deployment workflow.

## Validation checkpoint — 2026-10-24

- **Error cause:** the old Workers rejection timing reported handled Better Auth
  failures as unhandled. Six refusal tests reproduced the earlier seven errors.
  Enabling `unhandled_rejection_after_microtask_checkpoint` gave the same six
  passing tests with no unhandled errors, keeping compatibility date `2025-09-02`.
  The approved flag is now in `apps/web/wrangler.jsonc`.
- **Control:** an intentionally unhandled rejection still made the runner fail.
  No error filter, ignored-error setting or dependency patch was used.
- **Retry result:** 38 tests passed, with zero assertion failures, zero unhandled
  errors and exit code 0: six refusal tests and 32 private-creation/retry tests.
  They ran locally in workerd with D1 and SQLite Durable Object storage.
- **Covered:** owner, permitted admin and master creation; internal/external users;
  standalone master-created logins; failures saving the request, login, credential,
  membership, workspace user, audit entry and completion marker; interruptions;
  lost success responses; eight concurrent fresh attempts and eight concurrent
  credential repairs; changed permissions or request details; duplicate identities;
  password preservation; blocked unfinished access; and blocked native write routes.
- **Storage details:** the working prototype linked the creation reference in
  Better Auth's initial user-create hook. Unique constraints protected the creation
  link, one credential per login and one workspace per login. Audit insertion and
  the completion marker committed in one D1 batch. Workspace writes used the
  Durable Object's async storage transaction with Kysely.
- **Credential repair:** native user creation can save the user before its password
  account. After authorising the creator and matching the saved creation reference,
  the prototype reused Better Auth's configured password hasher and
  `internalAdapter.linkAccount` only when the credential was missing. It never
  changed a saved password. This version-sensitive integration must keep behaviour
  tests; it must not become a general password-reset endpoint.
- **Versions tested:** Better Auth 1.7.12; Cloudflare Vitest plugin 1.4.6;
  Vitest 4.1.12; Kysely 0.28.18; kysely-d1 0.4.0;
  kysely-durable-objects 0.2.2. Recheck documentation and release age before
  installing implementation dependencies.
- **Limits:** this was a reference prototype, not the application. It did not
  revalidate the full OIDC, custom-domain or browser flows. Profile checks were
  simplified for the prototype; application code must use the approved validators.
  Keep the stable creation reference separate from each HTTP request's ID when
  wiring application logs and audit entries.
  All temporary sources, dependencies, caches and data were removed.

## Official references checked before task generation

- [Cloudflare rejection handling](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#defer-unhandled-rejection-processing-to-after-microtask-checkpoint).
- [Cloudflare Vitest configuration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/)
  and [test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/).
- [D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
  and [Durable Object transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction).
- [Better Auth hooks](https://better-auth.com/docs/concepts/hooks),
  [additional fields](https://better-auth.com/docs/concepts/database),
  [Admin](https://better-auth.com/docs/plugins/admin),
  [Organization](https://better-auth.com/docs/plugins/organization) and
  [OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider).
- [Better Auth's tested user/password implementation](https://github.com/better-auth/better-auth/blob/v1.7.12/packages/better-auth/src/plugins/admin/routes.ts)
  and the [oauth4webapi client](https://github.com/panva/oauth4webapi).

## Execution rules

- **Order:** setup → foundations → story backends → screens → browser checks.
  Write each action's observable behaviour tests before implementing it.
- **Scope:** keep all 30 requirements. Public sign-up, invitations, editable roles,
  teams, password-expiry rules and a background creation-retry service stay out.
- **Approval:** prepare exact diffs before changing existing files. Runtime,
  Vite, Cloudflare and deployment configuration still need explicit approval.
  Adding this checklist does not approve those future configuration changes.
- **Package layout:** use `apps/hub`, `apps/web`, `apps/router`,
  `packages/core`, `packages/accounts` and `packages/stms` from the plan.
  Keep one action's rules, database code and tests together. Apps provide thin
  routes and configuration. The existing Worker name `xpro` stays unchanged.
- **Checks:** every acceptance scenario gets a test. No story is complete until
  its backend, screens and relevant browser checks pass against application code.
  The temporary prototype does not complete any task below.
- **Parallel marker:** `[P]` identifies separate test files that can be authored
  independently after their shared prerequisites. It does not require delegation.

## Phase 1: Setup

- [x] T001 Verify official docs, Workers support, peer versions and release age for the approved dependencies; prepare exact pins in `package.json`, app/package manifests and `bunfig.toml`, update `docs/TECH_STACK.md`, then install with Bun and disabled install scripts after required approvals.
- [x] T002 Prepare the minimal app/package scaffold in `apps/hub/package.json`, `apps/router/package.json`, `packages/core/package.json`, `packages/accounts/package.json` and `packages/stms/package.json`; reuse the existing web setup and obtain approval for new or changed Vite, Wrangler, local HTTPS, service-binding and storage configuration before applying it.
- [x] T003 Add the real-runtime test setup in `vitest.config.ts` and `tests/support/runtime.ts`, with isolated local bindings, an environment guard, MSW outside-call stubs, storage reset, generated test types and one root Bun test script; use the approved rejection flag and keep genuine unhandled errors fatal. Add real Hub migrations and HTTP sign-in fixtures with T008, workspace migrations with T009, and the workspace HTTP sign-in fixture with T018–T019 after that flow exists.
- [x] T004 Add bounded server input and named error/request-ID handling in `packages/core/src/server/errors.server.ts` and `packages/core/src/server/request.ts`; keep the stable creation reference distinct from each HTTP request ID, use the approved validation and result libraries, keep responses allow-listed and keep secrets out of logs.

## Phase 2: Foundations

- [x] T005 Write save/migration/audit behaviour tests in `packages/core/src/save/save.test.ts` and `apps/hub/src/db/hub-save.test.ts`: rollback after a later failure, immutable audit entries, upgrades from earlier schemas, and another workspace left unchanged.
- [x] T006 Implement the approved save helpers in `packages/core/src/save/save.db.ts` and `apps/hub/src/db/hub-save.db.ts`: Kysely inside `ctx.storage.transaction` for workspace storage, prepared all-or-nothing batches for D1, and no outside calls inside a local transaction.
- [x] T007 Configure Better Auth in `apps/hub/src/auth/auth.server.ts`: default-strength hashing, username/Admin/Organization/JWT/OAuth Provider support, disabled public sign-up and unused write routes, fixed membership roles and sessions lasting "at most 30 days"; keep trusted server APIs available and validate current package APIs before wiring them.
- [x] T008 Generate Better Auth's schema using its supported tooling in `apps/hub/scripts/generate-auth-schema.ts`; add Kysely migrations under `apps/hub/src/db/migrations/` for the full data model, audit triggers, indexed references and uniqueness rules, including "A login belongs to at most one workspace" and the unique `login_creation_id` link. Keep Better Auth's table names and documented non-STRICT exception. Apply these actual migrations before each relevant test and add real HTTP sign-in fixtures through the T007 authentication handler; do not bypass authentication or seed business records with raw test writes.
- [x] T009 Add workspace-user, local-session and local-audit migrations under `packages/core/src/database/migrations/` and startup upgrading in `apps/web/src/workspace/workspace.db.ts`; preserve internal/external type and business permissions locally and use the startup lock only for upgrades. Make workspace tests run these actual migrations. Extend the workspace HTTP sign-in fixture in T019 once T018–T019 implement that flow.
- [x] T010 Write and implement repeat-safe initial-master setup in `apps/hub/scripts/initial-master.test.ts` and `apps/hub/scripts/initial-master.ts`: explicitly supplied credentials, one initial master, no defaults, and no role/password changes when repeated against an existing login.
- [x] T011 Write shared-access behaviour tests in `packages/core/src/access/access.test.ts`: live revocation, role/membership changes, incomplete creation/profile gates, actual master identity without membership, local permissions, one Hub call per request and no reuse across requests.
- [x] T012 Implement the checks and Hub validation binding in `packages/core/src/access/access.server.ts`, `packages/accounts/src/access/validate-access.server.ts` and `apps/hub/src/auth/hub-access.server.ts`; allow only the approved completion/session/sign-out actions while a profile is unfinished, and deny protected access while login creation is unfinished.

**T012 checkpoint:** all 37 T011 cases pass against the real implementation.
The shared check validates the Hub once before a local save; authorization inside
it remains synchronous. Permanent tests exercise the named Service Binding in
workerd, native HTTP gates and indexed query plans. The full suite and test-project
type check passed at that checkpoint. A separate two-Worker check also exercised
the built Hub export using the configured service/entrypoint and production
compatibility settings.
Workspace HTTP sign-in fixtures still follow T018–T019.

## Phase 3: User Story 1 — Complete first sign-in (P1)

**Goal:** ask only for missing or invalid profile details.
**Independent test:** prepared complete and incomplete logins reach the right
destination; invalid, taken or reserved usernames are refused; skipping the form
does not grant access. No Account or workspace is created by signing in.

- [x] T013 [P] [US1] Write all Story 1 acceptance tests in `packages/accounts/src/complete-first-sign-in/complete-first-sign-in.test.ts`, including direct server calls and public sign-up refusal.
- [x] T014 [US1] Reuse T012's shared profile validity checks and add username availability in `packages/accounts/src/profile/profile.ts` and `packages/accounts/src/check-username/check-username.db.ts`: "4–8 characters, lowercase letters, numbers, dots, dashes and underscores, starting with a letter, unique across xpro, not reserved"; emails are "unique, ignoring capital letters and spaces around them"; store phone "in one international format" using the approved phone library.
- [x] T015 [US1] Implement `completeFirstSignIn` in `packages/accounts/src/complete-first-sign-in/complete-first-sign-in.server.ts` with the real save path, server-enforced completion and username confirmation rules; expose it through a thin Hub server function.
- [x] T016 [US1] After the backend checkpoint, add `apps/hub/src/routes/complete-profile.tsx` using shared form components and translations; show only required fields and the approved username warning, with keyboard/error/loading behaviour from the screen conventions.

**T013 checkpoint:** 47 cases are authored against the future
`completeFirstSignIn` action, real native HTTP sign-in, the T012 access check and
actual Hub migrations. At that checkpoint it stopped at the missing
`complete-first-sign-in.server.ts` module. T015 now makes those cases pass using
T014's helpers and restores the full test-project type check.
UI warning/form checks remain T016/T041, and actual destination/OIDC checks remain
T017–T019/T041. No fake implementation or skipped case is introduced.

**T014 checkpoint:** shared name/phone rules and indexed username availability
are implemented. The Hub and Accounts reuse one native D1 connection constructor;
feature table models remain owned by their data layers. Native username sign-in
uses the same format rule, and the unused native availability route is disabled.
That checkpoint passed 288 implemented tests, including query plans and mutation
controls, while T013's completion cases awaited T015.

**T015 checkpoint:** the Accounts action and authenticated Hub POST server function
are implemented. A conditional D1 batch saves a first username and its audit
together; repeated or competing requests cannot overwrite the saved choice.
All 356 tests and the full type check pass, including the original 47 cases,
six additional save regressions and 15 authenticated-boundary cases. All three
builds, frozen install, dependency audit and auth-schema check pass. The built
HTTP endpoint also passed seven checks, followed by a storage readback. Temporary
mutations of confirmation, snapshot protection and batch atomicity were caught.
See [ADR-016](../../docs/adr/016-atomic-profile-completion.md). Story 1's screen
and browser warning remain T016/T041; T017 below records the next test checkpoint.

### T016 profile-completion screen checkpoint

- **Delivered:** /complete-profile asks only for missing/invalid username, name
  and phone. Its readonly server function uses the native cookie and live shared
  check; inactive, unfinished or unauthenticated logins receive no field data.
  HTML is private/no-store with Cookie variation; public RPC keeps the POST gate.
- **Form:** reuse the existing save and validation rules. Show the exact username
  warning and require confirmation, clearing it on edits. Country selection uses
  the approved phone library. Errors stay beside fields and in a summary, with
  focus, retained input, busy controls and no automatic write retry.
- **Browser readiness:** controls wait for hydration and use native POST.
  Pointer activation does not lose clicks when blur messages change layout;
  keyboard blur and submit validation still run. A stale form refreshes its
  required fields and cannot overwrite another tab's completed username.
- **Continuation:** a complete profile skips the form. Hub completion uses the
  existing destination; signed workspace completion uses the native provider.
  Validation errors retain signed state, and the provider returns the registered
  callback only after the profile is valid.
- **Foundation:** install only the used Base UI/shadcn form controls, TanStack
  Form, Tailwind and Paraglide tools. Shared controls stay in the Hub. Local
  pinned message compilation runs before tests/types and during Vite builds.
  English and pseudo-language checks use request-local server context.
- **Checks:** 1,542 Workers tests in 74 files, all eight type projects, all three
  builds, schema comparison, frozen install and dependency audit pass. Add 23
  real browser checks, including accessibility, narrow/RTL layout and dark theme.
  Three broken versions fail their tests and are restored; review has no required
  findings. The screen cases use native authentication and actual local storage.
- **Cleanup:** the browser runner makes an isolated copy and removes its temporary
  records, processes and artifacts. Verification leaves existing local data and
  private settings alone. [ADR-032](../../docs/adr/032-profile-completion-screen.md)
  records the form, transport and UI-tool decisions.
- **Next:** both T022 slices are delivered below. T027/T030/T034/T040 and full
  T041–T045 browser/hosted/release work remain pending.

## Phase 4: User Story 2 — Sign in, route and sign out (P1)

**Goal:** real Hub sign-in and standard OIDC into the correct workspace app or Portal.
**Independent test:** internal/external users, account holders and masters reach
their specified destinations; sign-out/revocation blocks the next action;
interrupted sessions return to the same safe page with unsaved non-secret input.

- [x] T017 [P] [US2] Write Story 2 and routing-edge tests in `packages/accounts/src/sign-in/sign-in.test.ts` and `apps/web/src/auth/oidc.test.ts`; cover generic credential errors, suspended/archived logins, two devices, unknown/forbidden workspace addresses, safe redirects, code replay and missing-session behaviour.
- [x] T018 [US2] Implement the Hub OIDC provider wiring and native credential-response/audit handling in `apps/hub/src/auth/oidc.server.ts`, Accounts' `getSignInDestination` in `packages/accounts/src/sign-in/sign-in.server.ts`, and workspace start/callback logic in `apps/web/src/auth/oidc.server.ts` using the approved provider and `oauth4webapi`; validate discovery, trusted confidential clients, PKCE/state/nonce, exact redirects, code expiry/replay and disabled unused registration/grants against current official docs.
- [x] T019 [US2] Implement workspace session creation, `getCurrentUser`, sign-out and validated Hub sign-out messages in `packages/core/src/sessions/sessions.server.ts` and `apps/web/src/auth/sign-out.server.ts`; keep live Hub checks authoritative even when a back-channel message is absent. Extend the shared HTTP sign-in fixtures through the actual Hub-to-workspace callback and session flow; do not bypass authentication in protected-action tests.
- [x] T020 [US2] Add server-verified Turnstile and the approved approximate "10 attempts per minute" identifier limit in `apps/hub/src/auth/sign-in-protection.server.ts`; test both sign-in methods and refused responses, and obtain approval before adding the rate-limit binding to `apps/hub/wrangler.jsonc`.
- [x] T021 [US2] Implement prepared-workspace placement and address routing in `apps/router/src/router.server.ts`, with tests in `apps/router/src/router.test.ts`; router hints never replace workspace access checks, and account/workspace creation stays outside this feature.
- [x] T022 [US2] After the backend checkpoint, add the Hub sign-in route in `apps/hub/src/routes/sign-in.tsx` and workspace session-expiry handling in `apps/web/src/auth/session-expiry.tsx`; preserve non-secret unsaved input and support paste, password managers, autofill and the specified messages.

### T022 Hub sign-in screen checkpoint

- **Delivered:** /sign-in uses the existing native email/username credentials,
  CAPTCHA, identifier limit and audit. Public registration stays unavailable.
  All specified credential, suspended, archived, limit and security messages
  come from translations and include a safe reference when supplied.
- **Form:** blur/submit checks, field errors, summary/focus, busy state and
  hydration gating follow T016. Native paste and silent password-manager
  autofill work; the password is never trimmed. Refused or uncertain submissions
  keep input and are never retried automatically.
- **Continuation:** direct sign-in uses /auth/destination. Workspace sign-in
  preserves the native signed query through errors and profile completion.
  Changed signatures are refused; caller query targets are ignored. Unassigned
  people reach the approved message at /no-workspace.
- **Settings:** TURNSTILE_SITE_KEY is public and required alongside the existing
  secret. A strict read-only page function returns only that key. Missing keys
  fail safely. Real manual development uses a paired widget for the Hub hostname.
- **Checks:** 1,578 Workers tests in 76 files, eight type projects, three local
  builds and 47 permanent browser checks pass, plus schema, frozen install and
  audit checks. Two inverted guards fail their tests and are restored. A separate
  live official-widget smoke check passes and its temporary test is removed.
- **Isolation:** browser SDK and Siteverify responses can be controlled as
  outside services. Native credentials/cookies, real D1 and signed continuation
  remain in use. The external stub is imported only into the guarded temporary
  copy; no application authentication endpoint or checker is replaced.
- **Follow-up:** workspace session return and native browser exchange are
  delivered below. Account/STMS and other feature screens and T041–T045
  hosted/acceptance/release gates remain pending.
  See [ADR-033](../../docs/adr/033-native-hub-sign-in-screen.md).

### T022 workspace session-return checkpoint

- **Delivered:** the workspace keeps its current page mounted when a server
  request or an internal navigation check finds an ended session. The blocking
  dialog hides and disables the page without removing its React state or fields.
- **Return:** sign-in opens in a separate tab through the existing native Hub
  flow. Returning or selecting Continue checks live workspace access again.
  Only the original login may resume; another login must reload and lose the
  old draft. Failed writes are never replayed.
- **Checks:** 1,613 Workers tests in 78 files, nine type projects, three local
  builds and 55 browser checks pass. The real browser exchange covers native
  credentials, the registered confidential client, callback, workspace cookie,
  expired actions/navigation, same-login return and different-login refusal.
  Network loss, delayed old responses, keyboard/focus, accessibility, dark mode,
  narrow RTL and pseudo language are covered. Two deliberately inverted checks
  fail their regressions and are restored exactly.
- **Boundaries:** a read-only strict-empty-input POST function returns only the
  already-authorized login ID. Dynamic requests still use the local session,
  live Hub check and local-user gate. An optional mounted-page ID only refuses
  a different actual actor; it grants no access. Both apps share the existing
  bounded JSON/Origin gate through Core.
- **UI:** Button, AlertDialog and theme tokens used by both apps live in
  @xpro/ui. Web uses the same pinned Tailwind/Paraglide tooling as the Hub.
  Navigation remains a native link, styled with the shared button variants.
- **Local HTTPS:** a development-only Vite middleware preserves the configured
  HTTPS scheme across local service bindings. Real binding tests cover the
  platform's earlier HTTP rewrite; production origin checks stay unchanged.
- **Limits:** drafts survive only while the original tab stays mounted. Reload,
  closing the tab or cross-document navigation discards them. There are no
  workspace business forms or protected client loaders yet; the isolated draft
  fixture proves this boundary, and future loaders must preserve the mounted
  route on access failure before they ship.
- **Isolation:** only external widget/verification responses and interrupted or
  delayed connections are controlled. Authentication, protocol, storage and
  permissions stay real. The fixture route exists only in the guarded copy.
  Its data, processes, logs, screenshots and reports are removed afterward.
- **Follow-up:** T027 supplies the create-login screen below, followed by T030/T034/T040 and the
  remaining full browser/hosted/release gates in T041–T045. See
  [ADR-034](../../docs/adr/034-mounted-workspace-session-return.md).

**T017–T018 checkpoint (before T019):** 37 central sign-in/destination and 35 workspace
acceptance cases are authored. The 35 central cases within T018 now pass; the
two platform-limit refusals still await T020. T019 must implement `finishSignIn`,
`getCurrentUser` and sign-out before the workspace acceptance suite can collect.
T018's `validateSignInCallback` validates the real exchange and returns verified
identity to that future session handler; it does not create a workspace session.

The real-runtime checks also cover 35 protocol cases, private-cookie protections,
indexed destination/status queries, native and audit storage failures, and pending
login creation. Native JSON and HTML OAuth continuation both work and create one
credential audit. Customer domains, S256/state/nonce, exact redirects, code expiry,
sequential/concurrent replay and disabled grants/registration are checked against
the native provider. Inverting the native-new-session and cookie-expiry guards
made their relevant tests fail; both changes were restored exactly.

The full suite reports 444 passed and two planned T020 failures, plus the T019
collection failure; no skip or replacement implementation hides them. All six
application/package checks, all three local builds, frozen install, audit and
native schema comparison pass. The test-project check has only the three named
T019 omissions. Built-Hub HTTP checks pass on repeated runs. Two earlier local
runtime restarts remain unexplained and must be rechecked before deployment;
standalone crypto/D1 probes pass on both installed tool versions. No runtime or
tool version is changed for this observation. Address routing, screens and browser restoration remain
T021/T022/T041. See [ADR-017](../../docs/adr/017-oidc-browser-continuation.md).

**T019 checkpoint:** the 35 workspace acceptance cases now collect and pass.
The final callback creates a private local session capped by the original Hub
expiry, preserves local type and checks live access. Core exposes current
identity and request-local authorization. Native RP-Initiated Logout ends only
the current device; signed native Hub messages clear matching local sessions.
Repeated, missing and redirected delivery, cross-workspace isolation, cookie
tampering and the token boundary have permanent coverage. The shared HTTP
fixture follows the actual callback and save; authentication is never replaced.

A Workers runtime failure in native delivery was reproduced: the provider uses
an unsupported redirect mode. The minimal Bun patch retains native signing,
revocation and delivery while refusing redirects with `manual`. A fresh frozen
install reapplies it. `jose` 6.2.13 becomes a direct web dependency without a
version change. The review's quadratic form loop is replaced with one pass.

The full suite reports 518 passed and only the two planned T020 failures across
33 collected files. All seven type-check projects, all three builds, frozen
install and the 333-package audit pass. Inverting the logout nonce guard made
its tests fail; the source was restored exactly before the final run. See
[ADR-018](../../docs/adr/018-workspace-sessions-and-logout.md). The earlier T018
runtime observation remains a deployment check, and public route composition,
screens and browser acceptance remain T021/T022/T041.

**T020 checkpoint:** both credential methods use the installed native CAPTCHA
plugin with Hub-hostname and `sign-in` action checks. The public entry requires
the secret and one platform limiter. Counters target 10 attempts per minute per
normalized identifier and remain approximate per Cloudflare location.

The 40 new runtime tests cover native Siteverify requests, token boundaries,
hostname/action refusals, malformed replies, outages, timeout, normalized keys,
the actual local binding, alternate-route refusal and unblocked sign-out.
Refused attempts issue no session and preserve unrelated records. Inverting the
limiter decision caused 27 failures; the source was restored before the final
run. The two previous limit-refusal failures now pass.

All 560 tests across 34 files, all seven type-check projects, all three builds,
frozen install and the 333-package audit pass. Independent review has no
required findings. See [ADR-019](../../docs/adr/019-sign-in-protection.md).
The T018 runtime observation remains a deployment check. The visible widget and
full browser acceptance remain T022/T041; prepared placement and public route
composition remain T021.

**T021 checkpoint:** STMS owns the prepared placement/address directory in Hub
D1. The router validates its KV copy and uses a private Hub binding on a miss.
Native dispatch preserves the request; the local environment connects one
prepared `xpro` app. Unknown addresses return to the fixed Hub destination
without forwarding writes.

The workspace validates its own configuration, origin and actual object ID.
Its existing native auth/session handlers and one live Hub check protect
rendering; non-masters also need an active local user. Native Start receives
request-local storage/access context. The Hub uses existing Accounts
destination rules and the prepared primary address.

All 606 tests across 39 files, all seven type-check projects, all three builds,
frozen install and the 333-package audit pass. Reversing the object-ID guard
caused four test failures; the exact source was restored before the full run.
A separate built-Worker probe completed native sign-in/callback, real HTML
streaming and device sign-out, without private settings in the HTML. Its
temporary adapters, data and logs were removed. Independent review has no
required findings. See [ADR-020](../../docs/adr/020-prepared-workspace-routing.md).
Deployed dispatch, DNS/TLS and the earlier T018 runtime observation remain
deployment checks; screens and full browser journeys remain T022/T041.
T023 is next under the approved backend-first order.

## Phase 5: User Story 6 — Create someone else's login (P1)

**Goal:** private creation that safely resumes after failed saves.
**Independent test:** a permitted creator produces one non-master login with its
required membership and local type; complete profiles sign in immediately with
the ordinary supplied password. Interrupted creation stays blocked and resumes
once, including concurrent retries and lost responses.

- [x] T023 [P] [US6] Write all Story 6 scenarios and the 32 validated prototype behaviours against application code in `packages/accounts/src/create-login/create-login.test.ts`; use real D1, Durable Objects and HTTP sign-in, inject failures at every save boundary, and check unrelated logins/workspaces stay unchanged.
- [x] T024 [US6] Implement saved creation references and the initial user-create hook in `packages/accounts/src/create-login/create-login.db.ts` and `apps/hub/src/auth/auth.server.ts`; bind creator, intended workspace and non-secret details, set the server-owned link in the first login write, and enforce one credential and one linked login per creation through database constraints.
- [x] T025 [US6] Implement `createLogin` in `packages/accounts/src/create-login/create-login.server.ts`: recheck current `member:create` permission, use native user/member APIs without granting global admin, resume only missing steps for the same request, recover a missing credential through the verified Better Auth helpers, and never reset a saved password or adopt an unrelated identity.
- [x] T026 [US6] Complete local-user saving in `packages/core/src/workspace-users/workspace-users.db.ts` and the thin Hub creation server function in `apps/hub/src/functions/create-login.server.ts`; confirm all required records before the single Hub audit/completion batch, return the saved result on repeats, and enforce incomplete-creation checks on both Hub and workspace access.
- [x] T027 [US6] After the backend checkpoint, add `apps/hub/src/routes/create-login.tsx`; scope non-master creators to their own workspace, choose internal/external type, retain the creation reference for an explicit retry, and use ordinary passwords with no expiry, shown-once rule or forced first-sign-in change.

### T027 create-login screen checkpoint

- **Delivered:** the private Hub form uses the existing creation service.
  Masters may choose an unassigned login or a prepared workspace. Tenant
  creators see only their own workspace after current native permission checks.
  Workspace creation retains the selected internal/external type.
- **Safety:** fresh authentication checks the original page creator before any
  creation write. Uncertain replies retain the exact reference, details and
  original password for explicit retry. Known identifier refusals permit a
  corrected new request. Confirmed success clears the password.
- **Choices:** master-only pages expose at most 20 safe name/address choices.
  Real first-page/cursor query plans use indexes without shared-table scans.
  Browsing and failed list requests retain the selection.
- **Verified:** all 1,659 Workers tests in 81 files, nine type projects and three
  local builds pass. All 74 browser checks pass, including 19 creation cases
  covering native sign-in/internal workspace entry, tenant scope, identifiers,
  busy state, committed-response loss, expired/changed logins, autofill and
  accessible narrow/RTL, dark and expanded-language layouts.
- **Review:** reversing the actor guard fails two tests; reversing the
  uncertain-request correction guard fails five. Exact files are restored and
  all 54 targeted checks pass again. Independent review has no required
  findings. Frozen install, native schema comparison and the 426-package audit
  pass. Temporary test copies, data, output and processes are removed.
- **Limits:** pending requests survive only in the mounted form, with a marked
  retrieval upgrade trigger. Full hosted/Portal journeys and release acceptance
  remain pending. No dependency, migration, runtime or deployment change.
  [ADR-035](../../docs/adr/035-private-create-login-screen.md) records the design.
- **Follow-up:** T030 supplies the reset control below; T034/T040 and T041–T045
  remain pending.

**T023 test-authoring checkpoint (historical):**

- **Coverage:** 87 authored cases cover all ten Story 6 scenarios and the
  documented prototype categories: permissions and identifiers, every failed
  save, committed-write interruptions, lost responses, concurrent creation and
  credential repair, changed requests/authority and password preservation.
- **Boundary:** call the real Hub action, which must use Accounts. The root
  fixture adapts workspace transport to the real Core save in an actual object.
  It supplies no creation hook, recovery algorithm, permission decision or upsert.
- **Verified:** all 606 prior tests and six real-D1 interruption checks pass.
  Reversing the interruption guard made all six checks fail; its exact source
  was restored before the full run. All six app/package checks and three builds
  pass. Independent review has no remaining required findings.
- **Pending:** the new suite cannot collect because the Hub creation action and
  Core workspace-user save do not exist. The test-project check reports exactly
  those two missing modules. Creation behavior is unverified until T024–T026
  supply the real implementation. No skip or replacement implementation hides it.
- **Transport:** T026 must wire the real server function and authenticated private
  workspace call. The fixture's access to a local test namespace does not give
  the production Hub access to a tenant's storage. See the
  [Story 6 test boundary](./contracts/server-functions.md#story-6-test-boundary).

**T024 reference/link checkpoint (historical):**

- **Saved request:** canonical non-secret details bind one reference to its
  creator and intended workspace/type. A repeat preserves the original record;
  changed intent returns a conflict. Look up a created login only by its link.
- **Initial write:** native user creation captures a trusted saved snapshot.
  The before-hook writes its reference in the initial user insert, checks the
  profile/non-master role and overrides body data. Other setup cannot attach
  a link through body data. Existing session and HTTP gates remain in place.
- **Reuse:** existing foreign keys and unique indexes protect the association
  and credential count. The native schema comparison confirms no migration.
  No runtime, configuration, dependency or service is added.
- **Verified:** 43 new tests pass; the full run has 655 passing tests in 42 files.
  Reversing the profile guard fails 11 tests and reversing the creator check
  fails five. Both exact files were restored before the full run. Six app/package
  type checks, three builds, frozen install and the 333-package audit
  pass. Independent review has no remaining required findings.
- **Pending:** the 87 Story 6 cases still cannot collect; the test-project check
  reports only the same two missing modules. Live permission, recovery and full
  orchestration remain T025; local saving, the final batch and real transport
  remain T026. See [ADR-021](../../docs/adr/021-initial-login-creation-link.md).

**T025 native-record checkpoint (historical):**

- **Authority:** use the real native session and shared access checks. Every
  non-master attempt must target a workspace and pass its native `member:create`
  permission. Repeats do not bypass current authority or the saved intent.
- **Recovery:** Accounts prepares the linked native login, credential and member
  through a Hub-owned identity capability. It never adopts an email/username
  match, resets a saved password or changes an existing membership role.
  Native password helpers and existing uniqueness constraints resolve repairs.
- **Boundary:** the result is an internal `PreparedLoginCreation`. Pending
  records remain blocked; it supplies no public creation success. T026 still
  owns the local save, required-record confirmation, single audit/completion
  batch, public action and authenticated private workspace transport.
- **Verified:** 51 new native/D1 tests pass; the full run has 706 passing tests
  in 43 files. Removing the permission check fails four cases; inverting the
  credential-presence guard fails three. Exact sources were restored before
  the full run. All six app/package checks, three builds, schema comparison,
  frozen install and 333-package audit pass. No vulnerabilities are reported.
  Independent review has no remaining required findings.
- **Replay checks:** real D1 saves seed completed-reference conditions to check
  replay and pointer/link refusal. This does not verify the future final batch.
- **Test correction:** native membership queries now bypass the naming converter
  so they actually change/read Better Auth's camelCase columns. The same fix is
  applied to the pending Story 6 test setup; those cases have not executed.
- **Pending:** the full test command still reports one collection failure for
  the 87-case suite, and the test-project check reports only its same two missing
  T026 modules. No skip, stub or fake creation path hides this. See
  [ADR-022](../../docs/adr/022-native-login-creation-recovery.md).

**T026 completed-creation checkpoint:**

- **Flow:** the real Hub POST action composes native preparation, the Core local
  user save and Accounts' completion batch. Strict matching receipts and current
  native records precede one creation audit and completion marker. Lost replies
  and concurrent repeats preserve saved records and return the original result.
- **Private call:** production uses authoritative placement and dispatch `props`;
  local development uses the named private RPC binding. Worker and object both
  check deployment scope, with actual object-ID verification at the save boundary.
  Public body/header claims cannot supply authority.
- **Boundary:** exact-origin JSON POST is limited to 64 KiB of actual bytes before
  native Start deserialization. Decoded fields are validated again. A different
  creator receives 403; changed details/scope remain a conflict.
- **Verified:** all original 87 creation cases and 11 added cases pass. The full
  run passes 842 tests in 48 files, all seven type-check projects, three builds,
  native schema comparison, frozen install and 333-package audit with no reported
  vulnerabilities. Nine built-Worker HTTP/RPC/props checks pass. The local Hub
  command starts and passes three HTTPS refusal checks, then is stopped.
  First-master setup selects that same environment; two real CLI runs and native
  sign-in confirm password preservation and the Hub's shared local database.
- **Mutation/review:** separating audit and completion fails two tests; reversing
  deployment scope fails three. Exact files are restored before final checks.
  Independent review has no remaining required findings.
- **Setup:** the proposed Hub configuration adds production dispatch and the local
  private service environment; its dev command selects `local`. Test bindings
  add an isolated fixed workspace and private RPC receiver. No schema, dependency,
  runtime or Vite configuration changes.
- **Pending:** hosted namespace invocation, deployed placement/DNS/TLS and complete
  browser screens still require staging/release verification. The native props
  probe uses a local service binding, not hosted dispatch. See
  [ADR-023](../../docs/adr/023-complete-creation-and-private-workspace-save.md).

## Phase 6: User Story 3 — Reset a forgotten password (P2)

**Goal:** only masters reset another person's password; old sessions end.
**Independent test:** the old password and every old session stop working, the new
ordinary password works, and workspace admins cannot perform the reset.

- [x] T028 [P] [US3] Write reset acceptance and failure-path tests in `packages/stms/src/reset-password/reset-password.test.ts`, including no partial STMS change without its audit entry, all-device revocation, denied non-master calls and no forced password change.
- [x] T029 [US3] Implement the reset in `packages/stms/src/reset-password/reset-password.server.ts` and `packages/stms/src/reset-password/reset-password.db.ts`, reusing Better Auth's password handling and meeting the existing STMS save/audit rule; native `setUserPassword` alone does not revoke sessions, and sequential native writes do not by themselves prove all-or-nothing saving. If that rule cannot be met, report the gap before weakening it.
- [x] T030 [US3] After the backend checkpoint, add the master reset control in `apps/hub/src/components/stms/reset-password.tsx`; keep external handover, no mandatory comment and no temporary-password workflow.

### T030 master reset control checkpoint

- **Delivered:** the reusable inline form shows its selected login and uses the
  existing atomic audited reset service. Comments are optional and passwords
  remain ordinary. T040 supplies the STMS detail-page host; no standalone
  production route is added.
- **Authority:** current native access must authorize a master before the
  optional original-page hint is compared. A different master is refused
  before writes; tenant permissions and forged hints grant no authority.
- **Form:** shared password rules, native POST/autofill, hydration/busy guards,
  translated field errors and focused summaries are implemented. Both blurs
  preserve pointer submission. Target/actor keys isolate secrets and late replies.
- **Outcome:** errors retain input. An unknown reply may have committed; a
  deliberately submitted next reset is a new action, never automatic recovery.
  Self-reset explains possible session loss and offers sign-in. Confirmed
  success clears the password and leaves handover outside xpro.
- **Verified:** all 1,660 Workers tests in 81 files, nine type projects and three
  local builds pass. All 96 browser checks pass, including 22 reset cases for
  ordinary/master/self targets, old credentials/sessions, optional comments,
  denied callers, pending/lost responses, expired/changed logins, delayed context
  changes, comment correction, autofill and accessible narrow/RTL/dark layouts.
- **Review:** reversing the page-actor check fails two HTTP tests; reversing
  comment blur protection fails its correction/submission browser test. Exact
  files are restored before the final checks. Independent review has no remaining
  required findings. Native schema comparison, frozen install and the
  426-package audit pass. Temporary data, outputs, copies and processes are removed.
- **Scope:** reuse existing dependencies and the shared Hub HTTP adapter. No
  schema, runtime, Vite or Cloudflare configuration changes. See
  [ADR-036](../../docs/adr/036-private-password-reset-control.md).
- **Follow-up:** T034's own-profile screen is delivered below. T040 and
  T041–T045 remain pending.

### T029 reset backend checkpoint

- **Flow:** the real Hub POST action obtains the native session, shared live
  access result and configured hash function, then calls STMS. Only masters
  proceed. Existing field rules, ordinary passwords and optional comments remain.
- **Save:** one Hub batch upserts the credential, revokes active provider tokens,
  ends every target session and appends one audit. Preserve other credentials,
  roles, lifecycle status, memberships and workspace data. No automatic retry
  or logout-message fanout is introduced.
- **Verified:** all 44 original cases and 24 new storage/HTTP cases pass, including
  missing credentials, actual issued-token refusal, unrelated-token preservation,
  save failures and a committed batch with a lost reply. Query plans use existing
  indexes. The full run passes 910 cases in 51 files; all seven type projects,
  three builds, frozen install, native schema check and 333-package audit pass.
- **Mutation:** splitting the batch fails seven cases, weakening the master gate
  fails eight and changing token scope fails three. Exact source bytes are restored
  before the final run. Independent review has no required findings.
- **HTTPS:** the running local Hub passes eight native framework requests,
  including its real serialized reset and old-session refusal. Native password
  checks reject the old value and accept the new one; one saved audit matches
  the actual master and HTTP request. The temporary server is stopped afterward.
- **Dependencies:** add direct edges to already locked true-myth and UUID versions,
  with no new third-party package or version. Mark pure STMS modules as having no
  import-time effects so unused reset code does not enlarge the router bundle.
  The router returns from 350,309 to its previous 72,199 bytes.
- **Scope:** no schema, runtime, Vite or Cloudflare configuration change. Native
  credential/session SQL is the documented atomic-save exception in
  [ADR-024](../../docs/adr/024-atomic-password-reset.md). The reset screen remains
  T030; the next backend task is T031.

### T028 test checkpoint (historical)

- **Authored:** 44 cases cover both old devices, retained workspace cookies,
  password rules, master-only authority, expired/ended/inactive sessions,
  incomplete profiles, optional comments and normal sign-in after 48 hours.
  Another master and self-reset use the same rules; inactive targets stay inactive.
- **State:** successful resets require one native credential change, removal of
  every target Hub session and one audit identifying the actual master. Snapshots
  preserve all unrelated Hub records and two workspaces. Real triggers refuse
  the password, session or audit write to require complete rollback.
- **Boundary:** tests call the future STMS action with the real Hub access result
  and native hash function. Native HTTP write routes remain disabled. The fixture
  supplies authentication and storage wiring, not reset policy.
- **Controls:** all 44 cases execute with temporary, deliberately incomplete
  controls. A password-only save fails 10 cases; separate password/session/audit
  saves fail the two partial-save cases. The controls are removed before final
  checks. This validates the test oracles, not production reset behavior.
- **Pending:** `reset-password.server.ts` and its database save are T029.
  The final full run keeps all 842 existing cases passing and reports one suite
  load failure for that missing module. The test type check reports only its
  missing import; all six app/package checks and three builds pass. No skip or
  substitute implementation hides the unfinished action.
- **Scope:** no production action, dependency, schema or configuration change.
  T029 must prove these cases against its real implementation before reporting
  reset behavior complete, including regression mutations and indexed queries.

## Phase 7: User Story 4 — Manage own profile (P2)

**Goal:** edit name, phone and picture; change own password securely.
**Independent test:** profile changes persist, email/username stay read-only,
invalid uploads are refused, and a password change ends other devices while
preserving the current device's authenticated session.

- [x] T031 [P] [US4] Write profile, picture and own-password tests in `packages/accounts/src/update-profile/update-profile.test.ts`, `packages/accounts/src/picture/picture.test.ts` and `packages/accounts/src/change-password/change-password.test.ts`, including current-password verification and the returned current-device cookie.
- [x] T032 [US4] Implement profile saving and own-password change in `packages/accounts/src/update-profile/update-profile.server.ts` and `packages/accounts/src/change-password/change-password.server.ts`; apply "12–64 characters with a capital letter, a number and a symbol", retain the approved native password behaviour and end other devices.
- [x] T033 [US4] Implement bounded picture upload/removal in `packages/accounts/src/picture/picture.server.ts`: JPG/PNG/WebP, at most 2 MB, square output, metadata removed, generated R2 keys and the old picture preserved on failure; verify the supported processing mechanism in official docs before implementation or proposing any additional service.
- [x] T034 [US4] After the backend checkpoint, add `apps/hub/src/routes/profile.tsx` with the approved crop component, circular display, initials fallback, country/phone entry and read-only email/username; show errors accessibly and use thin server functions.

### T034 own-profile screen checkpoint

- **Page:** /profile reads only the current active, complete login's explicit
  profile projection. Masters follow the same own-profile rules. Email and
  username are read-only; name/phone use existing required Accounts rules.
- **Services:** reuse the registered details/password/removal functions and
  existing upload route. Compare the original page actor after fresh protected
  authorization on reads and all four writes. No preliminary save roundtrip.
- **Pictures:** pin react-image-crop 11.1.2 with no runtime dependencies. Check
  original size/signatures before decoding; standard Canvas submits a selected
  square PNG capped at 512 pixels. Keep native Images/R2 sanitation and storage.
- **Private reads:** serve only the actor's current owned picture revision,
  including HEAD. Missing, stale or other-person revisions reveal no picture.
  Use private/no-store, Cookie variance and nosniff. Display a circle or initials.
- **Drafts:** preserve independent form values, native autofill and accessible
  field/summary errors. Guard hydration, busy writes and pointer activation.
  Discard/replacement/unmount releases selected-file URLs; saved defaults update
  correctly. Session failures keep drafts mounted and inert until a fresh
  same-actor read succeeds. Never automatically replay writes or store secrets.
- **Password:** actual native replacement cookies keep this browser signed in
  and end old devices. Incorrect current passwords retain entries; an uncertain
  reply explains that either password may remain current and sessions may end.
  Confirmed saves clear the password fields. ADR-025/026 limits remain unchanged.
- **Tests:** add 50 Workers cases and 19 browser cases for private reads, actor
  changes, normalized saves, crop/EXIF pixels, type/size/decoder refusals, circle/
  initials, removal, native cookies, lost replies, draft retention and accessible
  narrow/RTL, dark and expanded-language layouts. Other login state stays intact.
- **Controls:** disabling the actor check fails six cases; ignoring the crop's
  horizontal offset fails the saved-pixel case. Restore exact bytes before the
  final checks. Keep the existing form-local blur guard; no global listener is needed.
- **Checks:** all 1,710 Workers cases in 84 files, 115 browser checks, nine type
  projects, three builds, frozen install, native schema comparison and the
  427-package audit pass. Independent review has no required findings.
- **Scope:** see [ADR-037](../../docs/adr/037-private-own-profile-screen.md).
  No schema, runtime, Vite, Cloudflare or deployment configuration change.
  Temporary candidates, logs, screenshots, test data and processes are removed
  after verification. Hosted image fidelity and full acceptance stay pending.
- **Next:** T040's STMS screens, then T041–T045 acceptance and release checks.

### T033 picture backend checkpoint

- **Boundary:** authenticated exact-Origin multipart POST at
  `/api/v1/profile-pictures`, one file and bounded streamed bytes. Removal is a
  registered JSON POST function. Derive the login from current protected access;
  reject submitted IDs, keys and unsupported encodings.
- **Processor:** the native Images binding verifies and converts JPEG/PNG/WebP,
  at most 2 MiB, into a still square PNG capped at 512 pixels. PNG removes all
  metadata. Store only processed output under a generated login-owned R2 key.
- **Save limit:** [ADR-026](../../docs/adr/026-bounded-private-profile-pictures.md)
  scopes the R2/D1 exception. Stage, guard the key update and delete the old file
  after commit. Read back lost replies without retrying the write. Unconfirmed
  results retain possibly active files; failed cleanup may leave private orphans.
- **Cases:** all 22 original picture cases plus 41 processor, HTTP and storage
  cases pass. Real D1/R2 cover competing changes, lost replies, confirmed and
  unconfirmed saves, cleanup failures and another login/workspace left intact.
- **Controls:** removing the key guard fails two cases; storing original image
  bytes fails three; deleting an unconfirmed active object fails one. Restore
  exact source bytes before final checks.
- **HTTPS:** the isolated running Hub passes 12 checks, including actual
  multipart uploads, replacement, registered native removal and continued
  session use. Two persistent readbacks confirm PNG dimensions/metadata, object
  replacement/removal and the unrelated login. Owned servers are stopped.
- **Checks:** 1,055 cases in 59 files, seven type projects, three builds, frozen
  install, native schema comparison and the 333-package audit pass. Independent
  review has no required findings. The router remains 72,199 bytes.
- **Scope:** only the Hub/local/test Images binding configuration is added;
  dependencies, schema, runtime and Vite stay unchanged. Installed local Images
  tooling has limited fidelity and uncoded corrupt-image errors. Hosted image
  checks remain pending; T034 supplies serving and screens. T035 is next.
  Temporary probes, data, settings, logs and the isolated copy are removed.

### T032 profile and password backend checkpoint (historical)

- **Profile:** one indexed Hub update saves the actor's trimmed name,
  international phone and timestamp. Reuse existing field rules and the shared
  protected-access check. Read-only identity fields and other records stay intact.
- **Password:** the trusted native API verifies the current password, hashes the
  new one, ends old sessions and creates a replacement. The Hub forwards actual
  native cookies and returns only the login ID as JSON. Public native write
  routes remain disabled.
- **Save limit:** keep native sequential D1 behavior as the scoped exception in
  [ADR-025](../../docs/adr/025-native-own-password-changes.md). A failed credential
  write can preserve the old password after sessions end; failed replacement
  creation can leave the new password with no replacement cookie. Return one
  safe error, do not retry automatically, and sign in normally to recover.
- **Runtime cases:** all 44 original profile/password cases plus 38 storage,
  session-race and HTTP cases pass. Real native tokens lose access after the
  change while another login's token remains usable. Real triggers verify
  each native save stage; unrelated Hub records and two workspaces stay intact.
- **Mutation:** a wrong profile-owner condition fails four cases, disabled
  revocation fails seven and dropped cookies fail two. Exact source bytes are
  restored before final checks.
- **HTTPS:** the running isolated Hub passes 12 native framework requests:
  method/Origin/byte refusals, anonymous and field errors, profile saving,
  incorrect current password, password change, old-device refusal and current
  replacement-cookie use. Read-back verifies the actual hash, saved profile,
  single replacement session and unrelated login. The Hub is stopped afterward.
- **Checks:** 992 cases in 55 files, six app/package type projects and three
  builds pass. One picture suite and one test-type import remain blocked by
  T033's missing action. Frozen install, native schema comparison and the
  333-package audit pass with no vulnerabilities. Both functions are registered;
  the router remains 72,199 bytes. Independent review has no required findings.
- **Scope:** no dependency, schema, runtime, Vite, Cloudflare or deployment
  configuration change. T033 implements pictures; T034 supplies the screen.
  Temporary probes, records, settings, logs and the isolated copy are removed.

### T031 own-profile test checkpoint (historical)

- **Authored:** 22 profile, 22 password and 22 picture cases define the backend
  contract. Cover required name/phone, international storage, read-only identity
  fields, own-login scope, invalid input, native password verification,
  replacement cookies, other-device refusal and safe storage failures.
- **Pictures:** real D1 and R2 assertions cover supported content, inclusive
  2 MiB limit, generated keys, replacement/removal and preservation on failure.
  Only the outside byte-processing boundary is a stand-in returning a known
  cleaned square. Actual decoding, crop and metadata removal remain unverified.
- **Fixture probes:** five temporary tests verify actual native cookies, ended
  sessions, current-password refusal, native credential failure, real R2 bytes
  and fresh shared access checks. They pass and are removed. No substitute
  Accounts action is introduced. Regression mutations await the implementations.
- **Native limit:** the installed own-password API deletes old sessions before
  updating the credential and creating a replacement. A failed credential write
  can therefore leave the old password with ended sessions. The new failure case
  documents that result; T032 must resolve the applicable save-rule limit before
  claiming atomicity.
- **Checks:** 910 existing cases in 51 files, six app/package type projects and
  three builds pass. The three new suites cannot load their missing actions;
  test types report only those three imports. No skips, fake production modules
  or suppressed type errors hide the unfinished behavior. Independent review has
  no remaining required findings.
- **Scope:** no production action, dependency, schema, runtime or configuration
  change. T032 implements profile/password, T033 selects and verifies the picture
  processor and upload boundary, and T034 supplies browser behavior. All
  temporary probes, data, logs and the isolated copy are removed after review.

## Phase 8: User Story 5 — Master login management (P2)

**Goal:** masters search and manage global logins through STMS.
**Independent test:** only masters can list/manage logins; suspension, archiving
and identifier changes revoke access as specified; restore preserves status and
history; each action identifies the actual master in the audit log.

- [x] T035 [P] [US5] Write Story 5 acceptance and failure-path tests in `packages/stms/src/logins/logins.test.ts`, `packages/stms/src/suspend-login/suspend-login.test.ts`, `packages/stms/src/archive-login/archive-login.test.ts` and `packages/stms/src/change-identifier/change-identifier.test.ts`; cover self-protection, reserved old usernames, restoration and atomic change/audit requirements.
- [x] T036 [US5] Implement indexed list/search/detail queries in `packages/stms/src/logins/logins.db.ts` and master-only functions in `packages/stms/src/logins/logins.server.ts`; show every required field and membership, hide archived rows from the normal list and test shared-query plans for full scans.
- [x] T037 [US5] Implement suspension and reactivation in `packages/stms/src/suspend-login/suspend-login.server.ts` and `packages/stms/src/reactivate-login/reactivate-login.server.ts`, with database writes in the matching `.db.ts` files; keep save/audit guarantees, end all sessions on suspension, protect the acting master from self-suspension, and require a comment only for reason Other.
- [x] T038 [US5] Implement archiving and restoring in `packages/stms/src/archive-login/archive-login.server.ts` and `packages/stms/src/restore-login/restore-login.server.ts`, with database writes in the matching `.db.ts` files; keep prior status, reserved identifiers and history, end all sessions on archiving, protect the acting master from self-archiving, and never permanently remove a login.
- [x] T039 [US5] Implement identifier changes in `packages/stms/src/change-email/change-email.server.ts` and `packages/stms/src/change-username/change-username.server.ts`, with database writes in the matching `.db.ts` files; validate uniqueness, reserve the old username, keep comments optional and end all sessions in the audited save.
- [x] T040 [US5] After the backend checkpoint, add `apps/hub/src/routes/stms/logins/index.tsx` and `apps/hub/src/routes/stms/logins/$loginId.tsx`; use the reset control from Story 3, specified confirmations/reasons and optional comments, with no additional-master management screen in this feature.

### T035 master login-management test checkpoint (historical)

- **Authored:** 220 cases: 53 list/search/detail, 58 suspend/reactivate,
  40 archive/restore and 69 email/username. Existing reset suites cover the
  Story 5 password-reset scenario.
- **Covered:** master/tenant separation, strict inputs, confirmation/reasons,
  optional comments, nullable fields, private projections, bounded literal
  prefix search, self-protection, inactive uniqueness, previous status, old
  usernames, concurrent claims/transitions and atomic state/session/token/audit.
- **Fixtures:** actual native sign-in, D1/R2, migrations and two workspaces.
  Five temporary controls validate setup, revocation, archived uniqueness and
  old-cookie refusal after status is cleared. An inverted fixture login lookup
  fails one control; exact source is restored and controls are removed.
- **Missing:** four suites cannot collect until T036's reads, T037's
  suspend/reactivate, T038's archive/restore and T039's email/username modules
  exist. Seven test-type imports remain unresolved. No skips, stubs, fake
  actions or permanent exclusions hide that result.
- **Checks:** all 1,055 implemented tests in 59 files, six app/package type
  projects and all three builds pass. The full run reports only those four
  missing suites; test typing reports only the seven imports. Authored behavior
  remains unverified until real actions pass it.
- **Review:** no required findings. Partial searches and same-target concurrency
  suggestions are included. Official matching 1.7 docs and installed 1.7.12
  source were checked before writing.
- **Scope:** [ADR-027](../../docs/adr/027-master-login-management-boundaries.md)
  records the new boundary choices. No production action, dependency, schema or
  configuration change. Temporary controls, data, logs and the isolated copy
  are removed. T036 is next; screens remain deferred.

### T036 indexed login directory checkpoint

- **Delivered:** master-only list/search/detail and three registered Hub POST
  functions. Explicit DTOs, live native cookies, exact Origin, no-store responses,
  strict fields and safe not-found/failure results. No directory read writes data.
- **Indexed:** normal lists hide archives; known-ID detail includes membership
  and archived status. Name/email/username literal prefixes use three indexed
  UNION branches and BINARY ranges, avoiding D1's 50-byte LIKE pattern limit.
  Actual plans use all three search indexes, the list index and detail indexes.
- **Names:** one private derived name copy, maintained by native persistence
  hooks and the two existing direct name saves. The additive migration fills old
  rows in restartable 25-row chunks within D1's 100-parameter limit; canonical
  names/timestamps are preserved. See
  [ADR-028](../../docs/adr/028-indexed-master-login-reads.md) for matching limits,
  paused-write rollout and rebuilding after an older writer is restored.
- **Tests:** T035's 53 read cases now pass. Add 20 indexed/name-maintenance,
  three migration and 42 authenticated HTTP cases. Mutations of master checks,
  archive filtering and prefix bounds fail their tests; exact source is restored.
- **Security prerequisite:** pin the existing Seroval serializer to 1.6.11 across
  the dependency tree. Five Workers regressions and a real unauthenticated Start
  decoder refusal cover the narrow advisory fix. The next valid HTTPS call works.
  All five reported advisories are absent from the final audit.
- **Checks:** 1,178 cases in 64 files pass; six app/package type projects, three
  builds, native schema comparison and frozen install pass. The full test run
  still reports three missing-action suites for T037–T039 (167 authored cases);
  test typing reports their six missing imports. No skip, stub or exclusion hides
  those unfinished tasks.
- **Native:** trusted local HTTPS exercises all three real Start functions,
  native cookies, paging, Unicode prefixes, membership/archives, refusal paths,
  strict input and the 64 KiB gate. Read-back confirms canonical user,
  credential, session, membership, organization and audit state is unchanged.
- **Scope:** no screens, future management writes, deployment, runtime or
  Cloudflare configuration changes. Temporary probes, settings, data, servers,
  logs and the isolated candidate are removed after verification. T037 is next.

### T037 suspension and reactivation checkpoint

- **Delivered:** two master-only actions and registered Hub POST functions.
  No self-suspension. Require confirmation and a fixed suspension reason; only
  Other requires a meaningful comment. Reactivation restores no old access.
- **Atomic:** one D1 batch reads the indexed target, claims the expected
  nonarchived state through a new conditional audit row, then gates every mutation
  on that fresh audit ID. Two requests have exactly one winner and one audit.
  No extra read round trip, schema, dependency, queue or replay table.
- **Revocation:** suspension updates native status without expiry, revokes active
  target access/refresh tokens and ends every native session. Prior revocation
  times, other logins, credentials, membership and tenant data are preserved.
  Existing live Hub checks stop retained workspace cookies on the next action.
- **Tests:** all 58 original cases pass, plus six storage and 36 HTTP cases.
  Seven native write-failure stages roll back completely. Lost replies leave
  complete audited changes; a fresh repeat conflicts. Actual query plans use
  indexes for all six suspension and three reactivation statements.
- **Native:** trusted local HTTPS checks both actual Start registrations, cookies,
  exact Origin/method/size/input refusals, missing targets, self-protection,
  Other comments, two-device revocation and no session revival. Read-back
  confirms two correlated master audits and preserved unrelated records.
- **Mutation:** weakened master access, split batches and wrong access-token
  scope fail the original suite. Exact source is restored; final independent
  review has no required findings.
- **Checks:** 1,278 executable cases in 67 files, six app/package type projects,
  all three builds, native schema comparison, frozen install and 333-package
  audit pass. The normal full test command still reports T038–T039's two missing
  suites (109 written cases); test typing reports their four missing imports.
  No skip, stub or exclusion hides those pending implementations.
- **Scope:** [ADR-029](../../docs/adr/029-atomic-login-status.md) records the batch
  claim and lifecycle limits. No configuration, deployment or screen changes.
  Temporary probes, settings, data, servers, logs and the isolated candidate
  are removed after verification. T038 is next.

### T038 archiving and restoration checkpoint

- **Delivered:** master-only archive/restore actions and two Hub POST functions.
  Confirmation is required for archive, comments are optional, and self-archive
  is refused. Another master follows the same rules.
- **Retention:** archive markers use existing fields. Native suspension/reason,
  identifiers, passwords, profiles, R2 pictures, membership and local business
  history remain intact. Unique indexes keep archived identifiers unavailable.
- **Atomic:** the existing batch claims the transition with a new audit row;
  every later mutation requires that fresh ID. Archive derives previous status
  inside the batch and shares the three guarded token/session revocations with
  suspension. One concurrent request wins and audits; a failed statement rolls
  everything back.
- **Restore:** clear markers only when previous-status metadata matches retained
  native state. Invalid history conflicts. A prior suspension remains suspended;
  old devices/tokens and removed membership are never recreated.
- **Tests:** all 40 original cases now execute, including R2 retention, duplicate
  identifiers, two workspaces, concurrent claims and seven rollback stages.
  Add ten storage cases and expand shared HTTP coverage from 36 to 71 cases.
  Query plans use existing indexes for all six archive and three restore
  statements. Lost replies preserve complete audited changes.
- **Native:** trusted local HTTPS exercises both actual Start functions,
  Origin/method/size/input and authority refusals, self-protection, active and
  suspended restore, list/detail visibility, ended devices and fresh sign-in.
  Read-back confirms four correlated master audits and preserved R2 bytes,
  credentials, membership and unrelated records.
- **Mutation/review:** four broken versions (master gate, batch atomicity, restored
  suspension and previous-status labels) fail their tests. Exact source is
  restored. Final independent review has no required findings.
- **Checks:** 1,363 executable tests in 69 files, six app/package type projects,
  three builds, native schema comparison, frozen install and 333-package audit
  pass. The full test command still reports T039's one missing suite (69 written
  cases); test typing reports its two missing imports. No skips or substitutes.
- **Scope:** [ADR-030](../../docs/adr/030-atomic-login-archiving.md) records the
  retention and restore guards. No schema, dependency, runtime, configuration,
  deployment or screen changes. Temporary probes, data, settings, servers,
  logs and the isolated candidate are removed after verification. T039 is next.

### T039 identifier changes and backend checkpoint

- **Delivered:** master-only email/username changes and two registered Hub POST
  functions, including self-change. Reuse existing field rules and optional
  comments; native bypass routes stay disabled.
- **Atomic:** one indexed D1 batch checks current value and namespace availability,
  claims a changed/free value through a new audit row, saves identity and any
  displaced-name reservation, then revokes access. Unique indexes and reservation
  triggers remain final guards. No extra availability round trip or native
  error-string matching.
- **No-op/reservation:** unchanged normalized values preserve every record and
  timestamp. Identical concurrent requests have one audit and one no-op.
  Derive the actual old username inside the batch, skip missing names and keep
  existing reservation history. Each successive change reserves its displaced name.
- **Native state:** email replacement clears its verification flag; same-address
  no-ops and username changes keep it. Update display username with username.
  Preserve passwords, stable IDs, roles, profile/status, membership and tenant
  records. End all target sessions/active tokens; self-change ends the master
  cookie. Earlier revocations and unrelated logins remain unchanged.
- **Reuse:** the renamed shared changes module serves status and identifier
  claims with separate predicates and shared guarded revocation. Core forwards
  D1's result-row type parameter; runtime behavior is unchanged.
- **Tests:** all 69 previously pending cases now execute. Add 17 storage and 41
  HTTP cases, covering native competing claims, identical/successive changes,
  nullable names, existing reservations, verification, lost replies and safe
  request/error behavior. All six email and seven username query plans use indexes.
- **Native:** trusted HTTPS exercises actual Start functions and directory reads,
  refusal boundaries, normalized changes/no-ops and self-change. Read-back
  confirms exact stored changes, three correlated master audits, two displaced
  names and preserved credentials/roles/membership/unrelated data. Native old
  identifiers fail; new identifiers use the same password; old names remain reserved.
- **Mutation/review:** four deliberately broken versions fail the original suite;
  sources are restored. Final independent review has no required findings.
- **Checks:** all 1,490 tests in 72 files, seven type projects (six workspaces plus
  tests), all three builds, native schema comparison, frozen install and
  333-package audit pass. No pending missing-action suites, skips or substitutes.
- **Scope:** [ADR-031](../../docs/adr/031-atomic-login-identifiers.md) records the
  decisions. No schema, dependency, runtime, Vite, Cloudflare or deployment
  configuration changes. Temporary probes, settings, data, servers, logs and
  the isolated candidate are removed after verification.
- **Next:** T016, the profile-completion screen, follows the approved backend-first
  order. T022/T027/T030/T034/T040 screens and T041–T045 acceptance/release work
  remain pending. The whole feature is not complete at this backend checkpoint.

### T040 STMS screen checkpoint

- **Delivered:** /stms/logins has native URL search/paging and known-ID detail.
  Reuse all indexed readers, lifecycle/identifier writes and the T030 reset
  control. /stms redirects to the directory. Only actual complete masters see
  global data; tenant owners/admins/members are refused.
- **Actor:** return successful-read actor metadata in the existing page-ID header
  and compare the optional hint after fresh authorization on every management
  read/write. No added pre-save request; JSON contracts stay unchanged. Direct
  SSR reads use only the configured-origin STMS page GETs; public RPC stays POST.
- **Directory:** preserve literal prefix text, including JSON-looking strings,
  through Router serialization, reload, pagination and detail/back navigation.
  Show server pages of 25, creation sort direction and explicit UTC dates through
  Core's date doorway. Failed reads never appear as empty results.
- **Forms:** optional comments except Other suspension; suspend/archive require
  confirmation. Protect self-suspend/archive. Retain other dirty cards, autofill,
  keyboard errors/focus and busy/hydration guards. Confirmed self-changes remain
  saved before renewed sign-in. Expired/changed actors cannot write from old pages.
- **Uncertainty:** explicit metadata readback without automatic write replay.
  Keep blocked drafts mounted and resume only as the original master. Retain
  T030's reset guidance and secret clearing. Archive restoration uses saved detail
  addresses, preserves prior suspension and creates no sessions.
- **Tests:** add 42 real master-boundary cases, ten search/validation model cases,
  one date-zone case and 31 browser journeys. Updated destination assertions now
  expect the actual directory; URL assertions wait for native navigation.
  A held-bootstrap case reproduces a real click loss when heading focus scrolls
  during a pointer press. Initial heading focus now preserves scroll in all 15
  Hub/workspace effects. Each router skips its initial restoration callback,
  retaining later client restoration. The case fails with the old behaviour;
  two further journeys cover client back, native back/reload and fragments.
  Browser checks cover cancellation/no-ops, actual
  revocation/new sign-in, lost replies, retained drafts and narrow/dark/RTL/expanded
  text with automated accessibility checks.
- **Controls:** removing actor comparison and replacing Router serialization
  with plain URLSearchParams both fail the relevant tests. Exact source is restored;
  affected checks pass again. Independent review has no required findings.
- **Checks:** all 1,763 Workers tests in 87 files, nine type projects, three local
  builds and 148 browser checks pass. Native schema comparison, frozen install
  and dependency audit pass. Temporary copies, data, reports, logs and processes
  are removed after verification.
- **Scope:** [ADR-038](../../docs/adr/038-private-stms-login-screens.md). No new
  dependency, schema, runtime, Vite, Cloudflare, deployment or data-safety exception.
  No archive listing or additional-master management screen. T041–T045 remain
  pending; local screen verification is not final hosted/release acceptance.

## Phase 9: Browser verification and completion

- [x] T041 Add browser journeys in `tests/e2e/sign-in.spec.ts` and `tests/e2e/create-login.spec.ts` for all six stories using the implemented apps; repeat OIDC/HTTPS/custom-domain and back-channel checks, and show that direct native routes and skipped screens cannot bypass xpro rules.
- [x] T042 Check keyboard access, automated accessibility, paste/autofill, loading and error states in `tests/e2e/accessibility.spec.ts`; measure the 3-second sign-in and 1-minute master-search goals and verify return-to-page behaviour with unsaved non-secret input.
- [x] T043 Run the actual repository type/build/test checks after inspecting their scripts; review `docs/SECURITY_CHECKLIST.md`, remove unnecessary code and verify passwords, session details and sign-in codes are absent from logs, audit entries and disallowed URLs. Keep tests that protect the implemented behaviour.
- [x] T044 Reconcile `specs/001-sign-in-and-accounts/research.md`, `specs/001-sign-in-and-accounts/quickstart.md` and `specs/001-sign-in-and-accounts/plan.md` with the final implementation and validation evidence through approved diffs; document real setup/test commands and do not label prototype checks as completed application acceptance tests.
- [x] T045 Review `docs/RELEASE_CHECKLIST.md` and all `shortcut:` comments, enforce the existing master-MFA-before-first-real-client gate, and remove temporary test resources; obtain deployment/configuration approvals separately before any release.

## T041 local browser acceptance checkpoint

- **Journeys:** actual private creation and form sign-in reach the workspace or
  Portal without forced password changes; missing phone completion gates OIDC.
  The same login can edit its profile, appear in master search, be reset,
  suspended and reactivated, then sign in with its retained saved details.
- **Destinations:** minimal protected Hub `/account` and workspace `/portal`
  pages make the existing routing decisions usable. Anonymous and ineligible
  access still uses the existing authoritative destination/access checks.
- **Protocol:** trusted customer-domain HTTPS uses the actual local router.
  Native provider JWKS/back-channel calls reach real handlers through copy-only
  local bindings. Actual native Hub logout delivery is counted and workspace
  access ends; native workspace logout ends one of two real devices only.
- **Refusals:** fresh changed-state callback, independent consumed-code replay,
  copied cookies across approved origins, forged routing headers, missing hosts,
  native write bypasses, incomplete creation and removed membership are checked.
  The actual later-save fault/retry creates one complete login and audit.
- **Coverage:** the [43-scenario map](checklists/browser-acceptance.md) identifies
  permanent browser/storage evidence and outstanding hosted checks. Concurrent
  uniqueness and atomicity remain covered by real Workers storage tests.
- **Controls:** weakening state validation lets the altered callback through and
  fails its browser test. Inverting the new account gate fails the non-holder
  refusal test. Both files are restored exactly; restored checks pass.
- **Checks:** 1,766 Workers tests in 87 files, 162 browser checks, nine type
  projects and all three local builds pass. Native schema comparison, frozen
  install and audit of 427 packages pass. The existing OAuth-provider patch is
  unchanged. Owned temporary copies, certificates, data, output and processes
  are removed after verification.
- **Scope:** [ADR-039](../../docs/adr/039-local-browser-acceptance.md) adds no
  dependency, schema, source runtime/Vite/Cloudflare/deployment configuration or
  data-safety exception. Local routing remains the accepted one-workspace
  fallback. T042–T045, hosted dispatch/images and release acceptance remain pending.

## T042 keyboard and timing checkpoint

- **Coverage:** add 14 dedicated cases for keyboard sign-in/completion, private
  internal/external creation, own details/picture/password, all master editors,
  account/workspace/Portal destinations and ended-session return. Keep all 162
  earlier screen/journey checks. Scan normal, busy, invalid, crop and confirmation
  states with the existing axe dependency.
- **Interaction:** reach controls through actual Tab traversal and activate with
  Enter/Space. Use native select typeahead, checkbox/crop keys and the native file
  chooser. Verify clipboard paste and silent native autofill through real sign-in.
  OS file selection is supplied by Playwright after keyboard chooser activation.
- **Draft:** actual popup sign-in plus the fresh resume handler retains the exact
  URL, note, amount text, select and checkbox. Dialog focus stays contained once
  library focus guards settle. No action is replayed or form values stored;
  Router's existing scroll-position storage is allowed. Native browser focus-event
  delivery is not asserted by the headless focus signal.
- **Measurements:** the table records one final local full-suite run. SC-002 uses
  50 ms minimum request-to-response-header latency, 10 Mbps down and 2 Mbps up;
  its limit is keyboard submission to the correct visible heading. Initial form
  setup and later hydration are outside that visible-page metric. SC-005 includes
  keyboard search entry through saved suspension on the unthrottled local link.

| Goal / destination | Measured | Limit |
|---|---:|---:|
| Sign-in: workspace-access message | 206 ms | 3,000 ms |
| Sign-in: account | 206 ms | 3,000 ms |
| Sign-in: STMS | 270 ms | 3,000 ms |
| Sign-in: workspace app | 461 ms | 3,000 ms |
| Sign-in: Portal | 483 ms | 3,000 ms |
| Master search and confirmed suspension | 882 ms | 60,000 ms |

- **Environment:** fresh browser contexts share warmed Vite/workerd servers.
  Outside Turnstile SDK/verification is substituted and SDK routing disables HTTP
  caching. The numbers do not establish hosted/cold latency, real verification,
  human completion speed or full accessibility compliance. Unbundled dev assets
  can hydrate slowly under the emulated link; repeat hosted production timings
  after setup approval and retain manual/assistive-user assessment.
- **Control:** removing native inputs from the Tab order fails the keyboard case
  at the unreachable password field. Restore the input component exactly; the
  full suite then passes. Keep no mutation or throwaway test code.
- **Checks:** all 176 browser checks, nine type projects and three local builds
  pass. Application code and dependency/schema/configuration files are unchanged;
  T041's Workers baseline remains applicable. Temporary copies, certificates,
  storage, reports, logs and processes are removed after verification.
- **Scope:** [ADR-040](../../docs/adr/040-keyboard-and-timing-acceptance.md).
  No runtime, Vite, Cloudflare, deployment, data-safety or product-policy change.
  T043–T045 and hosted/release acceptance remain pending.

## T043 security review checkpoint

- **Review:** map every reusable checklist item in the
  [security assessment](checklists/security-review.md). Inspect authentication,
  live access, server-function bounds/origins, native route restrictions, private
  pictures, routing, logout and audit/error reporting. No additional access bypass
  or credential leak was identified; independent review has no required findings.
- **Policy:** close the missing shared-header gap at Hub, workspace and both
  router entries. Apply nosniff, deny framing and no-referrer; append frame/base/
  object CSP restrictions while retaining native CSP, separate cookies, cache
  rules, statuses, streaming and WebSocket metadata. Add no Hub roundtrip.
- **Privacy evidence:** retain 10 response tests, four real authentication privacy/
  CSRF tests and five browser cases. Check actual submitted/issued secrets against
  diagnostics, automatic audit rows and navigation URLs. Keep the one-use code
  exception only at the exact OIDC callback. Native no-referrer logout succeeds;
  cross-site null-Origin confirmation cannot end a session.
- **Fixture fix:** await native initialization and schema validation before
  closing the shared browser Hub proxy. The new diagnostic-count assertion fails
  before the fix and passes afterwards; real errors remain reported.
- **Control:** removing both frame protections lets the actual customer document
  render in its iframe and fails the browser assertion. Restore the exact shared
  policy before final validation; keep no mutation or throwaway diagnostic code.
- **Checks:** all 1,780 Workers tests in 89 files, 181 browser checks, nine type
  projects and three local builds pass. Native schema comparison and frozen
  install pass; audit reports no vulnerabilities in 427 packages. The Hub's 30
  and workspace's six production client files contain no source maps or map
  markers. Final check logs contain no tested credential values, credential-query
  patterns or JWT-shaped values.
- **Scope:** [ADR-041](../../docs/adr/041-shared-response-security.md) changes no
  dependency, schema, runtime, Vite, Cloudflare or deployment configuration.
  Original source, developer private settings, certificates and local data remain
  untouched during candidate validation. Temporary copies, storage, certificates,
  logs, reports and processes are removed before requesting the exact diff's
  approval.
- **Outstanding:** deletion requests, anonymisation, free-text audit-comment
  policy and retention remain explicit gaps. Static/edge headers, hosted images,
  dispatch, production observability/performance and manual acceptance remain
  separate checks. T044–T045 and full feature/release acceptance remain pending.

## T044 documentation reconciliation checkpoint

- **Research:** distinguish the original failed prototype and infrastructure
  probes from passing application tests. Record the implemented native membership,
  resumable creation, atomic management revocation and actual logout behavior.
  Retain pinned hashing, the provider patch, all five save exceptions and the
  approved local/hosted boundaries.
- **Plan:** reconcile the current routes, seven workspaces, actual dependencies,
  six-story delivery order and local acceptance evidence. Remove statements that
  completed membership integration, retry logic or screens are still pending.
- **Quickstart:** put current preparation, private settings, first-master setup,
  app startup, automated checks and manual use before the historical checkpoints.
  Explain environment-specific secret-file selection, prepared-record requirements,
  real migration commands and the isolated runner's ownership/cleanup. Retain
  earlier checkpoint evidence and heading anchors without calling it current
  application acceptance.
- **Verification:** compare commands and claims with the manifests, scripts,
  configuration, entrypoints, migrations, test runner and existing T043 evidence.
  Render Markdown with the installed Bun parser and check local links, inbound
  anchors and current shell-block syntax. Reuse T043's 1,780-test/89-file Workers,
  181-browser, nine-type and three-build results; do not report a new full run.
- **Scope:** documentation only. No application, test, dependency, migration,
  runtime, Vite, Cloudflare or deployment configuration change. Temporary review
  work is removed before diff approval; original source and private data are
  preserved during candidate review.
- **Next:** T045 reviews release gates and shortcut comments. Outstanding privacy,
  hosted dispatch/images/observability/performance and manual acceptance remain
  explicit. Master MFA before the first real client is still required; no
  deployment or full feature/release acceptance is claimed.

## T045 release review checkpoint

This is the historical 2026-10-30 checkpoint. The [current release assessment](checklists/release-review.md) records the later MFA closure at T056.

- **Decision:** release review complete; deployment and first-real-client approval
  withheld. The [assessment](checklists/release-review.md) records every checklist
  item and source/patch shortcut. This review does not implement technical MFA or
  a deployment guard, and does not pass the underlying release checklist.
- **Coverage:** assess all 23 release requirements and all 21 shortcut comments.
  Each shortcut states its limit and upgrade trigger. Retain the approved simple
  limits, the provider/dialect compatibility work and all five save exceptions.
- **First-client gates:** Better Auth's available two-factor plugin is not wired
  into the Hub. Master second-step sign-in remains mandatory before the first
  real client. Core's event/request-ID-only diagnostic shortcut also explicitly
  requires reviewed, sanitized diagnostics before that point.
- **Other gaps:** the named-environment release workflow, identified rollout/
  rollback targets, hosted dispatch/Images/DNS/TLS/performance checks, version and
  flag controls, CI budgets, operational rehearsals/alerts and privacy evidence
  remain unimplemented or unverified as recorded. Controls outside the repo need
  actual target evidence; they are not assumed absent or complete.
- **Validation:** inspect the real comments, callers, manifests, configs, auth
  schema/plugin setup, migrations and existing test evidence. Current official
  documentation is checked against the pinned baseline. No tracked private
  environment/certificate paths or release tags are present; no complete secret
  history scan was performed. Reuse T043's passing application results rather
  than reporting another full run for documentation-only work.
- **Cleanup:** remove owned temporary review/check copies and processes; retain
  only the intentional diff until approval. Preserve developer private files,
  certificates, local data, caches and unrelated source work. No deployment,
  migration, dependency, runtime, Vite or Cloudflare configuration change.
- **Next work:** obtain an approved master-MFA implementation plan, then address
  diagnostics and the remaining release gates with their own evidence and
  deployment/configuration approvals. The original 45-task local delivery is
  reviewed; production/first-client readiness is not approved.

## Dependencies and delivery order

- **Foundation:** T001–T012 block application story implementation.
- **Backend order:** T013–T015 → T017–T021 → T023–T026 → T028–T029 →
  T031–T033 → T035–T039. The stories remain grouped by priority; their screens
  are deliberately deferred to preserve the approved backend-first build order.
- **Screens:** after the backend checkpoint, complete T016, T022, T027, T030,
  T034 and T040, then T041–T045. A story is not done at its backend checkpoint.
- **Story dependencies:** US2 uses US1's profile rules. US6 uses US1 validation
  and US2's real sign-in/access paths. US3, US4 and US5 reuse those foundations;
  the US5 reset control also depends on US3.
- **MVP:** foundations plus US1, US2 and US6 provide the initial private
  create → sign in → workspace/Portal path. Complete the remaining approved
  stories and release gates before treating the whole feature as complete.
- **Atomicity:** ADR-010 applies only to Story 6. It does not silently relax
  reset, suspension, identifier-change or other STMS audit guarantees.

## Parallel examples

After T001–T012, the following test-authoring tasks touch separate files and
may be prepared independently, while implementations follow the dependency order.
Use T003's test setup and the shared sign-in fixtures from T008–T009; do not split
or duplicate the auth implementation.

| Story | Independent test-authoring task | Implementation waits for |
|---|---|---|
| US1 | T013 | Foundations |
| US2 | T017 | US1 profile rules |
| US6 | T023 | US1 validation and US2 sign-in/access |
| US3 | T028 | Shared identity, audit and access foundations |
| US4 | T031 | US1 validation and US2 sessions |
| US5 | T035 | Shared foundations; US3 for the reset control |

## Checklist summary

- **Total:** 45 tasks: setup 4, foundations 8, story tasks 28, final checks 5.
- **By story:** US1 4; US2 6; US6 5; US3 3; US4 4; US5 6.
- **State:** T001–T045 local implementation/review tasks are delivered (45 of 45).
  Backend, all six screen tasks, local cross-story journeys and dedicated
  keyboard/timing and local security checks pass. Documentation and the release
  review are delivered; release remains blocked. Master MFA, production diagnostics,
  privacy/operations, hosted acceptance and full feature/release approval remain
  outstanding. A checked review task is not a satisfied deployment gate.
