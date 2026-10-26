# Tasks: Sign-in and Accounts

**Status:** T001–T004 and T006 complete. T005 validation awaits the schemas in
T008–T009; remaining tasks are pending. Sign-in/account workflows and feature
acceptance tests are not implemented yet.
**Input:** [Plan](./plan.md), [spec](./spec.md), [data model](./data-model.md),
[contracts](./contracts/server-functions.md), [research](./research.md) and
[quickstart](./quickstart.md).

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
- [x] T003 Add the real-runtime test setup in `vitest.config.ts` and `tests/support/runtime.ts`, with isolated local bindings, an environment guard, MSW outside-call stubs, storage reset, generated test types and one root Bun test script; use the approved rejection flag and keep genuine unhandled errors fatal. Add application migrations and real HTTP sign-in fixtures with T008–T009, after the code they exercise exists.
- [x] T004 Add bounded server input and named error/request-ID handling in `packages/core/src/server/errors.server.ts` and `packages/core/src/server/request.ts`; keep the stable creation reference distinct from each HTTP request ID, use the approved validation and result libraries, keep responses allow-listed and keep secrets out of logs.

## Phase 2: Foundations

- [ ] T005 Write save/migration/audit behaviour tests in `packages/core/src/save/save.test.ts` and `apps/hub/src/db/hub-save.test.ts`: rollback after a later failure, immutable audit entries, upgrades from earlier schemas, and another workspace left unchanged.
- [x] T006 Implement the approved save helpers in `packages/core/src/save/save.db.ts` and `apps/hub/src/db/hub-save.db.ts`: Kysely inside `ctx.storage.transaction` for workspace storage, prepared all-or-nothing batches for D1, and no outside calls inside a local transaction.
- [ ] T007 Configure Better Auth in `apps/hub/src/auth/auth.server.ts`: default-strength hashing, username/Admin/Organization/JWT/OAuth Provider support, disabled public sign-up and unused write routes, fixed membership roles and sessions lasting "at most 30 days"; keep trusted server APIs available and validate current package APIs before wiring them.
- [ ] T008 Generate Better Auth's schema using its supported tooling in `apps/hub/scripts/generate-auth-schema.ts`; add Kysely migrations under `apps/hub/src/db/migrations/` for the full data model, audit triggers, indexed references and uniqueness rules, including "A login belongs to at most one workspace" and the unique `login_creation_id` link. Keep Better Auth's table names and documented non-STRICT exception. Apply these actual migrations before each relevant test and add real HTTP sign-in fixtures through the T007 authentication handler; do not bypass authentication or seed business records with raw test writes.
- [ ] T009 Add workspace-user, local-session and local-audit migrations under `packages/core/src/database/migrations/` and startup upgrading in `apps/web/src/workspace/workspace.db.ts`; preserve internal/external type and business permissions locally and use the startup lock only for upgrades. Make workspace tests run these actual migrations and extend the shared sign-in fixtures through the implemented workspace flow.
- [ ] T010 Write and implement repeat-safe initial-master setup in `apps/hub/scripts/initial-master.test.ts` and `apps/hub/scripts/initial-master.ts`: explicitly supplied credentials, one initial master, no defaults, and no role/password changes when repeated against an existing login.
- [ ] T011 Write shared-access behaviour tests in `packages/core/src/access/access.test.ts`: live revocation, role/membership changes, incomplete creation/profile gates, actual master identity without membership, local permissions, one Hub call per request and no reuse across requests.
- [ ] T012 Implement the checks and Hub validation binding in `packages/core/src/access/access.server.ts` and `apps/hub/src/auth/validate-access.server.ts`; allow only the approved completion/session/sign-out actions while a profile is unfinished, and deny protected access while login creation is unfinished.

## Phase 3: User Story 1 — Complete first sign-in (P1)

**Goal:** ask only for missing or invalid profile details.
**Independent test:** prepared complete and incomplete logins reach the right
destination; invalid, taken or reserved usernames are refused; skipping the form
does not grant access. No Account or workspace is created by signing in.

