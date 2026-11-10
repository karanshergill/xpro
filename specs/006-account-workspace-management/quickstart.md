# Quickstart: STMS account and workspace management

This guide prescribes future checks; none is reported as run by the planning phase.

## Prerequisites

- Follow the existing [local setup and HTTPS guide](../001-sign-in-and-accounts/quickstart.md).
- Use real sign-in, completed profiles and master MFA. Workers tests create isolated records; manual checks need two holders, a successor and two workspaces.
- Approve the exact platform bindings, artifact bucket, test domain and provider permissions before hosted checks.
- Use only local/test resources. Do not invoke the browser seed script directly or reset retained data.

## Retained-data preflight

Before a forward migration, inspect the retained store while its writers are stopped:

```bash
bun run preflight:account-workspaces --env local
bun run preflight:account-workspaces --env test
```

Both commands read local storage. Only a separately approved
`bun run preflight:account-workspaces --env test --remote` reads the fixed hosted
test database. No production target or arbitrary database override is accepted.

The report contains issue codes and record IDs, at most 100 per issue; `hasMore`
means more matching records exist. Resolve only explicitly reviewed mappings and
rerun the check. It does not assign names or owners, run migrations, repair data,
or declare a workspace Ready. Its queries are advisory, not a locked snapshot.

Exit 0 means these checks found no issue. Exit 2 means review is needed or the
store is uninitialized; exit 1 means invalid options or a failed check. An
uninitialized report is not permission to initialize or reset retained data.

## Repository checks after implementation

```bash
bun run typecheck
bun run test
bun run test:cli
bun run test:e2e
bun run build:all
```

The implementation must include the platform app in the applicable checks. Current development scripts alone do not start the new executor.

## Required scenarios

| Area | Required observation |
|---|---|
| Accounts | Create without membership; reject a second account for the same holder; allow repeated display names; rename without changing identity |
| Creation | Two concurrent requests produce one workspace/address; the holder receives owner access; the acting master gains no membership |
| Recovery | Interrupt each stage, including lost replies; resume the original allocation or show Needs attention; never expose unfinished workspaces |
| Handover | Exercise holder-only, owner-only, both and departure; reject ineligible/stale successors; preserve history and unrelated tenants |
| Suspension | Test all four account/workspace status combinations using existing ordinary and master sessions; verify next-request enforcement and correct reactivation |
| Interface | Complete all five journeys by keyboard; check failed loads, validation, changed identity, session return, narrow layouts and inaccessible-state navigation |
| Privacy | Inspect exercised responses, URLs, errors, logs and audits for credential or raw-provider leakage |
| Retained data | Test empty stores, valid retained rows and actual conflicting rows without silent reassignment or deletion |

Use real application code and storage. Local failure tests may replace only external services; they do not prove provider behavior.

## Hosted proof

- After approved configuration and prepared inputs, preview through `bun run release --env test`.
- Publish only the exact separately approved actions.
- Provision two distinct origins and isolated Workers/storage through STMS.
- Verify sign-in, owner permissions, assets, live suspension and interrupted resumption against the actual provider.
- Retain sanitized evidence of resource identities and results. Do not mark the feature complete from mocked replies or upload success alone.

## Local implementation checkpoint

Historical T005–T007 results, recorded 2026-11-07 and reverified 2026-11-08
after the repairs below.
These results do not establish feature acceptance.

| Check | Observed result |
|---|---|
| `bun run test apps/hub/src/db/account-workspace.test.ts` | 29 passed |
| `bun run test packages/stms/src/management/operations.test.ts` | 5 passed |
| `bun run typecheck` after the repairs | Passed all workspaces and both test projects |
| `bun run test:cli` | 71 passed |
| Full `bun run test` after the repairs | 2,271 passed; 121 files passed |
| Full `bun run test:e2e` with diagnostics removed | 234 passed |

The isolated migration smoke recovered after a committed-DDL interruption,
preserved native records and the existing session, and kept an unnamed retained
account unnamed. An explicitly reviewed mapping in that disposable fixture
cleared preflight without completing its `stms_registered` creation. The
public-export smoke accepted valid receipts and rejected secret-bearing results,
fabricated pending receipts and unknown audit versions. Both probes were removed.
No retained-store migration or remote operation was run.

