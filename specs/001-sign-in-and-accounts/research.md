# Research: Sign-in and Accounts

- **Reconciled:** 2026-10-30, against the implementation delivered through T043,
  the pinned dependencies and the permanent tests. The
  [latest validation](tasks.md#t043-security-review-checkpoint) records 1,780
  Workers tests in 89 files, 181 browser cases, nine type projects and three
  local builds. T044 changes documentation only; those checks are not rerun or
  relabelled as hosted acceptance.
- **Evidence:** early probes informed the decisions below. Passing application
  tests now verify the implemented flows; a prototype or fixture check alone
  does not prove an acceptance scenario. See the
  [scenario map](checklists/browser-acceptance.md) and
  [security review](checklists/security-review.md) for scope and outstanding work.

## 1. Password hashing

- **Decision:** Better Auth's default password hashing at full strength, with no custom code.
  Workers Paid from the first deploy of sign-in to the test environment.
- **Rationale:** keep Better Auth 1.7.12's native `scrypt` implementation and
  default parameters. Do not substitute a weaker or custom hashing function.
  Earlier local timings informed the Paid requirement; they do not establish a
  hosted CPU budget or prove that this is the fastest possible implementation.
- **Evidence:** real native sign-in, initial setup, creation, reset and own-password
  tests execute in workerd. The installed password module and
  [official security guidance](https://github.com/better-auth/better-auth/blob/v1.7.12/docs/content/docs/reference/security.mdx)
  confirm the native default; custom hashing is supported but unused.
- **Alternatives considered:** a weaker hash through custom functions until the paid plan
  (rejected: custom code, and existing test passwords would need resetting).

## 2. Getting from the Hub into a workspace

- **Decision:** the standard sign-in protocol (OpenID Connect). The Hub uses Better Auth's OAuth
  provider add-on; each workspace is a trusted app that skips the consent screen, uses
  `oauth4webapi` to finish sign-in, and keeps its own session.
- **Rationale:** the proven standard for sign-in across addresses; works for clients' own
  domains and several workspaces per person later. A local test confirmed: sign-in with no extra
  screen, single-use codes, protection against stolen codes, no refresh tokens unless asked for,
  and sign-out messages to the workspace (back-channel). Permanent
  [protocol tests](../../apps/web/src/auth/oidc-protocol.test.ts) and
  [browser journeys](../../tests/e2e/sign-in.spec.ts) now verify the actual exchange.
- **Implemented boundaries:**
  - suspension, archive, reset and identifier changes revoke native sessions and
    active issued tokens in their audited Hub batch. A retained workspace cookie
    fails the next live check; these actions do not promise idle-screen or
    back-channel logout delivery;
  - native provider logout delivers back-channel messages. The pinned provider
    needs the Bun-managed workerd redirect patch recorded in
    [ADR-018](../../docs/adr/018-workspace-sessions-and-logout.md); frozen install
    reapplies it and real receiver tests retain redirect refusal;
  - the code always travels in the web address, so FR-018 allows that single protected code;
  - workspace addresses use exact HTTPS callbacks and origin-bound cookies.
    The isolated browser runner carries actual signed logout/JWKS requests over
    copy-only local bindings to the real handlers, rather than replacing logout
    results. Public DNS/TLS and deployed dispatch remain hosted checks.
- **Alternatives considered:** a shared cookie on the main domain (reaches workspaces the person
  doesn't belong to; no clients' own domains); our own one-time code hand-off (custom security
  code); signed passes with refresh tokens (suspension delayed until a pass expires, against
  SC-006); a gateway check in the router (details passed between our own apps are hints, not
  proof).

## 3. The Hub's audit log

- **Decision:** kept in the Hub's D1 database. Triggers refuse changes and deletions.
  Other STMS actions and their audit entries are sent as one batch. Login creation
  follows the exception in section 8 below. No fingerprint chain is used.
- **Rationale:** earlier local tests confirmed blocked changes/deletions and all-or-nothing
  batches. Independent proof is deferred until a customer or audit requirement calls for it.
- **Evidence:** permanent Hub batch and STMS storage tests check rollback, one
  correlated audit and unchanged neighbouring records. The
  [five scoped save exceptions](plan.md#constitution-check) remain explicit;
  database triggers are not independent proof against a database operator.
- **Alternatives considered:** a separate Durable Object for the Hub's audit log (two stores to
  keep in step for every STMS action).

## 4. Local development

- **Decision:** the Hub, the workspace app and the router each run with their own dev command on
  `*.localhost`, over https, and reach each other through service bindings.
- **Rationale:** Cloudflare documents cross-process bindings for both `vite dev` and
  `wrangler dev`; `*.localhost` behaves like separate addresses for cookies.
- **Evidence:** actual Hub/workspace/router bindings and a distinct HTTPS customer
  hostname are covered by permanent browser tests. The local single-workspace
  router is an accepted fallback, not deployed Workers for Platforms dispatch.
  The [quickstart](quickstart.md#prepare) distinguishes manual private settings
  and prepared records from the isolated runner's own disposable setup.
- **Alternatives considered:** one dev command for all Workers (only one is reachable from the
  browser).

## 5. Test tools and installs

- **Decision:** pin the tested Vitest 4.1.12 and `@cloudflare/vitest-plugin`
  1.4.6, with matching Istanbul coverage 4.1.12. Bun uses `exact = true`,
  `minimumReleaseAge = 259200` (3 days) and `ignoreScripts = true`.
- **Rationale:** this combination passed local workerd checks. The plugin's
  published 1.4.6 peer range is `^4.1.0 || ^5.0.0`; Vitest 5 is not categorically
  unsupported. Keep the tested 4.1.12 pin and revalidate before a major upgrade.
- **Current checks:** use `bun run test`, not Bun's own test runner. Use
  `bun run test:e2e` for actual browser flows; its wrapper owns copies, certificates,
  storage, external-service stand-ins and cleanup. Installed Chrome is the
  browser used for the recorded T043 run. No hosted environment was exercised.

## 6. Save helper

- **Decision:** ordinary Kysely code inside the Durable Object's async all-or-nothing block,
  through one save helper (ADR-002).
- **Rationale:** a local test confirmed all-or-nothing on failure, reads inside a save, and
  correct numbering with 500 saves at once. Saves run one at a time per workspace, so no outside
  call happens inside a save.
- **Evidence:** permanent save, storage and workspace-upgrade tests now use the
  actual Durable Object, migrations and SQLite storage. The original 500-save
  probe was infrastructure evidence, not an authenticated application journey.
- **Alternatives considered:** Kysely-built statements run as plain SQL in the one-step block
  (no reading and deciding in the middle of a save).

## 7. Workspace membership and access checks

- **Decision:** use Better Auth's Organization plugin in the Hub, one organization per
  workspace. Business roles, permissions, teams, entities and history stay local.
- **Rationale:** reuse built-in member management instead of building it ourselves.
  Membership also removes the need for a separate routing field on each login.
- **Initial scope:** use fixed member-management roles. Keep business teams workspace-local.
  Defer editable custom roles and invitation onboarding until needed.
  xpro's database constraints and native hooks enforce the one-workspace rule.
- **Access checks:** all users follow the
  [shared access checks](./contracts/server-functions.md#access-checks).
  Each protected workspace request uses one combined Hub call through a Cloudflare
  Service Binding. Reuse its result only within that request; check business permissions locally.
- **Evidence:** native policy, creation, Hub-access and isolation suites now pass
  on D1/workerd. Browser creation and live member removal verify integration
  through the actual apps. Masters keep global access independently of tenant
  roles; prepared-workspace setup uses trusted native server calls. Public
  organization/invitation writes and public registration stay disabled.
- **Alternatives considered:** local membership plus a Hub routing field (leaves member
  management custom); caching checks across requests (delays access removal).

## 8. Retrying interrupted login creation

- **Decision:** use the same saved login creation request to finish missing steps
  after a failed save. Keep the new login's access blocked until creation is complete.
  See [Login creation retries](./plan.md#login-creation-retries) for the rules.
- **Reason:** Better Auth's sequential server calls and a later audit or workspace
  save do not form one transaction. Failure probes left Hub records in place when
  the audit or workspace insert failed; an incomplete workspace user was denied access.
- **Storage boundary:** a [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
  protects its statements in D1. A [Durable Object transaction](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction)
  protects that object's storage. Neither rolls back writes in the other database.
- **Scope:** this is an explicit exception to all-or-nothing saving for Story 6.
  Use the existing databases; the creator retries without an additional service.
  Other STMS save and audit requirements remain in place.
- **Original probe:** 35 assertions passed but seven unhandled errors made the
  prototype exit unsuccessfully. That result identified the partial-save problem;
  it was never passing application acceptance evidence.
- **Current evidence:** the real saved-reference, native preparation, private
  workspace save and atomic audit/completion are implemented. Permanent
  [creation tests](../../packages/accounts/src/create-login/create-login.test.ts),
  [fault tests](../../tests/support/creation-faults.db.test.ts) and
  [browser journeys](../../tests/e2e/create-login.spec.ts) check interruptions,
  concurrent/repeated requests, lost success, changed permissions and unrelated
  identifier conflicts. Access stays blocked until completion; repeats preserve
  the original password and creator. The complete Workers run now exits cleanly.
- **Alternatives considered:** one transaction across D1 and workspace storage (not
  provided by those APIs); deleting partial logins (conflicts with keeping login
  history); a separate retry service (not needed for creator-initiated retries).

## 9. Screens and security

- **Implementation:** profile completion, native Hub sign-in, private creation,
  own profile/pictures/password, STMS management and mounted workspace session
  return are implemented. `/account` and `/portal` are minimal protected
  destination pages, not complete Account or Portal products.
- **Reuse:** TanStack Form, Base UI/shadcn controls, Tailwind tokens and Paraglide
  supply forms, dialogs, styling and translations. React renders user text
  without raw HTML. TanStack Query is not used by this feature.
- **Response policy:** the three public Workers use Core's shared headers,
  retaining native CSP, cookies, streams and upgrade metadata. Permanent tests
  verify actual framing refusal, no-referrer native logout, escaped user values
  and absence of tested credentials from diagnostics, audits and disallowed URLs.
  See [ADR-041](../../docs/adr/041-shared-response-security.md).
- **Remaining work:** local keyboard/axe and declared-link timing checks pass.
  Hosted performance, actual Images fidelity, dispatch, static/edge policies and
  manual/assistive-user acceptance remain separate. Deletion/anonymisation,
  retention and free-text audit-comment policy are documented privacy gaps.
  Master MFA before the first real client remains a release gate.

## 10. Reference scope

- **Pinned baseline:** `package.json`, workspace manifests, `bun.lock`, the native
  provider patch and installed source establish the implemented versions. Current
  official documentation was fetched through Context7 and checked against that
  baseline; a newer documentation example does not authorise a package upgrade.
- **Local tooling:** [multi-Worker development](https://developers.cloudflare.com/workers/local-development/multi-workers/),
  [development secrets](https://developers.cloudflare.com/workers/configuration/secrets/#local-development-with-secrets),
  [Worker types](https://developers.cloudflare.com/workers/languages/typescript/)
  and [Playwright browser channels](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge)
  support the current setup. The repo's scripts and isolated runner define the
  commands readers should actually use.
- **Limits:** no deployment, provisioning tool, remote migration command or
  production acceptance result is introduced by this reconciliation. Existing
  decisions and their five save exceptions remain unchanged.