- [ ] T013 [P] [US1] Write all Story 1 acceptance tests in `packages/accounts/src/complete-first-sign-in/complete-first-sign-in.test.ts`, including direct server calls and public sign-up refusal.
- [ ] T014 [US1] Add shared profile checks and username availability in `packages/accounts/src/profile/profile.ts` and `packages/accounts/src/check-username/check-username.db.ts`: "4–8 characters, lowercase letters, numbers, dots, dashes and underscores, starting with a letter, unique across xpro, not reserved"; emails are "unique, ignoring capital letters and spaces around them"; store phone "in one international format" using the approved phone library.
- [ ] T015 [US1] Implement `completeFirstSignIn` in `packages/accounts/src/complete-first-sign-in/complete-first-sign-in.server.ts` with the real save path, server-enforced completion and username confirmation rules; expose it through a thin Hub server function.
- [ ] T016 [US1] After the backend checkpoint, add `apps/hub/src/routes/complete-profile.tsx` using shared form components and translations; show only required fields and the approved username warning, with keyboard/error/loading behaviour from the screen conventions.

## Phase 4: User Story 2 — Sign in, route and sign out (P1)

**Goal:** real Hub sign-in and standard OIDC into the correct workspace app or Portal.
**Independent test:** internal/external users, account holders and masters reach
their specified destinations; sign-out/revocation blocks the next action;
interrupted sessions return to the same safe page with unsaved non-secret input.

- [ ] T017 [P] [US2] Write Story 2 and routing-edge tests in `packages/accounts/src/sign-in/sign-in.test.ts` and `apps/web/src/auth/oidc.test.ts`; cover generic credential errors, suspended/archived logins, two devices, unknown/forbidden workspace addresses, safe redirects, code replay and missing-session behaviour.
- [ ] T018 [US2] Implement the Hub OIDC provider wiring in `apps/hub/src/auth/oidc.server.ts` and workspace start/callback logic in `apps/web/src/auth/oidc.server.ts` using the approved provider and `oauth4webapi`; validate discovery, trusted confidential clients, PKCE/state/nonce, exact redirects, code expiry/replay and disabled unused registration/grants against current official docs.
- [ ] T019 [US2] Implement workspace session creation, `getCurrentUser`, sign-out and validated Hub sign-out messages in `packages/core/src/sessions/sessions.server.ts` and `apps/web/src/auth/sign-out.server.ts`; keep live Hub checks authoritative even when a back-channel message is absent.
- [ ] T020 [US2] Add server-verified Turnstile and the approved approximate "10 attempts per minute" identifier limit in `apps/hub/src/auth/sign-in-protection.server.ts`; test both sign-in methods and refused responses, and obtain approval before adding the rate-limit binding to `apps/hub/wrangler.jsonc`.
- [ ] T021 [US2] Implement prepared-workspace placement and address routing in `apps/router/src/router.server.ts`, with tests in `apps/router/src/router.test.ts`; router hints never replace workspace access checks, and account/workspace creation stays outside this feature.
- [ ] T022 [US2] After the backend checkpoint, add the Hub sign-in route in `apps/hub/src/routes/sign-in.tsx` and workspace session-expiry handling in `apps/web/src/auth/session-expiry.tsx`; preserve non-secret unsaved input and support paste, password managers, autofill and the specified messages.

## Phase 5: User Story 6 — Create someone else's login (P1)

**Goal:** private creation that safely resumes after failed saves.
**Independent test:** a permitted creator produces one non-master login with its
required membership and local type; complete profiles sign in immediately with
the ordinary supplied password. Interrupted creation stays blocked and resumes
once, including concurrent retries and lost responses.

