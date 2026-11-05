# ADR-047: Prepare the hosted test privately

**Status:** Accepted | **Date:** 2026-11-04

## Problem

- **Empty test:** the recorded Cloudflare test database needs schema, a first
  master and a prepared workspace/client before hosted sign-in can work.
- **Master role:** native Organization creation adds its creator as owner.
  An xpro master is a global operator and must not become a tenant member.

## Decision

- **Fixed command:** add `bun run setup:cloudflare-test` with `prepare` and
  `publish-placement` steps. Its input must match the recorded test account,
  D1 ID and origins. No arbitrary target or workspace creation is supported.
- **Binding:** use Wrangler 4.136.2 `getPlatformProxy` with a temporary D1-only
  configuration, `remote: true`, `remoteBindings: true`, `envFiles: []` and
  `persist: false`. Dispose the proxy and remove the temporary configuration.
  Ordinary application bindings and the existing local master command stay local.
- **Node host:** the remote binding stalled under Bun and succeeded under Node.
  Run the TypeScript entry through `node --import tsx`; pin tsx 4.23.15 as a root
  development dependency. Bun remains the package manager and script runner.
  Reuse the installed Node tooling without a custom build/launch wrapper.
- **Native identity:** run actual migrations and reuse `createInitialMaster`.
  Privately sign in through the native API, register one confidential PKCE
  client for the router's exact callback/back-channel URLs, then sign out.
  Hosted profile completion, MFA and public sign-up protections still apply.
- **Bare organization:** insert one fabricated test organization and its audit
  through Kysely and `saveHub` in one batch. Preserve native `createdAt` naming
  with `withoutPlugins()`. Create no master membership or tenant Account.
- **Deferred address:** after the operator checks the approved deployments,
  publish the placement/address/audit in a separate batch. Reject a missing
  prepared identity or a conflicting workspace, Worker name or address.
- **Local files:** read owner-only input from ignored `.cloudflare-test.local/`.
  Refuse symlinks and existing output files. Write protected Hub/workspace
  deployment files and a receipt containing only safe IDs and fixed targets.
  Disable Wrangler disk logging and print only safe status/ID or error fields.
- **Tests:** exercise native auth, real migrations, refusal, batch rollback,
  placement and unrelated-record preservation in workerd. Test local file
  permissions and overwrite protection through `bun run test:cli`, using the
  existing Vitest Node runner and disposable directories; add no dependency.

## Limits and impact

- **Attended setup:** retain ADR-013's one-time partial-write exception. Native
  identity/client operations and local files cannot share a D1 batch. Failure
  may leave incomplete setup; stop for private operator review, without blind
  retries, promotion, repair or automatic deletion. Add resumable setup before
  concurrent or unattended execution is supported.
- **Deployment checks:** the publication command does not prove that Workers
  are deployed. The operator must verify them before approving that separate
  write. Remote setup, deployment, Turnstile and notifications remain separate
  approvals. Local checks do not establish hosted acceptance.
- **Diagnostics:** test environments request native Logs, Traces and Issues,
  sampling 1 and query redaction. Confirm account terms and synthetic collector
  privacy before real sign-in; add no reporting SDK or service.

## Rejected options

- **Public bootstrap:** adds a privileged HTTP surface solely for attended setup.
- **General seeder:** disposable browser fixtures are not a hosted setup tool.
- **Native organization plus removal:** briefly grants tenant ownership to the
  master and needs another write; bare test metadata avoids both.
- **Custom adapter or credentials:** duplicates the approved platform binding
  and native auth behavior.

## References

- [Approved T063 plan](../../specs/005-flagship/tasks.md#hosted-setup-and-verification-t063)
- [Initial-master exception](013-private-initial-master-setup.md)
- [Wrangler platform proxy](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy)
- [tsx Node entry](https://tsx.is/dev-api/node-cli)
- [Native organizations](https://better-auth.com/docs/plugins/organization)
- [Native client administration](https://better-auth.com/docs/plugins/oauth-provider)
- [Worker diagnostics](https://developers.cloudflare.com/workers/wrangler/configuration/#observability)
