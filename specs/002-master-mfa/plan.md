# Implementation Plan: Master multi-factor authentication

- **Feature:** `002-master-mfa`.
- **Date:** 2026-10-30.
- **Specification:** [approved scope, recovery and acceptance scenarios](spec.md).
- **Planning stage:** plan and [implementation order](tasks.md) are recorded.
  Work follows the task checkpoints and exact-diff approval. Deployment and
  release approval remain separate.

## Summary

- **Native authentication:** use the existing Better Auth 1.7.12 two-factor server
  and client plugins for authenticator setup, code verification, encrypted factor
  storage, sign-in challenges and single-use backup codes. Keep the native
  credential checks and cookies. No new authentication service or package upgrade
  is proposed.
- **Master requirement:** the Hub decides whether the current login has xpro's
  global master role. Its live access query returns the current MFA state with
  the existing session, creation and membership facts. Core refuses protected Hub
  and workspace actions until master MFA is complete; tenant roles do not grant
  master authority. Reuse the existing one-Hub-call-per-request boundary.
- **Session verification time:** plan a server-owned, nullable MFA completion time
  on each native Hub session. Set it only after successful native factor
  verification; a missing value means that session has not passed MFA. Retain
  the original time when the authorized current device survives an own-password
  change. Neither session renewal nor a user-level enabled flag proves recent
  verification. Exact fields and hook behavior belong to the data-contract review.
- **Sign-in and navigation:** treat the native MFA challenge as an expected step,
  then verify the factor before reporting completed master sign-in. Preserve the
  OAuth provider's signed continuation and require MFA plus profile completion
  before workspace authorization. Verify plugin ordering and cookie rotation
  rather than assuming a redirect or returned token proves completion.
- **Hub ownership:** keep MFA screens and native API composition in the Hub.
  Core owns the shared access facts and authorization rule; workspace code reuses
  that rule. MFA setup and recovery receive only the narrow access required by
  the approved specification. Remembered-device bypasses and native password-only
  factor disabling remain unavailable.
- **Recovery and revocation:** enforce the approved current-password and five-minute
  MFA checks. The last backup-code sign-in can authorize replacement. Extend the
  existing invalidation paths to cover pending MFA challenges, including a
  verification already in progress, and prevent old access from returning after
  replacement or login changes. The exact save and concurrency design remains a
  required review item; deleting sessions alone is insufficient.
- **Attempt limits:** use native challenge/account failure controls and the existing
  Cloudflare limiter for exposed enrollment and management operations. The Hub's
  global Better Auth rate limiter is currently disabled; a plugin endpoint rule
  alone is not evidence that these requests are limited. Review the exact limits
  and keys with the flow design, including authenticated enrollment.
- **Storage and dependencies:** generate the native schema changes with existing
  tooling and add reviewed, forward-only Kysely migrations. Preserve the Worker
  name, Bun, Workers runtime and current deployment configuration. Any QR renderer
  needs a separate dependency/Workers review; factor secrets must stay in the
  local setup flow rather than an external QR service.
- **Evidence before implementation:** source and official-documentation review
  support this direction, but do not prove the integrated behavior. The first
  planned test checkpoint must establish native hook context, session verification
  time, cookie rotation, backup consumption and signed OAuth continuation in
  workerd. Complete the data, failure and invalidation design before implementing
  the application feature or claiming the 19 acceptance scenarios pass.
- **Constitution and release:** retain workspace isolation, native credential
  handling, existing save guarantees and the five accepted save exceptions.
  Native multi-step D1 writes are not assumed atomic; this summary accepts no new
  consistency exception. Record settled architectural choices in an ADR before
  implementation. The existing release hold remains in force.
- **References:** [version-matched two-factor documentation](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.12/docs/content/docs/plugins/2fa.mdx),
  [additional fields and hooks](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.12/docs/content/docs/concepts/database.mdx),
  and [OAuth continuation](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.12/docs/content/docs/plugins/oauth-provider.mdx).
  Context7 guidance was checked against installed 1.7.12 source because its
  available version index does not include this release.

## Data and session contract

- **Native records:** retain Better Auth's `user.twoFactorEnabled`, `twoFactor`
  enrollment/secret/backup fields and `verification` challenge records. Generate
  their schema from the configured plugin. Add no separate authentication store.