- [ ] T023 [P] [US6] Write all Story 6 scenarios and the 32 validated prototype behaviours against application code in `packages/accounts/src/create-login/create-login.test.ts`; use real D1, Durable Objects and HTTP sign-in, inject failures at every save boundary, and check unrelated logins/workspaces stay unchanged.
- [ ] T024 [US6] Implement saved creation references and the initial user-create hook in `packages/accounts/src/create-login/create-login.db.ts` and `apps/hub/src/auth/auth.server.ts`; bind creator, intended workspace and non-secret details, set the server-owned link in the first login write, and enforce one credential and one linked login per creation through database constraints.
- [ ] T025 [US6] Implement `createLogin` in `packages/accounts/src/create-login/create-login.server.ts`: recheck current `member:create` permission, use native user/member APIs without granting global admin, resume only missing steps for the same request, recover a missing credential through the verified Better Auth helpers, and never reset a saved password or adopt an unrelated identity.
- [ ] T026 [US6] Complete local-user saving in `packages/core/src/workspace-users/workspace-users.db.ts` and the thin Hub creation server function in `apps/hub/src/functions/create-login.server.ts`; confirm all required records before the single Hub audit/completion batch, return the saved result on repeats, and enforce incomplete-creation checks on both Hub and workspace access.
- [ ] T027 [US6] After the backend checkpoint, add `apps/hub/src/routes/create-login.tsx`; scope non-master creators to their own workspace, choose internal/external type, retain the creation reference for an explicit retry, and use ordinary passwords with no expiry, shown-once rule or forced first-sign-in change.

## Phase 6: User Story 3 — Reset a forgotten password (P2)

**Goal:** only masters reset another person's password; old sessions end.
**Independent test:** the old password and every old session stop working, the new
ordinary password works, and workspace admins cannot perform the reset.

- [ ] T028 [P] [US3] Write reset acceptance and failure-path tests in `packages/stms/src/reset-password/reset-password.test.ts`, including no partial STMS change without its audit entry, all-device revocation, denied non-master calls and no forced password change.
- [ ] T029 [US3] Implement the reset in `packages/stms/src/reset-password/reset-password.server.ts` and `packages/stms/src/reset-password/reset-password.db.ts`, reusing Better Auth's password handling and meeting the existing STMS save/audit rule; native `setUserPassword` alone does not revoke sessions, and sequential native writes do not by themselves prove all-or-nothing saving. If that rule cannot be met, report the gap before weakening it.
- [ ] T030 [US3] After the backend checkpoint, add the master reset control in `apps/hub/src/components/stms/reset-password.tsx`; keep external handover, no mandatory comment and no temporary-password workflow.

## Phase 7: User Story 4 — Manage own profile (P2)

**Goal:** edit name, phone and picture; change own password securely.
**Independent test:** profile changes persist, email/username stay read-only,
invalid uploads are refused, and a password change ends other devices while
preserving the current device's authenticated session.

- [ ] T031 [P] [US4] Write profile, picture and own-password tests in `packages/accounts/src/update-profile/update-profile.test.ts`, `packages/accounts/src/picture/picture.test.ts` and `packages/accounts/src/change-password/change-password.test.ts`, including current-password verification and the returned current-device cookie.
- [ ] T032 [US4] Implement profile saving and own-password change in `packages/accounts/src/update-profile/update-profile.server.ts` and `packages/accounts/src/change-password/change-password.server.ts`; apply "12–64 characters with a capital letter, a number and a symbol", retain the approved native password behaviour and end other devices.
- [ ] T033 [US4] Implement bounded picture upload/removal in `packages/accounts/src/picture/picture.server.ts`: JPG/PNG/WebP, at most 2 MB, square output, metadata removed, generated R2 keys and the old picture preserved on failure; verify the supported processing mechanism in official docs before implementation or proposing any additional service.
- [ ] T034 [US4] After the backend checkpoint, add `apps/hub/src/routes/profile.tsx` with the approved crop component, circular display, initials fallback, country/phone entry and read-only email/username; show errors accessibly and use thin server functions.

