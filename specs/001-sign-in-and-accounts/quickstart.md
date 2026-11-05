# Quickstart: Sign-in and Accounts

- **Current implementation:** sign-in, private login creation, own-profile and
  picture/password editing, master login management, prepared workspace routing,
  session return, master MFA and local picture-upload controls are implemented.
  See [current verification](#current-verification-and-limits) and the
  [task record](tasks.md) for local evidence and remaining release work.
- **Start here:** use [Prepare](#prepare), [first-master setup](#set-up-the-first-master-locally)
  and [local app commands](#run-the-local-apps) for manual development, or use the
  [Workers checks](#prove-it-with-tests) and isolated [browser checks](#browser-checks).
  Automated checks create their own data; manual workspace navigation needs
  separately prepared workspace and OAuth records.

## Prepare

Use Bun as the package manager/script runner and Node.js for Vite, Wrangler and
Miniflare. Production runs on Cloudflare Workers.

Install from the repository root:

```bash
bun install --frozen-lockfile
```

For local HTTPS, install [mkcert](https://github.com/FiloSottile/mkcert) once.
On macOS, `brew install mkcert` installs the tool. Run
`TRUST_STORES=system mkcert -install` in your Terminal so macOS can request
administrator authorization to add its local CA to the system trust store.
Then create the development certificate from the repository root:

```bash
TRUST_STORES=system mkcert -install
mkdir -p .certs
mkcert -key-file .certs/localhost-key.pem -cert-file .certs/localhost.pem localhost hub.localhost web.localhost router.localhost 127.0.0.1 ::1
```

The `.certs/` directory is ignored by Git. Keep the private key and mkcert's
CA key private. Each developer creates their own certificates. Node tools
that call local HTTPS endpoints also need the local CA; set this in each
development terminal:

```bash
export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
```

The Hub dev command selects its `local` environment, with local `DB` (D1),
`PROFILE_PICTURES` (R2), `IMAGES`, `SIGN_IN_RATE_LIMITER`, local `FLAGS` and a private `WORKSPACE_USERS`
binding to the prepared app's `WorkspaceUserWriter`. The
workspace app has `HUB` for HTTP, `HUB_ACCESS` for private access validation,
and a SQLite-backed `WORKSPACES` Durable Object namespace. The router has
`HUB`, private `HUB_PLACEMENT` and local `PLACEMENTS` (KV). Local bindings have
`remote: false`; no Cloudflare resource IDs or credentials are required for
these local applications. Local state stays under each app's ignored `.wrangler/`
directory. Deployment resources, Worker logs/traces and the Workers for
Platforms dispatch namespace must be configured and reviewed before a deploy.

Before setup or manual Hub use, privately set
`BETTER_AUTH_URL=https://hub.localhost:3001` and `BETTER_AUTH_SECRET` in
`apps/hub/.dev.vars.local` (or `.dev.vars` if the environment-specific file is
absent). Wrangler selects one file rather than merging both; put all four Hub
settings in the selected file. The secret must be at least 32 characters; use
the same private value for initial setup and subsequent Hub runs. Public Hub HTTP also
requires `TURNSTILE_SECRET_KEY` and the widget's public `TURNSTILE_SITE_KEY` in
that ignored file. Use the paired keys for a widget allowing the Hub hostname.
All four names are declared required in Wrangler; missing values produce local warnings and authentication
refuses invalid configuration. Never commit the file or infer settings from
request headers.

Manual workspace journeys require prepared organization, address and confidential
native OAuth-client records. Preparing those records is separate operator work.
This feature has no workspace/client provisioning UI or general provisioning CLI.
The browser wrapper prepares disposable records; never run its guarded seed script
against this checkout. Supply the matching values privately in
`apps/web/.dev.vars`:

| Setting | Meaning |
|---|---|
| `WORKSPACE_ID` | Its existing Hub organization/workspace ID |
| `WORKSPACE_ORIGINS` | A JSON array of its exact HTTPS origins, without trailing slashes |
| `HUB_ORIGIN` | The fixed Hub origin, locally `https://hub.localhost:3001` |
| `OIDC_CLIENT_ID` | Its registered confidential native OAuth client |
| `OIDC_CLIENT_SECRET` | That client's private secret |
| `WORKSPACE_SESSION_SECRET` | A separate private cookie secret of at least 32 characters |

If using both direct web and router addresses locally, the origins include
`https://web.localhost:3000` and `https://router.localhost:3002`. Register their
exact `/auth/callback` URLs on that same native client. Each address gets its
own private cookie. The prepared directory maps those origins to the same
workspace and the local worker name `xpro`, with one primary address.

Set `HUB_ORIGIN` in `apps/router/.dev.vars.local` (or its fallback
`.dev.vars`). The router dev command selects the `local` environment and its
single-app adapter. The normal router build explicitly selects the top-level
configuration with the `xpro-workspaces` dispatch namespace. It remains a
dry run. Real dynamic dispatch requires deployed user Workers; verify the
approved staging setup before a production rollout.

The Hub's normal build uses that same production dispatch namespace for private
login creation. It sends creation IDs/type and request context through platform
`props`; a public request body or header cannot authorize the workspace save.
Local creation requires the workspace app to be running and its prepared worker
name to be `xpro`. Neither development command connects to hosted dispatch.

These settings and prepared records are not created by public sign-up.
Provisioning workspaces and domains remains outside this feature. Missing or
invalid settings fail closed; do not add placeholder production credentials.

The Workers tests need none of these manual secrets, prepared records or TLS
certificates. The browser wrapper needs the installed/trusted mkcert CA and
browser, but generates its own server certificates and private fixture settings.

## Set up the first master locally

Stop the Hub before setup, allow no other login creation, and run one setup at a
time. This command uses only the Hub's local development database under
`apps/hub/.wrangler/state/v3`; it cannot initialize a deployed Hub.
It explicitly selects the same `local` environment as the Hub dev command.

Supply all four environment variables explicitly through your terminal or secret
tooling. There are no default credentials:

| Variable | Value to supply |
|---|---|
| `BETTER_AUTH_URL` | The intended Hub HTTPS address |
| `BETTER_AUTH_SECRET` | The intended Hub auth secret, at least 32 characters |
| `XPRO_INITIAL_MASTER_EMAIL` | The selected first master's email |
| `XPRO_INITIAL_MASTER_PASSWORD` | Its ordinary password: 12–64 characters, with a capital letter, number and symbol |

Keep credentials out of command arguments and committed files. In zsh, supply
the same Hub secret as the selected private settings file and read passwords
without displaying them:

```zsh
export BETTER_AUTH_URL=https://hub.localhost:3001
read -rs "BETTER_AUTH_SECRET?Existing local Hub auth secret: "
echo
read -r "XPRO_INITIAL_MASTER_EMAIL?Initial master email: "
read -rs "XPRO_INITIAL_MASTER_PASSWORD?Initial master password: "
echo
export BETTER_AUTH_SECRET XPRO_INITIAL_MASTER_EMAIL XPRO_INITIAL_MASTER_PASSWORD
bun --filter @xpro/hub setup:initial-master
unset BETTER_AUTH_URL BETTER_AUTH_SECRET XPRO_INITIAL_MASTER_EMAIL XPRO_INITIAL_MASTER_PASSWORD
```

The command applies actual Hub migrations, creates the selected login through
Better Auth and records its creation. Output contains a request ID and one of:

- **`created`:** the initial master and creation audit were saved.
- **`existing_logins`:** setup skipped all login changes because the Hub contains
  a login. This does not assert that the existing login is a master or complete.
- **`invalid_input`:** supplied credentials were refused; only field names are shown.

Missing environment variables or a failed operation exit unsuccessfully. Existing
roles, passwords and sessions are never changed. The new master still needs the
implemented profile-completion flow at first sign-in: choose the required
username, name and phone, then continue to STMS.

**Interrupted setup:** native login, password and audit writes are separate. A
failure can leave a partial login, or a usable login without its creation audit.
Stop and inspect/resolve that setup privately before starting the Hub. Repeating
this command does not repair it. This explicit first-time setup exception and its
upgrade triggers are recorded in [ADR-013](../../docs/adr/013-private-initial-master-setup.md).
It does not change the save/audit guarantees for other STMS actions.

## Run the local apps

Complete private settings and first-master setup before starting the Hub. For
workspace entry, also have the prepared records described above.
If picture uploads are needed, prepare the [local control](#local-picture-upload-controls)
while the Hub is stopped. Until configured for the login, new uploads are paused;
existing picture reads/removal and the other profile forms remain available.

Start each app in its own terminal, from the repository root:

| App | Command | Address |
|---|---|---|
| Hub | `bun run dev:hub` | `https://hub.localhost:3001` |
| Workspace | `bun run dev` | `https://web.localhost:3000` |
| Router | `bun run dev:router` | `https://router.localhost:3002` |

The servers listen on loopback. Vite uses fixed ports and the certificate
files above; a port conflict fails rather than moving a sign-in address.
Both local Vite and Wrangler sessions discover the Hub by its Worker name,
`xpro-hub`. Start the Hub first and keep all three terminals open.

Open the Hub to sign in. A fresh checkout does not create a workspace, OAuth
client or Account simply by running `bun run dev`. The root `dev`, `build`,
`preview` and `deploy` scripts target only `apps/web`; the Hub and router have
separate commands. `deploy` builds and deploys the workspace app and is not a
verification step.

Hub startup does not run migrations. The local first-master command applies the
registered migrations before setup. Upgrading an existing Hub needs a serial
Kysely migration run with writes paused as described in the
[search migration checkpoint](#t036-indexed-login-directory-checkpoint), including
its rollback/name-copy restriction. Workspace objects upgrade their own SQLite
storage on construction. No approved remote migration or deployment procedure
is supplied by this quickstart.

## Prove it with tests

From the repository root after the frozen install:

```bash
bun run test
bun run build:all
bun run typecheck
bun --filter @xpro/hub generate-auth-schema --check
bun audit
```

- **Workers:** `bun run test` invokes Vitest 4.1.12 with the pinned Cloudflare test
  plugin and local ephemeral D1/R2/KV/SQLite. `tests/wrangler.jsonc` supplies the
  required `XPRO_TEST_ENVIRONMENT=test` marker; callers do not need to export it.
  Setup refuses another target, disables remote bindings, resets storage after
  each test and fails on undeclared outside requests. It uses no development data.
  Bun's built-in `bun test` is a different runner.
- **Build:** `build:all` builds the workspace and Hub and runs the router's existing
  top-level Wrangler dry run. It uploads nothing and creates no cloud resources.
  The root `build` alone builds only `apps/web`.
- **Types:** `typecheck` regenerates runtime/binding declarations, messages and
  both apps' routes, then checks seven app/package projects plus the Workers and
  browser test projects: nine in total. Generated Worker types, Hub routes and
  messages are not files to edit by hand. The three Workers retain their approved
  `2025-09-02` target and flags.
- **Schema:** `generate-auth-schema --check` compares native Better Auth 1.7.12
  against actual migrations in an in-memory SQLite database. It cannot migrate
  development or hosted D1. Without `--check`, the same command prints additive
  SQL for review in a new dated Kysely migration; it does not rewrite old ones.
- **Audit:** `bun audit` checks the installed graph. Do not add a fix or upgrade
  flag merely to verify the checkout. Frozen installation retains the existing
  OAuth-provider patch needed for workerd back-channel redirect handling.

For optional Istanbul output use `bun run test --coverage`. Coverage reports are
ignored build artifacts to remove after use; the latest T043 results below are
not a claim of a new coverage run. Fixtures use `#test/...`; outside services use
`network` from `#test/network`. Safe unmatched-call errors omit submitted bodies,
passwords and query strings.

## Browser checks

Install Playwright's Chromium once if no supported browser is installed:

```bash
bun run test:e2e:install
bun run test:e2e
```

The recorded validation used installed Google Chrome instead:

```bash
PLAYWRIGHT_CHANNEL=chrome bun run test:e2e
```

Choose one browser path after installing/trusting the mkcert CA. Bun, Node.js,
Git and mkcert must be available. The wrapper reads the CA through `mkcert -CAROOT`
and issues its own temporary server certificates; it does not require
this checkout's `.certs` files or manually prepared logins/settings. Ports
3000/3001/3002 and 9230/9231/9232 must be free. It refuses existing dev servers.
Do not invoke Playwright's config or `tests/e2e/seed.ts` directly.

The wrapper copies only Git-selected source, performs a frozen install, applies
real migrations and creates its own native identities, memberships, workspace
and OAuth client. It starts all three existing dev scripts and verifies local
HTTPS readiness. Chromium resolves its two customer `.test` hosts to loopback;
no hosts-file change or CA installation occurs in the runner. Protocol/customer
and dedicated security cases reject untrusted TLS certificates.

Actual authentication, cookies, signed codes, access, routing, D1/SQLite/R2 and
native logout handlers remain real. Outside Turnstile SDK/verification results
are substituted. Copy-only bindings carry actual JWKS and back-channel messages
to the real local handlers; these are not hosted HTTP/dispatch tests. Local
Images has limited transformation fidelity. The wrapper stops its processes and
removes its certificates, fixtures, storage, copies, logs, screenshots and reports
on success or failure; it does not change original private files or local data.

To run a focused browser file, use the same wrapper, for example:

```bash
PLAYWRIGHT_CHANNEL=chrome bun run test:e2e tests/e2e/security.spec.ts
```

## Local picture-upload controls

The local Hub uses the native Flagship `accounts_picture_policy` control. New
uploads stay paused until a valid enabled rule targets the login. Current
pictures remain viewable/removable and the other profile forms stay usable.

Follow the [Flagship guide](../005-flagship/quickstart.md) while the Hub is stopped
for verified local seeding, pilot targeting, pause/restore and test commands.
The binding is local-only; hosted test/live setup and release approval remain
separate. [ADR-046](../../docs/adr/046-native-feature-controls.md) records ownership,
defaults and the future-consumer boundaries.

## Current verification and limits

- **Latest local candidate:** [T061](../005-flagship/quickstart.md#local-verification-t061)
  passed 2,200 Workers tests in 117 files, all 234 browser/integration checks,
  all type projects and all three local builds. Native schema comparison, frozen
  install and the dependency audit passed. The checkpoint records native policy
  evidence and its hosted limits; source application follows exact-diff approval.
- **Recorded:** T043 passed all 1,780 Workers tests in 89 files, 181 browser cases,
  nine type projects and three local builds. Native schema comparison, frozen
  install and the 427-package audit passed too. Applied-source security rechecks
  passed 14 Workers tests, five browser cases, nine type projects and three builds.
  T044 changes documentation only and reuses that evidence.
- **Stories:** the [43-scenario map](checklists/browser-acceptance.md) links all six
  stories to actual application browser and storage checks. Earlier prototype
  and fixture probes are historical supporting evidence, not substitutes for
  those journeys or for hosted acceptance.
- **Timing:** local keyboard sign-in checks use the declared 50 ms/10 Mbps down/
  2 Mbps up request link and a 3,000 ms submission-to-visible-heading deadline.
  Master search/confirmed suspension uses a 60,000 ms local workflow deadline.
  Warm Vite/workerd servers and substituted verification do not establish cold or
  hosted production performance. See [T042](#t042-keyboard-and-performance-checks).
- **Security:** [T043](#t043-security-checks) and the
  [security review](checklists/security-review.md) record Worker response headers,
  privacy regressions and outstanding deletion/anonymisation, audit-comment and
  retention decisions. Hosted static/edge headers, observability and asset
  exposure remain separate checks.
- **Release:** public DNS/TLS, Workers for Platforms dispatch, hosted Images,
  production timing and manual/assistive-user assessment remain pending. T045's
  [release review](checklists/release-review.md) is complete and withholds
  deployment and first-client approval. [Master MFA](../002-master-mfa/quickstart.md#t056-final-convergence-checkpoint)
  is implemented and verified locally. Sanitized production diagnostics and the
  other hosted/operational/privacy release gates remain open.

Official references: [multi-Worker development](https://developers.cloudflare.com/workers/local-development/multi-workers/),
[local secrets](https://developers.cloudflare.com/workers/configuration/secrets/#local-development-with-secrets),
[Worker types](https://developers.cloudflare.com/workers/languages/typescript/),
[Vitest configuration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/),
[Playwright browser channels](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge)
and [mkcert](https://github.com/FiloSottile/mkcert).


## Try it by hand

Use disposable local identities after setup; tests do not seed this checkout.
Sign in with the initial master and complete its missing profile before opening
STMS. The master is xpro's global operator, independent of tenant owner/admin
roles. Account and Portal currently provide protected destination headings, not
complete business screens. Then, with prepared workspace/client records:

1. As a master user, workspace owner or workspace user with creation permission,
   create a non-master test login in a prepared workspace. Non-master creators must
   use their own workspace. Enter valid email, username, name and phone, set a
   password, and choose internal or external.
2. Sign in at the Hub with the new login. Confirm it reaches the correct app or
   Portal without profile completion or a required password change.
3. Use another prepared login with workspace membership and an incomplete profile.
   Confirm only missing or invalid details are required before continuing.
4. Change the profile and the password.
5. As the master user, suspend the person.
6. Confirm the person is signed out of the workspace at their next action.
7. Try public sign-up, including a direct registration request; confirm no login
   or Account is created.

See [data-model.md](./data-model.md) and [contracts/server-functions.md](./contracts/server-functions.md)
for details.

## Implementation checkpoints — historical

These notes retain evidence and limitations at each delivered revision. Earlier
test counts, missing modules and future-task wording describe that checkpoint
only. They are not current failures, setup instructions or a new claim of
application acceptance. Use the current commands and verification above; the
[task record](tasks.md) and decision records retain the delivery history.

### Foundation checkpoints (T003–T009)

The approved setup was installed and thirteen infrastructure tests passed in
the repository on 2026-10-26 with Istanbul coverage. Four temporary controls
in the isolated candidate confirmed failures for a
wrong environment marker, a caught undeclared request, a genuine unhandled
rejection and a disabled guard. Their source mutations and control files
were removed. The frozen install, full type check, all three builds and
security audit passed too.

T004 adds 38 shared server-helper tests, bringing the permanent suite to 51
passing tests on 2026-10-26. They cover bounded JSON reads, validation,
allow-listed core errors, safe logs and request-ID propagation. Temporarily
disabling the byte limit made its permanent test fail; the source was restored
and the full suite passed again. The application/test type checks and frozen
install passed, with no new dependency or lockfile changes. Helper usage is
documented in `docs/conventions/server.md`.

T006 adds workspace transaction and Hub prepared-batch helpers. Seven new
storage tests bring the runnable subset to 58 passing tests with Istanbul
coverage on 2026-10-26:

```bash
bun run test tests packages/core/src/server packages/core/src/save/save-storage.test.ts apps/hub/src/db/hub-save-batch.test.ts
```

All app/package type checks and a scoped type check of the runnable tests
passed. The full test suite and test-project type check still need T005's
missing database/migration modules from T008–T009. Those tests remain active.
Controls that disabled workspace rollback or replaced the Hub batch with
sequential writes failed as expected; both mutations were restored before
final checks. The dialect's storage-type mismatch has one documented
compatibility assertion in its test connection; its removal trigger is in code.

T008 adds the real Hub migrations, native auth schema generation and the shared
`#test/hub-auth` HTTP sign-in fixture. The Hub uses Better Auth's native D1
adapter. See [ADR-011](../../docs/adr/011-hub-auth-migrations.md) for the
framework table exceptions and migration execution rules.

Check the generated auth schema, or print additive SQL for a new dated
Kysely migration, from the repository root:

```bash
bun --filter @xpro/hub generate-auth-schema --check
bun --filter @xpro/hub generate-auth-schema
```

These commands use an in-memory SQLite database built from the application
migrations. They never connect to a development or live database and never
rewrite a released migration. The initial native snapshot was generated with
Better Auth 1.7.12 and Wrangler's SQL statement splitter; its CREATE statements
allow a first installation to retry after interruption.

On 2026-10-27, 115 available tests passed locally in workerd with Istanbul
coverage. They include all 33 native auth policy/handler tests, eight Hub
save/audit tests and 16 Hub schema tests. All six app/package type checks,
the available-test type check, the Hub build and the frozen lockfile check
passed; the security audit reported no vulnerabilities. Temporary controls
removed membership uniqueness and a generated column; the membership test
and schema check failed as expected, then the source was restored.

Before T009, the workspace database module was still missing and T005's
workspace checks remained pending. Hub tests apply the actual migrations
before using native server-side user creation and real HTTP sign-in.

T009 adds the real workspace schema and constructor startup upgrade. Each
workspace upgrades its own SQLite database inside a native storage transaction
before processing incoming events. Kysely bookkeeping is included in that
transaction. A returned migration error is thrown so schema changes roll back.
If all migrations known to the code have run, startup leaves newer migration
history intact so an older app version can reopen an additive schema.
The constructor's startup lock is not used for ordinary actions.

The shared connection also handles the pinned dialect's protected-table
introspection issue. Restart tests save key-value data before eviction, so they
exercise the Cloudflare internal tables that caused the original failure.
The compatibility limit and removal trigger are recorded in code and
[ADR-012](../../docs/adr/012-workspace-schema-upgrades.md).

On 2026-10-27, all 137 tests passed locally in workerd with Istanbul coverage,
including T005's ten workspace save/migration/audit tests and twelve workspace
schema/startup cases. The full application/test type check, all three builds,
frozen install and security audit passed. Controls that skipped startup upgrades
or ignored returned migration failures made their permanent tests fail. Both
mutations were restored before the final checks; temporary output was removed.

Run the complete foundation checks from the repository root:

```bash
bun run test --coverage
bun run typecheck
bun run build:all
```

Workspace schema tests use the actual Durable Object class, real migrations and
the existing save helper. Local session rows in these storage tests do not prove
authenticated access. The shared Hub HTTP sign-in fixture is available now; T019
extends it through the actual workspace callback and session flow after T018
implements the callback. No test-only authentication path is introduced.

These checks cover infrastructure and shared helpers. App endpoints are not
wired yet. Hub and workspace schemas are available; workspace HTTP sign-in
fixtures follow the implemented flow in T018–T019. No feature acceptance scenario
is marked complete by this foundation suite.

References: [Cloudflare test configuration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/),
[storage isolation](https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/),
and [MSW outbound stubs](https://developers.cloudflare.com/workers/testing/vitest-integration/mock-outbound-requests/).

- As application actions are implemented, add each acceptance scenario from the spec
  as a matching test named "when … then …" and run it with the same command.
- Fail or interrupt login creation between each save. Confirm unfinished logins
  cannot use xpro, then retry with the same creation reference and confirm one
  complete result with the original creator in its audit entry.
- Repeat a completed request after a lost success response and send concurrent
  retries. Confirm no duplicate records or password changes. Refuse changed
  creators, workspaces or creation details, retries without current permission,
  and unrelated existing logins.


### T010 private initial-master checkpoint

T010 was checked in an isolated checkout on 2026-10-27: all 168 tests passed in
workerd (31 for initial setup), the full application/test type check and all three
builds passed, and frozen install/security audit passed. The actual local command
created one test master; same-email and different-email repeats preserved all
stored rows and printed no credentials. Temporary bindings, test data, output and
checkout were removed after verification. These checks do not complete an
application acceptance scenario or initialize this repository's development data.


### T012 shared-access foundation

The 37 cases in `packages/core/src/access/access.test.ts` now pass against the
real Core request checks and Hub validator. The Hub reads current session,
login, creation and workspace membership in one indexed statement. There is no
cross-request cache. Native HTTP gates use the same policy; session creation also
refuses archived or unfinished logins. Trusted native server APIs remain available
for xpro actions, which must apply their own authorization and save rules.

The shared profile helper checks stored username format, non-empty name and
canonical, valid international phone numbers. T014 adds username availability,
reservations and remaining write-time normalization; T015 implements completion.

Run the complete suite and type checks from the repository root:

```bash
bun run test
bun run typecheck
bun run build:all
```

`apps/hub/src/server.ts` preserves the TanStack HTTP handler and exports the named
`HubAccess` Worker entrypoint. The workspace's `HUB_ACCESS` service targets that
entrypoint on `xpro-hub`; it adds no public HTTP validation route. Wrangler generates
its RPC types from both app configurations. The workspace resolves `#` imports
through each package's own import map, including explicit `.ts` extensions.

`tests/worker.ts` exports the actual Hub RPC class and Workspace Durable Object.
The local `HUB_ACCESS` test binding targets that named entrypoint. Only the test
Worker enables `enable_ctx_exports`, required by this Vitest plugin to expose named
Worker entrypoints on the older compatibility target. The three app targets and
flags stay unchanged. Tests use the real RPC transport, real migrations, native
HTTP sign-in and ephemeral D1; there is no authentication substitute.

T012 also loaded the built Hub bundle and a temporary caller into separate workerd
Workers. The caller used the configured service/entrypoint and production
compatibility settings. Malformed input was refused; uninitialized D1 returned
only the named failure. The temporary caller and runtime were removed. Permanent
binding tests cover successful real identities, live sign-out and database failure.

The original in-process boundary counter proves one call per request; the binding
tests prove transport. This foundation does not complete sign-in acceptance or
OIDC/browser/back-channel checks. The workspace HTTP callback/session fixture
remains scheduled for T018–T019, when that actual flow exists.

### T013 first-sign-in test checkpoint

`packages/accounts/src/complete-first-sign-in/complete-first-sign-in.test.ts`
defines 47 cases for the five Story 1 acceptance scenarios and their backend
boundaries. At that checkpoint it imported the future action from
`complete-first-sign-in.server.ts`, scheduled for T015, and stopped at that
missing module. There was no substitute action, skipped case or authentication
bypass. T015 now implements that action, makes all 47 original assertions pass
and restores the complete type check.

The existing 249 tests, all six application/package type checks and all three
builds passed in the isolated T013 checkout on 2026-10-27. With T015 implemented,
run the complete suite:

```bash
bun run test
```

The shared fixture now supports preparing a privately created login before its
first HTTP sign-in. It waits for Better Auth's native startup schema check before
storage can be reset. Three temporary workerd checks verified no prepared session,
real HTTP sign-in, current complete/incomplete profile access and reserved-name
reference data. Those checks and their data/output were removed afterward.

Authored cases cover missing/invalid fields, required username confirmation,
invalid/taken/reserved usernames, canonical phone storage, unchanged neighboring
records, public registration refusal, direct-call authority checks, ended/inactive
sessions, unfinished creation, repeat submissions, competing username choices and
profile/audit rollback. T013 uses the actual named Hub binding for request access.
The typed boundary and safe result codes are documented in
[the server-function contract](./contracts/server-functions.md#completefirstsignin).

Official references checked for installed Better Auth 1.7.12:
[version index](https://better-auth.com/llms.txt),
[username plugin](https://better-auth.com/docs/plugins/username) and
[server API](https://better-auth.com/docs/concepts/api). Native username validation
and availability are checked against the installed source as well; the existing
xpro database constraints also protect uniqueness and reservations.

The protected-access result proves readiness for the next sign-in step; it does
not prove a redirect or OIDC exchange. Actual destinations follow T017–T019.
The warning's text, form behavior and browser journeys follow T016/T041. Story 1
is not complete until those checks run against its implemented screens and routes.

### T014 profile rules and username availability

The browser-safe Accounts entry exports `nameSchema`, `normalizePhone` and the
existing username/profile validity checks. Names are trimmed and must be non-empty.
Phone input supplies a supported country and a string number; the approved
`libphonenumber-js/max` parser returns canonical international format or `null`.
Surrounding descriptive text and extensions are refused. An explicit international
prefix takes precedence over the selected default country, as the library documents.
Email validation continues to reuse T010's trimming/lowercase schema; the existing
Hub expression index enforces case/space-insensitive uniqueness.

The server-only `@xpro/accounts/server` entry exports `checkUsername`. It reads
ownership and reservations in one indexed query, returning only the candidate
username or its named refusal. A check does not reserve a name. Saving must still
respect the existing database constraints. Unexpected database failures throw to
the authorized caller's safe error boundary; the helper is not a public endpoint.

Core now supplies the existing native D1 adapter constructor as
`createHubConnection<Database>`. The Hub retains its complete table model,
migrations and typed `createHubDatabase` alias. Accounts uses a minimal table view.
No runtime or storage configuration changes. See
[ADR-015](../../docs/adr/015-shared-hub-connection.md).

The native username plugin reuses the shared format validator. Explicit
pre-normalization validation preserves strict new username input and the installed
plugin's normalized username sign-in; real HTTP tests verify approved punctuation
and uppercase sign-in. The unused native `/is-username-available` route returns 404,
including before migrations. Its native check does not consult xpro reservations.

In the isolated T014 checkout on 2026-10-27, 288 implemented tests passed in workerd,
all six application/package type checks and all three builds passed, frozen install
and audit passed, and the supported schema check reported no pending changes.
Query plans used both existing indexes. Two temporary mutations broke reservation
and phone-extension refusal, and their tests failed; the source was restored.
Temporary mutation files, coverage, data and build output were removed afterward.

At the T014 checkpoint, T013's 47 cases still stopped at the missing completion
module. T015 below supplies the save path and authenticated Hub action.

Official references: [Better Auth username plugin](https://better-auth.com/docs/plugins/username),
[Kysely expression builder](https://kysely.dev/docs/recipes/expressions),
[libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js).

### T015 profile-completion backend

`@xpro/accounts/server` now exports `completeFirstSignIn`. It authorizes the
person's own completion, validates all submitted fields and preserves valid
stored details. A first or repaired username requires explicit confirmation.
The shared username check and database constraints enforce current ownership
and reservations, including inactive logins.

Accounts uses the existing Hub batch helper through `@xpro/core/server`.
A profile snapshot guards both the new username audit and the profile update;
D1 commits them together or rolls both back. Contact-only completion adds no
identifier audit and does not reassign an already owned username. A repeated
completed submission changes no records. See
[ADR-016](../../docs/adr/016-atomic-profile-completion.md).

The thin Hub `completeFirstSignIn` server function uses POST, native signed-cookie
authentication and the shared live access check. It validates input before
calling Accounts, which validates again before saving. Responses contain only
the login ID or a safe code/message/request ID with known invalid field names.
Caller-supplied identity, privilege and request-ID claims cannot determine the
acting login or audit. Start's default CSRF protection remains enabled.

The isolated T015 checkout passed 356 workerd tests, the complete app/package
and test-project type check, all three builds, frozen install, dependency audit
and native auth-schema comparison. The completion file contains the original
47 cases plus six regression checks; the Hub boundary has 15 cases. Temporary
mutations of confirmation, the username snapshot guard and D1 batch atomicity
failed the relevant tests, then the source was restored.

The built Worker also passed seven real HTTP checks for session refusal,
cross-site refusal, method restriction, strict input, confirmation, own-profile
saving and repeat submission. D1 readback verified exactly one username audit
and unchanged neighboring identity, session, credential and workspace records.
Temporary fixtures, local state, processes, logs and build/test output were
removed afterward; the original repository's local state and certificates were
left untouched.

T017 below writes the next backend tests. T016's form and username warning,
actual sign-in destinations/OIDC and full browser acceptance remain pending.

### T016 profile-completion screen and browser checks

The Hub's /complete-profile route renders only missing or invalid username,
name and phone fields for the current native session. Existing valid values are
kept. Username selection requires the approved warning and confirmation; changing
the choice clears confirmation. The existing backend still decides availability
and saves normalized values.

The form retains input on errors, shows field messages and a summary, and moves
focus to the first invalid field. Controls wait for browser hydration, then
disable during a save. Blur validation preserves pointer activation and keyboard
behavior. Complete profiles resume the destination; signed workspace sign-in uses
the native provider continuation and keeps its signed parameters through errors.

The new screen uses the approved Base UI/shadcn controls, TanStack Form, Tailwind
tokens and Paraglide messages. The Hub's generation script compiles the local
message files before Workers tests and type generation. Vite handles compilation
for development/builds. Generated message code and inlang working files are not
source files to edit.

After the HTTPS certificate setup above, install the browser once and run from
the repository root:

```bash
bun run test:e2e:install
bun run test:e2e
```

If Google Chrome is already installed, it can be selected without downloading
Chromium:

```bash
PLAYWRIGHT_CHANNEL=chrome bun run test:e2e
```

The runner requires Bun, Node.js, Git, mkcert and the development certificate.
Ports 3000/3001 and 9230/9231 must be free; it refuses to reuse existing servers. It makes a
fresh source copy, installs the frozen graph, applies actual local migrations,
and creates fake logins/native cookies for its own D1 data. The readiness check
verifies HTTPS with mkcert's public CA; Playwright accepts the development
certificate in its isolated browser context. It stops its processes and removes
its copy, data, screenshots and reports after success or failure.

There are 23 screen checks: all required-field combinations, private SSR, native
cookies, skipped complete profiles, controls before hydration, keyboard/focus,
confirmation/reset, error correction, busy saves, unknown replies, ended sessions,
concurrent completion and native signed continuation. Accessibility, dark theme,
narrow/RTL layout and pseudo-language checks pass. This does not complete the
full six-story browser journeys or hosted verification in T041–T045.

An unauthenticated Hub now reaches T022's /sign-in screen below. Completion
checks still prepare their own native sessions; no test-only application sign-in
route exists. See [the checkpoint](./tasks.md#t016-profile-completion-screen-checkpoint)
and [ADR-032](../../docs/adr/032-profile-completion-screen.md).

### T022 Hub sign-in screen

Open the Hub after configuring its private settings above. Manual sign-in needs
a real Turnstile widget allowing hub.localhost and its paired public site key and
secret. The explicit widget sends action sign-in; the existing native backend
checks that action and the Hub hostname. Never use the dummy keys in production.

The page accepts email or username, uses native paste/autofill and preserves the
password exactly. Empty fields are checked on blur or submission. Refusals keep
input, show the specified translated message/reference, and obtain a new security
challenge. Submission is disabled before hydration, while the challenge is
incomplete, and while credentials are being sent. There is no automatic retry.
Forgotten passwords still go through the administrator.

Successful direct sign-in uses the existing destination rules. Missing profile
details lead to completion; unassigned people see the approved /no-workspace
message. Workspace links retain the native signed continuation through errors
and completion. Master/account destinations remain their existing addresses;
their feature screens are still pending.

Use the existing bun run test:e2e wrapper for 55 permanent screen/boundary checks. Its
isolated copy includes paired dummy keys and a guarded external Siteverify stub.
The Web FetchInterceptor is test tooling: full MSW network coordination requires
BroadcastChannel, absent from standalone workerd. External widget/verification
responses can be controlled; native authentication, D1, cookies and signed
continuation are real. Original app sources never import that external stub.
The runner still removes its copy, local state, private fixtures and processes.

A separate smoke check also loaded Cloudflare's actual official test-key widget
and completed native sign-in. Its temporary test and image are removed after
visual review. Deployed widget configuration and full six-story acceptance
remain pending. The native workspace browser exchange and mounted-tab draft
return are covered below. See
[ADR-033](../../docs/adr/033-native-hub-sign-in-screen.md) and
[the checkpoint](./tasks.md#t022-hub-sign-in-screen-checkpoint).

### T022 workspace session return

The workspace now keeps the current page and its non-secret unsaved input
mounted after an ended-session response or failed internal navigation check.
A blocking dialog hides the page and moves focus to its heading. It cannot be
dismissed to reveal the blocked page.

Open sign-in from that dialog in a new tab, then return to the original tab or
select Continue. A fresh server check must confirm the same login and current
workspace access before the page becomes usable. A different login stays
blocked and can explicitly reload, discarding the old draft. An unavailable
connection shows a retry message; it is not treated as proof of an ended
session. Requests that may have changed data are never replayed.

The mounted page ID is only a precondition: the workspace authenticates the
actual cookie first and refuses a different login before running dynamic
handlers. It is not an access cache or caller-supplied identity proof. The page
read reuses the live access context and returns only the current login ID.

The browser wrapper now starts its own Hub and workspace. It prepares a real
native confidential client and workspace, creates tenant logins through the
existing authorized creation function, and finishes the actual token/callback
exchange. Its temporary draft form exercises React state, fields and the real
request/navigation boundary; no fixture route is shipped. The 55 checks include
same-login return, different-login refusal, lost connections and stale replies,
with accessibility, narrow/RTL, dark and pseudo-language checks.

Drafts are kept only in the mounted tab; reloads, closing it and arbitrary
cross-document navigation cannot recover them. No draft, session token or
credentials are written to browser storage. Workspace business forms and
protected client loaders are still future work. Their reads must use this
boundary without replacing a mounted draft after access fails.

Both local Vite servers require HTTPS. Their development-only middleware
restores that known scheme during the Cloudflare plugin's internal service
hop; actual binding tests protect this workaround. Remove it when the platform
preserves the scheme itself. Production still checks the exact configured HTTPS
origin. No runtime, Worker binding, deployment setting or external package
version changes in this slice.

See [ADR-034](../../docs/adr/034-mounted-workspace-session-return.md) and
[the checkpoint](./tasks.md#t022-workspace-session-return-checkpoint).

### T027 create-login screen

Sign in with a master login or a workspace owner/user that currently has native
member:create permission, then open /create-login on the Hub. There is no
public registration. Non-permitted members cannot open this form.

Tenant creators see their own workspace fixed and choose internal or external
user type. Masters may create an unassigned login or select a prepared workspace.
Workspace choices use pages of 20, newest first; the primary address
distinguishes workspaces with the same name. Browsing retains the selection.

Enter email, username, full name, country/phone and an ordinary password. The
existing creation service handles native identity, membership, workspace user
and the creation audit. A complete new profile can immediately sign in with
that password. The form creates no Account, workspace or master login. It adds
no invitation, expiry, shown-once password rule or forced password change.

Input and identifier errors retain the entered values. Correcting a known
refusal and submitting again starts a new creation reference. An unknown or
lost response instead fixes the original reference, details and password for
an explicit Retry creation action; it never silently creates a second request.
Keep that tab open. If the session ends, sign in as the same person in a new
tab, then retry. Another signed-in person is refused before the first write
and must explicitly reload to start their own form.

Confirmed success clears the password and shows the email/username for handover
through the usual channel. Create another login starts a fresh form. Pending
requests live only in component memory; closing/reloading loses that browser
copy. No password, session or creation draft is saved in browser storage.
Retrieval across those boundaries is a marked future upgrade.

Run the isolated checks from the repository root using the existing setup:

```bash
bun run test
bun run typecheck
bun run build:all
PLAYWRIGHT_CHANNEL=chrome bun run test:e2e
```

The browser runner prepares real native cookies, organizations and a local
workspace in its guarded source copy. Its creation cases cover tenant/master
scope, direct sign-in and internal workspace entry, identifier corrections,
busy controls, lost committed replies, ended/changed logins, silent autofill,
workspace-list failures and paging, accessibility, dark, narrow/RTL and expanded
translations. Only external services and interrupted HTTP transport are
substituted. The runner removes its own settings, data, reports and processes.
Full hosted journeys, Portal behaviour and release acceptance remain pending.

See [ADR-035](../../docs/adr/035-private-create-login-screen.md) and
[the checkpoint](./tasks.md#t027-create-login-screen-checkpoint).

### T030 master password-reset control

The reusable ResetPassword control lives in
apps/hub/src/components/stms/reset-password.tsx. T040 places it on the STMS
login detail page. There is no standalone reset page.

Its host supplies the selected login ID/email and original page login ID from
authorized page data. The form shows the target, accepts an ordinary new
password and an optional comment, and uses the existing registered reset
service. Only a current master can perform a reset; workspace permissions and
page hints grant no authority. A different signed-in master is refused before
the first write. The optional page hint adds no extra authorization request.

The same mechanism covers ordinary logins, another master and the acting
master. Existing sessions end through the established backend rules; retained
workspace cookies are refused on their next live access check. Successful
self-reset offers normal sign-in. Handover stays outside xpro, without expiry
or a required password change.

Errors retain the entered password and comment. Unknown replies warn that a
reset may already have committed; check whether the entered password works.
Reset password again is a deliberately new reset, with a new audit, not recovery
of the earlier operation. The control never retries automatically or saves
credentials in browser storage. Confirmed success clears the form. Selecting
another login or page actor also clears it and isolates delayed responses.

Use the existing isolated runner from the repository root:

```bash
bun run test:e2e
```

After the browser/certificate setup above, an installed Chrome can be used with
PLAYWRIGHT_CHANNEL=chrome. The runner mounts the real control only in its guarded
copy, supplying public ID/email props from native fixture records. Real cookies,
authorization, hashing and writes remain in use; anonymous and tenant callers
are refused by the real service. The fixture route is never shipped.

The reset browser checks cover old-password and all-device session refusal,
normal new-password sign-in, optional comments, ordinary/master/self targets,
busy guards, lost replies, expired/changed logins, delayed target/actor switches,
oversized-comment correction with one click, autofill and accessible narrow/RTL,
dark and expanded-language layouts. Test copies, data, reports and processes
are removed. T040 integration is delivered below; hosted journeys and release
acceptance remain pending.

See [ADR-036](../../docs/adr/036-private-password-reset-control.md) and
[the checkpoint](./tasks.md#t030-master-reset-control-checkpoint).

### T034 own-profile screen

After the existing local HTTPS/private-settings setup, start the Hub with
`bun run dev:hub` from the repository root. Sign in with a prepared active,
complete login and open `https://hub.localhost:3001/profile`.

The page shows read-only email/username and separate forms for name/phone,
picture and password. Choose a country and keep name/phone populated. A saved
password ends other sessions while the actual native replacement cookie keeps
this browser signed in. An uncertain reply preserves both entries and explains
how to check normal sign-in with either password before submitting again.

Choose an original JPG/PNG/WebP no larger than 2 MiB, adjust the square by pointer
or keyboard and save. The screen sends only bounded square PNG output through
the existing native processor. The saved picture is circular; removal restores
initials. Picture reads require the current actor and current revision, with
private/no-store responses. Discarding or replacing selected files releases their
browser URLs. Another section's dirty values remain in place.

Expired access keeps the drafts mounted behind an inaccessible background. Sign
in as the same person in a new tab, then use Check access and continue. A changed
person must reload. No write is automatically replayed and nothing is saved in
browser storage. Closing or reloading can discard unsaved input.

Run all isolated browser checks, or only this screen, from the repository root:

```bash
bun run test:e2e
bun run test:e2e tests/e2e/profile.spec.ts
```

The runner uses real native authentication, services, D1/R2 and local Images;
only outside verification is substituted. It creates temporary private settings
and data and removes its copies, reports and processes afterward. Use installed
Chrome with PLAYWRIGHT_CHANNEL=chrome after the existing certificate setup when
needed. Hosted image fidelity, deployed journeys and release acceptance remain
pending. See [ADR-037](../../docs/adr/037-private-own-profile-screen.md) and
[the checkpoint](./tasks.md#t034-own-profile-screen-checkpoint).

### T040 STMS screens

After the existing HTTPS/private-settings setup and initial-master procedure,
start the Hub with `bun run dev:hub` from the repository root. Sign in as an
active, complete global master and open `https://hub.localhost:3001/stms/logins`.
The existing `/stms` destination redirects here. Workspace permissions alone
do not allow access.

Search literal prefixes of name, email or username. The address keeps the search
and page offset through reloads, pagination, detail links and the back link.
The server returns 25 records per page, newest first; creation times show UTC.
Open a login to see its workspace and manage status, email, username or password.
Suspend and archive require confirmation. Suspend requires a reason; only Other
requires a comment. All other comments are optional. Self-suspend and self-archive
are disabled; self-identifier changes and resets follow the same backend rules.

Archives leave the normal directory and search. Keep the detail address to
restore a known archived login. Restoring retains its previous active/suspended
state and password; neither restoration nor reactivation restores old sessions.
No archive directory or additional-master management screen is introduced.

The page never retries a write automatically. An unknown reply can follow a
committed change; use the offered readback before deliberately submitting again.
For reset uncertainty, use the existing password/sign-in guidance. Confirmed
self-changes show success before asking for sign-in again. Expired access keeps
drafts mounted: sign in as the same master in another tab, then check access.
A different master cannot resume the old page. Reloading can discard unsaved input;
nothing is persisted in browser storage.

Run the isolated browser suite or this screen alone from the repository root:

```bash
bun run test:e2e
bun run test:e2e tests/e2e/stms.spec.ts
```

Use `PLAYWRIGHT_CHANNEL=chrome` with an installed Chrome when needed after the
certificate setup. The existing wrapper creates its own native logins, sessions,
D1/R2 and workspace fixtures, then removes its copies, data, reports and processes.
Only outside verification is substituted. The 31 STMS cases include actual
revocation/sign-in, no-ops, lost replies, retained drafts, changed actors and
accessible narrow, dark, expanded-language and RTL layouts. Delayed hydration
cannot scroll a pagination link away during a mouse press. Full local checks
pass; deployed journeys, hosted image fidelity and final acceptance/release work
remain pending. See [ADR-038](../../docs/adr/038-private-stms-login-screens.md).

### T041 local browser acceptance

Use the existing trusted mkcert CA and installed Chromium/Chrome. From the
repository root, run the wrapper rather than Playwright's config directly:

```bash
bun run test:e2e
bun run test:e2e tests/e2e/sign-in.spec.ts tests/e2e/create-login.spec.ts
```

With installed Chrome, prefix either command with `PLAYWRIGHT_CHANNEL=chrome`.
Ports 3000/3001/3002 and inspector ports 9230/9231/9232 must be free. The wrapper
runs all three actual dev scripts in its own copy. It issues a temporary server
certificate for localhost, `hub.localhost`, `web.localhost`, `router.localhost`,
`workspace.customer.test` and `missing.customer.test` using the already-trusted
CA; it neither installs a CA nor changes the system trust store or hosts file.
Chromium alone resolves the two `.test` hosts to loopback. The customer-domain
protocol cases reject invalid TLS certificates.

The copy registers the customer address and native OAuth callback/logout
metadata. Two local Fetcher bindings carry the actual provider's JWKS and
back-channel calls to the real Hub/router handlers; signing, verification,
placement, workspace access and storage remain real. A copy-only response
header counts successful native logout deliveries. The existing outside
Turnstile SDK/verification substitution remains explicit. No permanent public
test endpoint or source app configuration change is introduced.

Journeys now reach the minimal protected Hub `/account` and workspace `/portal`
pages, connect creation/profile/master changes to real sign-in, check two-device
sign-out, repeat callback/state/replay checks and refuse direct native bypasses.
The [43-scenario map](checklists/browser-acceptance.md) identifies browser and
Workers evidence. Fault injection/readback uses only guarded isolated storage;
triggers, certificates, data, copies, reports, logs and processes are removed.

These are local application checks through the accepted single-workspace router
fallback. Deployed Workers for Platforms dispatch, public DNS/edge certificates,
hosted image fidelity, T042 performance/accessibility and final release acceptance
remain pending. See [ADR-039](../../docs/adr/039-local-browser-acceptance.md).

### T042 keyboard and performance checks

Run the dedicated checks through the same isolated wrapper:

```bash
bun run test:e2e tests/e2e/accessibility.spec.ts
```

Use `PLAYWRIGHT_CHANNEL=chrome` with installed Chrome after the existing CA setup.
No new tool, binding or app configuration is needed. The suite uses real Tab
traversal, keyboard native selects, Enter/Space actions, crop arrows and popup
sign-in. Playwright supplies file selection after Space opens the native chooser.
It scans pages, errors, busy forms, crops and confirmations with the existing axe
package. Earlier suites retain additional paste/autofill, layout and failure cases.

Each sign-in case applies 50 ms minimum request-to-response-header latency,
10 Mbps download and 2 Mbps upload through Chromium's request-network emulation.
The 3,000 ms limit runs from keyboard submission until the exact destination and
visible main heading; form setup and later hydration are outside that metric.
The 60,000 ms master case times keyboard search entry through confirmed saved
suspension on the unthrottled local connection. Safe `T042 measurement` lines and
per-run attachments contain goal, elapsed time, limit and environment only.

These are fresh browser contexts on shared warm Vite/workerd servers, with the
outside Turnstile SDK/verification substituted. SDK routing disables HTTP caching;
unbundled development assets can hydrate slowly under the emulated link. The
checks do not claim hosted production latency, cold starts, real verification or
human task-completion speed. Repeat hosted measurements after setup is approved.

The draft case preserves the exact route and non-secret fields through actual
popup authentication and a fresh resume-handler access check. It permits the
Router's existing scroll-position storage, verifies form values are absent from
storage and sends no repeated action. Native browser focus-event delivery is not
asserted by the headless focus signal. Axe/keyboard automation also does not
replace manual, assistive-tech or inclusive-user assessment; see
[ADR-040](../../docs/adr/040-keyboard-and-timing-acceptance.md). Per-run copies,
certificates, data, reports, logs and processes are removed after verification.

### T043 security checks

Run from the repository root after the existing HTTPS/browser setup:

```bash
bun run test
PLAYWRIGHT_CHANNEL=chrome bun run test:e2e
bun run build:all
bun run typecheck
bun --filter @xpro/hub generate-auth-schema --check
bun install --frozen-lockfile
bun audit
```

Use `bun run test:e2e tests/e2e/security.spec.ts` for just the dedicated browser
security cases. Always use the isolated wrapper, which removes its generated
certificates, data, reports and processes. Keep its required ports free.

The shared Worker response policy denies framing, omits referrers and retains
native CSP and authentication cookies. Dedicated Workers tests cover response
shapes, safe genuine-error diagnostics and native same-origin/cross-site CSRF
decisions. Browser cases cover actual protected framing, escaped user values,
native logout confirmation and credentials absent from disallowed navigation
URLs and audit records. Only the exact OIDC callback may carry its one-use code.
The shared browser fixture awaits native schema validation before proxy disposal;
fast database read-back must not create a false error diagnostic.

The [security review](checklists/security-review.md) records every checklist item,
including missing privacy-request/anonymisation workflows, retention and the
free-text audit-comment policy. Worker headers and local production-build output
do not establish hosted static/edge behavior or observability. Strict script CSP,
HSTS, hosted image/dispatch checks and existing release gates need their separate
review. See [ADR-041](../../docs/adr/041-shared-response-security.md).

### T039 identifier changes and backend checkpoint

Masters can use the registered `changeEmail` and `changeUsername` Hub POST
functions. Comments are optional. The existing Accounts rules validate input:
email is trimmed/lowercased; usernames keep the strict lowercase 4–8 character
format. A master may change their own identifier, which ends their acting session.

One indexed D1 batch checks the current value and namespace, conditionally
records the audit, saves the change and revokes all target sessions/active
tokens. Username changes reserve the actual displaced name in that same batch;
missing usernames create no empty reservation and existing reservations keep
their history. Status, password, stable ID, profile, membership and tenant
records are retained. Inactive targets remain inactive.

Submitting an unchanged normalized value changes nothing, including timestamps,
verification, sessions, reservations and audit. Identical same-target requests
produce one audit and one unchanged success. A real email replacement clears
verification of the old address; existing email-verification routes remain
disabled. A username change preserves email verification and updates display
username. Old usernames cannot be reassigned.

A failed statement rolls back the whole change. A lost reply may follow a
complete commit: read current state before a fresh submission; there is no
automatic retry. A master whose own identifier changed signs in afresh.

The normal root commands now pass with no missing implementations: 1,490 tests
in 72 files, all seven type projects, all three builds, schema comparison,
frozen install and the 333-package audit. The final 69 T035 cases now execute;
17 additional storage and 41 HTTP cases cover the new boundaries. All six email
and seven username statements use existing indexes.

Temporary HTTPS checks call the actual Start functions, confirm directory
updates, safe refusals, no-ops, two-device/self-session ending and exact D1 state.
Native sign-in rejects old identifiers, accepts new ones with the same password,
and refuses old-username reassignment. Four mutations are detected and restored;
final review has no required findings. Temporary data, probes, settings, servers
and logs are removed. No new migration, package or configuration is needed by
T039; an existing database still needs the earlier T036 search migration.

Backend work is complete; feature screens and full browser/hosted acceptance
remain pending. Next is T016 (profile completion), then T022, T027, T030, T034
and T040 before T041–T045, following the approved delivery order.

See [ADR-031](../../docs/adr/031-atomic-login-identifiers.md) and the
[current task checkpoint](./tasks.md#t039-identifier-changes-and-backend-checkpoint).

### T038 archiving and restoration checkpoint

Masters can call the Hub's registered `archiveLogin` and `restoreLogin` POST
functions. Archive requires confirmation, with an optional comment and no
mandatory reason. Self-archive is refused; other masters follow the same rules.

Archiving keeps the login, unique identifiers, password, profile, R2 picture,
membership and local history. One atomic batch claims the expected state,
records the previous active/suspended status from the current row, writes its
audit and ends all target sessions/active tokens. Concurrent identical requests
have one winner. The shared helper also keeps suspension's revocation behavior.

Restore clears the archive markers while preserving native suspension/reason.
It requires valid previous-status metadata matching that retained state; invalid
history returns a safe conflict. It does not restore old devices/tokens or a
membership removed while archived. A previously active person signs in afresh
with the same password; a previously suspended person remains suspended.
The normal directory hides archives; known-ID detail remains available.

No new migration, package or configuration is needed for T038. Existing Hub
databases still need T036's documented search migration. Normal root checks pass
1,363 tests in 69 files, six app/package type projects, three builds, schema
comparison, frozen install and audit. Full tests/test typing still fail only on
T039's pending suite and two missing imports (69 written cases).

All 40 original archive cases execute; ten added storage cases and 35 additional
HTTP cases protect stale preparation, invalid history, lost replies and safe
boundaries. Native HTTPS checks both real functions, visibility, two-device
revocation, active/suspended restoration and fresh sign-in. Read-back confirms
four master/request-correlated audits, retained R2 bytes and unchanged credentials,
membership and unrelated records. Browser screens and hosted acceptance remain
pending. Four deliberate mutations are detected and restored; final review has
no required findings. Temporary data, settings, probes, servers and logs are removed.

See [ADR-030](../../docs/adr/030-atomic-login-archiving.md) and the
[task checkpoint](./tasks.md#t038-archiving-and-restoration-checkpoint).
T039 is next; screens remain deferred.

### T037 suspension and reactivation checkpoint

The Hub now registers master-only `suspendLogin` and `reactivateLogin` POST
functions. Suspension requires confirmation and one fixed reason; only Other
needs a meaningful comment. Masters cannot suspend themselves. Native HTTP
ban/unban routes stay disabled, so they cannot bypass the audited action.

One atomic D1 batch looks up the target, claims its expected nonarchived status
through a new row in the existing audit table, and gates every later write on that fresh ID.
Suspension has no expiry and ends all target sessions and active issued tokens.
Reactivation clears suspension without restoring any old device or token.
Credentials, profile, membership and unrelated records are preserved. Retained
workspace cookies fail the existing live Hub check on their next action;
idle-screen logout messages remain deferred as documented for password reset.

A missing target returns a safe 404; an already completed or inapplicable
transition returns 409 without another audit. An interrupted response can follow
a committed change. There is no automatic retry: read current state first.
No new schema migration, dependency or deployment configuration is added by
T037. Existing databases still need T036's documented search migration.

Use the normal root verification commands. At this checkpoint, 1,278 tests
in 67 files pass, including the 58 original suspension/reactivation cases and
42 additional storage/HTTP cases. T038–T039's two suites still cannot load
their four missing modules (109 written cases), so full tests and test typing
remain unsuccessful for those expected imports only. Six app/package type
checks, three builds, schema comparison, frozen install and audit pass.

Temporary HTTPS checks call both real Start functions with native cookies and
confirm two-device revocation, no revival, safe boundaries and exact persisted
state. They do not prove screens or hosted acceptance. Mutations of master
access, atomic batching and token scope are detected and restored. Final review
has no required findings; temporary data, settings, servers and logs are removed.

See [ADR-029](../../docs/adr/029-atomic-login-status.md) and the
[task checkpoint](./tasks.md#t037-suspension-and-reactivation-checkpoint).
T038 is next; screens remain deferred.

### T036 indexed login directory checkpoint

The Hub now registers master-only `listLogins`, `searchLogins` and `getLogin`
POST functions. They use live native cookies and the existing exact-Origin,
64 KiB JSON gate. Tenant roles cannot grant global access. List/search hide
archives; known-ID detail includes archive status and workspace membership.
Responses contain explicit DTOs, fresh request IDs and no-store headers.

Search uses literal normalized prefixes across name/email/username, with
default 25 and maximum 100 rows. Names use a private trim/lowercase JavaScript
copy; punctuation and accents remain significant. This is not full Unicode
case folding. Three indexed UNION branches and BINARY ranges support long
inputs without D1's 50-byte LIKE limit. Deep offset pages can still cost work.

Before opening the new directory on an existing database, run
`createHubMigrator(database).migrateToLatest()` serially with login
creation/name writes paused, and check its returned error. The additive
`2026-10-29-100000-login-search` migration fills missing derived copies in
25-row chunks; rerunning resumes after interruption. Older writers do not
maintain the copy. If rolled-back code writes names, pause those writes,
clear `name_search` to NULL with Kysely, then call
`fillMissingLoginSearchNames` before enabling this version's directory.
The existing local initial-master runner also applies all registered migrations;
there is no new remote migration command or public repair endpoint.

Normal verification remains:

```bash
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run build:all
bun --filter @xpro/hub generate-auth-schema --check
bun audit
```

At this checkpoint, 1,178 tests in 64 files pass. Three suites still cannot
load T037–T039's six missing modules, so the normal full-test command exits
unsuccessfully; test typing reports those same six imports. All six
app/package type checks, three builds, schema comparison, frozen install
and audit pass. The 167 future write cases remain unexecuted.

The separate Seroval prerequisite pins the existing serializer to 1.6.11,
fixing five audit findings. Five permanent Workers regressions check the JSON
decoder and generated output. A bounded malformed request to the actual Start
decoder is refused before authentication; the following valid request succeeds.

Temporary trusted-HTTPS checks exercise all three registered functions and
confirm unchanged canonical state. Mutation checks detect broken authority,
archive filtering and range bounds. These checks do not prove screens,
hosted deployment or the one-minute search goal. Independent review has no
required findings. Probes, data, settings, servers and logs are removed.

See the [task checkpoint](./tasks.md#t036-indexed-login-directory-checkpoint)
and [ADR-028](../../docs/adr/028-indexed-master-login-reads.md).
T037 is next; screens remain deferred.

### T035 master login-management test checkpoint (historical)

- **Tests first:** 220 cases in four STMS suites await seven real modules in
  T036–T039. No missing action is replaced by a stub or fake.
- **Commands:** the normal test command passes all 1,055 implemented cases and
  reports four missing-action suites. Type checking passes six app/package
  projects and reports only seven missing test imports. All three builds pass.
- **Evidence:** five temporary fixture controls pass; an inverted login lookup
  fails one. These controls are removed and do not prove the future actions.
- **Details:** the [task checkpoint](./tasks.md#t035-master-login-management-test-checkpoint-historical),
  [action contract](./contracts/server-functions.md#master-login-management-test-boundary)
  and [ADR-027](../../docs/adr/027-master-login-management-boundaries.md) describe
  coverage, boundary choices and limits. No production action or configuration
  is added. T036 is next; screens remain deferred.

### T033 picture backend checkpoint

Use the existing root test, type-check and build commands. All 1,055 tests in
59 files, all seven type projects and all three builds pass. The earlier missing
picture import is resolved. Frozen install, native schema comparison and the
333-package audit also pass. T035 supplies the next backend tests; T034's profile
screen and picture-serving route remain pending.

The Hub accepts exact-Origin multipart POST at `/api/v1/profile-pictures` with
one `file` field and a current complete, active login. The request is capped at
2 MiB plus 64 KiB multipart overhead; the file itself is at most 2 MiB. The
Images binding decodes JPEG/PNG/WebP and produces a still square PNG with side
min(width, height, 512), without upscaling. PNG output removes metadata. Only
this output reaches the existing private R2 bucket. Removal is a registered
JSON POST server function; both actions return only `{ loginId }`.

R2 and D1 cannot share a transaction. The server stages the new object, guards
the key update against a competing picture change, and deletes the old file
after commit. A lost reply is checked by reading back. If that fails, keep
possibly active files and return a safe error. Cleanup failure after commit
keeps success and logs safely; private orphan files may remain. No automatic
write retry or recovery ledger is added. See the scoped exception and cleanup
upgrade trigger in [ADR-026](../../docs/adr/026-bounded-private-profile-pictures.md).

`IMAGES` is configured for the Hub, its local environment and the test Worker.
Local binding use needs no hosted account access; remote bindings stay disabled.
Before deployment, review the hosted Images account setup and current
[transformation allowance](https://developers.cloudflare.com/images/pricing/).
Quota/service failures return a safe error while preserving the old picture.

The installed local image simulator has limited transformation fidelity and can
return an uncoded error for corrupt JPEG metadata. Tests preserve that safe 500
rather than matching native error text. Documented typed error cases are also
covered. Actual local output checks prove square PNG dimensions and absent
camera/location metadata; staging must verify full-fidelity cropping,
orientation, animation and decoder refusals. Browser crop interaction, serving,
circular display and initials remain T034.

All 63 picture cases pass, including the original 22. Mutation controls detect
a missing concurrency guard, original-byte storage and deletion after an
unconfirmed commit. Twelve native HTTPS checks and two persistent D1/R2
readbacks verify real multipart replacement, registered removal, unchanged
sessions and the unrelated login. Independent review has no required findings.
Temporary probes, data, settings, logs and servers are removed after checks.

### T032 profile and password backend checkpoint (historical)

The registered Hub POST functions now save the acting person's name/phone and
change their password through Accounts' server entry. T034 supplies the form
later; these are backend functions, not complete browser screens.

The profile update uses the existing name/phone rules and saves both details
together in one indexed statement. Identity, status, picture, membership and
workspace records stay outside that write.

The password function requires the current password and the existing new-password
rules, then calls Better Auth. It returns only `{ loginId }` as JSON and forwards
the actual replacement cookie as a header. Old Hub sessions and retained
workspace cookies fail the next protected action; the new Hub cookie works.

Native writes on D1 remain sequential. A failed credential write can leave the old
password with ended sessions. If creating the replacement session fails after the
password write, the new password remains without a new cookie. This scoped save
exception is recorded in
[ADR-025](../../docs/adr/025-native-own-password-changes.md). The action returns a
safe error and does not retry automatically. Sign in normally with whichever
password was saved, or ask a master to reset it.

All 82 profile/password cases pass, including the original 44 T031 cases,
indexed storage, safe HTTP results, current-session races and real issued-token
revocation. Triggers verify all three native failure stages and one matching
safe HTTP log. The full run passes 992 cases in 55 files; six app/package type
checks and all three builds pass. `bun run test` and the test-project part of
`bun run typecheck` still report only T033's missing `picture.server` module.
Its 22 picture cases cannot execute yet.

Frozen install, native schema comparison and the 333-package audit pass. The
running local Hub also passes 12 real HTTPS checks using native Start
serialization, real cookies and persisted D1 records. Read-back confirms the
changed profile and hash, one replacement session and the unrelated login.
Mutation checks detect wrong ownership, disabled revocation and dropped cookies;
the exact source is restored before final checks. Independent review has no
required findings.

T033 is next. Picture processing and upload support remain unimplemented; T034
must verify forms, circular pictures, initials, crop interaction and browser
acceptance. Temporary data, settings, probes, servers and logs are removed after
verification. No dependency, schema or configuration change is needed by T032.

### T031 own-profile test checkpoint (historical)

The three new Accounts suites define 66 cases: 22 profile, 22 own-password and
22 picture. They import these future implementations:

- `packages/accounts/src/update-profile/update-profile.server.ts` — T032.
- `packages/accounts/src/change-password/change-password.server.ts` — T032.
- `packages/accounts/src/picture/picture.server.ts` — T033.

The existing 910 tests in 51 files still pass. `bun run test` reports three suite
load failures for those modules; `bun run typecheck` passes the six app/package
projects and reports only the same three missing imports in the test project.
All three builds pass. No skips or substitute implementations make this
checkpoint appear complete.

Tests use real native sign-in, D1, R2 and two workspace databases. Five temporary
probes passed against the real fixture: returned native cookies authenticate,
old devices end, a wrong current password makes no change, a native credential
failure preserves the old password after ending sessions, picture bytes and
keys persist, and a new access check refuses an ended session. These are
fixture checks, not proof of the missing Accounts actions. The probes are removed.

Better Auth 1.7.12 creates a replacement current-device session when asked to end
other sessions. T032 must forward its actual cookie as a header, never as JSON.
On D1, session deletion, credential update and replacement-session creation are
separate native writes. The failure test records that limit; it does not prove
an atomic password change. The
[action contract](./contracts/server-functions.md#own-profile-picture-and-password)
keeps that boundary explicit.

Picture tests use a known cleaned square at the outside processor boundary.
They verify storage ownership, validation and cleanup, not actual image
decoding or metadata removal. T033 must verify the selected mechanism and its
runtime/test support using official documentation before proposing any new
binding or service. No Images binding or dependency is added here.

T032 is next. Production behavior and regression mutations remain pending until
T032/T033 run these cases against real implementations. Circular display,
initials, interactive crop, read-only profile fields and full browser acceptance
remain T034. Temporary files, local test data, logs and the isolated copy are
removed before approval; only the requested review patch remains.

### T029 password-reset backend checkpoint (historical)

The Hub registers a real POST server function for STMS's `resetPassword` action.
It requires the current native master session and shared live access check.
Keep the existing exact-Origin JSON gate and 64 KiB actual-byte limit before
Start deserializes the request. The action validates the same fields again.

Better Auth supplies the hash. One Hub batch updates or creates the native
credential, revokes active native access/refresh tokens, deletes every target
Hub session and writes one audit identifying the actual master and request.
Failed saves roll back all of it. Existing credential IDs, other logins,
workspace records and suspended/archived status are preserved.

Passwords are ordinary passwords: no temporary expiry, required comment or
forced next-sign-in change. Retained workspace cookies fail the next live Hub
check. Reset does not emit back-channel notifications. Do not automatically
retry an unknown result; a lost reply can follow a committed reset.

All 910 tests in 51 files, seven type-check projects and three builds pass.
The reset coverage has 68 cases: all original 44 plus 24 storage/HTTP checks.
Real query plans use existing indexes. Deliberately splitting the batch,
weakening the master gate or changing token scope fails seven, eight and three
tests respectively; exact files are restored before the final checks. Frozen
install, native schema comparison and the 333-package audit also pass.

Eight HTTPS checks against the running local Hub exercise the native framework
payload, real reset, old-session refusal and request protections. A native
sign-in check rejects the old password and accepts the new one, with one audit
matching the actual master and HTTP request. The temporary Hub is then stopped.

STMS uses direct references to the same locked result and UUID libraries.
Its pure-package annotation prevents unused reset code from entering the router;
the router stays at its previous 72,199 bytes. Schema and platform settings stay
as configured. See [ADR-024](../../docs/adr/024-atomic-password-reset.md) and the
[reset contract](./contracts/server-functions.md#resetpassword).

The reset screen remains T030 after the backend checkpoint. Continue backend
work with T031. Hosted dispatch and complete browser journeys remain release
checks. Temporary verification copies, settings, data, logs and output are removed.

### T028 password-reset test checkpoint (historical)

T028 adds 44 acceptance and failure cases in
`packages/stms/src/reset-password/reset-password.test.ts`. The fixture in
`tests/support/reset-password.ts` uses real native sign-in, hashing, Hub access,
D1 and two workspace databases. It does not implement the reset.

The tests require master-only access, an ordinary password with no expiry or
forced change, optional comments, all-device revocation and one audit identifying
the actual master. They preserve other logins and workspace records, cover reset
of another master and self-reset, and leave inactive targets inactive. Real
database triggers refuse each part of the save to require complete rollback.

Two temporary controls exercise all 44 cases: a password-only save fails 10,
and separate password/session/audit saves fail the two partial-save cases.
Both controls are removed before the final checks; neither supplies a reset
implementation in this checkpoint.

Run the normal commands:

```bash
bun run test
bun run typecheck
bun run build:all
```

At this checkpoint, the existing 842 tests in 48 files pass, but the full run
reports one additional failed suite: `./reset-password.server` does not exist yet.
The test-project type check reports that same missing import; all six app/package
type checks and all three builds pass. No skip or dummy implementation hides it.
Reset behavior stays unverified until T029 implements the action and its save.

T029 must reuse Better Auth's password handling and meet the existing STMS
save/audit rule. The native admin reset does not end sessions, and sequential
native calls do not provide one D1 commit with the audit. Do not weaken the
save rule to make the tests green. See the
[reset contract](./contracts/server-functions.md#resetpassword).

The next backend task is T029. The reset screen is T030 after the backend
checkpoint. Temporary controls, isolated copies, test data and logs are removed
after verification.

### T026 completed login creation checkpoint (historical)

- **Available:** the Hub POST server function creates a non-master login through
  native preparation, a real workspace save when needed, and one conditional
  Hub audit/completion batch. Matching repeats return the saved result and
  preserve passwords, membership roles and local records.
- **Access:** pending creation remains blocked on Hub and workspace paths.
  Public headers/body cannot authorize private writes. Worker and actual object
  RPC check the fixed workspace and object ID. Request context is UUID-validated.
- **Request:** current Hub server functions use exact-origin JSON POST and count
  at most 64 KiB of actual bytes before Start deserializes the unchanged native
  payload. Uploads or other encodings need a separate approved boundary.
- **Passing:** all 842 tests in 48 files, all seven type-check projects, all three
  builds, schema comparison, frozen install and the 333-package audit pass with
  no reported vulnerabilities. The creation suite includes all original 87
  cases and 11 additional cases. No missing modules or skipped cases remain.
- **Native checks:** nine built-Worker checks cover the real server function,
  genuine native session, private binding, D1/DO completion/repeat, refusal paths
  and platform-delivered props. The local Hub command also starts and passes
  three HTTPS refusal checks before being stopped.
  Two actual first-master CLI runs preserve the original password; native sign-in
  and the running Hub confirm that setup and development share the local database.
- **Mutation/review:** separate final saves fail two tests; reversing deployment
  scope fails three. Sources are restored before final checks. Independent review
  has no remaining required findings.
- **Limit:** the hosted namespace and deployed routing/DNS/TLS need staging
  verification. The props probe uses a local service binding. Screens and full
  browser acceptance remain pending; the next backend task is T028.
- **Cleanup:** temporary verification copies, probe adapters, private test settings,
  data, logs, certificate links and generated output are removed after checking.
  See [ADR-023](../../docs/adr/023-complete-creation-and-private-workspace-save.md).

### T025 native login creation and recovery checkpoint (historical)

- **Available:** Accounts `createLogin` validates input and current creator
  authority, binds the saved request and prepares missing native login/password/
  membership records. The Hub owns native auth calls and the Organization
  `member:create` check. Existing passwords and membership roles are preserved.
- **Boundary:** `PreparedLoginCreation` is an internal checkpoint. It does not
  finish creation, save a workspace user, issue a session or expose public success.
  Native sign-in for a pending login still returns `core_creation_incomplete`.
- **Passing:** 706 collected tests in 43 files, including 51 new native/D1 cases.
  All six app/package type checks, three builds, native schema comparison,
  frozen installation and the 333-package audit pass with no vulnerabilities.
  Removing the permission guard fails four cases; inverting the credential guard
  fails three. Exact sources were restored before the full run.
- **Replay:** completed-marker fixtures exercise only saved-reference replay and
  pointer/link refusal. They do not verify the future completion batch.
- **Pending:** the 87 full creation cases still cannot collect, and the test-project
  check reports the same two missing T026 modules. T026 must supply real local
  saving, required-record confirmation, atomic creation audit/completion and
  the public server-function/authenticated private workspace transport.
- **Cleanup:** the isolated verification copy, mutation backups, data, logs and
  generated output were removed. Permanent behavior tests remain. See
  [ADR-022](../../docs/adr/022-native-login-creation-recovery.md).

### T024 saved-reference and initial-link checkpoint (historical)

- **Available:** `prepareLoginCreation` saves one canonical, non-secret request
  and preserves matching repeats. `readCreatedLogin` uses its unique initial
  association. A trusted native auth snapshot sets that association before the
  first user insert; body data cannot set or replace it.
- **Passing:** all 655 collected tests in 42 files, including 43 new reference/
  hook cases. All six app/package type checks and all three builds pass.
  The native schema comparison, frozen install and 333-package audit pass;
  no vulnerabilities are reported. No migration or dependency is added.
- **Pending:** the 87 full creation cases have not executed. The test command
  still reports one collection failure and the test-project type check reports
  the same two missing production imports described at T023 below.
- **Next:** T025 checks live creator permission and completes recovery/
  orchestration; T026 supplies local saving, the final audited batch and
  authenticated private workspace transport. No public creation flow is added
  by this foundation alone.
- **Cleanup:** the isolated verification copy, mutation backups, data, logs
  and build output were removed after checking. See
  [ADR-021](../../docs/adr/021-initial-login-creation-link.md).

### T023 login-creation test checkpoint (historical)

- **Authored:** 87 cases cover Story 6 and the documented prototype behaviors,
  including interrupted saves, concurrent retries, unchanged saved passwords,
  complete first sign-in and isolation of unrelated records/workspaces.
- **Passing:** 612 tests pass in 40 files: the prior 606 and six checks of the
  real-D1 interruption fixture. All six app/package type checks and all three
  builds pass. Frozen installation succeeds without dependency changes.
- **Expected failure:** the ordinary full test command also reports one suite
  that cannot collect. Its missing production imports are
  `apps/hub/src/functions/create-login.server.ts` and
  `packages/core/src/workspace-users/workspace-users.db.ts`. The test-project
  type check reports the same two missing modules and no other errors.
- **Limit:** the 87 creation cases have not executed. T024–T026 must implement
  creation before these tests can verify it. No skip, fake implementation or
  disabled error hides this checkpoint.
- **Cleanup:** the isolated verification copy, mutation backup, logs, runtime
  data and build output were removed; permanent behavior tests remain.
- **Next:** T024, followed by T025/T026 under the approved backend-first order.
  The actual server-function/private-workspace transport must be checked in
  T026. See the [test boundary](./contracts/server-functions.md#story-6-test-boundary).

### T021 prepared-address routing checkpoint (historical)

Primary and custom addresses resolve through a typed private Hub binding and
the existing KV copy. The workspace independently validates its configured
identity, allowed origin, real object ID, encrypted session and live Hub access.
The router never supplies identity or permissions.

The public object handler composes the existing auth endpoints. Protected
requests share their prepared access/storage context with native rendering;
cookie-backed writes require the same Origin. The Hub uses the existing
Accounts rules for requested/default destinations. External users reach
`/portal`; a master can enter a prepared workspace without membership.

The new tests cover full routed native sign-in on primary/custom addresses,
hint forgery, wrong targets and object IDs, body preservation, cache hits,
fallbacks, revocation, local archival and safe configuration failures.
Directory tests cover real query plans, constraints and migration restart.
Inverting the object-ID guard caused four failures; it was restored exactly.

A separate local probe used the built Hub, router and workspace Workers,
real native identity/client preparation and the production HTML renderer.
It completed OIDC, consumed the HTML stream, checked that private settings
were absent from HTML, ended the device session and refused its next request.
Only Siteverify was an outside-provider stand-in. Its private seed adapters,
probe data, logs and temporary runtime were removed after checking.

All 606 tests across 39 files, all seven type-check projects and all three
builds pass. Frozen install and the 333-package audit pass with no reported
vulnerabilities. Independent review has no required findings.

These checks do not prove deployed Workers-for-Platforms dispatch, customer
DNS/TLS or the complete browser journeys. Those checks, the earlier T018
runtime observation and release gates remain pending. See
[ADR-020](../../docs/adr/020-prepared-workspace-routing.md).

### T020 sign-in protection checkpoint (historical)

The public Hub entry requires its Turnstile secret and identifier limiter.
Better Auth's existing CAPTCHA plugin validates `x-captcha-response` for both
email and username sign-in. A token must belong to the configured Hub hostname
and use action `sign-in`. The native verification timeout is 10 seconds.

Configure a Turnstile widget for the Hub's hostname before connecting the T022
sign-in screen, and keep its secret in private settings. Automated tests use
MSW responses for Siteverify and require no real Turnstile credentials.
Private first-master setup continues to use trusted server APIs.

`SIGN_IN_RATE_LIMITER` targets 10 attempts per 60 seconds for each trimmed,
lower-case email or username. Oversized tokens are refused first; other parsed
submissions count before native CAPTCHA and credentials. These are approximate
counters in each Cloudflare location.
The Hub reserves namespace `1001`; confirm it is unused by unrelated Workers
in the target account before first deployment. The isolated test binding uses
`1002`. No IP counter, daily counter or additional storage is introduced.

Bot and limit refusals create no session and save only the safe refusal audit.
Provider or limiter failures stop sign-in and return the safe Core error.
Sign-out remains available without a bot token or a sign-in allowance.
The visible widget, screens and full browser acceptance remain T022/T041;
placement and public route composition remain T021.

See [ADR-019](../../docs/adr/019-sign-in-protection.md) for the decision and
verification. Use the existing root test, type-check, build and audit commands.
All 560 tests across 34 files pass, including the two previous limit-refusal
cases. All seven type-check projects and all three builds pass. Frozen install
and the 333-package audit pass; no vulnerabilities are reported.

### T019 workspace session checkpoint (historical)

The real Hub-to-workspace HTTP fixture now creates the local session and reads
its current identity. The callback clears pending state on success and failure;
its private cookie stays on the workspace's own address. Local session expiry
preserves the original Hub expiry, capped at 30 days.

The real-runtime tests cover device sign-out, native signed Hub messages,
repeated and missing delivery, redirect refusal, another workspace left
unchanged, cookie isolation and invalid signed claims. An expired short-lived
ID token remains usable by the native end-session flow for its original active
Hub session. Profile completion gates still apply to protected actions.

Use the existing repository commands:

```bash
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run build:all
bun audit
```

At this checkpoint, the full suite collects all 33 files: 518 tests pass and the
two T020 rate-limit refusals still fail. All six app/package type checks, the
test-project type check and all three builds pass. The audit checks 333 packages
and reports no vulnerabilities. No suite or case is skipped.

The native provider needs the Bun-managed patch described in
[ADR-018](../../docs/adr/018-workspace-sessions-and-logout.md), because workerd
rejects its original redirect mode. Frozen installation reapplies the patch;
its response handling continues to refuse redirects. `jose` 6.2.13 was already
installed and is now declared directly by the web app.

These are backend checks. Public route composition remains T021; real screens,
HTTPS/custom-domain browser journeys and unsaved-input restoration remain
T022/T041. Recheck the earlier T018 runtime observation before deployment.

### T017 sign-in test checkpoint (historical)

Two new files define 72 cases: 37 in Accounts for native credentials and
destination rules, and 35 in the workspace app for real OIDC and sessions.
They use current Better Auth 1.7.12 and oauth4webapi 3.8.8 documentation.
Better Auth keeps credential verification and its successful client response;
xpro supplies the approved failures, credential audit and product destinations.
See [the Story 2 contract](./contracts/server-functions.md#story-2-test-boundaries).

The root integration fixture uses actual migrations, D1, prepared organizations,
memberships and local user records, plus the existing Durable Object and private
Hub binding. Core exports its existing workspace connection constructor so those
fixtures reuse the same adapter. Clients are registered through the native admin
API with a real signed-in master. S256, confidential client authentication and
end-session support are enabled. Native end-session support is required for the
ID token's `sid`, which links a workspace session to the correct Hub device.
Only the outside Turnstile and rate-limit responses are stand-ins.

A temporary workerd probe completed native discovery, authorization, code
exchange and user info, checked claims and the signing key, and used a separate
customer domain. Disabling native end-session support made its session-link
assertion fail; the fixture was restored and the probe passed again. That proves
the fixture's native integration, not the missing application workflow.

The new suites stop before collection at missing production code. The
test-project type check reports exactly these five missing entry points:

- Accounts `getSignInDestination` in `sign-in/sign-in.server.ts` (T018).
- Hub `handleHubAuthRequest` in `auth/oidc.server.ts` (T018).
- Workspace `startSignIn`/`finishSignIn` in `auth/oidc.server.ts` (T018/T019).
- Workspace `signOut` in `auth/sign-out.server.ts` (T019).
- Core's public `getCurrentUser` (T019).

The two limit-refusal cases also need T020's policy. No stub, permanent exclusion
or skipped test is used. At this checkpoint, `bun run test` reports 356 passing
implemented tests and two files that cannot collect. All six app/package type
checks, all three builds, frozen install, dependency audit and native schema
comparison pass. The full test-project check remains red for the stated imports.

For a green run of only the implemented checkpoint:

```bash
bun run test --exclude packages/accounts/src/sign-in/sign-in.test.ts --exclude apps/web/src/auth/oidc.test.ts
```

Temporary probes, mutation copies, local data, logs and build/test output are
removed after verification. The next task is T018. Host placement is T021;
unsaved browser input and actual screen behaviour remain T022/T041.

References: [Better Auth version index](https://better-auth.com/llms.txt),
[OAuth provider](https://better-auth.com/docs/plugins/oauth-provider),
[oauth4webapi 3.8.8 OIDC example](https://github.com/panva/oauth4webapi/blob/v3.8.8/examples/oidc.ts),
[Cloudflare test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/),
and [Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