- **Login revision:** a server-owned number increases when an action revokes old
  access. Sessions and pending MFA checks retain the revision they started with.
  For example, a check started at revision 7 cannot become valid after a reset
  advances the login to revision 8. Never replace an old snapshot with the newest
  revision merely because verification finishes later.

| Native table | Added column | Stored meaning |
|---|---|---|
| `user` | `auth_revision` | Current login revision; non-negative safe integer, initially 0. |
| `session` | `auth_revision` | Revision authorized for this session; existing rows start at 0. |
| `session` | `mfa_verified_at` | Actual MFA completion time as fixed ISO UTC text; NULL until verified. |
| `verification` | `auth_revision` | Original revision for a native MFA sign-in challenge; NULL for unrelated native records. |

- **Private fields:** map these columns through native `additionalFields`, with
  client input disabled and private values omitted from browser session bodies.
  Hook code reads the private Hub snapshot, not browser-submitted flags or a
  returned token. Revisions use database integer/range checks. Existing sessions
  receive no invented MFA completion time.
- **Credential snapshot:** capture the candidate login ID and revision before
  native password verification. Native authentication must prove that same login;
  only then may the unchanged revision reach its session or MFA challenge. Missing
  or mismatched snapshots fail closed rather than using a current/default value.
- **Challenge snapshot:** retain the native identifier, value, expiry and attempt
  handling. Use native verification hooks to carry the revision. A consumption
  hook is trusted only for the intended factor flow and the exact signed challenge
  selected for that request; ordinary cleanup deletion never establishes MFA.
  Keep transient hook state request-local through native context facilities.
- **Completed verification:** a native session can be created before enrollment's
  final writes. Therefore create it without MFA authority and record the time
  only after native verification succeeds. Guard the update by the captured
  revision, the actual issued session ID, current active/completed login state
  and the verified source enrollment. Complete this before OAuth can issue an
  authorization. A failed guard cannot return completed sign-in or an access cookie.
- **Own-password rotation:** retain only the authorized current device. Carry its
  original MFA time and the exact revision won by that change into the replacement
  session. Do not mint a fresh MFA time or reread a newer revision to make a stale
  request pass. Other sessions and earlier challenges remain invalid.
- **Revocation writes:** advance the revision in the relevant existing password,
  identifier, lifecycle and factor-replacement save paths. Guard each write by
  its captured state; keep audited atomic changes in their existing D1 batch.
  Enrollment restarts that replace factor material must also retire earlier
  verification work. Native flags, backup sets and factor-record writes need
  guards too: refusing a resulting session alone does not stop stale native writes
  from changing a newer enrollment. Detailed composition and native own-password
  limits remain required flow/failure reviews before coding.
- **Indexes:** keep native identifier lookup indexes. Add an indexed lookup by
  `verification.value` restricted to non-NULL `auth_revision` for targeted MFA
  invalidation, and enforce one native factor record per login with a unique
  `twoFactor.userId` index. Do not scan the shared challenge store or delete
  unrelated verification records. Native attempt records keep native expiry.
- **Live access:** extend the existing indexed Hub statement with revision and
  MFA facts. Refuse an expired session, a revision mismatch or inactive/incomplete
  access under the existing rules. Master MFA needs current verified enrollment
  and a valid session completion time. Contradictory native enrollment state or
  malformed/future times fail closed; an enabled flag alone never grants access.
- **Shared result:** the Hub-local access result adds the following plain-data
  field to `HubAccessResult`; revision counters and factor secrets are not sent
  across the binding. Core checks that MFA state agrees with the actual master
  role. Missing/unknown MFA data never defaults to `not_required`.

```ts
type MfaAccessState =
  | { status: "not_required" }
  | { status: "enrollment_required" }
  | { status: "sign_in_required" }
  | { status: "verified"; verifiedAt: string };
```

- **Binding boundary:** the external HubAccess binding returns the existing
  `invalid` / `core_unauthenticated` result for any master without verified MFA,
  even if a caller supplies a NULL workspace ID. A `valid` binding result is only
  for an ordinary login or a verified master. Older workspace code could ignore
  a new field on a valid result, so Core's new checks alone are insufficient.
  Only a Hub-local limited-access path can expose enrollment/sign-in states.
  No caller-supplied flag enables that path; both paths share the indexed reader.
