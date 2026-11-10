# Quickstart: Master multi-factor authentication

- **Checkpoints:** T046–T056 are complete locally. Native foundation/access/actions,
  public sign-in/OAuth, revocation/password integration, enrollment/management
  screens and browser acceptance are delivered. The
  [T056 convergence](#t056-final-convergence-checkpoint) records fresh project-wide
  verification on 2026-11-01. Earlier sections retain their dated checkpoint evidence.
- **Release:** the existing [release hold](../001-sign-in-and-accounts/checklists/release-review.md)
  remains. No deployment or first-client use is approved by local completion.
- **Permanent evidence:** the [T052 backend map](#t052-backend-acceptance-checkpoint)
  and [T055 browser map](#t055-browser-acceptance-checkpoint) cover all 19 named
  scenarios. T046's 31 prototype cases have permanent equivalents; its reference
  patch is retired. The sections below preserve that implementation history.

## Local authenticator QR follow-up

- **Display:** setup and replacement show a browser-local QR code from the exact
  validated native setup URI, with manual-key copy retained as a fallback.
  [ADR-048](../../docs/adr/048-local-authenticator-qr.md) extends the earlier
  manual-only display decision; the dated checkpoints below retain that history.
- **Private lifecycle:** QR drawings are removed after verification and access
  changes and blanked synchronously before page suspension. Refresh retains the
  existing pending/restart flow. The setup URI stays in temporary component state.
- **Package:** the Hub pins `qrcode.react` 4.2.0. It supports React 19 and adds no
  other runtime dependencies; all existing locked package versions are retained.
- **Verification:** on 2026-11-05, 17 focused workerd checks and all 49 MFA/security
  browser checks passed, including accessibility and the narrow dark/RTL screen.
  Type checks, the Hub test build and packaging, frozen installation and audit
  passed. Native Apple Vision decoded desktop, tablet and mobile-dark captures to
  the exact setup URI. Removing synchronous QR cleanup made its browser regression
  fail; restoring the code returned it to green. Independent review found no
  required changes.
- **Hosted follow-up:** the owner confirmed QR enrollment on the deployed test
  Hub, and the agent observed the enabled authenticator and protected access.
  The [T063 checkpoint](../004-cloudflare-test/quickstart.md#hosted-verification-t063)
  records the hosted evidence. Production release remains subject to T064.

## Observed checks

The proof used Bun 1.4.2, Node.js 24.21.0, Better Auth/core/Kysely adapter/OAuth
provider 1.7.12, Kysely 0.28.18, Vitest 4.1.12, Cloudflare's Vitest plugin 1.4.6
and Wrangler 4.136.2. It used the existing lockfile, application migrations and
local Workers configuration with remote bindings disabled. No dependency,
configuration, native SDK patch or production data change was needed.

The following commands ran from the isolated copy, after applying its candidate
migration, native composition and assertions. The prototype-only paths below
are not part of the application's source tree. Use T056's commands for current project-wide verification.

```bash
bun install --frozen-lockfile
bun run typecheck:tests
bun run apps/hub/scripts/t046-schema.ts
bun run test apps/hub/src/auth/mfa/proof.test.ts apps/hub/src/auth/auth.test.ts apps/hub/src/auth/creation-policy.test.ts
```

| Check | Observed result |
|---|---|
| Frozen install | Passed; existing pinned dependencies and provider patch retained |
| Test type check | Passed after generating the existing test Worker types |
| Native schema comparison | Passed; generated migration output was only `;`, with no unsafe changes or schema problems |
| Native proof and existing auth/creation suites | 67 tests passed across three files: 31 proof cases and 36 existing cases |
| Guard-removal control | Removing only the revision predicate from native password session deletion made its race case fail: the winner's session disappeared |
| Restored code | Guard restored; the complete 67-test selection passed without filtered or skipped cases |
| Review | Independent read-only review found no remaining Required or Critical feasibility finding |

Wrangler metrics were disabled for the final checks and its logs were directed
into the owned temporary directory. Native dependency sourcemap warnings and
URL-encoded-body `.text()` warnings remained visible; no warning/error filter was
introduced. These results are focused checks, not a full build/browser release run.

## What the proof establishes

| Boundary | Observed behavior |
|---|---|
| Native adapter | In-place guards retain schema registration, transaction callback identity, native returned values and lock-date conversion. Removing a required column still fails the native schema check. |
| Password source | A delayed native credential request retains its original revision. A later password change cannot lend that request the winning revision or let its challenge complete. |
| Challenge and request scope | The exact signed main challenge is consumed once. Operation state is scoped to the current native endpoint inside native request state; reused/composed calls do not inherit authorization. |
| Issued session | Successful native enrollment/verification stamps the actual issued session. Existing password-only sessions remain unverified, old revisions cannot authorize, and failed final guards emit no success cookie. Private revision/time fields are omitted from native public session/user output. |
| Enrollment phases | Setup, activation and restart/replacement use real conditional D1 batches with matching audits. SQL refusal rolls activation back; lost committed replies leave coherent, resumable state. |
| Backup codes | Native one-use consumption has one concurrent winner. Regeneration invalidates the old set, preserves MFA age and conflicts with older backup use or competing generation. The last backup can authorize replacement. |
| Native throttling | Account failure counts and lock dates survive the adapter boundary; a locked account refuses verification, and expiry permits native guarded reset. Remembered-device/session-skipping options are refused before factor use. |
| Management time | The exact five-minute boundary succeeds and a later request is refused without changing factor material. Ordinary verified sessions retain normal expiry rules. |
| Own password | A verified master can rotate its password at MFA age 300,001 ms. The new session has the exact winning revision and original MFA time. Delayed older session deletion cannot remove that session. |
| OAuth ordering | A real signed credential request stays pending without a session. Native MFA completion finalizes its session before provider hooks issue the workspace callback. Password-only signed continuations and consent without live MFA cannot issue authorization codes. |
| Delayed sign-out | The native provider's queued old-session logout reaches the actual workspace receiver. Its signed token removes only the old workspace session; a later winning Hub/workspace session and token remain usable. |
| Other logins | An ordinary native credential login still works and cannot enroll master MFA. Unknown bulk/consuming factor mutations are refused without changing the factor. |

The existing native own-password save exception remains: sessions can be removed
before a later password save fails, or the password can commit before replacement
session insertion fails. The latter case requires a fresh sign-in with the new
password and MFA. The proof adds no MFA save-consistency exception.

## Minimum production changes supported by this proof

- **T047 storage:** add the native factor schema and exactly the four approved
  private revision/time columns, one-factor constraint and main-challenge index.
  Preserve existing migrations and NULL MFA time for older sessions. Generate
  the final dated migration through existing schema tooling.
- **T047 adapter:** create the native adapter asynchronously, wrap the same object
  in place and await every auth-factory caller. Native sequential transaction
  callbacks must use guarded methods too. Review any direct `@better-auth/core`
  1.7.12 reference separately; no package upgrade is justified by this proof.
- **T048 access:** fold current MFA/revision facts into the existing indexed live
  access read and Core policy. The proof's workspace fixture composes a private
  MFA check with the existing validator; it does not prove the production
  one-read/one-call target or strict older-consumer contract.
- **T049 phases:** carry the native endpoint-scoped snapshot, exact consumed
  challenge, conditional factor/counter/backup saves and audited phase batches
  into cohesive application code. Preserve the meaningful proof assertions in
  permanent tests with the approved acceptance names.
- **T049–T050 completion:** use the actual native issued session and finish its
  guarded MFA-time write before provider after-hooks. Keep the native two-factor
  plugin before the provider. Clear success cookies and new-session state when
  finalization fails; inspect native refusals separately from completed sign-in.
- **T051 password/revocation:** guard the native session-delete step as well as
  password persistence. Retain the authorized device's original MFA time and
  exact winning revision. Include targeted main-challenge removal in existing
  lifecycle/identifier/password invalidation saves.

These changes reuse native TOTP, backup-code cryptography, challenge handling,
cookies, schema metadata and the existing `saveHub` D1 batch. No replacement
authentication implementation, QR dependency or extra consistency exception is
needed for the demonstrated behavior.

## Limits and handoff

- **Application wiring:** the prototype composes existing Hub auth options and
  persistence hooks; it is not the final Hub HTTP/access-policy integration.
  Core/local/external access contracts, indexed query plans, public limiter and
  request/error/privacy wrappers, bearer UserInfo and full lifecycle revocation
  remain required in T047–T052.
- **Acceptance:** these 31 feasibility cases are not the feature's 19 complete
  acceptance scenarios. Scenario mapping and full backend checks belong to T052;
  screens, browser copy/download, keyboard/accessibility and full regressions
  belong to T053–T056. No browser/build/hosted validation is claimed here.
- **Interruptions:** SQL refusals, paused overlapping native writes and simulated
  lost committed replies were exercised with real migrations/saves. A lost-reply
  fixture does not prove every possible Worker termination point.
- **Evidence lifetime:** T052 completed the handoff to permanent tests and
  retired the nine-file prototype patch. Its historical SHA-256 was
  `749fbcab8e0c7b61a6592075eeafe4ea5ee6d8e30cd4fb8a6c1e1f156d1dd98a`.
  The [current scenario map and commands](#t052-backend-acceptance-checkpoint)
  replace that reproduction artifact; the proof was never applied to production.
- **Cleanup:** owned dependency installation, runtime storage, test processes,
  temporary sources and logs were removed after the proof. All 517 original
  source entries, 23 inventoried private files, seven symlinks, original native
  provider patch and lockfile were preserved. The T046 review diff was removed
  after its documentation/evidence update was approved.

## T047 native foundation checkpoint

- **Storage:** added `2026-10-31-014344-master-mfa.ts`, generated from native
  1.7.12 schema and extended with the four approved private columns, revision
  range checks, one-factor constraint and targeted challenge index. Existing
  migrations remain unchanged. A fresh migrator resumes after each of its nine
  committed DDL statements loses its reply; existing credentials, sessions,
  unrelated verification records and two other workspaces/owners stay intact.
- **Factory:** `createHubAuth` awaits the native Kysely adapter; every setup,
  handler and fixture caller awaits it too. Guards retain that adapter object,
  schema metadata, conversion and sequential transaction callbacks. The factory
  preserves native preflight behavior; blocked HTTP paths still return 404 before
  migrations exist, rather than eagerly awaiting a failing schema check.
- **Source:** credential snapshots use the existing indexed identifier lookup
  before native password verification. Session creation keeps that original
  revision and checks it against current storage; it never adopts a newer one.
  Request state is keyed by the native endpoint context. No Hub access RPC is
  added to protected requests.
- **Concurrent initialization:** the new direct-server-API regression first
  reproduced a lost source when two endpoints shared initially empty native
  request state. The production helper now publishes the endpoint map
  synchronously through the public native state store before reading it through
  the typed helper. Both actual sign-ins retain their own revisions. This case
  was not covered by T046; use the permanent implementation for this boundary.
- **Closed operations:** all eight native MFA HTTP endpoints remain disabled.
  Raw factor mutations, enabled-flag changes, unauthorized private metadata and
  main MFA challenge creation are refused. Guards cover create/update, bulk,
  counter, deletion and atomic-consumption methods, including native callbacks.
  T047 creates no verified MFA session and no MFA completion timestamp.
- **Existing passwords:** native password persistence/deletion still follow the
  existing behavior and accepted save exception. A replacement session carries
  its original authorized revision with NULL MFA time. Exact password/revocation
  race guards and original MFA-time retention belong to T051.
- **Dependency review:** the manifest and generated lockfile add only a direct
  `@better-auth/core` 1.7.12 reference for its public adapter/context interfaces.
  Removing that one added workspace entry reproduces the previous lockfile;
  resolved versions and package payloads were not upgraded. The existing
  Workers compatibility flags and provider patch are retained.

Permanent cases live in [foundation.test.ts](../../apps/hub/src/auth/mfa/foundation.test.ts)
(29 cases), [master-mfa.db.test.ts](../../apps/hub/src/db/master-mfa.db.test.ts)
(15 cases), the eight added pre-schema route checks in
[auth-policy.test.ts](../../apps/hub/src/auth/auth-policy.test.ts), and the
existing indexed identifier/native-auth suites. No verifier or verified-session
fixture was substituted. Storage-only factor fixtures are explicitly unverified.

| Check run in the isolated candidate | Final result |
|---|---|
| `bun run test` | 1,832 tests passed across 91 files, without skipped cases |
| `bun run typecheck` | Passed all workspaces, generated Worker bindings, Workers tests and browser-test types |
| `bun --filter @xpro/hub generate-auth-schema --check` | Native schema matches application migrations |
| `bun run build:hub` | Local Hub production build passed; no deployment |
| `bun install --frozen-lockfile` | Passed without changing the reviewed lockfile |
| `bun audit` | No known vulnerabilities found; 427 packages checked |
| Revision guard control | Removing only the current/source revision comparison made its focused race test fail: native completion returned 200 instead of the required 409; restored code passed the final full suite |
| Independent review | No remaining Required or Critical findings after the shared-state initialization fix |

- **Remaining work:** T048 adds live Core/Hub MFA access enforcement. T049 adds
  guarded native MFA phase saves and completion; T050 integrates public/OAuth
  handling; T051 finishes revocation. Full backend/scenario and browser evidence
  still belongs to T052–T056. A passing foundation is not full MFA acceptance.
- **Saved databases:** this checkpoint tested disposable storage only. Apply the
  existing serial Hub migration procedure before using the updated runtime with
  an older local or hosted database. Existing private development data was not
  migrated or rewritten by these checks.
- **Warnings and scope:** existing sourcemap, URL-encoded-body and local tooling
  warnings were retained without error/warning filters. Runtime, Vite,
  Cloudflare and deployment configuration were unchanged. Browser journeys,
  builds of unrelated apps and hosted
  validation were not rerun for this backend-only checkpoint. The release hold
  remains in force.
- **Cleanup:** owned source/dependency installation, runtime storage, build
  output, logs and processes were removed after verification. The approval diff
  is the only retained temporary artifact and is removed after applying it.

## T048 live access checkpoint

- **One snapshot:** the existing session query also reads current login/session
  revisions, the native enabled/verified enrollment state and the private session
  MFA time. The added factor join uses the unique native user index. Query-plan
  cases require indexed searches for every joined table, with no full scans.
  Multiple actions in one prepared request still use one Hub check.
- **External boundary:** the existing HubAccess entry point returns `invalid` /
  `core_unauthenticated` for an active master without verified MFA, including a
  NULL workspace ID. An older consumer that ignores the new field receives no
  valid identity. No caller flag enables limited access.
- **Hub-local access:** Hub-owned callers use the same indexed reader through
  `validateHubLocalAccess`. A coherent unenrolled master may inspect its session,
  sign out and, after login creation completes, enroll. A verified enrollment
  without session MFA time requires sign-in verification. Neither limited state
  permits profile completion or protected actions. Native HTTP session inspection
  and sign-out remain usable for both ordinary logins and unenrolled masters.
- **Live refusals:** all logins need equal non-negative safe-integer revisions.
  Master enrollment flags must agree with the actual factor record. Master MFA
  time must be real, fixed UTC text and not in the future. Core requires the MFA
  field and checks its consistency with the actual master role. Malformed or
  missing binding data is refused and reported through the existing safe path.
- **Recent verification:** only `manage_mfa` requires an MFA age from 0 through
  300,000 milliseconds, inclusive, checked when the action is authorized. A
  normally valid verified session keeps its existing expiry for protected/profile
  actions. The guarded action's current-password check belongs to T049.
- **Preserved rules:** ordinary membership/local grants, creation completion,
  profile completion, inactive/expired-session refusal and request/workspace
  isolation remain covered. The two new local MFA refusals use the existing
  allow-listed error body, request-ID header and `no-store` response.

The focused command ran in the isolated copy with the real Workers runtime,
native authentication, application migrations and database. Plain policy tests
exercise fact values; they do not create verified sessions or substitute native
verification. The command below uses the current Accounts test locations; the
recorded results are the pre-relocation checkpoint, not a new run:

```bash
bun run test packages/core/src/access \
  apps/hub/src/auth/{hub-access,mfa-access,access-policy}.test.ts \
  packages/accounts/src/access/{validate-access.db,mfa-access}.test.ts \
  packages/core/src/dates/dates.test.ts packages/core/src/server/errors.test.ts
```

| Check run in the isolated candidate | Final result |
|---|---|
| Focused command above | 146 tests passed across 10 files, without skips |
| Tests before implementation | Six failures exposed the missing RPC refusal, joined index and safe errors |
| Live revision guard control | Removing only revision equality caused four failures, including real ordinary/master sessions; restored code passed the focused suite |
| `bun run typecheck` | Passed all workspaces, generated bindings, Workers tests and browser-test types |
| `CLOUDFLARE_ENV=local bun run build:hub` | Local Hub production build passed |
| `bun install --frozen-lockfile` | Passed with unchanged manifests and lockfile |
| Full suite, with default and JSON reporters | 1,547 passed and 360 failed across 94 files (30 failing files); no skipped/pending cases |
| Independent review | No Critical or Required findings |

- **Integration handoff:** master fixtures in the older account, STMS, routing,
  session and screen-handler tests currently complete only password sign-in.
  The 360 failures include these refused flows and checks that depend on them;
  the full suite is not green. T049 must provide
  real guarded enrollment/sign-in fixtures and restore successful master access,
  including global access without membership and after role changes. Keep these
  integration assertions enabled; do not invent stored verification times, fake
  verification, weaken the gate or add fixture exemptions. The full suite must
  be green before the T052 backend checkpoint.
- **Limits:** no native MFA completion endpoint, factor-management save, public
  MFA/OAuth integration, revocation race or browser acceptance is claimed here.
  Those remain T049–T056. This is an intermediate access checkpoint with a
  blocked release, not a deployable complete MFA feature.
- **Original data and cleanup:** checks used disposable storage. Original source,
  saved private databases/settings/certificates, seven symlinks and the native
  provider patch were preserved. No original database migration was run. Owned
  dependency installation, sources, build/runtime output, logs and processes were
  removed; only the approval diff is retained until it is applied. Runtime,
  Cloudflare, Vite, dependency and deployment configuration were unchanged.

## T049 guarded native actions checkpoint

- **Native actions:** the existing factory now composes guarded native setup,
  activation, TOTP/backup sign-in, pending-setup restart, authenticator replacement
  and backup generation. Password checking, encryption, code verification,
  challenge/attempt handling and cookie rotation remain native. The eight native
  MFA HTTP paths remain closed; public verification/OAuth handling is T050.
- **Coherent saves:** pending factor material and setup audit share a D1 batch.
  Activation and restart/replacement update both native flags/material, advance
  only the winning revision, revoke old sessions/tokens/main challenges and save
  the matching audit together. Backup replacement compares the captured old set
  and commits the new set with its audit. It preserves enrollment and session MFA
  age. Already-revoked token timestamps remain unchanged.
- **Captured authority:** the guarded native adapter retains its identity and
  native conversions. Each endpoint owns its request-local operation. Conditional
  saves recheck the captured role, revision, enrollment, active/completed login
  and original session/challenge expiry after native checking. Counter and backup
  writes retain native comparisons and cannot alter a newer enrollment.
- **Completion:** only the native atomic challenge-consumption result supplies
  consumption proof; ordinary cleanup deletion does not. New sessions initially
  have NULL MFA time. The application after-hook records actual completion only
  after native success and a final live-state guard, before provider after-hooks.
  A failed final guard suppresses its success cookies and native new-session state.
- **Management boundary:** strict password-only server-function inputs reject
  identity/private-field claims. The existing Hub request/access helper gates
  setup, explicit restart/replacement and backup generation; native guards repeat
  the relevant checks after password verification. Native cookie helpers carry
  the replacement enrollment cookie between disable and enable. Only intended
  setup URI/new backup material is returned, with request ID and `no-store`.
- **Role and limits:** the native credential MFA hook runs for current global
  masters; demotion restores ordinary credential behavior without deleting the
  enrollment. Every native MFA submission uses the existing limiter with the
  server-resolved `mfa:<loginId>` key. Missing/unavailable limiting refuses safely.
  No limiter configuration or accepted per-location approximation was changed.
- **Real fixtures:** [master-mfa.ts](../../tests/support/master-mfa.ts) enrolls and
  signs in through the guarded native APIs. It generates test codes with native
  helpers using the actual stored factor. It never writes verified flags, times
  or sessions as authentication fixtures. Only the outside rate-limit service is
  controlled for focused flow tests; a real configured binding case also passes.

Permanent tests under `apps/hub/src/auth/mfa/` cover setup and wrong codes,
password/recency refusal including exactly five minutes, last-backup recovery,
native lockout/unlock, request isolation, one-use backup races, competing
regeneration, stale activation/counters, delayed expiry and authority changes,
interrupted phase commits and rollback. Token cases issue real provider access
tokens and preserve an unrelated login's tokens. The configured grant issues no
refresh tokens; the indexed refresh-revocation statement is covered by query plans.

The command uses current test locations; the results below record the original
pre-relocation checkpoint, not a new run.

```bash
bun run test apps/hub/src/auth/mfa packages/core/src/access \
  apps/hub/src/auth/hub-access.test.ts apps/hub/src/auth/mfa-access.test.ts \
  packages/accounts/src/access/{validate-access.db,mfa-access}.test.ts
```

| Check run in the isolated candidate | Final result |
|---|---|
| Focused command above | 193 tests passed across 16 files, without skips |
| Enrollment tests before implementation | Both failed while the foundation refused native setup; both pass with real guarded enrollment |
| Demotion regression | Reproduced an unwanted native MFA challenge for an ordinary login; the scoped native matcher fixes it |
| Final live-state guard control | Removing only the final source condition returned 200 instead of required 409 after revocation; restored code passed |
| `bun run typecheck` | Passed all workspaces, generated bindings, Workers tests and browser-test types |
| `CLOUDFLARE_ENV=local bun run build:hub` | Local Hub production build passed |
| `bun --filter @xpro/hub generate-auth-schema --check` | Native schema matches the unchanged application migrations |
| `bun install --frozen-lockfile` | Passed with unchanged dependencies/lockfile |
| Full suite, default and JSON reporters | 1,598 passed and 360 failed across 102 files; no skipped/pending cases. Failing-file counts match T048's same 30 files exactly |
| Independent review | No Critical or Required findings; pinned native ordering/consumption contracts were corroborated |

- **Remaining integration:** the older application fixtures still perform
  password-only master sign-in. Their 360 failures remain visible. T050 wires
  public pending/completed responses, signed OAuth continuation and those real
  MFA fixtures into application tests. T051 wires existing password/lifecycle/
  identifier revocation producers and own-password retention. The new delayed
  tests remove authority through real saves to prove the guard; they do not claim
  those remaining producers are implemented. T052 requires the full backend suite
  to pass. Screens, browser acceptance and convergence remain T053–T056.
- **Scope and cleanup:** no public verifier, automatic recovery, package upgrade,
  schema change, runtime/Cloudflare/Vite/deployment change or release approval is
  included. Original source, seven symlinks, private settings/certificates/saved
  databases and the provider patch were preserved. No original migration was run.
  Owned sources, dependencies, runtime/build output, logs and processes were
  removed; only the approval diff is retained until application. The release hold
  remains. T052 subsequently integrated T046's meaningful assertions into
  permanent application tests and retired its reference patch.

## T050 public sign-in and OAuth checkpoint

Public email/username sign-in now preserves native MFA-pending success and its
signed challenge cookie. A password-only master enrollment session remains
limited and receives no completed-sign-in audit. The public TOTP and backup-code
routes reuse T049's guarded native proof/time path; successful verification
records completion once. Their strict JSON boundary accepts only `code` and
the optional signed `oauth_query`. It refuses remembered-device/session-skip
options and private metadata before native execution. Existing credential
Turnstile/identifier limits and sign-out remain unchanged; MFA uses T049's
shared, server-resolved login limiter without another CAPTCHA or Hub RPC.

Verification responses expose only `{ status: true }` or the native signed
OAuth redirect, with request IDs and `no-store`. Native token/user responses
are not forwarded as verification JSON. Expected refusals give static safe
messages for invalid codes, restart, limits and temporary unavailability;
unexpected failures drop success cookies and use the existing safe reporter.
The completion audit retains the existing native-session/audit save exception
and its upgrade trigger; this adds no MFA-state consistency exception.

The native post-login page remains `/complete-profile`. Its live redirect check
pauses a master needing MFA or profile details; T053 adds the screen's `/mfa`
navigation. `consentReferenceId` always requires a fully authorized live session
before consent/code issuance, including skip-consent and already-cleared signed
continuations. Native UserInfo first validates the bearer, then checks that
token's originating `sid` against the live Hub. An unrelated browser cookie
neither grants nor prevents bearer access. These provider callbacks replace the
redundant initial browser-session checks on authorization/continuation/UserInfo.

Application fixtures now create masters through real native enrollment and
verification, while deliberate password-only refusal tests remain intact.
Public sign-in fixtures complete native MFA through the actual HTTP boundary;
password-reset fixtures still require the enrolled factor after new credentials.
Browser setup reuses the same native enrollment helper and the existing local
rate-limit binding; it never writes verified session/factor facts directly.

| Check run in the isolated candidate | Final result |
|---|---|
| `bun run test` with JSON reporting | All 1,988 tests passed across 104 files; zero failures, skips, pending or todo cases |
| Public MFA/OAuth files within that full run | 34 cases passed; all prior 360 application failures are resolved |
| Initial public-boundary tests | 12 of 18 failed before implementation: pending was 500, verification was closed, and enrollment credentials were audited too early |
| Initial OAuth tests | All three failed before implementation: limited authorization could not pause, and bearer access ignored new master MFA requirements |
| Unrelated limited browser cookie regression | Reproduced a false bearer refusal; delegating to the bearer-session callback fixes it |
| Native code-order barrier | Three real TOTP/backup JSON/HTML continuations inspected the verified session time/revision before native code creation |
| Response and consent guard controls | Removing response field filtering or the live consent check failed one targeted test each; exact source bytes were restored before final checks |
| `bun run typecheck` | Passed all workspaces, generated bindings, Workers-test types and browser-test types |
| `CLOUDFLARE_ENV=local bun run build:hub` | Passed the local Hub production build |
| `bun --filter @xpro/hub generate-auth-schema --check` | Native schema matches the unchanged application migrations |
| `bun install --frozen-lockfile` | Passed; dependencies and lockfile unchanged |
| Existing Chrome smoke test below | One test passed, including real native MFA seed and protected workspace entry |
| Independent read-only review | No remaining Critical/Required findings after exact verification-response assertions were added |

```bash
PLAYWRIGHT_CHANNEL=chrome bun run test:e2e tests/e2e/security.spec.ts \
  -g 'valid customer workspace is embedded'
```

The first browser attempt could not launch because bundled Chromium was absent;
the documented installed-Chrome option passed without a browser download or
configuration change. The wrapper removed both runs' isolated source, storage,
certificates, logs and processes. This smoke test does not establish the new MFA
screens' browser acceptance.

- **Remaining work:** T051 extends password/identifier/lifecycle revocation and
  native own-password retention. T052 maps the complete backend acceptance
  evidence; a green current suite does not implement those remaining producers.
  T053–T056 still own screens, browser acceptance and convergence. The release
  hold remains.
- **Scope and cleanup:** no dependency, migration/schema, runtime, Vite,
  Cloudflare or deployment change is included. No original database migration
  was run. Original source, seven symlinks, private settings/certificates/saved
  databases and the provider patch were preserved. Owned temporary source,
  dependencies, Git metadata, runtime/build output, logs and processes were
  removed; only the approval diff remains until application.

## T051 existing revocation and password checkpoint

Existing master password resets, email/username changes and all four lifecycle
transitions now advance the target's authentication revision and remove its
main MFA challenges in the same batch as their existing audit and revocations.
Reactivation and restoration also retire old access. Enrollment and factors
remain intact; another login's challenges, sessions and data are unchanged.
No-op, conflicting and failed saves retain their existing behavior.

Own-password changes still use native current-password verification, hashing,
session lifecycle, field conversion and cookie serialization. They now capture
the original session, expiry, role, revision and credential before native work.
The session-delete step rechecks that source. The guarded credential batch
compares the original hash, advances the revision, removes remaining access and
main challenges, and records `accounts_password_changed` with no required comment.
Native replacement sessions use only that winning revision and begin with NULL
MFA time. The final guard restores the authorized device's original MFA time;
it never makes old MFA recent. Ordinary logins retain NULL MFA time and do not
need a factor. Master own-password changes need verified MFA, without the
five-minute factor-management restriction.

Stale native work returns a safe sign-in/access refusal without a success
cookie or a false unexpected-error report. Unknown native failures still use
the existing single safe reporter. The native sequential-write exception is
unchanged: sessions can end before a password batch fails, or the password,
revision, revocations and audit can commit before replacement-session creation
fails. These outcomes are not retried automatically. Lost-reply tests read the
durable result through the unaffected binding and prove fresh native factor sign-in;
they do not claim to simulate every Worker termination.

| Check run in the isolated candidate | Final result |
|---|---|
| `bun run test` with JSON reporting | All 2,018 tests passed across 107 files; zero failures, skips, pending or todo cases |
| New password/revocation behavior tests | 29 passed: seven revocation producers, five consumed-challenge races, eight password boundary cases and nine password overlap/failure cases |
| Initial revocation/password checks | All nine failed before implementation; the final implementation passes them |
| Real native password SQL plans | Actual captured source, credential, revision, cleanup and completion queries use indexes; no shared-table scans or statements over D1's 100-bound-parameter limit |
| Revision and credential guard controls | Removing either guard failed its targeted regression; exact candidate bytes were restored before final checks |
| `bun run typecheck` | Passed all workspaces, generated bindings, Workers-test types and browser-test types |
| `CLOUDFLARE_ENV=local bun run build:hub` | Passed the local Hub production build |
| `bun --filter @xpro/hub generate-auth-schema --check` | Native schema matches the unchanged application migrations |
| `bun install --frozen-lockfile` | Passed; dependencies and lockfile unchanged |
| Existing Chrome password regressions below | All three passed: native replacement cookie/other-device logout, invalid-password handling and lost-response behavior |
| Independent read-only review | No remaining Critical/Required findings; expected stale-password refusals no longer produce false server errors |

```bash
PLAYWRIGHT_CHANNEL=chrome bun run test:e2e tests/e2e/profile.spec.ts \
  -g 'silent autofill supplies the correct password|password entry or the current password is invalid|a committed password response is lost'
```

- **Remaining work:** T052 maps all 19 scenarios to permanent backend tests and
  outstanding browser assertions. T053–T056 own MFA screens, browser acceptance
  and convergence. Existing browser password regressions do not establish those
  new screens' acceptance. The release hold remains; T052 retires the T046 patch.
- **Scope and cleanup:** no dependency, schema/migration, runtime, Vite,
  Cloudflare or deployment change is included. No original database migration
  was run. Original source, seven symlinks, private settings, certificates,
  saved databases and the provider patch were preserved. Owned temporary
  source, dependencies, Git metadata, generated/build output, test/browser
  storage, logs and processes were removed; only the approval diff remains
  until application.

## T052 backend acceptance checkpoint

All 19 approved scenario names now identify permanent behavior tests. T052 adds
13 cases and strengthens existing cases without changing application behavior.
These use native creation, credentials, TOTP, backup consumption, OAuth, D1 and
workspace storage. There are no skipped tests, manufactured verified sessions,
test-only authorization paths, new dependencies or new save exceptions.

The following map names the main test and important supporting suites.
`mfa/` means `apps/hub/src/auth/mfa/`; `auth/` means `apps/hub/src/auth/`.
The final column is an explicit handoff to T053–T055, not a claim that those
screen/browser assertions passed.

| Approved scenario | Permanent backend evidence | Outstanding screen/browser assertion |
|---|---|---|
| Master enrollment | `mfa/enrollment.test.ts`; first private master in `mfa/recovery.test.ts`; `mfa/http.test.ts` | First/later-master setup, manual key, copy/download and protected navigation only after verification. |
| Invalid enrollment code | `mfa/enrollment.test.ts`; authentic out-of-window code in `mfa/protection.test.ts` | Accessible errors keep enrollment pending and preserve the draft. |
| Password accepted, MFA pending | `mfa/sign-in.test.ts`; email/username HTTP cases in `mfa/http.test.ts` | Navigate to MFA with the signed query preserved and no false sign-in error. |
| Valid master sign-in | `mfa/sign-in.test.ts`, `mfa/http.test.ts`, `mfa/oauth.test.ts` | Actual MFA page reaches STMS/profile/workspace destinations. |
| Invalid or expired verification | `mfa/protection.test.ts`, `mfa/http.test.ts`, `mfa/concurrency.test.ts` | Expired challenges offer fresh credential sign-in; no automatic resubmission. |
| Existing password-only session | `mfa/protection.test.ts`, `mfa/enrollment.test.ts`; external binding in `auth/hub-access.test.ts` | Old tabs and direct protected navigation remain gated after enrollment elsewhere. |
| Fresh sign-in on the same browser | `mfa/http.test.ts` covers sign-out/expiry; `mfa/protection.test.ts` rejects trust/session-skip options | The same browser must show MFA again after sign-out/expiry. |
| Workspace sign-in continuation | `mfa/oauth.test.ts` covers credentials, MFA, profile completion and signed continuation, plus tamper/code-order cases | The complete browser journey reaches only the intended workspace; tampering cannot continue. |
| Single-use backup sign-in | `mfa/sign-in.test.ts`, `mfa/concurrency.test.ts`; consumed-proof failure in `mfa/interruption.test.ts` | Backup entry completes sign-in once and clears sensitive submitted fields. |
| Last backup code | `mfa/management.test.ts` exhausts the set, starts replacement without another code and verifies the new factor | Complete recovery and copy/download the new set without requiring a second old code. |
| Current password and recent MFA | `mfa/management.test.ts`, `mfa/concurrency.test.ts`, `packages/accounts/src/access/mfa-access.test.ts`; Core access-policy tests | Separate-tab re-verification and Check access preserve drafts; stale/changed identity cannot save. |
| Authenticator replacement | `mfa/management.test.ts`, `mfa/token-revocation.test.ts`, `mfa/interruption.test.ts` | Warn about invalidation; display new material and keep access limited until verification. |
| New backup-code set | `mfa/management.test.ts`, `mfa/concurrency.test.ts`, `mfa/interruption.test.ts` | Warn, display only the winning new set and provide explicit copy/download. |
| Interrupted replacement | `mfa/interruption.test.ts` covers lost commits, insertion refusal and actual resume/restart | Unknown-result and refresh recovery show no false success or automatic replay. |
| Loss of all second factors | `mfa/recovery.test.ts` exhausts backups, resets the password and repeats initial setup without removing MFA | Keep sign-in blocked; expose no automatic recovery or unapproved operator action. |
| Ordinary logins | `mfa/sign-in.test.ts` covers tenant owner/admin roles and closed public sign-up; `mfa/management.test.ts` refuses factor management | Ordinary users retain their normal flow and see no master MFA controls. |
| Login changes invalidate old access | `mfa/revocation.test.ts`, `mfa/password.test.ts`, `mfa/password-races.test.ts`, `mfa/concurrency.test.ts` | Mounted pages handle ended access and delayed responses without restoring old identity/proof. |
| Limited verification attempts | `mfa/protection.test.ts` covers native budgets and the actual local binding, including enrollment and shared methods; HTTP refusals in `mfa/http.test.ts` | Display limit/unavailability errors; no automatic retry or extra CAPTCHA; sign-out remains available. |
| Private authentication material | `mfa/http.test.ts` inspects setup/management, verified sessions, headers, logs and audits; OAuth URLs in `mfa/oauth.test.ts` | Inspect navigation, console, browser storage, copy/download failure, focus and third-party requests throughout actual screens. |

- **Clocks and limits:** authentic generated old codes are refused while current
  codes still verify under the same live enrollment/challenge. Clock tests use
  Date-only control. Real-binding tests use its actual ten-request budget and do
  not advance its clock or claim an exact globally shared limit. Separate native
  tests cover five failures per challenge, ten per-login failures, the fifteen-
  minute lock and guarded reset after expiry. Management retains the inclusive
  five-minute boundary, rejects stale/missing/future/malformed proof and never
  refreshes MFA age through ordinary session reads or password rotation.
- **Committed state and isolation:** interruption cases open new Hub database
  connections to inspect phase/user/factor/audit state. Consumed TOTP challenges
  and used backups stay consumed after session insertion fails. A failed
  replacement-session insert leaves coherent pending enrollment; fresh native
  credentials/setup/TOTP restore access. Another master's state remains intact.
  The password race delivers the real signed logout message after the winner,
  preserves its actual local session/current-user/token access, and compares a
  second active workspace unchanged. Lost-reply fixtures do not simulate every
  possible Worker termination.
- **Compatibility and privacy:** unenrolled and enrolled-but-unverified masters
  return the existing exact external invalid shape for NULL and non-NULL
  workspace IDs, so older consumers cannot bypass MFA by ignoring new fields.
  Public verification JSON stays allowlisted; material appears only in intended
  private setup/management output. Native cookie-deletion headers on a refused
  credential race have empty values and `Max-Age=0`; no success/challenge cookie
  is accepted as a refusal.
- **Prototype retirement:** all 31 T046 cases have permanent equivalents. The
  final carryovers are in `mfa/management.test.ts` (last-code replacement through
  completion), `mfa/interruption.test.ts` (replacement-session refusal),
  `mfa/password-races.test.ts` (queued logout/workspace winner),
  `mfa/concurrency.test.ts` (delayed enrolled-master credential issuance) and
  `mfa/http.test.ts` (verified-session private output). Native schema, guard,
  revision, lock, one-use, code-order and other save/race assertions remain in
  the permanent foundation/access/sign-in/management suites. The obsolete
  prototype patch is removed rather than retained as a second implementation.

| Check run in the isolated candidate | Final result |
|---|---|
| `bun run test` with JSON reporting | All 2,031 tests passed across 108 files; zero failures, skips, pending or todo cases |
| MFA suites within that full run (`mfa/` and `auth/mfa-access.test.ts`) | All 197 tests passed across 17 files, including 13 added cases |
| Scenario-map verification | All 19 names match the specification in order, have exact passing test titles and point to existing permanent files |
| `bun run typecheck` | Passed all workspaces, generated bindings, Workers-test types and browser-test types |
| `bun --filter @xpro/hub generate-auth-schema --check` | Native schema matches the unchanged application migrations |
| `bun install --frozen-lockfile` | Passed; dependencies and lockfile unchanged |
| Enrollment-limit and private-output controls | Bypassing the platform refusal or exposing private MFA time failed its new regression; exact source bytes restored before full checks |
| Independent read-only review | No Critical/Required findings in the tests, 31-case prototype handoff or 19-row evidence/browser map |

```bash
bun run test apps/hub/src/auth/mfa
bun run test
bun run typecheck
bun --filter @xpro/hub generate-auth-schema --check
```

- **Gate and next work:** T052's backend gate permits proceeding to the separately
  reviewed T053 screen task. Copy/download, keyboard/focus, accessibility,
  responsive/RTL layouts, browser storage and complete screen acceptance remain
  T053–T055; T056 owns convergence. No MFA screen or operator recovery tool is
  delivered here, and the release hold remains.
- **Scope and cleanup:** changes are permanent tests, their real integration
  helper, this evidence/task status and prototype retirement. No application,
  dependency, schema/migration, runtime, Vite, Cloudflare or deployment setting
  changed. Original databases were not migrated. Original source, seven
  symlinks, private settings/certificates/saved databases and provider patch were
  preserved while verifying the candidate. Owned temporary source, dependencies,
  generated output, storage, reports, logs and processes were removed; only the
  approval diff remains until application.

## Primary references checked

Documentation was retrieved through Context7 and checked against the installed
1.7.12 source and public exports. Native references are version-pinned; platform
guides were checked in their current documentation:

- [Native two-factor plugin](https://github.com/better-auth/better-auth/blob/v1.7.12/docs/content/docs/plugins/2fa.mdx)
- [Native adapter contract](https://github.com/better-auth/better-auth/blob/v1.7.12/docs/content/docs/guides/create-a-db-adapter.mdx)
- [Database hooks and additional fields](https://github.com/better-auth/better-auth/blob/v1.7.12/docs/content/docs/concepts/database.mdx)
- [OAuth provider integration](https://github.com/better-auth/better-auth/blob/v1.7.12/docs/content/docs/plugins/oauth-provider.mdx)
- [Native cookie forwarding helpers](https://github.com/better-auth/better-auth/blob/v1.7.12/packages/better-auth/src/cookies/cookie-utils.ts)
- [Native own-password implementation](https://github.com/better-auth/better-auth/blob/v1.7.12/packages/better-auth/src/api/routes/update-user.ts)
- [Wrangler platform proxy and disposal](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy)
- [Cloudflare D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [Cloudflare rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [TanStack Start server functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)
- [Cloudflare Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)


## T053 enrollment and sign-in screens checkpoint

The Hub now has a private `/mfa` page for native setup, pending-setup recovery,
authenticator/backup sign-in and saving the new backup set. It uses the existing
fields, TanStack Form, confirmation dialog and translations. Manual setup shows
the native account label, copyable key and native TOTP settings. The required
`shortcut:` records when to add a reviewed local QR renderer. No dependency or
external QR service was added.

- **Read-only page boundary:** native `createAuthMiddleware` verifies the signed
  session/challenge cookies. Indexed queries read live authority without native
  session refresh or expired-verification cleanup. GET, POST and repeated preload
  tests compare complete authentication/audit snapshots, including expired rows.
  The page returns only `loginId`, a render `step` and the current nonsecret
  `setupId` (NULL for ordinary logins); these never authorize a mutation.
- **Private setup identity:** after the guarded native factor creation commits,
  its endpoint puts that actual factor ID in an internal response header. Only
  the trusted setup action's response supplies `setupId` beside `totpURI` and
  `backupCodes`. A request header cannot supply it. The private display checks
  this identity on revalidation: its own cookie rotation retains the display;
  another setup or loss of MFA privileges clears it. No extra database read or
  secret fingerprint is used to bind an action reply to its setup.
- **Local private display:** setup material and new backups stay in component
  memory. Refresh exposes no stored key or codes and creates no new factor;
  enter an already-added authenticator code or explicitly confirm restart with
  the current password. Successful setup clears the credential/code form before
  showing Copy, Download and Continue, without a saved-codes checkbox. Clipboard
  failures offer manual selection; local downloads release their object URL.
  Continue, Start again and sign-out clear local forms and private DOM fields
  before departure. A Boolean-only browser observer checks the departure event.
- **Live identity and races:** the existing page-login header can only refuse
  stale native operations. Six real setup/replacement/backup/password/TOTP/backup
  cases prove it cannot lend authority to another login with the same password.
  Focus/visibility reads are cancelled or deferred across mutations so an old
  cookie cannot discard a successful enrollment reply. Browser checks hold the
  native verification response after rotation and exercise a real second-tab
  restart. Same-login route revalidation keeps the matching private display.
- **Continuation:** credential sign-in registers the native two-factor client
  without automatic navigation and handles its named pending result first.
  Native signed queries retain their raw URL bytes between fixed Hub pages;
  Router's search serializer must not convert repeated `ba_param` values into
  JSON. Native provider calls may re-sign their own continuation. Workspace
  selection uses only the validated `requestedWorkspaceId` through MFA and
  profile completion. Display-only `intent` is not an OAuth request or return
  URL. Actual authorization, profile ordering and code issuance stay native.
- **Documentation checked:** the T053 Context7 review covered native MFA client
  navigation, Router signed-query redirects/revalidation and Form submission/
  reset behavior. Pinned Better Auth 1.7.12 and TanStack implementations were
  inspected where necessary, including the public middleware and isomorphic
  helper exports. Workers execution, SSR/browser journeys and the Hub build
  validate the composition against installed versions.

Verification in the isolated source copy:

```bash
bun run test
bun run typecheck
bun run build:hub
bun --filter @xpro/hub generate-auth-schema --check
PLAYWRIGHT_CHANNEL=chrome bun run test:e2e tests/e2e/mfa.spec.ts tests/e2e/sign-in.spec.ts
```

- **Workers:** 2,081 cases across 112 files passed, with no pending, skipped or
  todo cases. T053 adds 50 permanent cases and strengthens existing setup-output
  privacy assertions. The read-only page's 21 cases cover safe render state,
  expiry, login/privilege changes, refusal-only hints, request boundaries,
  unchanged stored state and actual indexed application queries. SQLite's small
  native schema-catalog reads are excluded from the shared-row query-plan check.
- **Browser:** all 47 targeted checks passed: 14 MFA journeys and 33 existing
  sign-in/protocol regressions. These cover new/returning masters, both native
  verification methods, manual setup, wrong-password restart, refresh recovery,
  copy/download, cookie rotation, same-login revalidation, login changes,
  second-tab restart, ordinary display intent, requested workspaces and signed
  workspace/profile continuation. They also check leading zeroes/no auto-submit,
  private browser storage, credential clearing before navigation and automatic
  accessibility on the new visible states. Authentication and application saves
  remain real; only the external widget and deliberate transport timing are
  controlled.
- **Other checks:** all workspace, Workers-test and browser-test types passed;
  the Hub production build passed; the native schema matches the application
  migrations. Removing the page-login identity comparison in the isolated copy
  failed exactly six permanent refusal regressions; its original bytes were
  restored before the final passing run. Independent read-only review found no
  remaining required issue after the routing and lifecycle corrections.
- **Remaining acceptance:** the T052 table is the backend-checkpoint handoff;
  this section records the new targeted browser evidence. T054 still owns profile
  MFA status, verified replacement and backup generation/recent-verification UI.
  T055 completes every remaining browser assertion in that table, including the
  full management, privacy, keyboard, narrow-screen and fake-language matrix;
  T056 owns full convergence and all-app checks. These targeted checks do not
  claim full acceptance of all 19 scenarios.
- **Scope and cleanup:** no dependency, schema/migration, runtime, Worker name,
  Vite, Cloudflare or deployment configuration changed. No original database was
  migrated. Owned source/dependency copies, runtime data, browser downloads,
  logs, reports and processes were removed after verification. Original source,
  seven symlinks, private settings/certificates/saved databases and the provider
  patch were checked unchanged before applying the approved review diff. The
  existing release hold and accepted save limits remain; no deployment or first
  client use is approved.

## T054 master MFA management checkpoint

Masters can generate a new backup-code set from Profile or follow Replace
authenticator to `/mfa?intent=replace`. Ordinary logins have no MFA controls.
The replacement warning, password confirmation and new setup stay on `/mfa`
so its private key and codes never need to cross a route boundary. Display intent
alone grants no permission and does not create an OAuth continuation.

- **Readiness:** Profile and MFA reads return only a nonsecret management state
  beside their existing page data. The existing live access result serves Profile;
  no extra Hub RPC or database read is added. Core authorization and native MFA
  guards share the same five-minute check, including the exact boundary and
  rejection of future timestamps. Every mutation still checks live identity,
  current password, native state and the actual verification time on the server.
- **Fresh sign-in:** an old proof disables only MFA management. Ordinary profile
  editing remains available. The explicit sign-in link opens a separate tab;
  automatic focus reads pause during that sign-in so its temporary challenge
  cookie cannot erase the original draft. Check access and continue reads live
  authority and enables the retained form only after actual MFA completion.
- **Private display:** generated codes stay in component memory with Copy,
  Download and Done. A successful expected-login refresh precedes their display.
  Same-login revalidation keeps them; access or login loss removes them. Page
  departure clears marked forms and private DOM fields; generation checks discard
  late action replies. No browser storage, loader, URL or retrieval endpoint holds
  the new material, and failed mutations are never replayed automatically.
- **Lost material:** refresh neither retrieves nor regenerates codes. Pending
  replacement can finish using the authenticator already added; after verification
  the page explains the lost backup display and links to Profile in a new tab.
  A new set requires explicit password confirmation there. Both management actions
  work after the last usable backup code completed sign-in, without requesting
  another already-consumed factor. No comment, saved-codes checkbox, automatic
  recovery or QR dependency was added.
- **Documentation:** Context7 covered native backup generation/re-enrollment,
  Router revalidation and Playwright popup routing. The pinned Better Auth 1.7.12
  two-factor documentation and installed implementation were checked for native
  password handling, invalidation of old codes and cookie forwarding. The existing
  guarded native actions remain the only MFA mutation implementation.

Verification in the isolated source copy:

```bash
bun run test
bun run typecheck
bun run build:hub
bun --filter @xpro/hub generate-auth-schema --check
PLAYWRIGHT_CHANNEL=chrome bun run test:e2e tests/e2e/mfa.spec.ts tests/e2e/profile.spec.ts tests/e2e/sign-in.spec.ts
```

- **Workers:** 2,104 tests across 114 files passed, with no pending or skipped
  tests. The 23 new cases cover safe management readiness, unchanged stored state,
  exact recency boundaries and display-only replacement intent. Tightening the
  five-minute comparison in the isolated copy failed exactly three boundary
  regressions; restoring its original candidate bytes passed all 36 related cases.
- **Browser:** 78 targeted checks passed: 26 MFA journeys, 19 existing Profile
  checks and 33 existing sign-in/protocol checks. Twelve new MFA journeys cover
  both management actions, old-code invalidation with a still-working authenticator,
  last-code use, stale-proof refusal and separate-tab refresh, lost displays,
  same-login revalidation, identity changes and late replies after departure.
  Authentication and application saves stay real. Controls cover the outside
  widget, fixture preparation clock, the outside limiter while consuming fixture
  backup codes, and deliberate transport timing. Browser actions use the actual
  configured limiter.
- **Other checks:** workspace and test types, the Hub production build and native
  schema comparison passed. Independent read-only review found no required issue.
- **Remaining work:** T055 completes the broader browser, privacy, keyboard,
  narrow-screen and fake-language matrix; T056 owns convergence and all-app
  checks. These targeted checks do not claim full acceptance of all 19 scenarios.
- **Scope and cleanup:** no dependency, migration, runtime, Vite, Cloudflare or
  deployment configuration changed, and no original database was migrated.
  Owned source/dependency copies, runtime data, downloads, logs, reports and
  processes were removed after verification. Original source, seven symlinks,
  private settings/certificates/saved databases and the provider patch were checked
  unchanged before presenting the review diff. The release hold remains.

## T055 browser acceptance checkpoint

The MFA browser matrix is complete alongside the T052 backend evidence below.
All browser requests use the actual Hub, router and workspace apps in the guarded
HTTPS runner. Ten older checks were updated to finish native MFA after password
acceptance; no session proof or authorization result is manufactured. Ordinary
logins keep their original flow.

- **Native fixtures:** shared browser helpers read actual native TOTP codes and
  complete the real verifier where an existing test uses HTTP reauthentication.
  Screen journeys enter those codes through the actual form. Date-only fixture
  preparation creates authentic old codes, expired challenges and expired sessions;
  app Workers retain their real clocks. Initial/last/consumed backup fixtures use
  native enrollment and consumption. Only the outside limiter is replaced while
  preparing exhausted-code fixtures; browser actions use the configured binding.
- **Errors and recovery:** old or incorrect codes preserve input with accessible
  errors. Expired page-load challenges return to credential sign-in. An interrupted
  replacement may require fresh credentials when its new cookie was lost, then
  resumes the committed pending setup. Lost backup replies never retrieve codes
  or replay generation. Actual native limits and browser transport failure remain
  actionable without automatic retries or an extra MFA CAPTCHA.
- **Keyboard and layout:** keyboard checks cover blank-field focus, silent autofill,
  native paste, verification, copy and continuation. The 320px dark RTL/fake-language
  journey covers setup, key/backups, returning authenticator/backup entry, Profile
  management, replacement/error confirmation, refreshed pending setup, lost-code
  completion and the stale-MFA access gate. Automatic accessibility checks run on
  these visible states.
- **Timing:** the existing defined-connection master check completes real MFA and
  measures from its final verification submit. Human entry and cold development
  module loading are outside that request measurement, as with the existing
  sign-in form preparation. The three-second limit and connection profile are
  unchanged; the observed master request took 261ms in this run.
- **Privacy:** the browser collector inspects navigation, relevant response bodies
  and headers, requests, console arguments, browser storage and real audit entries.
  Passwords/TOTP are forbidden in every response and diagnostic. Only setup keys
  and backup arrays in their intended private reply fields are exempted; those
  replies must be no-store. Clipboard/download failures leave manual export
  available, including actual keyboard copy. A temporary control injected a
  synthetic fixture password into one real setup reply and logged its TOTP as
  plain console text: exactly the response-body and console checks failed. The
  original candidate bytes were restored before the final passing run. Native
  server-diagnostic and 503-unavailability evidence remains in the T052 HTTP tests;
  browser transport unavailability is exercised separately.

The T052 table records its historical browser handoff. This table closes that
handoff; `mfa.spec.ts` is the browser suite unless another file is named.

| Approved scenario | Completed browser evidence |
|---|---|
| Master enrollment | New-master manual setup; key/settings, held native verification reply, copy/download and protected continuation; signed new-master workspace flow. |
| Invalid enrollment code | Named invalid-enrollment case uses an authentic expired code, retains/focuses input, keeps protected navigation gated, then accepts a current code. |
| Password accepted, MFA pending | Returning authenticator/backup journeys and `sign-in.spec.ts` master flow reach MFA without a false credential error. Existing HTTP evidence covers both identifiers. |
| Valid master sign-in | Returning-master, requested-workspace and signed workspace/profile journeys reach the actual intended destination. |
| Invalid or expired verification | Authentic old-code refusal and expired-challenge fresh sign-in; only an explicit current-code submit completes verification. |
| Existing password-only session | Old browser session remains refused at STMS and workspace sign-in after actual enrollment on another device. |
| Fresh sign-in on the same browser | Real sign-out and genuine session-expiry cases both require MFA again; no remembered-device control is offered. |
| Workspace sign-in continuation | Returning/new signed continuations and requested-workspace cases; signed-query tampering during MFA issues no callback. |
| Single-use backup sign-in | Successful backup entry clears on departure; a new sign-in refuses the consumed code and keeps its error accessible. Native concurrency evidence remains at T052. |
| Last backup code | Last-code sign-in starts replacement, verifies the new authenticator and exports its new set; last-code backup generation also works without another factor. |
| Current password and recent MFA | Wrong-password management refusals, both stale-proof actions, and separate-tab verification/Check access retain drafts while live identity guards remain active. |
| Authenticator replacement | Warning and current-password confirmation, old-session refusal, gated protected navigation until new verification, then private backup export. |
| New backup-code set | Warning, wrong-password refusal, copy/download/Done, same-login display survival, old-code refusal and a still-working authenticator. |
| Interrupted replacement | Actual committed reply loss, no false success or replay, fresh credential recovery if needed, read-only refresh and explicit pending verification. |
| Loss of all second factors | Native exhausted-backup fixture cannot complete sign-in and offers no automatic recovery; password/initial-setup reset evidence remains at T052. |
| Ordinary logins | Ordinary MFA intent/Profile checks and existing account, workspace owner/admin and user journeys stay unchanged. |
| Login changes invalidate old access | Actual own-password change refuses an earlier mounted challenge; identity-switch/private-display/late-reply checks plus reauthenticated STMS, reset, creation and workspace journeys. |
| Limited verification attempts | Actual enrollment and sign-in budgets show limit errors; transport failure preserves input and sends no automatic retry; enrollment still permits sign-out. |
| Private authentication material | Field-specific response allowlists, URL/console/storage/audit inspection, no third-party QR calls, private lifecycle clearing, and copy/download failure/manual fallback. |

Verification in the isolated source copy:

```bash
PLAYWRIGHT_CHANNEL=chrome bun run test:e2e
bun run typecheck
```

- **Results:** all 225 browser checks passed, including 44 MFA checks, without
  skipped cases. App, Workers-test and browser-test types passed. Independent
  read-only review found no remaining required issue. This task changes browser
  tests/fixtures and checkpoint documentation; application behavior is unchanged.
- **Remaining work:** T056 still owns the final Workers suite, all-app builds,
  schema comparison, shortcut review and release-evidence convergence. Completing
  this browser checkpoint does not claim those new convergence checks have run.
- **Scope and cleanup:** no dependency, migration, runtime, Vite, Cloudflare or
  deployment configuration changed. No original database was migrated. Owned
  copies, dependencies, downloads, runtime state, logs, reports and processes were
  removed; original source, private local data, symlinks and the provider patch
  were verified unchanged before presenting the review diff. The release hold
  remains, and deployment or first-client use is not approved.

## T056 final convergence checkpoint

All T046–T056 local implementation and verification tasks are complete. The
[T052 backend map](#t052-backend-acceptance-checkpoint) and
[T055 browser map](#t055-browser-acceptance-checkpoint) account for all 19 named
scenarios. Native MFA, access/revision guards, factor management, public
continuation and existing password/identifier/lifecycle behavior were reviewed
end to end. Independent backend and frontend reviews found no required or
critical implementation finding and no worthwhile additional runtime abstraction.

Verification ran against a frozen source copy on 2026-11-01. It used the existing
Bun/Node toolchain, pinned dependencies, actual migrations and local workerd/
Miniflare bindings. No verified-session stand-in, verifier replacement, skipped
case, new save exception, runtime/configuration change or dependency upgrade was
introduced. The current documentation is reconciled with the delivered feature;
earlier checkpoints remain historical evidence.

```bash
bun install --frozen-lockfile
bun audit --json
bun run test
bun run typecheck
bun run build:all
bun --filter @xpro/hub generate-auth-schema --check
PLAYWRIGHT_CHANNEL=chrome bun run test:e2e
```

| Check in the isolated copy | Result |
|---|---|
| Frozen install | Passed; manifest, lockfile, payload versions and provider patch retained |
| Workers suite | 2,104 passed in 114 files; zero failed, pending or skipped cases |
| Complete browser suite | 225 passed in 11 files, including all 44 MFA checks; zero failed or skipped cases |
| Types | All workspaces, generated Worker bindings and both test projects passed |
| Builds | Web and Hub production builds passed; router's existing local deploy dry run passed |
| Native schema comparison | Matches the application migrations; no pending schema change |
| Dependency audit | Exit 0; registry JSON contained no advisory records |
| Public source-map check | Web's 6 and Hub's 40 public client files contain no `.map` files or `sourceMappingURL` markers |
| Native identity guard control | Removing only the refusal-only page-login comparison failed all six setup/replacement/backup/password/TOTP/backup-code regressions |
| Core MFA guard control | Removing only the master-MFA protected-access check failed four of 37 real access cases |
| Restored source | Both guards restored byte for byte before the full passing Workers/browser/build checks |

- **Review and compatibility:** Context7 refreshed native two-factor lifecycle,
  cookie forwarding and backup invalidation, Workers runtime testing/local builds,
  and Bun's audit behavior. Installed 1.7.12 native interfaces and current project
  types remain the authority for this pinned composition. The direct core reference
  added at T047 uses already-resolved public request-state/adapter interfaces;
  T056 changes no dependency reference or payload. Request-local state remains
  native, phase writes remain conditional/audited, and native cryptography/code
  consumption remains in Better Auth.
- **Shortcut review:** all 23 source/patch occurrences state a limit and upgrade
  trigger. The original 21 remain recorded in the release review; the two MFA
  additions are native sign-in/audit separation under the existing credential
  sign-in exception, and manual key entry until onboarding errors or a scanning
  requirement justify a local QR renderer. No external QR or automatic recovery
  path was added. Server conventions now state the approved no-replay/native MFA
  retry rule; all five accepted save exceptions remain unchanged.
- **Current status:** README, the sign-in plan/task/quickstart summaries and the
  security/release assessments link this evidence. R22 now records locally
  implemented and verified master two-step sign-in. Historical T043/T045 results
  are preserved; they are not relabelled as this fresh run.
- **Release remains blocked:** sanitized production diagnostics, a named-
  environment release/rollback workflow, hosted routing/DNS/TLS/Images/assets/
  performance, operational rehearsals/alerts and privacy requirements still need
  separate evidence and approval. No target account or deployed old/new version
  pair was confirmed. Local completion does not authorize deployment or first-client
  use, and does not make the reusable release checklist universally passed.
- **Cleanup and isolation:** all owned source/dependency/replay copies, build and
  runtime data, browser downloads/screenshots, logs, reports and processes were
  removed. Original source, private settings/certificates/saved databases, seven
  file symlinks and the provider patch were verified unchanged before presenting
  the exact review diff. Keep only that intentional diff until approval/application.