## Phase 8: User Story 5 — Master login management (P2)

**Goal:** masters search and manage global logins through STMS.
**Independent test:** only masters can list/manage logins; suspension, archiving
and identifier changes revoke access as specified; restore preserves status and
history; each action identifies the actual master in the audit log.

- [ ] T035 [P] [US5] Write Story 5 acceptance and failure-path tests in `packages/stms/src/logins/logins.test.ts`, `packages/stms/src/suspend-login/suspend-login.test.ts`, `packages/stms/src/archive-login/archive-login.test.ts` and `packages/stms/src/change-identifier/change-identifier.test.ts`; cover self-protection, reserved old usernames, restoration and atomic change/audit requirements.
- [ ] T036 [US5] Implement indexed list/search/detail queries in `packages/stms/src/logins/logins.db.ts` and master-only functions in `packages/stms/src/logins/logins.server.ts`; show every required field and membership, hide archived rows from the normal list and test shared-query plans for full scans.
- [ ] T037 [US5] Implement suspension and reactivation in `packages/stms/src/suspend-login/suspend-login.server.ts` and `packages/stms/src/reactivate-login/reactivate-login.server.ts`, with database writes in the matching `.db.ts` files; keep save/audit guarantees, end all sessions on suspension, protect the acting master from self-suspension, and require a comment only for reason Other.
- [ ] T038 [US5] Implement archiving and restoring in `packages/stms/src/archive-login/archive-login.server.ts` and `packages/stms/src/restore-login/restore-login.server.ts`, with database writes in the matching `.db.ts` files; keep prior status, reserved identifiers and history, end all sessions on archiving, protect the acting master from self-archiving, and never permanently remove a login.
- [ ] T039 [US5] Implement identifier changes in `packages/stms/src/change-email/change-email.server.ts` and `packages/stms/src/change-username/change-username.server.ts`, with database writes in the matching `.db.ts` files; validate uniqueness, reserve the old username, keep comments optional and end all sessions in the audited save.
- [ ] T040 [US5] After the backend checkpoint, add `apps/hub/src/routes/stms/logins/index.tsx` and `apps/hub/src/routes/stms/logins/$loginId.tsx`; use the reset control from Story 3, specified confirmations/reasons and optional comments, with no additional-master management screen in this feature.

## Phase 9: Browser verification and completion

- [ ] T041 Add browser journeys in `tests/e2e/sign-in.spec.ts` and `tests/e2e/create-login.spec.ts` for all six stories using the implemented apps; repeat OIDC/HTTPS/custom-domain and back-channel checks, and show that direct native routes and skipped screens cannot bypass xpro rules.
- [ ] T042 Check keyboard access, automated accessibility, paste/autofill, loading and error states in `tests/e2e/accessibility.spec.ts`; measure the 3-second sign-in and 1-minute master-search goals and verify return-to-page behaviour with unsaved non-secret input.
- [ ] T043 Run the actual repository type/build/test checks after inspecting their scripts; review `docs/SECURITY_CHECKLIST.md`, remove unnecessary code and verify passwords, session details and sign-in codes are absent from logs, audit entries and disallowed URLs. Keep tests that protect the implemented behaviour.
- [ ] T044 Reconcile `specs/001-sign-in-and-accounts/research.md`, `specs/001-sign-in-and-accounts/quickstart.md` and `specs/001-sign-in-and-accounts/plan.md` with the final implementation and validation evidence through approved diffs; document real setup/test commands and do not label prototype checks as completed application acceptance tests.
- [ ] T045 Review `docs/RELEASE_CHECKLIST.md` and all `shortcut:` comments, enforce the existing master-MFA-before-first-real-client gate, and remove temporary test resources; obtain deployment/configuration approvals separately before any release.

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
- **State:** T001–T004 and T006 are complete. T005 tests are authored but their
  schema-dependent execution remains pending. Application behaviour, sign-in
  fixtures, migrations and feature acceptance tests remain pending.