- **Actions:** retain limited session inspection/sign-out. A Hub-owned `enroll_mfa`
  action allows only a current master session needing enrollment, with completed
  login creation. `complete_profile` and protected actions require verified MFA
  for masters. For a Hub-owned `manage_mfa` action, Core also checks the master
  role and an MFA age from 0 through 300,000 milliseconds, inclusive. The Hub
  separately verifies the current password before the guarded change. Only the
  recent-MFA check has a five-minute limit; normal verified sessions keep their existing
  expiry rules. Pending challenge verification uses native challenge state and
  does not pretend to be an authenticated enrollment session.
- **Errors and input:** keep access input as server-resolved login/session IDs,
  workspace ID and request context. Propose `core_mfa_required` and
  `core_mfa_recent_verification_required` for Hub-local expected refusals; retain
  the existing safe error/request-ID format. Workspace binding refusals use the
  existing invalid result above. Cookies, counters and caller-provided times never
  supply authority. OAuth code issuance cannot use a limited-action exemption.
- **Proof gate:** validate private-field mapping, request isolation, challenge
  consumption binding, guarded time recording, stale consumers and overlapping
  revocation in workerd. These contracts do not establish atomic native MFA
  writes or settle every interrupted/replacement flow. If native APIs cannot
  preserve the guards, review their supported helpers inside a guarded save or
  revise the plan before coding; accept no new consistency exception here.
- **Decision record:** [ADR-042](../../docs/adr/042-mfa-session-revisions.md) explains
  these additions and their limits. The version-matched
  [native option/hook types](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.12/packages/core/src/types/init-options.ts)
  and [consumption hook implementation](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.12/packages/better-auth/src/db/with-hooks.ts)
  support the extension points; integrated application behavior is still unverified.

## MFA flow and failure handling

- **Native boundary:** Hub-owned handlers compose the native `auth.api` methods;
  keep native password checks, factor cryptography, verification and cookies.
  Block direct public setup/disable/backup-generation routes and unused OTP routes.
  Expose code verification only through the guarded flow. Accept strict bodies;
  refuse remembered-device and session-skipping options. Enrollment uses a limited
  Hub session; sign-in uses the exact signed native challenge. Refuse an ambiguous
  request rather than letting an unrelated session substitute for its challenge.
- **Guarded adapter:** prepare the existing native Kysely/D1 adapter before
  constructing Better Auth, then attach the Hub's security-write guards at its
  public adapter boundary. Make `createHubAuth` asynchronous and await its callers.
  Preserve the native adapter's identity, schema checks, metadata, field/date
  conversions and atomic consumption/comparison behavior. Its sequential D1
  transaction callback must still receive the guarded adapter. Leave unrelated
  operations with the native implementation; do not import private dialect files.
- **Request authority:** use native request-local context for the captured login,
  session/challenge, revision and source enrollment. A committed change can carry
  its exact winning revision into that operation's replacement session; it cannot
  adopt a later revision. Plan a direct Hub reference to the already-resolved
  `@better-auth/core` 1.7.12 for its public context helpers, without a version
  upgrade. Review the eventual manifest/lockfile diff separately before editing.
- **Conditional saves:** use Kysely and existing `saveHub` batches, including the
  existing conditional audit-claim pattern. The state check and the affected
  writes belong in the same save. MFA saves recheck active/completed login state,
  the master role, captured revision/source enrollment and the initiating
  session/challenge expiry. Management saves also recheck the five-minute MFA age
  after native password verification. Existing password actions retain their
  existing role rules, including ordinary logins. Factor, backup, failure-counter
  and password writes must not bypass these guards.
  Reject unsupported native security-write shapes instead of silently delegating.
  Keep native backup-code compare-and-swap conditions and exact challenge
  consumption; a stale request cannot alter a newer factor or its failure count.
- **Credential sign-in:** capture the revision before native credential checking.
  An ordinary login follows the existing flow. An unenrolled master receives only
  an enrollment session with no MFA time. An enrolled master receives the native
  ten-minute challenge, not completed sign-in. Update the existing sign-in wrapper
  and client to recognize this expected response without requiring a session
  cookie or producing a false server error. Ignore/remove a trusted-device cookie
  before native credential handling so it cannot bypass the second factor.
- **First setup:** after the current password is checked natively, save the native
  encrypted pending factor and its setup audit together. Keep the enabled flag
  false and MFA time NULL. Display only the returned private setup material.
  A page refresh does not silently generate another seed. The master may finish
  the same setup if they retained its seed, or explicitly restart it with their
  password. Restart first advances the revision and removes the old factor,
  sessions, tokens and main MFA challenges in one audited batch, then prepares
  the new pending setup using the native methods.
