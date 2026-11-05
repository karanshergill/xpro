# Cloudflare test setup and verification

- **Scope:** the named `test` environments prepare the existing apps for the
  account and resources in [resources.json](./resources.json). Resource creation
  is verified. The [T063 checkpoint](#hosted-verification-t063) records the
  completed hosted test journeys; production release remains gated by T064.
- **Addresses:** the Hub uses
  https://xpro-hub-test.karanshergill.workers.dev. One prepared workspace uses
  https://xpro-router-test.karanshergill.workers.dev through the router.
  The `xpro-test` workspace Worker belongs only in `xpro-workspaces-test`;
  its direct workers.dev and preview URLs are disabled.
- **Bindings:** the Hub uses the test D1, private picture R2, native Images,
  Flagship and dispatch bindings. The router uses test placement KV, that same
  dispatch namespace and the test Hub's HTTP and placement entrypoints. The
  workspace binds to the test Hub's HTTP and access entrypoints and its own
  SQLite Durable Objects. The inherited `v1` migration creates its own storage
  on deployment; it does not move the existing `xpro` Worker's data.
- **Sign-in limit:** the test Hub uses namespace `1004`, with the existing
  limit of 10 per 60 seconds. Read-only account metadata found `1001`–`1003`
  already used; this avoids sharing their counters.
- **Feature policy:** the test Hub's `FLAGS` binding uses app
  `d6054b12-d093-4d58-b5ef-7ca8e03bac3e`. The saved `accounts_picture_policy`
  is disabled, defaults to `paused` and has no targeting rules. T063 temporarily
  targeted one fabricated login and restored that exact definition. Further
  changes require their own approved scope.
- **Local isolation:** D1, KV, R2, service, dispatch, Images and Flagship bindings
  use `remote: false`; the existing Vite configuration disables remote bindings.
  Local evaluation uses a local Flagship store, not the saved hosted definition.
  The normal local environments, default names and runtime settings are retained.
- **Known settings:** `BETTER_AUTH_URL`, both `HUB_ORIGIN` values and the
  workspace's `WORKSPACE_ORIGINS` are supplied by the test configuration.
  They use only the exact public addresses above.
- **Settings supplied separately:** before hosted use, supply these required
  names through the separately reviewed secret/setup procedure. Their values
  are not included here or created by the configuration change.

| App | Required values |
| --- | --- |
| Hub | `BETTER_AUTH_SECRET`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY` |
| Workspace | `WORKSPACE_ID`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `WORKSPACE_SESSION_SECRET` |

- **Prepared records:** `WORKSPACE_ID` must match the prepared Hub workspace;
  `OIDC_CLIENT_ID` and its secret must belong to its confidential native client.
  Register `https://xpro-router-test.karanshergill.workers.dev/auth/callback`
  and the native back-channel URL
  `https://xpro-router-test.karanshergill.workers.dev/auth/back-channel-sign-out`.
  Turnstile must allow `xpro-hub-test.karanshergill.workers.dev`.
- **Hosted prerequisites:** review Hub migrations, private initial-master setup,
  prepared workspace/client records, Turnstile, Images usage and secrets before
  opening the hosted test. `setup:initial-master` remains local-only; the
  separate private hosted command is described below.
  The disposable browser seeder is not a hosted provisioning tool. Review
  automatic invocation metadata, query-string privacy, tracing, retention and
  alert delivery before hosted acceptance. T064 retains the release hold.

Build the Vite apps from the repository root with the selected environment:

```bash
CLOUDFLARE_ENV=test bun run build:hub
CLOUDFLARE_ENV=test bun run build
```

Inspect each generated `dist/server/wrangler.json` for the intended account,
Worker name and test resource IDs before any later deployment. A deploy-time
`--env` cannot retarget a Vite build. The normal router build selects the default
configuration explicitly. Package the selected test targets locally with these
dry runs. The workspace command must include its dispatch namespace; the root
`deploy` script does not supply that target. Output stays under ignored `dist/`
folders.

```bash
bun x --no-install wrangler deploy --config apps/hub/dist/server/wrangler.json --dry-run --outdir apps/hub/dist/dry-run
bun x --no-install wrangler deploy --config apps/web/dist/server/wrangler.json --dispatch-namespace xpro-workspaces-test --dry-run --outdir apps/web/dist/dry-run
bun x --no-install wrangler deploy --config apps/router/wrangler.jsonc --env test --dry-run --outdir apps/router/dist/dry-run
```

- **Verification:** on 2026-11-03, the isolated candidate passed the standard
  nine-project `bun run typecheck`, both Vite test builds and all three test
  packaging dry runs. Generated targets, account and binding IDs were inspected.
  These checks do not establish hosted acceptance.
- **Types:** keep the existing type-generation workflow, which includes all
  configured environments. A test-only declaration omits the local transport's
  `WORKSPACE_USERS` property and cannot typecheck the shared Hub source.
- **Tooling:** verification used `WRANGLER_HIDE_BANNER=true` after Wrangler's npm
  version check kept a completed type command open. This skips that CLI check
  without changing application configuration.
- **Cleanup:** remove owned verification copies, generated output, storage and
  logs after checks. Retain only the reviewed configuration, documentation and
  the intentionally persistent resources recorded here.
- **References:** [Vite environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/),
  [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/),
  [dispatch bindings](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/dynamic-dispatch/),
  [user Worker assets](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/static-assets/)
  and [rate-limit namespaces](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## Private hosted preparation

- **Approval:** these commands write to the recorded remote test database.
  Run each only after its exact remote actions are approved. The source change
  and local verification do not authorize execution or deployment.
- **Order:** prepare the private records and files, deploy the Hub, workspace
  and router in that order, verify their versions/bindings, then publish the
  workspace address. Begin interactive use only after the sequence completes.
- **Execution:** run both setup steps through `bun run setup:cloudflare-test`.
  Wrangler's platform proxy runs under the existing Node tooling installation;
  the pinned tsx development tool loads the TypeScript entry.
- **Checks:** run `bun run test` for application/setup behavior in workerd and
  `bun run test:cli` for local file permissions, symlinks and overwrite refusal.
  File checks use disposable directories and no remote proxy.
- **Private input:** create an owner-only `.cloudflare-test.local/` directory
  (mode `0700`) in the repository root and `operator.json` (mode `0600`). The
  existing `*.local` ignore rule covers the directory. Keep it outside app
  `.dev.vars` files. Enter actual credentials and keys privately, never in
  command arguments or chat. Supply this JSON shape:

```json
{
  "accountId": "35ff2b49c05d63c1ab9be216933c774a",
  "databaseId": "28f995c1-9c2f-4dfa-b050-86ee0baf73bf",
  "hubOrigin": "https://xpro-hub-test.karanshergill.workers.dev",
  "workspaceOrigin": "https://xpro-router-test.karanshergill.workers.dev",
  "email": "<initial master email>",
  "password": "<privately supplied password>",
  "hubSecret": "<independently generated secret>",
  "workspaceSessionSecret": "<independently generated secret>",
  "turnstileSiteKey": "<test widget site key>",
  "turnstileSecretKey": "<test widget secret key>"
}
```

- **Values:** use the existing 12–64 character password rules and secrets of at
  least 32 characters. Keep the password exactly as supplied. Use the managed
  widget for the test Hub hostname. The command refuses changed targets,
  unexpected fields, group/other-accessible files and symlinks.

```bash
bun run setup:cloudflare-test prepare
```

- **Prepared:** actual migrations run first; an empty Hub receives its initial
  master, one bare test organization and one native confidential sign-in client.
  The master receives neither tenant membership nor Account ownership. The
  private setup session ends. No workspace address is published at this stage.
- **Outputs:** `hub.json` contains the Hub's three required secrets;
  `workspace.json` contains its four required values, including the native client
  secret. `prepared.json` holds safe IDs and the fixed target. All stay in the
  private directory with mode `0600`; existing files are never overwritten.
  The command prints no credentials, cookies or client secret and disables
  Wrangler diagnostics files. Retain these protected operator files for the
  approved deployment; do not print or commit them.
- **Failure:** stop and inspect the private state. Native identity/client writes,
  their associated work and the local outputs are not one transaction. Some
  records or output files may remain incomplete. Repeating setup does not repair
  them or change an existing login; there is no force/reset option.
- **Deploy:** use the T063 deployment order and the generated test configurations
  above. Supply `.cloudflare-test.local/hub.json` and
  `.cloudflare-test.local/workspace.json` with the separately approved
  `--secrets-file` deployments. Do not use `secret put` to initialize an
  undeployed Hub. Before real sign-in, inspect native telemetry with synthetic
  query/header/body markers and record actual account usage/retention terms.
- **Publish:** after the approved deployments and binding checks succeed, approve
  this separate database write and run:

```bash
bun run setup:cloudflare-test publish-placement
```

- **Published:** the prepared workspace resolves to `xpro-test` at the router's
  exact origin. Placement, primary address and audit commit together. A repeat
  or a conflicting mapping is refused without changing either workspace.
  Publication does not itself inspect or deploy the remote Workers.
- **Hosted result:** the [T063 checkpoint](#hosted-verification-t063) below records
  the completed journeys and restored settings. T064 owns the remaining
  production-readiness review and release decision.
- **Local verification:** on 2026-11-04, the isolated candidate passed 111
  relevant workerd tests, 13 permanent filesystem tests, 17 command-refusal
  checks, the standard nine-project typecheck, both Vite test builds and all
  three packaging dry runs. The file tests detected an intentionally inverted
  permission guard. Refusal checks made no remote API requests and exposed no
  input values. The independent review found no required changes. These are
  local results; the later hosted results are recorded separately below.
- **Decision:** [ADR-047](../../docs/adr/047-private-cloudflare-test-setup.md)
  records why setup uses a private binding and bare test metadata.

## Hosted verification (T063)

- **Checkpoint:** the declared T063 hosted checks passed on 2026-11-05 in the
  named test environments. The workspace currently renders its minimal
  authenticated shell. Production release remains subject to
  [T064 and the release review](../001-sign-in-and-accounts/checklists/release-review.md).
- **Setup:** registered migrations, attended initial-master setup, one bare test
  workspace, its confidential sign-in client and the reviewed placement were
  verified. The master received no tenant membership or Account ownership.
  Hub, private workspace and router were deployed in that order before publication.
- **Identity and routing:** native Hub sign-in, the managed Turnstile check and
  protected router dispatch worked. The owner confirmed scanning the hosted
  Hub's authenticator QR; the agent observed the enabled authenticator and protected
  master/workspace access. Hub-driven staff-login creation, fresh staff sign-in,
  prefilled profile details and unprivileged management refusals passed.
- **Revocation:** suspending the fabricated staff login removed its old Hub
  sessions and access tokens. Reactivation did not restore that browser session;
  a fresh sign-in worked afterward.
- **Pictures:** native Flagship targeted only the pilot login; a non-pilot stayed
  paused. Synthetic PNG originals at 2 MiB and 1 MiB were accepted for cropping,
  while one byte above each displayed limit was refused. Cropped uploads passed
  through native Images and private R2. The picture owner received PNG with
  `private, no-store`; another login was refused and an anonymous request got 401.
  Before these checks, the dashboard showed 0 of 5,000 included image
  transformations used.
- **Server refusal:** after pausing, a save from an already-open crop editor was
  refused without changing the saved picture. An invalid pilot policy also
  produced the paused screen fallback and an authenticated upload refusal of 503.
- **Limit scope:** the hosted byte-boundary checks covered original-file selection
  and real cropped saves. Direct raw multipart requests at those size boundaries
  were not exercised remotely; permanent Workers tests cover server byte limits.
  These PNG checks do not establish fidelity for every supported image format.
- **Diagnostics:** test Logs, Traces and Issues were enabled with sampling 1,
  query-string redaction and automatic invocation logs disabled. The synthetic
  collector probe found none of its private markers in 25 inspected records.
  The policy failure emitted only `event`, `requestId`, `app` and `operation`;
  all three native Issue occurrences correlated to their application request IDs
  and contained no credential headers.
- **Retention:** the account inspection on 2026-11-04 recorded three days for logs
  and seven for traces. Usage terms and production retention need a fresh review
  for the actual release target, including the announced 2026-12-01 pricing change.
- **Alert:** the approved native automation was limited to `xpro-hub-test` and
  fired once at three controlled policy errors. Cloudflare recorded one email
  dispatch and the owner confirmed receipt. The temporary policy and automation
  were removed; the controlled Issues were resolved with their history retained.
- **Restored state:** `accounts_picture_policy` is disabled with the original
  paused default, the original three variations and no audience rules. The test
  picture pointer is null and its R2 prefix is empty. Owned fixtures, review
  files, copies and test tabs were removed; protected operator files and the
  intentional active QA login were retained.
- **Evidence:** operator-local, ignored records in `.cloudflare-test.local/`
  include `deployment-receipt.json`, `telemetry-privacy-receipt.json`,
  `mfa-qr-deployment.json`, `staff-creation-verification.json`,
  `session-revocation-verification.json`, `picture-control-verification.json` and
  `picture-fallback-verification.json`. They retain safe IDs and outcomes under
  restricted permissions; credentials remain separate and must not be committed.

| Test target | Recorded deployment reference |
| --- | --- |
| `xpro-hub-test` | Worker version `60013c39-1812-4e5c-a279-236222a182d2` |
| `xpro-router-test` | Worker version `adabfa0e-0f47-4ebe-92e2-c22c882d29db` |
| `xpro-test` in `xpro-workspaces-test` | Private Worker deployment `a903955912df41d3b6a479ff00976436` |

- **Next:** T064 reviews production hostnames/routing, the named deployment path,
  rollout/rollback, backups, load, persistent monitoring and the remaining
  security/privacy requirements. The hosted test alert was a temporary proof;
  ongoing production error and uptime alerts remain an open release requirement.