### Verification repair

Earlier full runs reported two Workers failures and three browser failures. The
outdated audit-column allowlist found in the first Workers run was also corrected
without weakening its privacy assertions.

- MFA budget coverage now controls only the external limiter decision; native authentication and D1 remain real, and the actual-binding enrollment check remains. This avoids a wall-clock-window assumption without changing production limits. The precise cause of the historical failed invocation was not recovered.
- Directory paging still covers 23 prepared workspaces, 20+3 pages, aliases and the unprepared negative control. Separate passwordless native owners preserve membership uniqueness without unused OAuth clients or MFA setup.
- Shared buttons no longer interpolate foreground and surface colors when their variant changes. The real rendered dark/RTL component reproduced the low-contrast crossover before the change and had none afterward; the unchanged narrow-dark-RTL MFA journey passed.
- Keyboard sign-in passed the diagnostic and full uninstrumented browser runs without an authentication change; its earlier failure cause is not established. The privacy collector captures real auth/server-function headers and body bytes before delivering the unchanged response, so automatic navigation cannot invalidate those reads. Document/console captures retain explicit navigation barriers, and every observed non-navigation auth request must have a captured response. A diagnostic run identified a 200 auth/server-function body unavailable after navigation; the attempted navigation gate was removed after timing out. Every privacy assertion remains; the earlier failed invocation was not causally attributed.

The final full Workers run preceded the full browser run. No timeout or assertion
was relaxed, and all temporary diagnostics were removed. These local checks do
not authorize deployment. At that repair checkpoint, T003 approvals, T008 onward
and hosted acceptance remained open; the later T008 results follow below. No retained-store migration or remote operation was run.


## Guarded operation verification (T008)

Shared guarded commits and read-only operation recovery are implemented. This is
not completion of the account/workspace HTTP or UI journeys.

| Check | Observed result |
|---|---|
| Focused operation and relocated access tests | 79 passed; 3 files, including all 52 operation cases |
| Full `bun run test` after guard restoration | 2,318 passed; 121 files |
| Full `bun run test:cli` after the source-copy repair | 72 passed; 7 files |
| Full isolated `bun run test:e2e` after the repair | 234 passed |
| `bun run typecheck` | All workspaces and both test projects passed |
| Affected test-project typechecks after the repair | `typecheck:e2e` and `typecheck:tests` passed |
| Actual API smoke against disposable native D1 | New-target audit, lost-reply recovery, explicit replay, changed-intent refusal and logged-out denial passed |
| Deliberate AND-to-OR guard mutation | The false-business-guard case failed; the exact correct guard was restored before the full passing suite |

The native smoke used real Better Auth login/MFA and the shared operation APIs.
It created an account after its audit claim, preserved one effective rename
through a lost reply and replay, and retained the original audit attribution.
These SQL consumers exercise T008, not the queued product account actions.

Referential integrity was also checked outside Vitest. An on-only deferred-FK
batch rejected an invalid final reference and rolled back both writes. The
actual management helper independently rolled back its invalid audit and earlier
business update, left no FK violations, and accepted the next guarded write.
The invalid-FK Vitest case emitted a workerd input-gate diagnostic; that green
test alone is not the rollback evidence. Early explicit deferral-off retained
invalid data in its disposable probe, so it is not used. Native warnings were
not suppressed.

The first inline Node smoke invocation encountered a module-loader error. The
unchanged reviewed program passed from a temporary file, which was removed;
the interrupted invocation's private state was also removed. The first browser
attempt stopped before app startup because Git's cached file list included
removed tracked paths. The wrapper now filters Git's explicit deletion set and
has a real temporary-repository regression covering new source, NUL-delimited
names, symlinks and ignored secrets. It does not stage files or alter the user's
index. The full browser run then passed without changing timeouts or assertions.

Worker and full browser suites ran sequentially. Temporary probe source/state
was removed. No retained-store upgrade, remote action, dependency, runtime or
deployment-configuration change was made. At this checkpoint, T003 approvals,
the T009 HTTP lookup, later story implementations and hosted acceptance remained
open. The T009 results follow below.


## Operation-status HTTP verification (T009)

The read-only status server function is implemented behind the existing native
master/request protections. This is not the account create/list/rename journey.