- **Enrollment completion:** native TOTP verification proves the captured pending
  factor. Its guarded activation batch sets the user and factor verified flags
  together, advances the revision, retires previous sessions/tokens/main MFA
  challenges and records enrollment success. The native replacement session uses
  only that winning revision and initially has no MFA time. After the native
  endpoint succeeds, the application after-hook guards the MFA-time write before
  provider after-hooks can continue OAuth. Only then permit profile completion or
  protected navigation. A later revocation defeats this
  final write; do not return a completed sign-in cookie on failure.
- **Factor sign-in:** native TOTP or backup verification consumes the intended
  challenge and creates its session. Record MFA time only after that native
  endpoint succeeds and the final live-state guard, before provider after-hooks. Count a recent backup sign-in
  as recent MFA, including the last unused code; do not demand another code to
  start replacement. An older password-only session for an enrolled master must
  start a fresh credential sign-in. A master whose MFA is older than five minutes
  does the same before managing factors; ordinary session renewal never refreshes it.
- **Authenticator replacement:** check recent MFA and let the native disable
  method verify the current password inside the Hub-owned action. Its guarded
  state change atomically sets enrollment pending, advances the revision, removes
  the old factor/backups, sessions, tokens and main challenges, and audits the
  start. Native session rotation then supplies only a new enrollment session;
  compose native enable to prepare the replacement seed and backups. Forward
  native cookies between these trusted calls using native cookie helpers.
  The native follow-up delete/update is allowed only for that exact committed
  phase; it cannot repeat the change against a newer enrollment. There is no
  public password-only disable action. New TOTP verification completes enrollment
  through the same guarded activation flow.
- **Backup replacement:** after current-password and recent-MFA checks, save the
  native encrypted new set and its audit together, conditional on the captured
  enrollment and previous backup value. A concurrent change loses this save and
  returns no new codes. Keep the authenticator, sessions and original MFA time.
  Every previous backup code becomes unusable once this save commits.
- **Existing revocation:** extend password-reset, identifier and lifecycle batches
  to advance the captured revision and remove main MFA challenges with the
  existing session/token invalidation. Restoration cannot revive old work.
  Native own-password change keeps its accepted sequential-write exception: its
  guarded password write also advances the revision, removes remaining old access
  and records a basic change audit in one batch. It may retain only the authorized
  current device with the original MFA time and that exact winning revision.
  Because native code already deletes sessions before its password write, use the
  verified original-session snapshot there, not a requirement that its deleted
  row still exists. Keep current revision, login-state and expiry checks.
  Do not reset enrollment or add a mandatory comment. No new save exception is
  accepted for MFA state changes.
- **OAuth continuation:** send the master through MFA, then profile completion,
  using the provider's signed query. The native post-login redirect chooses the
  screen; it does not authorize access. Validate the live, fully verified session
  in `postLogin.consentReferenceId` before consent/code issuance, including
  skip-consent and signed post-login continuations, then return the existing
  undefined reference. Also validate bearer UserInfo against its originating Hub
  session, rather than relying on a browser cookie. No limited action or client
  continuation flag grants authorization; workspace access still uses the strict
  external HubAccess boundary. Preserve PKCE, nonce, state and issuer validation.
- **Attempt budgets:** retain native sign-in challenge limits: five failed code
  checks per challenge, plus the native per-login lock after ten consecutive
  failures for fifteen minutes. Reuse the configured Cloudflare binding's ten
  requests per sixty seconds for all MFA submissions, keyed by the server-resolved
  login across TOTP, backup, setup and management actions. Include authenticated
  enrollment, which has no native challenge-attempt counter. Retain the existing
  per-location approximation limit; upgrade if abuse defeats it or stricter
  guarantees are required. Leave global native limiting and Worker configuration
  unchanged. An absent/unavailable limiter refuses the attempt safely.
- **Expected refusals:** invalid/used codes, expired challenges, stale revisions,
  wrong passwords, insufficient MFA age and rate limits return actionable safe
  results. Restart credentials for an expired/stale challenge; wait or start the
  prescribed fresh sign-in for the other applicable refusal. Do not report these
  as unexpected server failures. Keep responses private and non-cacheable; no
  password, factor secret, code, URI or raw native token enters URLs or logs.
