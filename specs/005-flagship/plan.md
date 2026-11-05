# Flagship controls

## Scope

- **Purpose:** use Flagship for gradual releases, feature availability and small
  operational settings across xpro.
- **Coverage:** map all 16 identified uses to their consumer, prerequisites and
  acceptance checks. Add controls when their consuming feature is ready.
- **First delivery:** control new Hub profile-picture uploads: allow or pause
  uploads and lower the maximum file size within the existing 2 MB ceiling.
  Select pilot logins using their authenticated login IDs.
- **Failure behavior:** an unavailable or invalid picture policy pauses new
  uploads. Existing pictures remain viewable and removable; other profile,
  password, sign-in and MFA operations remain usable.
- **Integration:** use the native Workers binding and installed tooling. Manage
  controls through Cloudflare's dashboard and CLI. Add no SDK dependency,
  generic flag framework or new administration screen.
- **Authority:** existing login, MFA, membership and workspace permission checks
  determine access. Flags may restrict feature availability but never grant
  identity, membership or business permissions.
- **Later deliveries:** add workspace, module, subscription, settings, job,
  integration, experiment, Portal, launch and diagnostic controls with their
  owning features, following the use-case map below.
- **Delivery boundary:** verify locally first, then on the separately approved
  Cloudflare test target. Review live activation and remaining release gates
  separately. Scope approval does not approve the later implementation sections.

## Initial policy and behavior

- **Policy key:** use accounts_picture_policy for a JSON value containing
  canUpload and maximumBytes. Keep this key stable once deployed.
- **Availability:** canUpload is a boolean. The policy grants no identity or
  storage authority; all existing server access checks still apply.
- **File size:** maximumBytes is a finite integer from 1 through 2,097,152 bytes.
  The upper bound comes from maximumPictureBytes in the existing Accounts module.
  Remote configuration cannot raise that bound.
- **Validation:** check the JSON shape and the two fields with the already
  approved validation library. Ignore unrelated fields to allow additive future
  configuration. Reject arrays, missing fields and unsafe values as invalid
  policy; use the paused fallback.
- **Variants:** define paused as uploads disallowed with the existing size
  ceiling, and standard as uploads allowed with that ceiling. Use a reduced
  variant when verifying a lower limit. All variants remain JSON values.
- **Defaults:** make paused both the configured default variant and the code
  fallback. An enabled rule serves standard to the intended audience. Disabling
  the flag therefore pauses new uploads.
- **Targeting:** the first Hub control buckets by the authenticated login ID in
  targetingKey. Do not add a membership query to obtain a workspace ID for this
  global profile operation. Use no email, phone, cookie, token or request ID as
  targeting data.
- **Page reads:** return only the effective upload availability and size limit
  alongside the existing private profile response. A paused policy must not stop
  the rest of the profile page from rendering.
- **Uploads:** validate origin, session, mounted identity and existing access
  requirements first. Then read the policy once before consuming the multipart
  body or calling Images or R2. Reject a paused upload with HTTP 503 and
  accounts_picture_uploads_unavailable.
- **Error message:** explain that picture uploads are temporarily unavailable and
  that the current picture can still be removed. Use the existing request-ID and
  no-store response conventions; set no authentication cookie.
- **Size enforcement:** retain an absolute bound while reading the body, including
  the existing multipart allowance. Enforce the effective file limit again at
  the Accounts operation boundary. Preserve format checks, image processing,
  output bounds and guarded R2/D1 storage behavior.
- **Stale clients:** enforce the current policy on every upload even if an older
  page still shows an enabled upload control or a previous limit.
- **Other operations:** picture reads and removals do not depend on this policy.
  A pause does not undo an upload already committed or guarantee cancellation of
  processing that started under an earlier decision.
- **Known failures:** missing flags, wrong value types and invalid configuration
  use paused. A missing optional binding also means this integration is off.
  Target deployment checks must detect a missing binding before declaring the
  feature available.
