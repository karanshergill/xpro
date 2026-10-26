# Quickstart: Sign-in and Accounts

## Prepare

The scaffold starts the apps and local bindings. The Hub and workspace app
currently render the xpro shell. The router returns 404 until placement
routing is implemented in T021. Sign-in, schemas and application acceptance
tests follow in later tasks.

Use the existing Bun and Node.js setup. From the repository root:

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

The Hub has local `DB` (D1) and `PROFILE_PICTURES` (R2) bindings. The
workspace app has `HUB` and a SQLite-backed `WORKSPACES` Durable Object
namespace. The router has `HUB` and local `PLACEMENTS` (KV). Bindings have
`remote: false`; no Cloudflare resource IDs or credentials are required for
this local scaffold. Local state stays under each app's ignored `.wrangler/`
directory. Deployment resources, Worker logs/traces and the Workers for
Platforms dispatch namespace must be configured and reviewed before a deploy.

Check the scaffold from the repository root:

```bash
bun run typecheck
bun run build:all
```

Type checking regenerates the shared runtime types and each app's binding
types, then generates Hub routes and checks all six workspaces. Generated
Worker declarations and the Hub route tree are ignored by Git; rerun type
checking after config changes. All three Workers currently use the tested `2025-09-02` target and
approved flags, so their runtime declarations can be shared. Review the
shared type setup if a Worker later needs different compatibility settings.
The existing `bun run build` continues to build the workspace app;
`build:all` also builds the Hub and compiles the router with Wrangler's
`--dry-run` option. It does not upload Workers or create cloud resources.

The scaffold passed local HTTPS startup, service calls from both
the workspace and router to the Hub, and temporary D1/R2/KV/SQLite probes.
The probes and their data were removed. This does not complete the sign-in
feature's acceptance tests or prove OIDC/browser/back-channel flows.

After installation, all six workspaces passed type checking, all three apps
built, and HTTPS for the explicit Hub/workspace/router hostnames verified
against the macOS system trust store. The local CA and development
certificate are installed; their private keys remain outside Git.

Official references: [Cloudflare multi-Worker development](https://developers.cloudflare.com/workers/local-development/multi-workers/),
[TanStack custom Worker entry points](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/#custom-entrypoints),
[generated Worker types](https://developers.cloudflare.com/workers/languages/typescript/),
and [Vite HTTPS](https://vite.dev/config/server-options.html#server-https).

## Prove it with tests

Run the permanent suite from the repository root:

```bash
bun run test
bun run test --coverage
bun run typecheck
```

The suite uses `tests/wrangler.jsonc`, local ephemeral D1/R2/KV bindings
and the actual workspace Durable Object class. It requires
`XPRO_TEST_ENVIRONMENT=test`, disables remote bindings, resets storage
after each test and fails on undeclared outbound requests through MSW.
It does not use the apps' development data or need local TLS certificates.
Use `bun run test`; Bun's built-in `bun test` is a different runner.

Shared helpers are imported as `#test/...`. For an outside service, import
`network` from `#test/network` and add an MSW handler in the test using
`network.use()`. Setup checks for unmatched calls even if the application
handles the resulting network error. No passwords, request bodies or query
strings are included in that failure message.

Type checking generates `tests/worker-configuration.d.ts` and checks tests
separately from application projects. That generated declaration and the
`coverage/` report are ignored by Git.

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

These checks cover infrastructure and shared helpers. App endpoints are not
wired yet. Application migrations and real HTTP
sign-in fixtures are added with T008–T009, after the auth and database code
exists. No feature acceptance scenario is marked complete by this suite.

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

## Try it by hand

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