- **Interrupted changes:** each committed phase must be a coherent audited state:
  pending setup, activated factor or replaced backup set. If native session
  creation or the final response fails after a phase commits, return no success
  cookie and do not retry the mutation automatically. A fresh password sign-in
  resumes pending enrollment; if its seed is unavailable, explicitly restart it.
  If activation committed, sign in with the configured authenticator. If a new
  backup set's response was lost, explicitly generate another set after the same
  checks; never restore old codes. A consumed sign-in challenge or backup code
  stays consumed even if later session creation/delivery fails; use another factor
  attempt. If all factors are then unavailable, the approved blocked-recovery
  policy still applies. No password-only recovery or new operator tool is added.
- **Proof before rollout:** the first future workerd checkpoint must prove the
  guarded native composition, not just inspect hooks. Exercise interrupted and
  overlapping activation, restart, replacement, backup consumption/regeneration,
  own-password rotation and revocation; prove cookies and OAuth cannot complete
  early and unrelated logins stay unchanged. Plan this proof as the first approved
  implementation task. If adapter coverage or native ordering cannot uphold these
  phases, stop and revise the plan before building the remaining feature.
  Screen/verification plans and implementation tasks still require approval;
  approval of this section does not claim the 19 scenarios pass or lift release.
- **Decision record:** [ADR-043](../../docs/adr/043-guarded-native-mfa-writes.md)
  records this composition. The version-matched
  [adapter contract](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.12/docs/content/docs/guides/create-a-db-adapter.mdx),
  [two-factor flow](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.12/docs/content/docs/plugins/2fa.mdx)
  and [OAuth callbacks](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.12/docs/content/docs/plugins/oauth-provider.mdx)
  were checked against installed source. Native sequential D1 writes alone do not
  provide the proposed guarded saves; integration remains to be demonstrated.


## Verification and acceptance

- **Runtime and scope:** reuse the existing Vitest/workerd project, real Hub and
  workspace migrations, local bindings and isolated browser runner. Keep remote
  bindings disabled and the test-environment guard. Add no test service or new
  runner. These are future checks; this plan records no passing MFA test result.
- **First implementation checkpoint:** after task approval, prove the native
  adapter composition before building the remaining feature. Use real password,
  enrollment, TOTP and backup flows. Show that guarded methods remain effective
  inside native transaction callbacks, native field/date conversion and schema
  checks still work, and request-local proof cannot cross between requests.
  An unsupported write or failed guard must produce no privileged session/cookie,
  newer-factor mutation or early OAuth authorization. Keep meaningful behavior
  cases as permanent tests. If this fails, revise the design before proceeding.
- **Real authentication:** privately create test logins through existing creation
  actions, then enroll/sign in through native Hub flows. Update shared master
  fixtures to complete MFA rather than setting flags, inserting a verified session
  or adding a test-only bypass. Preserve ordinary-login, workspace and first-master
  coverage. Generate real test codes from test-only setup material; never replace
  the native verifier or pretend a browser session is verified.
- **Acceptance mapping:** retain all 19 scenario names from the specification as
  permanent behavior tests. The table identifies the required evidence; it is
  not an implementation-task count. Most cases belong in Workers integration
  tests, with the few full browser journeys described below.

| Approved scenario | Required evidence |
|---|---|
| Master enrollment | First and later masters remain limited until real TOTP verification; setup provides copy/download of backup codes. |
| Invalid enrollment code | Wrong/out-of-window codes leave enrollment pending and protected access refused. |
| Password accepted, MFA pending | Correct credentials return the native challenge as an expected step; no completed-sign-in audit or privileged access. |
| Valid master sign-in | Real TOTP completes sign-in; profile completion and destination rules still apply. |
| Invalid or expired verification | Invalid codes fail; an expired challenge requires new credentials and cannot issue a session. |
| Existing password-only session | A real earlier password-only session stays blocked after enrollment on another device, including through the external binding. |
| Fresh sign-in on the same browser | Sign-out/expiry requires MFA again; trusted-device cookies and options cannot bypass it. |
| Workspace sign-in continuation | MFA then profile completion preserves the signed workspace destination; tampered/premature continuations cannot authorize. |
| Single-use backup sign-in | One code succeeds once; simultaneous uses permit at most one completed sign-in. |
| Last backup code | Its successful sign-in authorizes replacement within five minutes with the current password and no second code. |
| Current password and recent MFA | Wrong passwords and stale/missing/future MFA times refuse changes; renewal does not make proof newer. |
| Authenticator replacement | Starting replacement retires old factors, sessions, tokens and challenges; only completed new enrollment restores access. |
| New backup-code set | The winning save invalidates every old code, keeps the authenticator and preserves session MFA age. |
| Interrupted replacement | Read back each committed phase using a fresh request; it stays coherent and follows the approved resume/restart rules. |
| Loss of all second factors | Password reset and repeated initial setup cannot recover MFA; no unapproved manual reset route exists. |
| Ordinary logins | Existing sign-in works; tenant roles do not grant master authority or factor-management access; public sign-up stays disabled. |
| Login changes invalidate old access | Reset/change/identifier/lifecycle actions defeat old and already-running challenges; own-password rotation retains only the authorized device with its original MFA age. |
| Limited verification attempts | Native challenge/account limits and the real local Cloudflare binding refuse excess attempts, including authenticated enrollment. |
| Private authentication material | Sensitive values appear only in intended submissions/setup/copy/download; inspect responses, cookies, URLs, logs, audit and browser storage. |