- **Unexpected failures:** report a rejected evaluation or invalid configuration
  through the existing four-field reporter with a fixed operation label, then
  use paused for this optional control. Never log flag values, targeting context
  or provider error text. Do not fail the whole profile page.
- **Propagation:** allow for the documented update window of up to 30 seconds.
  This control is an operational pause, not an immediate security revocation.

## Runtime and environment wiring

- **Consumer ownership:** keep a small policy reader in the Hub. Put the plain
  policy type, bounds and validation with Accounts picture behavior. Core does
  not need a generic feature service.
- **Platform boundary:** only the Hub server reader accesses Flagship. Accounts
  operations receive a validated plain policy, and browser code receives safe
  display values. Evaluate outside database save transactions.
- **Request lifetime:** reuse one evaluation within each relevant page or upload
  request. Keep targeting context in arguments rather than shared variables.
  Add no browser polling, application result cache or extra Hub HTTP request.
- **Local binding:** add FLAGS only to the Hub's local environment, with an
  explicitly local app identifier and remote evaluation disabled. Use a separate
  local identifier and binding for permanent Workers tests.
- **Generated types:** regenerate the existing Hub and test binding types.
  Preserve the existing narrow entrypoint environment projection for cross-app
  compilation; derive the capability from the existing platform types.
- **Existing setup:** preserve Worker names, compatibility dates, runtime flags,
  package versions, Vite settings, storage names, migrations and save rules.
- **Local flags:** seed the same persistence directory the Hub Vite server uses.
  The current fixture setup locates Hub data under apps/hub/.wrangler/state/v3;
  verify the CLI persistence-root mapping before writing the seed instructions.
- **Seeding order:** finish identity fixtures and dispose their platform proxy,
  then seed flags before starting dev servers. Installed Wrangler blocks local
  Flagship commands while the matching dev session is registered.
- **Browser fixtures:** seed a standard audience plus dedicated paused and
  reduced-limit fixture logins in the isolated browser copy. Specific audience
  rules precede the standard rule. The default remains paused.
- **Isolation:** browser fixtures and local test stores use fabricated data and
  never pull live flags. Every test store, log and owned process is removed by
  the existing isolated wrapper.
- **Remote environments:** use separate test and live Flagship apps. Bind each
  explicitly in its approved named environment; Flagship bindings are not
  inherited automatically. Verify the real IDs rather than deploying local IDs
  or placeholders.
- **Hosted dependency:** coordinate the test binding with the proposed Cloudflare
  test setup. Do not silently apply that pending plan, activate a paid service,
  create remote resources or deploy as part of this planning work.
- **Account terms:** verify beta availability, pricing and the actual account's
  permissions before the approved remote-resource step. A custom domain is not
  a Flagship prerequisite.

## Screen and interface changes

- **Profile contract:** add effective picture-upload availability and maximum
  bytes to the existing profile response and its client validation. Older
  responses without these additions resolve to the paused display state.
- **Paused screen:** keep the current picture and Remove control available.
  Explain the pause and disable new selection and upload actions. Other profile
  forms retain their current state and access behavior.
- **Size messages:** show the effective limit using the existing translation and
  number-formatting tools. Check selection and the actual file sent after crop;
  the server remains authoritative.
- **Refusals:** treat the new unavailable outcome as a picture-operation message,
  not as loss of account access. Preserve other form drafts and show the request
  ID where supplied.
- **Accessibility:** retain hydration and busy guards, keyboard access, visible
  labels, error focus, narrow-screen behavior and current private/no-store rules.
- **Refresh:** reuse the profile's existing refresh behavior. Add no new endpoint,
  client provider, cross-page flag store or automatic retry of a refused upload.

## Files and implementation order

- **New policy files:** propose packages/accounts/src/picture/policy.ts and
  apps/hub/src/functions/picture-policy.server.ts, with behavior tests beside the
  server reader or in the existing picture suites.
- **Accounts changes:** update packages/accounts/src/index.ts and
  packages/accounts/src/picture/picture.server.ts to expose the policy contract
  and enforce it through the existing upload operation.
