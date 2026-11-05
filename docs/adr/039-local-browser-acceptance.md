# ADR-039: Protected destinations and local browser acceptance

**Status:** Accepted | **Date:** 2026-10-30

## Problem

- **Context:** T041 must connect all six implemented stories through actual apps.
  Existing routing returned `/account` and `/portal`, but those pages did not exist.
  The old browser fixture did not run the router or deliver native logout messages
  to the real workspace receiver.

## Decision

- **Destinations:** add minimal account and Portal landing headings. Reuse the
  existing fresh Hub destination decision for `/account`, including completion
  and unfinished-creation rules. Only an actual account destination renders it.
  `/portal` uses the existing workspace root/access gate. Add no account-management
  or Portal business feature.
- **HTTPS:** run the three existing app dev scripts inside the disposable browser
  copy. Issue its certificate for localhost plus all fixture hostnames using the
  developer's already-trusted mkcert CA. Map two `.test` hosts only in Chromium;
  do not modify DNS, the trust store, source app config or deployment settings.
- **Native transport:** add self-Hub and router Fetcher bindings only in that
  guarded copy. Route the native provider's JWKS fetch and customer back-channel
  POST to the actual local Workers. All tokens, native metadata, verification,
  placement and workspace storage remain real.
- **Delivery evidence:** the temporary Hub entry wrapper adds a response header
  counting successful native logout deliveries. No permanent test endpoint or
  production instrumentation is added; the receiver's authorization and session
  revocation are still verified by subsequent browser access.
- **Fixtures:** keep temporary faults and readback behind the existing isolated
  root guard. Use native Admin/Organization methods for setup/membership changes.
  Remove the fault trigger in `finally`, dispose database/proxy handles, and let
  the runner remove copies, certificates, storage, output and process groups.
- **Coverage:** retain small journeys connecting creation, completion, app/Portal,
  own-profile editing, master search/reset/lifecycle and live access changes.
  Map all story scenarios to browser and storage evidence in the
  [acceptance checklist](../../specs/001-sign-in-and-accounts/checklists/browser-acceptance.md).

## Rejected options

- **Mock the provider or logout receiver:** would not prove native signing,
  delivery or workspace revocation.
- **Add public testing endpoints:** unnecessary authority in production code.
- **Change source app/service configuration:** local fixture bindings suffice;
  deployment changes require separate approval.
- **Build full account/Portal features:** outside sign-in acceptance; protected
  headings suffice to make the approved destinations real.
- **Treat local router checks as hosted dispatch:** local fallback cannot prove
  Workers for Platforms isolated dispatch, public DNS or edge certificates.

## Impact

- **Constitution:** shared identity stays in the Hub and tenant data stays in its
  workspace. No dependency, schema, migration, data-safety or product-policy change.
  Existing source/document changes remain subject to exact-diff approval.
- **Boundary:** T041 proves local application journeys. Hosted dispatch and image
  fidelity, T042 performance/accessibility, final security review and release gates
  remain outstanding. Existing master-MFA-before-first-real-client gate stands.

## References

- [Better Auth OAuth provider](https://github.com/better-auth/better-auth/blob/v1.7.12/docs/content/docs/plugins/oauth-provider.mdx)
- [Cloudflare local service bindings](https://developers.cloudflare.com/workers/development-testing/bindings-per-env/)
- [Playwright redirect interception](https://playwright.dev/docs/api/class-page#page-route)
- [Playwright isolated contexts](https://playwright.dev/docs/browser-contexts)
- [mkcert certificate generation](https://github.com/FiloSottile/mkcert#advanced-options)
- [Vite allowed hosts and HTTPS](https://vite.dev/config/server-options.html#server-allowedhosts)