- **Boundary cases:** cover exactly five minutes and one millisecond beyond it,
  future/malformed/missing MFA time, revision mismatch, expired sessions and
  contradictory enrollment state. Reuse Date-only clock control for application
  time boundaries and restore it after each test; do not assume it advances a
  platform limiter's clock. Check native budgets and the real local limiter
  separately so one cannot hide a failure in the other. Sign-out remains available.
- **Interrupted and competing writes:** reuse the real-storage interruption
  fixture and explicit barriers around real D1 calls, without replacing auth or
  save logic. Simulate refusal before commit and lost replies after commit; use a
  fresh connection to inspect durable state. Cover activation versus restart,
  replacement versus an earlier factor check, backup use versus regeneration,
  concurrent own-password changes and verification versus revocation. Check the
  winner's state and that delayed work cannot change it. A lost-reply fixture is
  not evidence of every possible Worker termination; do not claim that coverage.
- **Authorization and cookies:** exercise both Hub-local limited actions and the
  external binding, including NULL workspace IDs and an older consumer that
  understands only the existing invalid result. Test actual issued/expired
  cookies, direct native route refusals and guarded trusted-server calls. Cover
  skip-consent, signed post-login continuation and bearer UserInfo. No master OAuth code
  can issue before MFA completion; old codes/tokens cannot restore revoked access.
- **Database checks:** generate the native plugin schema, apply additive migrations
  over the existing database and check private-field mapping, defaults, range and
  uniqueness constraints. Existing sessions keep NULL MFA time. Verify indexed
  plans for the live access read and targeted challenge/factor operations; no
  shared-table scan is accepted. Keep schema/guard compatibility cases for future
  Better Auth upgrades. Old-code tests do not authorize rolling back to code that
  predates master MFA enforcement; deployment/rollback approval remains separate.
- **Browser journeys:** use the existing HTTPS wrapper for enrollment, TOTP and
  backup sign-in, last-code replacement, backup regeneration and signed workspace
  continuation. Verify actionable errors, pending states, double-submit prevention,
  keyboard/focus behavior, narrow screens, translations and automatic accessibility
  checks on every new MFA screen. Setup secrets stay out of navigation and browser
  storage, and copy/download works without a third-party QR service. Exact screens
  and routes still require their own planning review.
- **Observable outcomes:** check responses, durable state, audit/diagnostics and
  applicable outgoing effects together. Expected refusals do not create false
  server-error reports. Committed phases keep their matching audit; no completion
  is reported for an incomplete sign-in. Check another login and workspace remain
  unchanged. Retain a test that fails if each non-trivial security guard breaks;
  prove key refusal tests detect a deliberately removed guard in a disposable copy.
- **Completion checks:** after implementation, run targeted behavior checks while
  developing, then the existing `bun run test`, `bun run test:e2e`,
  `bun run typecheck` and `bun run build:all` before marking the feature complete.
  Keep existing regressions passing and identify newly failing test-first cases
  honestly; no skips or substitute implementations. Record the exact commands,
  outcomes and unresolved limits in the feature checkpoint. Passing local checks
  does not satisfy hosted acceptance or lift the existing release hold.
- **Cleanup:** run checks with isolated test data and owned temporary artifacts.
  Remove disposable source copies, databases, logs, browser downloads/screenshots
  and started processes after their safe outcomes have been captured in the checkpoint.
  Preserve developer certificates, private files and existing local data. The
  browser runner already performs its own copy/process cleanup; keep using it.