- **Hub changes:** update apps/hub/src/server.ts and the picture, picture-input,
  profile-page and profile-page.functions files in apps/hub/src/functions/.
  Trace all callers before changing their service contracts.
- **Screen changes:** update profile.ts, profile.data.ts and picture-editor.tsx in
  apps/hub/src/features/profile/, plus the existing Hub translation files.
- **Configuration:** review exact diffs for apps/hub/wrangler.jsonc and
  tests/wrangler.jsonc. Generated binding declarations follow those changes.
  Other app configurations remain outside the first delivery.
- **Test changes:** extend the existing Accounts picture, Hub picture and profile
  suites, tests/e2e/profile.spec.ts and the guarded browser seed/wrapper where
  needed. Keep any outside-binding stand-in explicit and typed.
- **Decision record:** prepare docs/adr/046-native-feature-controls.md for native
  evaluation, policy ownership, defaults and the rejected SDK/framework options.
  Add no dependency or database migration.
- **Documentation:** update the existing quickstart and release evidence with
  verified local commands, policy defaults, rollout steps and remaining limits.
  Planning and existing-file changes follow the repository approval rules.

| Order | Work | Done when |
| --- | --- | --- |
| 1 | Review each plan section and the first control's contract. | Scope, failure behavior and delivery boundaries are approved. |
| 2 | Prepare local binding and deterministic test fixtures in an isolated copy. | Types identify FLAGS correctly; local stores remain isolated and offline. |
| 3 | Implement the policy reader and server enforcement with permanent tests. | Paused and active paths, bounds, targeting context and failure privacy are checked through the real handlers. |
| 4 | Extend the profile contract and picture screen with matching checks. | UI and server agree; direct requests cannot bypass a pause or limit. |
| 5 | Run required local validation, review and simplify the candidate. | Workers tests, type checks, builds and browser checks pass on the exact proposed source. |
| 6 | Present the complete tested implementation diff and apply after approval. | Only the approved code, config, tests and documentation are applied. |
| 7 | Prepare approved remote test resources and the exact test binding diff. | Actual app IDs, environment selection, permissions and account terms are verified. |
| 8 | Deploy to the approved test target and collect hosted evidence. | Targeting, changing values, pause, limits and fallback behavior are demonstrated. |
| 9 | Review live configuration and the initial release separately. | Hosted acceptance and remaining release requirements are satisfied before activation. |

## Verification and acceptance

- **Real behavior:** permanent Workers tests exercise the actual picture policy
  reader and upload/page handlers with real identity, access and database flows.
  Only the outside Flagship service may have a typed stand-in for controlled
  failures; never substitute our policy reader or authorization code.
- **Native path:** use the real local binding for wiring checks and the actual
  seeded local store in browser checks. Distinguish those results from tests
  that simulate an outside-service response.
- **Normal upload:** an active valid policy permits a valid upload and preserves
  the established response, file processing, key update, cleanup and audit rules.
- **Paused upload:** disabled and missing flags, missing binding and invalid
  policy prevent new upload work while profile reads and picture removal work.
  A direct request receives the defined 503 outcome even when the UI is stale.
- **Size bounds:** test an accepted file, a file above a reduced limit, the hard
  ceiling, malformed values, non-integers and attempted limits above the ceiling.
  Rejected uploads do not change the picture key or stored objects.
- **Authorization:** active or permissive flags do not bypass sign-in, origin,
  suspended/archived status, MFA, profile completion or mounted-login checks.
  Policy evaluation does not run before the required access checks.
- **Targeting:** trusted login IDs reach the intended first-delivery policies.
  Request parameters cannot supply a different targeting identity. Interleaved
  requests do not share policy or actor state.
- **Privacy:** provider failures and malformed secret-bearing values cannot add
  fields or sensitive text to the established four-field diagnostic event.
  Browser responses contain neither configuration rules nor Cloudflare tokens.
- **Screens:** verify paused, standard and reduced policies, matching notices,
  crop/upload size checks, removal, keyboard behavior and unchanged access flows.
