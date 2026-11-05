# Local Flagship picture controls

Use this guide for the first native control, `accounts_picture_policy`. Complete
the [HTTPS, private settings and first-master setup](../001-sign-in-and-accounts/quickstart.md#prepare)
for manual Hub use. Run commands from the repository root with the frozen
dependencies installed. Automated checks prepare their own disposable records.

## Scope

The Hub's local `FLAGS` binding uses `xpro-hub-local`; permanent Workers tests use
the separate `xpro-tests-local` identifier. Both are local-only. The named test
environment has a separate hosted binding; its completed checks are recorded in
the [T063 checkpoint](../004-cloudflare-test/quickstart.md#hosted-verification-t063).

`accounts_picture_policy` is JSON with `canUpload` and `maximumBytes`. The code
fallback and reviewed configured default are both paused, with a 2,097,152-byte
(2 MiB) hard ceiling. A valid enabled rule can allow a selected login or lower
its limit. Flag values cannot raise the ceiling or bypass any access check.

## Manual local setup

Run from the repository root after the frozen install. Stop the Hub, including
any isolated browser preview, before local Flagship commands: the installed
Wrangler refuses management while that Worker has a registered dev session.

For a fresh local store, create the policy disabled:

```bash
./node_modules/.bin/wrangler flagship flags create xpro-hub-local accounts_picture_policy \
  --config apps/hub/wrangler.jsonc --env local --local \
  --persist-to apps/hub/.wrangler/state --type json \
  --variation 'paused={"canUpload":false,"maximumBytes":2097152}' \
  --variation 'standard={"canUpload":true,"maximumBytes":2097152}' \
  --default-variation paused --disabled
```

Wrangler adds `/v3` to this persistence root; do not append it to `--persist-to`.
The Vite server and setup proxy read that resulting `apps/hub/.wrangler/state/v3`
store. Every command here includes `--local`; these commands otherwise default
to the remote service.

Inspect an existing definition instead of recreating it:

```bash
./node_modules/.bin/wrangler flagship flags get xpro-hub-local accounts_picture_policy \
  --config apps/hub/wrangler.jsonc --env local --local \
  --persist-to apps/hub/.wrangler/state --json
```

Confirm type `json`, default variation `paused`, and its value
`{"canUpload":false,"maximumBytes":2097152}`. For the fresh flag above, replace
`REPLACE_WITH_LOGIN_ID` below with a disposable login's UUID, available in its
STMS detail URL. This command replaces the entire rule set; inspect and preserve
existing audiences when maintaining an already configured flag.

```bash
./node_modules/.bin/wrangler flagship flags update xpro-hub-local accounts_picture_policy \
  --config apps/hub/wrangler.jsonc --env local --local \
  --persist-to apps/hub/.wrangler/state \
  --rule-json '{"priority":1,"conditions":[{"attribute":"targetingKey","operator":"equals","value":"REPLACE_WITH_LOGIN_ID"}],"serve_variation":"standard"}' \
  --enable
```

Start the Hub again and sign in as that login. `/profile` shows the effective,
locale-formatted limit; a valid picture can be cropped and saved. Other logins
remain paused. For a lower limit, update the intended variation's
`maximumBytes` within the code bounds, inspect the resulting definition, and
restart local development after the management command completes.

To pause the reviewed local policy, stop the Hub and run:

```bash
./node_modules/.bin/wrangler flagship flags disable xpro-hub-local accounts_picture_policy \
  --config apps/hub/wrangler.jsonc --env local --local \
  --persist-to apps/hub/.wrangler/state
```

Restart the Hub. New uploads are disabled, while saved pictures remain viewable
and removable. Re-enable the same reviewed rules with `flags enable` and the
same app, key and local options. Keep the default paused. Hosted changes may
take up to 30 seconds to propagate; work already started is not cancelled.

## Automated coverage and operation

The existing browser wrapper creates disposable identities first, disposes the
identity proxy, then seeds the same Hub persistence root before dev servers
start. Specific paused, reduced-limit and crop-limit audiences precede its
standard fixture audience. The default stays paused; a second disabled fixture
checks native configured-default behavior. Never run its seed script directly
against this checkout.

```bash
PLAYWRIGHT_CHANNEL=chrome bun run test:e2e tests/e2e/profile.spec.ts tests/e2e/local-bindings.spec.ts
```

The checks use real authentication, access, Flagship, Images and D1/R2. The
stale-screen case supplies old initial client controls after an authorized read,
then uses real native reads and upload refusal. Controlled provider failures in
Workers suites use explicit typed outside-binding stand-ins. The guarded seed
bridge converts its external R2 streams to fixed-length bytes; Worker uploads
retain their existing native streaming/storage code.

Missing binding/flag, known native evaluation failure or invalid policy pauses
new uploads. Invalid objects and rejected evaluations use the fixed
`accounts_picture_policy` diagnostic operation without values/provider text.
The browser can explicitly refresh picture options without losing other form
drafts or retrying an upload automatically.

Inspect full definitions before replacing rules or using rollout/split commands.
Use the provider history for operational diagnosis and retain xpro's business
audits for their existing purpose. Keep a useful operational pause; remove all
deployed consumers or approve permanent behavior before retiring a temporary
flag. Future workspace controls must also account for independently deployed
versions and their [owning-feature prerequisites](plan.md#use-case-coverage-and-prerequisites).

The [T063 checkpoint](../004-cloudflare-test/quickstart.md#hosted-verification-t063)
records hosted targeting, value changes, pause, fallback, diagnostic/alert checks
and the restored definition. Production apps, bindings and activation remain
part of T064. See [ADR-046](../../docs/adr/046-native-feature-controls.md) and the
[release hold](../001-sign-in-and-accounts/checklists/release-review.md).

## Local verification (T061)

Verified on 2026-11-03 in an isolated candidate using Bun 1.4.4, Node 24.21.0,
Wrangler 4.136.2, Vite 8.3.5, Cloudflare Vite plugin 1.57.2, Cloudflare test plugin
1.4.6, Vitest 4.1.12 and Playwright 1.64.1. Existing compatibility dates, flags,
Worker names, package versions and save rules are retained.

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Passed; this candidate introduces no dependency or lockfile change. |
| `bun run test` | 2,200 tests passed in 117 files in the Workers runtime. |
| `bun run typecheck` | Passed all nine app/package and test projects, including generated bindings and routes. |
| `bun run build:all` | Web and Hub built; router's top-level Wrangler dry run passed without uploading. |
| `PLAYWRIGHT_CHANNEL=chrome bun run test:e2e` | All 234 browser/integration checks passed through the isolated wrapper. |
| `bun --filter @xpro/hub generate-auth-schema --check` | Native schema matches the application migrations. |
| `bun audit` | No advisories returned for 427 packages at this checkpoint. |
| Public Web/Hub build assets | No `.map` files or source-map markers found. |

The browser run also covers existing sign-in, creation, MFA, profile/password,
login-management, workspace/session and security journeys. These are local
results with the existing external-verification substitutions and simulator
limits, not hosted release acceptance.

| Picture-control acceptance | Permanent evidence |
| --- | --- |
| Schema bounds, paused defaults, extra-field stripping | Accounts `picture/policy.test.ts` and profile client contract checks. |
| Targeting, fresh reads, request isolation and private failure reporting | Hub `picture-policy.test.ts`, including the native missing-flag case and typed outside failures. |
| Access before evaluation, pause before body/Images/R2, unchanged state on refusal | Hub `picture.test.ts` and `profile-page.test.ts`, with real identity/access/database paths. |
| Current and absolute file limits, bounded body, storage and audit preservation | Accounts picture/storage suites and Hub multipart/upload suites. |
| Native standard/paused/reduced values and configured disabled default | `tests/e2e/local-bindings.spec.ts`, using the seeded local store and authenticated HTTP uploads. |
| Displayed limits, original/cropped checks, paused removal, local refusal focus, draft preservation and refresh | `tests/e2e/profile.spec.ts`; narrow, pseudo-language, dark/RTL and keyboard cases pass. |

Temporarily inverting Accounts' upload-availability guard made 20 of its 27
permanent checks fail. The exact file was restored before the final 2,200-test
run. Earlier candidate checks also caught removed client/cropped-file guards;
the retained tests enforce observable outcomes, including zero upload requests
for an oversized cropped file.

A separate disposable CLI store verified the documented disabled creation,
definition read, pilot-rule enablement, selected/unselected evaluation and
disable behavior. The CLI's `/v3` mapping was checked against its installed
implementation and resulting store. This does not measure a hosted live change.

The independent implementation review found no required code change. All 23
existing shortcut occurrences were reviewed without changing their accepted
limits. Exact-diff approval, applied-source checks and a verified Graphify
refresh are required before recording T061 complete. Keep the release hold and
the separately approved hosted test/live gates.
