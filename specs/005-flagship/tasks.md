# Tasks: Flagship controls

## Scope and sequence

- **Status:** T057–T063 are complete. The
  [local checkpoint](quickstart.md#local-verification-t061) and
  [hosted checkpoint](../004-cloudflare-test/quickstart.md#hosted-verification-t063)
  record the evidence and its limits. T064 remains open for the separate
  production-readiness and release review.
- **Numbering:** continue after T056 in the
  [Master MFA task list](../002-master-mfa/tasks.md). The F01–F16 references in the
  plan describe use cases; they are not another sixteen implementation tasks.
- **Inputs:** follow the [approved Flagship plan](plan.md), its code anchors,
  acceptance checks and operating rules. Keep the existing
  [release hold](../001-sign-in-and-accounts/checklists/release-review.md).
- **First delivery:** implement accounts_picture_policy for personal profile
  uploads. Use trusted login IDs, paused fallback and the existing 2 MB ceiling.
  Add the remaining mapped controls with their approved consuming features.
- **Approval:** review this document one section at a time. Scope approval sets
  the order; it does not approve the later task details, source diffs, resource
  creation, deployment or live activation. Report each task checkpoint and wait
  for the user's go-ahead before beginning the next task.
- **Candidate:** prepare and verify T057–T060 in an isolated source copy. Keep
  their changes together for final local checks and the complete exact diff in
  T061. These intermediate checkpoints do not mean the feature is applied to
  the working project or ready for deployment.
- **Existing setup:** retain the installed dependencies, runtime, Worker names,
  compatibility settings, Vite setup, storage and save rules. Add no SDK,
  generic feature framework, database migration or administration screen.
- **Clean-up:** remove owned temporary source copies, fixtures, logs and
  processes after verification. Retain intentional review artifacts and useful
  evidence; preserve private data, certificates and unrelated changes.

| Task | Delivery | Completion check |
| --- | --- | --- |
| T057 | Prepare local binding and fixtures. | Native local evaluation, generated types and isolated stores work on installed tooling. |
| T058 | Add the validated policy and Hub reader. | Bounds, defaults, targeting, failure privacy and request isolation pass permanent tests. |
| T059 | Enforce the policy on picture uploads. | Real handlers reject paused or oversized uploads before unsafe work; access and storage rules remain intact. |
| T060 | Update the profile response and picture screen. | Standard, paused and reduced-limit behavior agrees with server enforcement and passes browser checks. |
| T061 | Complete local verification, documentation and source review. | Required checks pass, the complete exact diff is approved and applied, and Graphify reflects applied source. |
| T062 | Prepare the hosted test resources and binding. | The target, account terms, permissions and real IDs are verified; only approved resources and configuration are created or applied. |
| T063 | Deploy and verify the hosted test control. | The approved test target demonstrates targeting, value changes, pause, limits and fallback behavior. |
| T064 | Review live readiness and release. | Hosted evidence and existing release gates support a separate approved live configuration and activation decision. |

## Local implementation: T057–T061

- **Before each task:** read the applicable conventions and trace every affected
  caller. Retrieve current official platform/library documentation through
  Context7 and compare it with installed packages, schema and generated types.
  Reuse native capabilities and existing helpers before writing custom code.
- **Tests with changes:** add meaningful behavior assertions before the logic
  they protect and make them pass within the task when its prerequisites exist.
  Identify later-task dependencies honestly; use no skips or substitute auth.
  Test through real identity, access, database and picture flows. Only outside
  services may have explicit typed stand-ins for controlled failure cases.

- [x] T057 Prepare local Flagship wiring and deterministic fixtures in the isolated candidate.

  - **Files:** propose FLAGS in apps/hub/wrangler.jsonc's local environment and
    tests/wrangler.jsonc with separate local-only app identifiers and remote
    evaluation disabled. Regenerate Hub/test binding declarations through the
    existing scripts; retain the narrow cross-app entrypoint projection.
  - **Fixtures:** extend tests/e2e/seed.ts and its guarded wrapper only as needed.
    Finish and dispose identity provisioning before seeding the matching Hub
    persistence store. Verify the installed CLI's persistence-root mapping and
    seed flags before dev servers start. Use fabricated standard, paused and
    reduced-limit login audiences; specific rules precede the standard rule and
    the configured default remains paused. Never pull remote flags.
  - **Done when:** the native local binding returns the expected configured
    values and missing/disabled fallback, generated types compile, test and
    browser stores stay separate, and seeding starts no remote work. Preserve
    meaningful wiring assertions and record verified seed commands for T061.

- [x] T058 Add the Accounts policy contract and Hub policy reader with permanent tests.

  - **Files:** add packages/accounts/src/picture/policy.ts and
    apps/hub/src/functions/picture-policy.server.ts, with focused behavior tests;
    export the plain contract through packages/accounts/src/index.ts.
  - **Behavior:** validate canUpload and maximumBytes with the approved library.
    Ignore unrelated fields; reject arrays, missing/unsafe values, non-integers
    and limits outside 1–2,097,152 bytes. Use the native getObjectValue method,
    paused fallback and authenticated login ID in targetingKey. Keep request
    context in arguments and add no cache, membership query or extra Hub call.
  - **Done when:** valid policies, missing/disabled flags, absent binding,
    malformed configuration and rejected evaluations give the approved result.
    Invalid values and unexpected failures use the existing four-field reporter
    without provider text or targeting data. Interleaved calls stay independent.
    Distinguish native-binding evidence from simulated outside-service failures.

- [x] T059 Enforce the policy through the existing upload flow and its permanent suites.

  - **Files:** update packages/accounts/src/picture/picture.server.ts,
    apps/hub/src/server.ts and the existing picture/picture-input server modules
    and tests. Trace and update every affected upload caller and test helper.
  - **Behavior:** complete existing origin, session, mounted-login, status,
    MFA/profile and access checks before evaluating once per upload. Reject a
    pause before consuming multipart input or calling Images/R2, using HTTP 503
    and accounts_picture_uploads_unavailable, no-store and the request ID.
  - **Limits:** retain the absolute multipart read bound and enforce the current
    file limit again at the Accounts operation boundary. Preserve image-format
    checks, processing/output limits, guarded storage, cleanup and audit rules.
    Picture reads and removal do not evaluate or depend on the policy.
  - **Done when:** normal uploads work; stale/direct paused requests and files
    above a reduced limit are refused without picture-key/object changes.
    Permissive flags bypass no access check. Permanent tests cover those paths,
    the hard ceiling, body bounds, failure privacy and unaffected removal/reads.

- [x] T060 Update the existing profile contract and picture screen, with matching checks.

  - **Files:** update the Hub profile-page server/functions modules,
    apps/hub/src/features/profile/profile.ts, profile.data.ts and
    picture-editor.tsx, existing Hub translations and tests/e2e/profile.spec.ts.
    Update additional real callers found while tracing the profile response.
  - **Behavior:** evaluate once after the required page access checks and return
    only effective upload availability and size alongside the private response.
    Older responses default to paused. Keep the current picture and removal
    usable; disable selection/upload while paused and show a clear notice.
  - **Screens:** format the effective limit with existing translation tools.
    Check both selected and cropped files. Treat upload refusals as picture
    messages, preserve other drafts, and reuse existing refresh behavior.
    Retain busy/hydration guards, labels, keyboard access and error focus.
  - **Done when:** real seeded browser checks cover standard, paused and reduced
    policies, removal, direct/stale refusals, accessible controls and unchanged
    profile/access flows. The server enforces every limit the screen displays.

- [x] T061 Verify, review and apply the complete local candidate after approval.

  - **Documentation:** propose docs/adr/046-native-feature-controls.md for policy
    ownership, native evaluation, defaults and rejected SDK/framework options.
    Update the existing quickstart and release evidence with verified seeding,
    local results, operation/retirement steps and remaining hosted limits.
    Preserve the plan's future-use prerequisites and the current release hold.
  - **Checks:** run bun run test, bun run typecheck, bun run build:all and browser
    checks only through bun run test:e2e. Temporarily break one new enforcement
    expectation in the candidate, confirm its permanent test fails, restore the
    exact source and complete final passing verification.
  - **Review:** remove unnecessary code, simplify the implementation and confirm
    the approved plan's acceptance requirements have evidence. Present the
    complete tested source/config/test/documentation diff for approval before
    applying it to original project files. Check approved content and relevant
    validation again after application; retain precise evidence and limitations.
  - **Done when:** only approved changes are applied, required local checks pass,
    Graphify is refreshed and verified against the applied code/documentation,
    and owned temporary files, storage, logs and processes are removed. Local
    completion alone approves no hosted deployment or live activation.

## Hosted test preparation: T062

- [x] T062 Prepare the hosted test Flagship app and the Hub test binding.

  - **Target:** use the verified Cloudflare account and propose the Hub address
    https://xpro-hub-test.karanshergill.workers.dev. Use a separate Flagship app
    named xpro-hub-test. A custom domain is not needed for this test.
  - **Dependency:** follow the approved [Cloudflare test plan](../004-cloudflare-test/plan.md)
    and the verified [test resources](../004-cloudflare-test/resources.json).
    Apply only the reviewed test configuration. Hosted private setup, deployment
    and native-flow acceptance remain separately reviewed T063 work.
  - **Preflight:** recheck resource names, Flagship availability and the required
    Flagship Write permission. Confirm current account terms, pricing and any
    needed subscription with the owner before resource creation. Read access or
    an empty dispatch list does not prove write access or paid entitlement.
  - **Resources:** after approval of the exact remote actions, create the test
    app and accounts_picture_policy as a disabled JSON flag. Use paused as its
    default with canUpload false and maximumBytes 2097152; standard uses true
    and 2097152; reduced uses true and 1048576. Add no audience rules or live app.
    Inspect the complete saved definition and record the actual app ID.
  - **Binding:** prepare FLAGS only in apps/hub/wrangler.jsonc's named test
    environment using that real app ID and the complete approved test bindings.
    Preserve local/offline fixtures, defaults, package versions and runtime.
    Review the exact configuration diff before applying original-file changes;
    disable automatic configuration edits during resource creation.
  - **Checks:** regenerate the existing binding types and typecheck. Select test
    with CLOUDFLARE_ENV when building the Vite Hub and inspect the resulting
    configuration and local deployment dry run. Confirm the intended account,
    Worker and resource IDs; keep all new test artifacts isolated and remove
    them after checks. These checks do not establish hosted runtime acceptance.
  - **Done when:** approved test resources exist, the saved definition is
    disabled with the reviewed default, the approved Hub test binding is applied,
    relevant local checks pass and Graphify reflects the approved documentation
    and configuration. Record evidence and remaining prerequisites. Deployment
    and pilot enablement stay in T063; live readiness and release stay in T064.

  - **Evidence:** [test preparation](../004-cloudflare-test/quickstart.md) records
    the isolated candidate checks and remaining hosted prerequisites. The real
    app and disabled policy were read back; standard types, selected Vite test
    builds and three local packaging dry runs passed on 2026-11-03.

## Hosted setup and verification: T063

- [x] T063 Prepare, deploy and verify the hosted test environment and picture control.

  - **Target:** use the existing account and confirmed Workers for Platforms
    plan, the [approved test plan](../004-cloudflare-test/plan.md) and
    [recorded resource IDs](../004-cloudflare-test/resources.json).
    Recheck names, bindings, permissions and service usage before execution.
    The original pre-deployment checks found an empty database and dispatch
    namespace, no deployments and a disabled/paused flag. The completed
    [hosted checkpoint](../004-cloudflare-test/quickstart.md#hosted-verification-t063)
    records the initialized, deployed and verified test state.
  - **Delivery order:** prepare the private command, its tests and the test-only
    logging configuration in an isolated copy. Present the exact source diff,
    then the exact remote actions for approval. Apply and verify one approved
    step at a time; this planning approval performs no remote writes.
  - **Private command:** add a test-only Bun setup command with separate prepare
    and publish-placement steps. Use Wrangler's public `getPlatformProxy` with
    a temporary configuration containing only the recorded test D1 binding,
    `remote: true`, the fixed account, `remoteBindings: true` and
    `persist: false`. Refuse other
    accounts, database IDs or origins. Dispose the proxy and remove its temporary
    files. Keep the existing local setup and application bindings separate.
  - **Database and first master:** before deploying the Hub, run the registered
    Kysely migrations and reuse `createInitialMaster` with privately supplied
    credentials and the same Hub secret that will be deployed. Preserve the
    accepted serial setup limits and repeat refusal; stop for operator review
    after failure without repairing or changing an existing login.
  - **Prepared workspace:** prepare one fabricated organization through the
    existing Kysely database and save helper, with no master membership or tenant
    Account ownership. The native Organization creation API adds its creator as
    owner, which is unsuitable for this xpro master. Test the migrated schema and
    constraints. Save workspace metadata with its audit in one batch; do the same
    for later placement publication. Keep native authentication/client operations
    outside those batches. Publish the address only after the deployed app is ready.
  - **Native sign-in client:** authenticate the master privately through the
    existing native API and register one client using `adminCreateOAuthClient`.
    Use authorization code, confidential client authentication, S256 PKCE,
    `openid profile email`, trusted consent skipping and end-session support.
    Register only the router's exact `/auth/callback` and
    `/auth/back-channel-sign-out` URLs from the test quickstart.
    End the private setup session; complete normal profile/MFA through the hosted
    screens later. Create non-master test logins through the actual Hub flow.
  - **Private values:** keep operator input and generated secrets in an ignored
    `.cloudflare-test.local/` directory with restricted permissions, outside app
    development-variable files. Produce separate Hub/workspace secret files for
    deployment. Keep credentials, cookies, MFA secrets and client secrets out of
    command arguments, logs, diffs and evidence. Record only safe IDs and outcomes.
  - **Turnstile and Images:** prepare one managed `xpro-hub-test` widget for
    `xpro-hub-test.karanshergill.workers.dev`, with no pre-clearance. The existing
    widget does not cover this host. Use the native Images binding and private R2;
    check account usage against the published transformation allowance before
    testing. Any new paid activation or extra write access needs explicit approval.
  - **Test diagnostics:** propose native Logs, Traces and Issues only in the test
    environments, with sampling 1 for the small test run and
    `observability.redact_query_string: true`. The installed Wrangler supports
    these fields. Before real sign-in, use synthetic query/header/body markers to
    verify collector privacy and record actual retention and usage terms.
    Stop on unexpected credential-bearing metadata.
  - **Test alert:** prepare a native issue notification and an automation scoped
    to `service: xpro-hub-test`, using the owner's approved recipient. The account
    exposes the native issue alert type. Review the required notification and
    observability write access, or use the authenticated dashboard. Approve the
    exact rule and test message before sending; add no alerting service or SDK.
  - **Local checks:** run the relevant permanent setup/security tests, the standard
    type-generation/typecheck workflow, both Vite test builds and three packaging
    dry runs. Check fixed target refusal, repeats, native credentials/client
    behavior, absence of master membership, deferred placement and secret privacy.
    Preserve versions, compatibility settings, Vite configuration and `xpro`.
  - **Deployment:** after private preparation and approval, build with
    `CLOUDFLARE_ENV=test` and inspect the generated configurations. Deploy the
    initialized Hub first, the private workspace Worker second and the router
    last, supplying the reviewed secret files with the deployments:

    ```bash
    bun x --no-install wrangler deploy --config apps/hub/dist/server/wrangler.json --secrets-file .cloudflare-test.local/hub.json
    bun x --no-install wrangler deploy --config apps/web/dist/server/wrangler.json --dispatch-namespace xpro-workspaces-test --secrets-file .cloudflare-test.local/workspace.json
    bun x --no-install wrangler deploy --config apps/router/wrangler.jsonc --env test
    ```

    Verify returned version/deployment IDs, service entrypoints, storage bindings,
    secret names and the workspace's own SQLite namespace. Keep workspace direct
    and preview URLs disabled. Publish the single reviewed router placement only
    after these checks; begin interactive use after the setup sequence finishes.
  - **Hosted journeys:** use fabricated test data to verify native sign-in,
    profile completion, master MFA, real router dispatch, Hub-driven workspace
    user creation, session revocation and private picture access. Keep public
    sign-up blocked. Do not run the disposable local browser seeder remotely.
  - **Picture controls:** prove disabled/paused behavior, a standard policy for
    one trusted pilot login and paused behavior for a non-pilot, the 2 MiB and
    1 MiB limits, and server enforcement after a previously loaded screen.
    Temporarily serve an invalid JSON policy to the pilot to verify paused
    fallback, the existing four-field error event, native Issue detection and
    approved alert delivery. Allow documented propagation time before assertions.
  - **Failure and cleanup:** stop on a failed setup, deployment or privacy check
    and report completed actions without blind retries or destructive cleanup.
    Review the stop/rollback actions with the deployment proposal. Restore the
    exact disabled/paused flag and remove audience rules after testing.
    Remove owned temporary fixtures, logs, copies and processes; retain and record
    intentional test resources/data and protected operator files.
  - **Done when:** the exact approved changes are applied, real hosted journeys
    and picture-control checks pass, privacy/retention/alert evidence is recorded,
    and Graphify reflects the applied source and documentation. Record provider
    limits honestly; local checks do not prove hosted behavior. Keep T064 and the
    production release hold separate.
  - **Sources:** use the installed Better Auth 1.7.12 and Wrangler 4.136.2 contracts
    alongside the current official documentation:
    [platform proxy](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy),
    [native organization creation](https://better-auth.com/docs/plugins/organization),
    [native OAuth administration](https://better-auth.com/docs/plugins/oauth-provider),
    [query redaction](https://developers.cloudflare.com/workers/wrangler/configuration/#observability),
    [native Issues](https://developers.cloudflare.com/workers/observability/issues/),
    [issue automations](https://developers.cloudflare.com/workers/observability/issues/automations/),
    [Images usage](https://developers.cloudflare.com/images/pricing/)
    and [Workers Logs terms](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

  - **Evidence:** the declared hosted journeys, picture controls, collector privacy
    and one approved automatic alert passed on 2026-11-05. The owner confirmed
    email receipt. The flag was restored and temporary alert resources removed;
    the [checkpoint](../004-cloudflare-test/quickstart.md#hosted-verification-t063)
    records the exact test scope, deployment references and private receipt paths.

## Live-readiness review: T064

- [ ] T064 Review live readiness and release.

  - **Input:** use the completed
    [T063 checkpoint](../004-cloudflare-test/quickstart.md#hosted-verification-t063)
    and the existing [release review](../001-sign-in-and-accounts/checklists/release-review.md).
  - **Next:** prepare and review the remaining production gates one step at a
    time. Production configuration, deployment, activation and first-client
    onboarding require their own exact approvals.
  - **Shared release command:** the first item supplies a required named test
    target, a non-deploying three-app preview, native configuration/resource
    checks and guarded Hub/workspace/router publication with private partial
    receipts. The [runbook](../../docs/RELEASING.md) and
    [ADR-049](../../docs/adr/049-shared-test-release-command.md) record the contract.
    CLI tests and native test packaging pass locally, including the corrected
    environment handling and native dry-run target guard. The
    [corrected controlled publication](../../docs/RELEASING.md#t064-corrected-test-publication-2026-11-05)
    passed in Hub/private workspace/router order, with native/provider version
    matches, preserved bindings/storage and scoped smoke checks. The unintended
    suffixed Worker was removed through reviewed cleanup. CI use and production
    configuration/readiness remain outstanding; R06 stays partial and T064 open.
  - **Manual CI preparation:** a reviewed-source proposal adds a GitHub Actions
    workflow with preview as the default, audit/type/CLI/Workers checks and the
    same native three-app release command. A separate `main` publication job uses
    a protected `cloudflare-test` environment, owner-only prepared inputs and
    safe-receipt retention. Local checks pass; environment protection/secrets,
    the reviewed commit/push and first hosted preview/publication remain pending.
    This does not complete R06 or T064. See the
    [CI setup](../../docs/RELEASING.md#manual-github-actions-workflow).