- **Project checks:** use bun run test, bun run typecheck and bun run build:all.
  Run browser checks through bun run test:e2e and its isolated wrapper. Broaden
  checks when changed contracts or failures require it; never run live tests.
- **Meaningful regression:** temporarily break one new enforcement expectation
  in the isolated candidate, confirm its permanent test fails, and restore the
  exact source before the final passing verification.
- **Cleanup:** remove owned probe data, temporary source copies, generated test
  artifacts, logs and processes. Preserve intentional review files and existing
  private data, certificates and unrelated changes.
- **Hosted evidence:** record the actual target and configuration, targeted and
  non-targeted outcomes, an operator change observed without a code deployment,
  pause/restore and a fresh upload refusal under the current policy. Allow the
  documented propagation window without treating it as an instant cutover.
- **Release evidence:** report local and hosted status separately. One integrated
  control does not prove that every release feature is correctly flagged.
  Retain the current release hold until all applicable requirements have evidence.

## Use-case coverage and prerequisites

- **Meaning:** these 16 rows map the identified research uses to xpro consumers
  and delivery gates. They are proposals, not claims that the features exist or
  that their tests have passed. F01-F16 are planning references, not flag keys.
- **First pilot:** one accounts_picture_policy control exercises availability,
  bounded configuration, optional-operation pause and management/testing
  (F01, F06, F08 and F16), plus a selected-login preview (part of F03).
  Workspace-wide targeting needs a workspace feature; the personal-profile
  pilot does not establish that wider acceptance.
- **Later order:** after the first integration, deliver each control with its
  approved consuming feature. The later rows are independent gates, not one
  mandatory sequence. Do not create placeholder flags for missing features.

| ID | Identified use | Consumer and delivery gate | Decision and boundary |
| --- | --- | --- | --- |
| F01 | Release features separately from code deployment | Hub picture boundary first; later each releasing feature. | Boolean or validated JSON availability; keep an explicit safe default and the existing access checks. |
| F02 | Keep a workspace on one experience | Workspace feature boundary after its code, schema and deployed-version eligibility exist. | Use the verified workspace ID as the stable bucket; all users in that workspace share the feature allocation. |
| F03 | Run private previews | Selected login IDs for the personal-picture pilot; selected workspace IDs for future workspace features. | Explicit reviewed audiences before percentages. xpro's own workspace remains an ordinary tenant. |
| F04 | Control module and subfeature availability | Consuming workspace module after installation and capability ownership are defined. | Boolean or JSON subfeature policy. Installed code and module upgrades remain prerequisites; a flag cannot install a module. |
| F05 | Express plan, trial or add-on feature policies | STMS billing and the consuming feature when subscriptions, trials and entitlements are designed. | Trusted plan facts plus shared availability policy. Choose one owner for the plan-to-feature mapping; keep purchased rights and effective dates in durable business records. |
| F06 | Deliver shared operational settings | Accounts picture limits first; later each operation needing a shared limit. | Validated numeric or JSON settings within code-owned hard bounds. Flag values do not count usage or reserve concurrent capacity. |
| F07 | Supply defaults for customer groups | Workspace settings owner when saved preferences and customer-group facts exist. | Targeted defaults fill unset preferences. Administrator overrides and operational ceilings get an explicit precedence rule for that setting. |
| F08 | Pause or reduce a troublesome operation | Hub picture uploads first; later the owning action or job runner. | Boolean or JSON pause for starting optional work. Define safe stop points for jobs; completed records and in-flight operations need their own handling. |
| F09 | Introduce a new implementation gradually | The owning feature after both implementations and their data compatibility exist. | String variants select an allow-listed implementation; fall back to the stable path. Save a selected version when retries or stored results depend on it. |
| F10 | Control optional integrations | The owning integration module after connector, secret and durable-delivery contracts exist. | Boolean or allow-listed string selection. Keep credentials in secrets and retain saved-message delivery/retry ownership. |
| F11 | Tune background jobs | The workspace Durable Object job runner when step, scheduling and retry contracts exist. | Validated step limits or engine selection. Save decisions that affect job meaning; reevaluate operational pauses only at defined safe boundaries. |
| F12 | Allocate experiments | The consuming screen/action when variants, exposure measurement and an outcome question are defined. | Sticky variant allocation at the chosen login or workspace unit. Define measurement separately; allocation does not establish a winner. |
| F13 | Evolve staff and Portal experiences | Workspace Portal or staff feature boundaries as those business screens are built; only the destination shell exists now. | Use the already verified user kind and the required allocation unit. Existing record permissions remain authoritative for both kinds. |
| F14 | Make launches sensitive to region or time | The consuming launch feature once trusted country forwarding and server-time attributes are specified. | Conditions on verified region or server-generated time, with ordinary behavior for missing context. Job scheduling stays with its runner. |
| F15 | Sample permitted diagnostics | The diagnostics owner after the extra measurement, metadata privacy and retention are approved. | Boolean request sampling with a suitable per-request bucket. Preserve required error reports, business audits and the approved four-field logging contract. |
| F16 | Support release management and testing | Cloudflare dashboard/CLI and isolated local/test stores from the first delivery. | Review the complete flag definition, environment, defaults and audiences. Use provider change history for operations; xpro business auditing keeps its own owner. |