- **References:** follow the repository's
  [testing conventions](../../docs/conventions/testing.md),
  [Workers test configuration](../../vitest.config.ts),
  [isolated browser wrapper](../../tests/e2e/run.ts) and
  [existing release hold](../001-sign-in-and-accounts/checklists/release-review.md).
  [Cloudflare's test integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
  and [Vitest clock controls](https://vitest.dev/api/vi.html#vi-usefaketimers) were
  checked through Context7 against installed tooling; retain existing settings.

## Screens and routes

- **Hub pages:** add one `/mfa` route for setup and second-factor entry. Add a
  master-only MFA section to the existing `/profile` page for the authenticator
  replacement entry and backup-code generation. Keep these controls in the Hub; workspace apps use
  their existing sign-in flow and live access boundary. Reuse the existing form,
  input, button, notice and confirmation components and translation system.
- **Server-owned routing:** a read-only page function resolves the actual native
  session or exact signed challenge and returns only the safe state needed to
  render the page. The browser cannot select a login, claim verified MFA or turn
  a challenge into a full session. Keep this inspection in the Hub-local limited
  path, with no new workspace RPC. Check authorization again on every submission;
  hiding or redirecting a screen supplies no authority.

| Hub page or entry | Planned behavior |
|---|---|
| `/sign-in` | Keep credential entry and Turnstile. Recognize native MFA-pending success, clear submitted credentials, then navigate to `/mfa` with the existing signed continuation. An unenrolled master reaches setup through the live destination/post-login gate. Ordinary users keep their current destination rules. |
| `/mfa` with a sign-in challenge | Show authenticator-code entry and an explicit switch to a backup code. The Hub validates the actual challenge; a missing/expired/stale one offers a fresh credential sign-in. |
| `/mfa` with an enrollment session | Show explicit password-confirmed setup or pending-setup recovery. Start/restart only after submission; loading the page never generates a seed or backup set. |
| `/mfa?intent=replace` | A verified master opens the replacement confirmation/password form here. The intent chooses a screen only; server authorization and recent MFA remain required. Keeping the save on this page preserves its new private setup response without passing secrets between routes. |
| `/mfa` after successful verification | Keep any newly issued backup set visible until the user chooses Continue. Clear secret inputs, then resume the signed flow or the fixed Hub destination. A fully verified revisit without pending private display or the allowed replacement intent goes to that same continuation/destination. |
| `/complete-profile` | Keep the provider's existing post-login page. Resolve MFA first and send an incomplete master to `/mfa` with the same signed continuation; show required profile fields only after MFA. Completion resumes the existing native continuation. |
| `/profile` | Verified masters see MFA status, a fixed link to the replacement form and the backup-generation form. Other users keep the existing profile screen. Management requires the current password and server-checked recent MFA. |
| `/auth/destination`, `/`, `/account` | Extend the existing destination handling to send a master needing MFA to the fixed `/mfa` page before account/workspace/STMS navigation. Preserve existing destination rules after MFA and profile completion. |

- **Signed continuation:** retain the existing native OAuth client and its
  signed-query extraction/verification. Move only between fixed Hub paths during
  MFA/profile steps; no arbitrary return URL, browser-provided login ID or new
  persistent continuation store is introduced. The allowlisted replacement intent
  is only a presentation choice and stays out of the signed `oauth_query`; it
  never overrides server MFA state. Detect continuation from verified signed
  parameters, not merely a nonempty search string: `intent=replace` alone returns
  to the fixed Hub destination. Keep native strict authorization
  before code issuance. For direct Hub sign-in, use `/auth/destination` once the
  required steps finish. Existing protected routes translate an MFA refusal into
  the appropriate sign-in/setup navigation rather than a redirect loop.
- **Client navigation:** register the native two-factor client while retaining
  explicit navigation. Return a named MFA-pending result to the credential form,
  then clear it before navigating; leave automatic two-factor page navigation
  unset. Use guarded Hub handlers for setup/management and native verification
  through the approved public gate.
  Keep redirects disabled until any private backup display is finished, even if
  native OAuth processing returns a destination. Continue uses native signed
  continuation or the fixed Hub destination, with server state rechecked.
- **Setup steps:** the master submits their current password to begin. Show the
  native setup's account label and copyable setup key, using the native TOTP
  settings. They add it to their authenticator app and enter its code. Keep native
  backup codes only in this page's memory while enrollment is verified; after
  success, offer Copy, Download and Continue. Do not claim backup codes were saved
  merely because they were displayed; no mandatory saved-codes checkbox is added.
- **Initial setup display:** use manual key entry initially; no QR dependency or
  external QR service is introduced. Extract the setup key from the trusted native
  URI with the platform URL parser, keeping the URI out of navigation. Record a
  `shortcut:` comment when implementing this choice: add a reviewed local QR
  renderer if master onboarding reveals manual-entry errors or scanning becomes
  a release requirement. Keep setup and cryptography native.
- **Code entry:** use one labeled text input that accepts paste and preserves
  leading zeroes. Authenticator codes use the appropriate numeric keyboard and
  one-time-code autocomplete; backup codes use their native text format. Show
  errors beside the field and in the form summary. Provide explicit Verify,
  switch-method and Start again controls; do not submit automatically when the
  expected length is reached. Offer sign-out for enrollment sessions.
- **Pending setup:** refresh/back navigation never regenerates factor material.
  If the master already added the pending key to their app, let them submit its
  code. Otherwise offer an explicit password-confirmed restart with a warning
  that the previous pending setup will be retired. A lost setup response follows
  this same route. Page reads return no saved seed or backup codes. If verification
  succeeds after the page lost its backup display, offer generation of a new
  backup set through `/profile` after required profile completion and checks.
- **Management actions:** show Replace authenticator and Generate new backup codes
  separately. Each form requires the current password. Explain before replacement
  that other devices are signed out and old factors stop working; confirm the
  action with the existing confirmation component. The successful guarded action
  changes the current `/mfa` screen into pending setup.
  The replacement form runs on `/mfa`, so its new key and backup set remain in
  that component after the action. Backup generation stays on `/profile`, explains that the previous set will stop
  working, and offers private Copy/Download of the winning new set.
- **Fresh verification:** when MFA is older than five minutes, offer a fresh
  credential sign-in followed by TOTP or a backup code. Reuse the profile's existing
  separate-tab sign-in and Check access pattern so a form draft can remain in
  memory; recheck the same login before enabling its actions. Carry no password
  or code across that navigation and do not add a one-time return cookie or special
  reauthentication service. A last-backup-code sign-in still permits replacement
  within the approved window without asking for another code.
- **Private display:** keep setup material, submitted credentials and backup sets
  in local component memory only. No route loader, SSR hydration payload, global
  query cache, browser storage or URL stores them. Clear them when the user
  dismisses the display, leaves, signs out or a live identity/access check fails;
  do not replay a request to recover lost codes. Copy reports failure safely and
  allows manual selection; downloads use a local file and release their temporary
  object URL. A requested backup-code file is an intentional export, not browser
  session storage. Never log its contents. Cookie rotation or same-login page
  revalidation must preserve a visible new backup set until dismissal/Continue;
  verify this browser behavior rather than keying the display to a rotating
  session ID. An identity/access failure still clears the private display.
- **Forms and failures:** reuse the existing hydration/pending guards, native POST
  form semantics, zero mutation retries, stable loading space, field errors and
  request-ID notices. Preserve in-memory input on an ordinary field refusal; clear
  credential/code inputs after a successful step or access/identity loss. Rate
  limits and expired challenges explain the available next action. Unknown save
  outcomes follow the approved interrupted-change rules; show no false success
  and never retry the mutation automatically. Loss of all factors has no password
  recovery or operator-reset link while that procedure remains unapproved.
- **Page policy:** include `/mfa` in the existing private/no-store page handling;
  private mutation/page responses also remain non-cacheable. Keep existing origin,
  CSRF, security-header and referrer controls. Route reads, SSR and preloads have
  no setup/management mutation. Labels and messages use the existing translations;
  keyboard/focus, narrow screens and accessibility checks follow the approved
  verification plan and [screen conventions](../../docs/conventions/screens.md).
- **Decision and scope:** [ADR-044](../../docs/adr/044-hub-mfa-screens.md) records the
  route and setup-display choices. The version-matched
  [native client/setup documentation](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.12/docs/content/docs/plugins/2fa.mdx)
  and [signed continuation documentation](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.12/docs/content/docs/plugins/oauth-provider.mdx)
  were checked with Context7 and installed source, alongside the current Router
  guidance. Implementation tasks remain a separate review. This section adds no
  application code, dependency, deployment approval or passing MFA test claim.
