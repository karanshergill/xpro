# Tasks: Master multi-factor authentication

- **Status:** all 11 local implementation/checkpoint tasks T046–T056 are delivered.
  Native MFA, live access/revocation rules, enrollment/management screens and
  browser acceptance are complete. The [T056 checkpoint](quickstart.md#t056-final-convergence-checkpoint)
  records fresh project-wide checks and all 19 scenarios' backend/browser evidence.
  The later [T063 checkpoint](../004-cloudflare-test/quickstart.md#hosted-verification-t063)
  records hosted test acceptance. The production release hold and remaining
  operational/privacy gates stay open.
- **Numbering:** continue after the delivered T001–T045 in the
  [Sign-in and Accounts task list](../001-sign-in-and-accounts/tasks.md).
  This feature owns T046–T056. Its 19 acceptance scenarios are test cases, not
  another 19 implementation tasks.
- **Inputs:** [approved specification](spec.md), [technical plan](plan.md),
  [ADR-042](../../docs/adr/042-mfa-session-revisions.md),
  [ADR-043](../../docs/adr/043-guarded-native-mfa-writes.md) and
  [ADR-044](../../docs/adr/044-hub-mfa-screens.md). These documents contain the
  feature's data, flow, recovery, screen and verification contracts.
- **Approval:** this list establishes scope and order. Before writing original
  project files, prepare and verify their exact diff for approval. Complete and
  report one task, then wait for the user's go-ahead. Do not start later tasks
  because their files could be edited in parallel.
- **Before each task:** read the applicable conventions and trace the real callers.
  Refresh official library/platform documentation through Context7 and check it
  against installed versions before API-dependent implementation. Reuse existing
  code, native helpers and Web APIs before adding custom code or dependencies.
- **Tests with changes:** write meaningful behavior assertions before the logic
  they protect, then make them pass in the same task where its prerequisites
  exist. Preserve the exact approved scenario names. Identify cases waiting for
  later implementation explicitly; never use skips, bypasses or substitute auth.
  Partial checkpoints are not deployable or proof of full feature completion.
- **Release scope:** retain the existing
  [release hold](../001-sign-in-and-accounts/checklists/release-review.md), runtime,
  Worker names, configuration and the five accepted save exceptions. This list
  approves no deployment, first-client onboarding or new consistency exception.

## First checkpoint: native integration proof

- [x] T046 [Shared] Prove the proposed Better Auth 1.7.12 composition in an isolated source copy using the real `apps/hub/src/auth/auth.server.ts`, application migrations, Kysely/D1 and Workers test setup. Exercise native enrollment, TOTP/backup verification, activation, restart/replacement, backup regeneration and own-password rotation with the proposed adapter guards.

- **Proof scope:** prepare only the candidate migration, context/adapter guard and
  native composition needed to exercise the approved write phases. Validate
  adapter identity/schema/conversion preservation, guarded transaction callbacks,
  exact consumed-challenge binding, request isolation, winning revision/MFA-time
  propagation, actual cookies and OAuth ordering. Inject the planned interrupted
  and overlapping writes; stale work must not alter the winner or grant access.
- **Deliverable:** a safe T046 checkpoint in the proposed
  `specs/002-master-mfa/quickstart.md`, with exact commands, observed outcomes,
  limits and the smallest supported production changes needed next. Preserve the
  meaningful assertions in the permanent test work below; remove throwaway proof
  infrastructure and owned temporary files. Prototype success is not completion
  of the application feature or its 19 acceptance scenarios.
- **Done when:** the required guarded native behaviors pass in workerd and their
  exact evidence/limits are recorded. An incomplete or failed proof leaves the
  gate open; writing a report alone does not satisfy it.
- **Stop condition:** if supported native interfaces cannot uphold an approved
  phase or hook/cookie boundary, return for plan review. Do not proceed to T047,
  weaken the guards, patch the dependency or accept an exception silently.

## Foundation

- [x] T047 [Shared] Add the approved native schema/extensions and guarded-adapter foundation in `apps/hub/src/auth/auth.server.ts`, a cohesive new `apps/hub/src/auth/mfa/` area and a new dated migration under `apps/hub/src/db/migrations/`; update `apps/hub/src/db/hub.db.ts` and await every `createHubAuth` caller.

- **Storage:** generate the native plugin schema through existing tooling. Add
  exactly the four approved private columns, one-factor constraint and targeted
  challenge index; keep old session MFA time NULL. Keep any existing migrations
  unchanged. Test upgrades, defaults/constraints, native field mapping and indexed
  operations in `apps/hub/src/db/hub.db.test.ts` and focused MFA database tests.
- **Native boundary:** land only the T046-supported adapter/request-context design,
  preserving native behavior and rejecting unrecognized security-write shapes.
  Keep unguarded public MFA mutation routes unavailable while the backend is
  assembled. If required, review the exact `@better-auth/core` 1.7.12 direct
  reference in `apps/hub/package.json`, `bun.lock` and `docs/TECH_STACK.md` before
  editing; no package upgrade or QR package is included.
- **Done when:** schema/factory/adapter compatibility checks pass and all callers
  await the real factory. Record any MFA integration tests that await the next
  actions honestly; do not manufacture verified sessions to make fixtures green.

- [x] T048 [US1, US3] Enforce the live MFA contract in `apps/hub/src/auth/validate-access.db.ts`, `validate-access.server.ts`, `hub-access.server.ts`, `packages/core/src/access/` and the shared safe-error definitions.

- **Access:** add current role, revision and MFA facts to the existing indexed
  read. Implement the Hub-local limited state/actions, exact five-minute boundary
  and strict external invalid result, including NULL workspace IDs and older
  consumers. Preserve ordinary-login, creation, profile and workspace isolation
  rules without adding another Hub call per protected request.
- **Done when:** meaningful Core/Hub access and query-plan cases prove refusals
  for missing/invalid/stale facts and preserve unrelated access. Real positive
  MFA integration completes at the backend checkpoint; no client flag supplies it.

## User stories 1 and 2: native MFA and recovery actions

- [x] T049 [US1, US2, US3] Implement native MFA sign-in completion and the guarded enrollment/activation/restart, authenticator replacement and backup-generation actions in `apps/hub/src/auth/mfa/`, `auth.server.ts`, `access-policy.server.ts` and thin `apps/hub/src/functions/mfa.functions.ts`/`mfa.server.ts` boundaries where needed.

- **Native proof first:** capture authority before native credentials, propagate
  the exact consumed challenge, and save actual MFA time after native endpoint
  success but before provider after-hooks. Suppress success cookies on a failed
  final guard. Add the real enrollment/sign-in fixture support in `tests/support/`
  here so recent-MFA and last-backup-code cases do not depend on T050.
- **Saves:** use existing `saveHub` conditional batches for the approved audited
  phases. Recheck active/completed login state, role, original revision/source,
  session/challenge expiry and required recent MFA after native password checks.
  Fence factor flags, material, backup comparison and failure-counter writes.
- **Protection:** use the existing limiter with the approved shared login key;
  fail safely if unavailable. Keep native cryptography, challenge handling and
  cookie rotation. Supply only intended private setup/new backup data; block
  public disable, unused OTP and unguarded generation paths. Preserve resumable
  pending state and consumed-code behavior after interruptions.
- **Done when:** focused permanent native-action tests pass through real auth and
  migrations, including wrong password, recent-MFA limits, last-code replacement,
  one-use backup comparison and matching audit/state behavior.

- [x] T050 [US1, US3] Integrate the public credential/MFA response handling and OAuth in `apps/hub/src/auth/oidc.server.ts`, `access-policy.server.ts`, `auth.server.ts`, `sign-in-protection.server.ts` and application-level sign-in fixtures.

- **Public completion:** reuse T049's native proof/time path. Distinguish the
  pending response in the Hub HTTP wrapper and audit completed sign-in only after
  MFA. Refuse remembered-device/session-skip options and ambiguous native
  session/challenge combinations before exposing the guarded verification paths.
- **OAuth:** preserve signed continuation and profile ordering; enforce the strict
  live session at code issuance and bearer UserInfo. Use T049's real verified-master
  fixtures for application HTTP/provider checks and update browser seed helpers. Keep
  ordinary credentials, Turnstile and sign-out behavior intact.
- **Done when:** native HTTP/code/cookie/provider tests prove pending and completed
  states, safe refusal/privacy behavior and no premature master authorization.

## User story 3: revocation and backend checkpoint

- [x] T051 [US2, US3] Extend existing password, identifier and lifecycle saves in `packages/stms/src/reset-password/`, `logins/changes.db.ts`, `logins/identifiers.db.ts`, the suspend/reactivate/archive/restore actions and the Hub's native own-password integration.

- **Revocation:** advance the revision and remove targeted main MFA challenges
  with existing session/token invalidation in the same audited save. Guard stale
  native password/factor work. Restoration and password reset never remove MFA
  or revive older proof. Own-password rotation may retain only the current
  authorized device with its original MFA time and exact winning revision.
- **Done when:** real reset/identifier/lifecycle/own-password tests prove active
  and already-running challenges cannot restore access. Retain the accepted
  native own-password sequential-write limit and optional-comment policy.

- [x] T052 [Shared] Complete the backend acceptance checkpoint in `apps/hub/src/auth/mfa/*.test.ts`, the existing access/auth suites and integration wiring under `tests/support/`; record evidence in `specs/002-master-mfa/quickstart.md`.

- **Evidence:** match every specification scenario to its permanent test location
  and identify its remaining browser assertions. Complete the approved clock,
  concurrent-use/revocation, save-refusal/lost-reply, privacy and older-consumer
  cases. Read durable results with a fresh connection and confirm another login
  and workspace remain unchanged. A simulated lost reply is not a universal
  Worker-termination test.
- **Gate:** run the affected backend suites and full Workers/type checks. Resolve
  genuine regressions before screen work; list any explicitly authored cases
  waiting on screens. Do not claim copy/download, keyboard, accessibility or full
  browser acceptance from this checkpoint. Return for design review if native
  coverage required a change to the approved contract.

## User stories 1 and 2: screens

- [x] T053 [US1] Build `apps/hub/src/routes/mfa.tsx`, cohesive UI/data/forms under `apps/hub/src/features/mfa/` and the read-only MFA page boundary in `apps/hub/src/functions/`; integrate sign-in, `/complete-profile`, `auth/hub.server.ts` destination handling and `server.ts` private-page policy.

- **Journey:** resolve server MFA state; present manual-key setup, authenticator
  and backup entry, explicit restart and private new-code display. Keep route
  loads/preloads read-only. Preserve the signed query and explicit navigation
  after credentials are cleared and codes can be saved. Use existing components,
  translations and form behavior; include the manual-key shortcut's upgrade trigger.
- **Done when:** targeted browser checks exercise new/returning masters, ordinary
  users, fixed/signed destinations and setup refresh recovery. Page state never
  authorizes a mutation or leaks setup material to loaders/storage/URLs.

- [x] T054 [US2] Add the master MFA entry/status and backup-generation form to `apps/hub/src/features/profile/`, and the approved replacement form/display intent to `apps/hub/src/features/mfa/` with corresponding messages and guarded action calls.

- **Management:** submit replacement on `/mfa` itself so its new key/backups stay
  in that component; keep backup generation on `/profile`. Implement warnings,
  password confirmation, recent-MFA separate-tab sign-in/Check access and private
  Copy/Download. The display intent has no authority and by itself is not an
  OAuth continuation. Preserve the new-code display through cookie rotation and
  same-login revalidation; identity/access loss clears it.
- **Done when:** targeted journeys cover the last backup code, both replacement
  actions, stale MFA, refreshed setup and lost displays. No mandatory comment,
  saved-codes checkbox, automatic recovery or QR dependency is added.

## Cross-story acceptance and convergence

- [x] T055 [US1, US2, US3] Complete MFA browser journeys in `tests/e2e/mfa.spec.ts`, update `tests/e2e/seed.ts`, `hub-fixture.ts` and existing affected browser suites, then run them only through `bun run test:e2e`.

- **Evidence:** finish every browser assertion identified at T052, including
  signed workspace/profile continuation, backup copy/download, replacement,
  cookie-rotation display survival, refresh, actionable refusals, keyboard/focus,
  narrow screens, fake-language checks and automatic accessibility on each new
  screen. Check URLs, diagnostics, responses, audit and browser storage for leaks.
  Update real master sign-in fixtures; do not bypass MFA or replace the verifier.
- **Done when:** the browser suite and existing identity/workspace journeys pass
  without skipped cases; every one of the 19 named scenarios has its full required
  automated evidence. Capture only safe outcomes and remove owned test artifacts.

- [x] T056 [Shared] Converge the feature: review the implementation, simplify unnecessary code, inspect all new/relevant `shortcut:` comments, and update `specs/002-master-mfa/quickstart.md`, this task list and the affected release-review evidence.

- **Checks:** run `bun run test`, `bun run test:e2e`, `bun run typecheck` and
  `bun run build:all`; verify the generated native schema using the existing
  schema-check tooling. Prove key refusal tests catch a removed guard in an
  isolated copy. Complete applicable dependency checks if a direct reference
  changed. Record exact results and limits rather than inheriting old counts.
- **Done when:** all MFA scenarios and existing regressions pass, reviews have no
  unresolved required findings, meaningful tests remain, and owned temporary
  files/processes are gone. Other production diagnostics, release workflow,
  hosted validation and operational/privacy requirements remain under the existing
  release hold. Completing MFA does not approve deployment or first-client use.

## Order and ownership

- **Sequence:** T046 → T047 → T048 → T049 → T050 → T051 → T052 → T053 → T054 →
  T055 → T056. T046 is a hard proof gate; T052 is the backend gate before screens.
  Respect the user's one-task-at-a-time review even where work could overlap.
- **Story coverage:** US1's eight enrollment/sign-in scenarios span T048–T050 and
  T053; US2's seven recovery/replacement scenarios span T049, T051 and T054; US3's
  four existing-rule/privacy scenarios span T048, T050–T052. T052/T055 maintain
  the exact scenario-to-test mapping; T056 confirms completion of all 19.
- **Checkpoint accuracy:** record a task as delivered only when its own done-when
  evidence exists. Remaining tasks, expected test-first failures and the release
  decision stay explicit; no partial task is checked off merely to advance.