- **Fact ownership:** prepare trusted facts once with the consuming operation.
  The existing workspace request context already supplies workspace ID and user
  kind; the current access contract does not supply subscription facts. Design
  that addition with billing rather than adding a separate Hub lookup per flag.
- **Placement:** evaluate in the Worker that needs the decision and pass plain
  validated values into the owning action before a save starts. Keep the router
  on its authoritative placement directory and keep platform APIs out of module
  business rules. Reuse only the decisions needed within that request.
- **Future policy decisions:** the owning feature must select its exact keys,
  permitted attributes, ranges, fallback, administrator precedence and retirement
  trigger. This map does not settle the future subscription policy owner or
  experiment measurements before those features are designed.

### Acceptance for each mapped use

| ID | Evidence required when that use is delivered |
| --- | --- |
| F01 | A configured availability change affects fresh requests without a code deployment; the default and missing-flag cases give the reviewed result. |
| F02 | All logins in one workspace receive the same feature allocation; another workspace is independent. Browser-supplied workspace IDs cannot change it. |
| F03 | Named pilot audiences receive the preview and other audiences receive the baseline; adding a pilot never grants tenant or master permissions. |
| F04 | An enabled flag cannot expose an uninstalled module, skip a required upgrade or bypass permissions; disabling preserves the module data. |
| F05 | Paid, trial, expired and custom-entitlement cases follow the approved policy without duplicate mappings or invented rights. Immediate restrictions use authoritative state. |
| F06 | Accepted, malformed and excessive values are checked at the server boundary. The picture pilot cannot exceed 2 MB; stateful quotas get separate enforcement tests. |
| F07 | Unset, saved and conflicting settings follow the approved precedence; a shared default does not silently replace a saved workspace preference. |
| F08 | Fresh paused requests start no new upload or other selected work; picture viewing/removal remain usable. A pause does not promise instant global cancellation. |
| F09 | Each supported variant reaches the intended implementation, an unknown variant uses the reviewed fallback, and a retry does not change saved semantics. |
| F10 | Targeted connectors and providers follow existing authorization, secret handling and delivery rules; disabling cannot corrupt already saved outgoing work. |
| F11 | A restart or retry retains the selected semantic settings; a temporary pause stops only at a safe step boundary and resumes without duplicate effects. |
| F12 | The chosen allocation unit remains stable for unchanged rules; weighted splits and approved exposure/outcome measurements are tested before drawing conclusions. |
| F13 | Internal and external users keep their existing data scope and server permissions under every presentation variant and after a session changes. |
| F14 | Region, UTC-window boundaries, missing attributes and conflicting rules produce the planned outcome using verified server facts. |
| F15 | Sampling can vary across requests without weakening mandatory diagnostics or audits, and neither context nor secret-bearing values enter logs. |
| F16 | Local flags are isolated from remote apps; test/live separation, default behavior, update propagation, failed management changes and retirement are checked. |