| Check | Observed result |
|---|---|
| Focused HTTP, shared operation and migration tests | 98 passed; 3 files, including 56 operation and 13 HTTP cases |
| `bun run typecheck` | All workspaces and both test projects passed |
| `CLOUDFLARE_ENV=local bun run build:hub` | Production-mode Hub build passed against the existing local configuration |
| Built Worker HTTP smoke | Real native MFA recorded/absent reads passed; holder, stale actor, invalid input, GET, wrong Origin and signed-out requests were refused |
| Full `bun run test` | 2,335 passed; 122 files |
| Full `bun run test:cli` | 72 passed; 7 files |
| Full isolated `bun run test:e2e` | 234 passed |

The standalone function module is explicitly imported by the Hub router. The
actual production resolver contains `getManagementOperation_createServerFn_handler`;
the smoke dispatched serialized requests through that built Worker and its asset
router, not a dev-only lazy import or a direct source call. It used disposable
native D1, real login/MFA, and denied outbound traffic. Business and audit rows
were unchanged. Native auth may independently remove an expired session.

The HTTP tests additionally cover live revocation between cached authorization
and the audit read, another enrolled master recovering an original receipt,
expired/stale sessions, corrupt stored receipts and safe terminal-storage errors.
The error paths produce one structured report without leaking stored details.

The direct status service now validates its UUID independently of the HTTP
checks. A preparation refusal also re-reads current authority and the immutable
operation: a same-key concurrent commit returns its original receipt, not a false
conflict. New native regressions first reproduced three assertion failures
(same-intent receipt, revoked-authority precedence and malformed operation ID);
all passed after the approved fixes. A standalone actual-helper/D1 smoke recovered
the overlapping receipt with one effective write and original audit attribution.

The first full Workers attempt passed 2,330 cases but exceeded the existing
5-second deadline in the exhausted-factor recovery scenario; the command chain
stopped before CLI/browser checks. An approved test-only fixture now arranges the
first nine native code consumptions in an isolated `beforeEach`; each affected
test still exercises the final-code transition and its existing recovery checks.
All ten real consumptions remain, with no factor seeding, auth mock or timeout
change. The 17 affected tests and an outside-Vitest native-D1 probe passed; that
probe observed exactly one code, consumed it, and refused reuse without issuing a
cookie. This separates fixture arrangement from the behavior assertion, not a
claim that the complete native workflow became faster.

