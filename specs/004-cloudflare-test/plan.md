# Cloudflare test environment

- **Scope:** prepare one persistent test environment on the verified Cloudflare
  account, using its existing karanshergill.workers.dev subdomain.
- **Hub address:** propose
  https://xpro-hub-test.karanshergill.workers.dev.
- **Workspace address:** propose
  https://xpro-router-test.karanshergill.workers.dev for one prepared test
  workspace. Keep the existing router and dispatch flow, preserving the incoming
  URL. The workspace Worker stays inside the test dispatch namespace.
- **Exposure:** the Hub and router addresses are reachable over the Internet.
  Keep native sign-in, MFA and access checks; use fabricated test data.
  Custom-domain DNS, certificates and customer hostnames remain later work.
- **Existing identity:** preserve the xpro Worker name and existing storage.
  Propose xpro-workspaces-test as a separate test dispatch namespace with
  isolated workspace Durable Object storage.
- **Test resources:** propose xpro-hub-test for Hub D1, xpro-placements-test for
  placement KV and xpro-profile-pictures-test for private picture R2. Prepare
  test-only Turnstile settings, Images usage and private secrets. Record real
  resource IDs before reviewing their configuration; keep picture storage private.
- **Flagship:** follow the approved T062 scope: one xpro-hub-test Flagship app
  and the disabled accounts_picture_policy with paused as its default.
  Bind its real app ID only to the Hub test environment. Keep local stores
  separate; deployment and pilot enablement belong to T063.
- **Current evidence:** the 2026-11-03 metadata checks succeeded and found no
  resources using these proposed names. Dispatch listing now works; the earlier
  10121 read failure is historical. Read access does not prove creation rights
  or a paid subscription.
- **Costs:** Cloudflare lists Workers for Platforms at US$25 monthly plus usage.
  Confirm the account's actual plan, other service charges and applicable terms
  with the owner before resource creation. Billing is unavailable through the
  current MCP OAuth connection. Any new paid activation needs explicit approval.
- **Configuration:** prepare complete named test environments, explicit test
  service/storage bindings, origins, native OAuth callbacks and Turnstile
  hostname settings. Select test when building the Vite apps with CLOUDFLARE_ENV
  and inspect the generated deployment configuration. Preserve local setup,
  runtime versions, compatibility settings and default Worker identities.
- **Private preparation:** review test migrations, attended initial-master setup,
  one prepared workspace and native OAuth registration before opening the Hub
  for use. The current initial-master CLI is local-only; review a private
  hosted setup path using the existing action, without a public bootstrap route.
  Keep the accepted first-master setup limits.
- **Checks:** validate types, packaging and target selection locally before
  remote changes. After separate deployment approval, verify real dispatch,
  native sign-in/MFA, workspace-user creation, session revocation and the T063
  picture-control cases. Local checks alone do not establish hosted acceptance.
- **Diagnostics:** review automatic invocation metadata, query-string privacy,
  sampling, tracing and retention alongside the application's four-field events.
  Record alert delivery and remaining hosted limits.
- **Delivery:** present exact configuration/code diffs and the intended remote
  actions for approval before application, creation, migration or deployment.
  Remove owned temporary verification files; record intentionally retained test
  resources. Refresh the project graph after approved source/document changes.
- **Release status:** retain the release hold. Review production routing,
  rollout/rollback, backup, load and privacy evidence separately in T064.
- **References:** [prepared routing](../../docs/adr/020-prepared-workspace-routing.md),
  [private setup](../../docs/adr/013-private-initial-master-setup.md),
  [T062 scope](../005-flagship/tasks.md#hosted-test-preparation-t062),
  [release requirements](../001-sign-in-and-accounts/checklists/release-review.md),
  [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/),
  [dispatch example](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/get-started/),
  [Workers for Platforms pricing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing/),
  [Flagship setup](https://developers.cloudflare.com/flagship/get-started/)
  and [Vite environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/).