- **Current code anchors:** [Hub picture handler](../../apps/hub/src/functions/picture.server.ts),
  [Accounts picture operation](../../packages/accounts/src/picture/picture.server.ts),
  [hard picture bounds](../../packages/accounts/src/picture/input.ts),
  [verified workspace request context](../../apps/web/src/workspace/request.server.ts),
  [workspace object identity](../../apps/web/src/workspace/object.server.ts),
  [access authority](../../packages/core/src/access/access-policy.ts) and the
  [existing Portal shell](../../apps/web/src/routes/portal.tsx).
- **Product basis:** [workspace releases, jobs, modules, settings and Portal](../../docs/planning/PLANNING.md)
  and [release gates](../../docs/RELEASE_CHECKLIST.md).
- **Capability basis:** Cloudflare's [typed evaluations](https://developers.cloudflare.com/flagship/binding/methods/),
  [targeting](https://developers.cloudflare.com/flagship/targeting/),
  [sticky rollouts](https://developers.cloudflare.com/flagship/targeting/percentage-rollouts/),
  [defaults and propagation](https://developers.cloudflare.com/flagship/concepts/),
  [local configuration](https://developers.cloudflare.com/flagship/configuration/),
  [limits](https://developers.cloudflare.com/flagship/reference/limits/) and
  [management commands](https://developers.cloudflare.com/flagship/reference/wrangler-commands/).

## Operation and retirement

- **Enablement:** create the first policy disabled with paused as its default.
  Enable standard only for the intended test audience after the code is deployed
  and checked. Expand the audience after the relevant acceptance checks.
- **Pause and restore:** disabling serves paused; restoring the reviewed enabled
  rules resumes the intended audience after propagation. Never promise immediate
  cancellation of in-flight work or rollback of completed uploads.
- **Change safety:** inspect the resulting definition before updating it.
  Full replacement and CLI rollout/split operations can replace existing rules.
  Do not assume several updates succeed atomically.
- **History:** use the provider changelog for operational diagnosis. Its documented
  cap is 200 entries per flag, and deleting an app deletes its history; it does
  not replace the Hub or workspace business audit.
- **Retirement:** keep a useful operational pause while it has an owner and a
  purpose. For temporary release flags, remove every deployed consumer or give
  it an approved permanent behavior before deleting the shared flag.
- **Broader reuse:** workspace versions are released independently. Review the
  version inventory before retiring controls used outside the Hub.

## Readiness and constitution check

- **Local evidence:** an isolated native-binding probe on the installed
  Miniflare version, using the current 2025-09-02 compatibility date and runtime
  flags, returned the paused fallback for a missing flag, the configured active
  JSON policy and the paused default for a disabled flag.
- **Evidence limit:** the probe checks local platform feasibility only. It is not
  a passing implementation, test-suite or hosted-deployment result.
- **Unapproved work:** implementation, configuration changes, resource creation,
  deployment and live activation remain separate from this plan review.
- **Constitution:** preserve workspace isolation, platform-independent business
  rules, bounded input handling, save semantics, existing authentication and the
  installed runtime. Use platform capability and approved dependencies before
  introducing custom code. Review exact existing-file diffs before applying them.

## References

- [Product requirements](../../docs/planning/PLANNING.md),
  [architecture conventions](../../docs/conventions/architecture.md),
  [server conventions](../../docs/conventions/server.md),
  [testing conventions](../../docs/conventions/testing.md),
  [picture input bounds](../../packages/accounts/src/picture/input.ts) and
  [release review](../001-sign-in-and-accounts/checklists/release-review.md).
- [Flagship binding](https://developers.cloudflare.com/flagship/binding/),
  [configuration](https://developers.cloudflare.com/flagship/configuration/),
  [evaluation methods](https://developers.cloudflare.com/flagship/binding/methods/),
  [rollouts](https://developers.cloudflare.com/flagship/targeting/percentage-rollouts/)
  and [best practices](https://developers.cloudflare.com/flagship/best-practices/).