The next default run exposed four existing deadline failures in timestamp and
logout scenarios. The bounded diagnostic passed all 2,331 then-current Workers
cases, 72 CLI cases and 234 browser checks. The approved Vitest default now uses
`Math.min(4, availableParallelism())`; only test-worker contention is bounded, not
the deadlines or case set. See [Vitest maxWorkers](https://vitest.dev/config/maxworkers).
The timestamp case retains every rejection and complete before/after state checks
while removing repeated whole-store reads:

| Timestamp rejection check | Before | After |
|---|---:|---:|
| Rejected writes asserted | 64 | 64 |
| Whole-state table SELECTs | 1,536 | 24 |

The final table above records the unchanged root commands after all amendments,
not merely that earlier invocation-only diagnostic.

Initial disposable-harness failures identified missing compiled chunks and the
asset-router user-worker flag; only probe metadata changed to load the actual
bundle correctly. Every probe disposed its private runtime/storage. Workers, CLI
and browser regressions ran sequentially; no timeout, assertion or runtime warning
was suppressed. No retained-store upgrade, remote action, dependency, runtime or
deployment-configuration change was made. At this T009 checkpoint, T010–T016
account development was next. The account results follow below; T003 provisioning
approvals and hosted acceptance remain open.


## Account management verification (T010-T016)

Loading feedback uses route-specific table, holder-choice/form and detail/rename
placeholders. The active read, paging, clear, retry, save, status or refresh action
shows a disabled spinner; full-document search clears its pending state on native
`pageshow`.

The account-only increment is implemented: native master list/search/detail,
create and rename, with real account screens and existing login/MFA recovery.
Workspace creation, ownership handover and lifecycle controls are not included.

Account and login directory searches share the package-private literal-prefix
range helper, including the named Unicode and surrogate-gap bounds. Existing
native boundary and index-plan coverage is retained.

| Check | Observed result |
|---|---|
| `bun run typecheck` | Every workspace and both Workers/browser test projects passed |
| Focused native account, HTTP, page admission and shared-operation checks | 200 passed; 4 files |
| Isolated account browser scenarios through the existing wrapper/UI | 15 passed, including real sign-in/MFA and interrupted-session return |
| Standalone native D1/MFA SDK journey | Create/list/search/detail/rename, replay, stale/changed intent, access refusal and unchanged memberships/roles passed |
| Actual built Hub Worker HTTP | All five registered account functions and operation lookup passed using the production bundle, real native MFA and disposable D1 |
| Actual screen and storage readback | Keyboard validation/selection/create/rename and search found the same account; one account at revision 1, two original-actor audits, no member/role/workspace grant |
| Layouts | Actual desktop/tablet/phone screens inspected in light and dark; expanded narrow RTL scenarios and semantic/keyboard checks passed |
| `bun run build:all` | Web, Hub and router built locally without publication |
| Full `bun run test` | 2,437 passed; 124 files |
| Full `bun run test:cli` | 72 passed; 7 files |
| Full isolated `bun run test:e2e` | 249 passed |

### US1 scenario evidence

| Required scenario | Exercised behavior |
|---|---|
| Create | Real native saves and HTTP/UI create one labelled account for an active eligible holder, including an incomplete personal profile. Existing membership is preserved; neither the holder nor the acting master gains membership or a global role. |
| Refuse conflicts | Native duplicate/concurrent holder, unavailable login, stale revision/authority, changed-key intent and guarded-batch failures preserve unrelated state; browser coverage preserves drafts and refuses changed actors and ordinary tenant roles. |
| Find and rename | Native literal-prefix, bounded 25/100 paging, stable newest-first order and retained-null details are covered. Real browser search and rename preserve identity/holder; native linked-workspace fixtures verify unchanged organization, address, client and allocation. |

Account recording and workspace creation have distinct eligibility boundaries.
Recording an account changes no membership and accepts an existing member;
workspace creation must refuse a holder in another workspace, not move them.
Account labels may repeat and suspended accounts may be renamed.

Uncertain submissions retain their exact original actor, normalized intent and
operation key. Receipt lookup is read-only; a missing receipt permits only an
explicit same-key retry. A confirmed receipt with a failed refresh remains saved
and offers refresh, not another write. The browser checks exercised those paths
through actual completed requests, native sign-out and same-actor reauthentication.
Fresh detail reads rebase clean form names and preserve genuine edits; the stale-
refresh browser journey distinguishes both and checks that matching the newly read
server name clears leave protection.

Normal fixture accounts now use the real guarded `createAccount` save and audit.
Empty-directory coverage starts with an identity-only fixture rather than deleting
saved records. Retained-null labels and pre-existing allocation links are narrowly
named fixture state; allocation setup upgrades at T020 and suspension setup at
T049. Native identities, MFA, queries and batches remain real.

The first focused run passed 199/200 checks. A standalone native trace showed that
the reply-loss hook interrupted a 24-query auth schema-introspection batch before
any account commit. The repaired hold/loss seams target the actual guarded save
batch; they do not replace auth or business results. Kysely now composes the native
EXPLAIN statement without copying readonly parameters; one unused browser binding
and an incidental parameter-count assertion were removed. No behavior case or
deadline was relaxed.

The post-commit native sign-out case passed alone with no uncaught runtime error.
The separate deliberately missing-final-audit-reference case reproduces the
existing workerd `broken.inputGateBroken` diagnostic while its assertions pass.
The independent actual-helper rollback proof remains documented in the
[T008 checkpoint](#guarded-operation-verification-t008); this diagnostic was not
suppressed or attributed to sign-out. Existing source-map/dispatcher/tooling
warnings remain visible.

Use the configured root `bun run build:all`; the Hub-only `CLOUDFLARE_ENV=local`
flag cannot be applied to Web, which has no named local environment. Full build,
Workers, CLI and browser checks ran sequentially. Probe runtimes and isolated
browser copies were disposed. No retained-store upgrade, remote action, dependency,
production runtime/deployment configuration or Worker identity changed. T003
configuration/hosted approvals, T017 onward and final cross-story acceptance remain
open. The next increment is workspace creation; T022-T025 retain their T003 gates.
