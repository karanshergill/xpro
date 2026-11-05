# ADR-034: Keep the working page mounted during session return

**Status:** Accepted | **Date:** 2026-10-29

## Problem

- **Drafts:** redirecting an expired working page destroys its unsaved state.
- **Identity:** a tab must not resume a previous person's draft under another
  login, even when the new login has permission to enter the same workspace.
- **Native flow:** the existing Hub and workspace protocol must remain the
  authority for authentication and current access.

## Decision

- **Mounted page:** place one controller above the workspace route outlet.
  Use a controlled Base UI AlertDialog to hide and disable the existing page
  without unmounting it. Keep the draft in React/DOM memory; serialize nothing.
- **Actions:** the supported Start server-function fetch hook attaches the
  document's original login ID and observes genuine access refusals. It opens
  the dialog and returns the failed request without replaying it.
- **Navigation:** use Router's public async blocker before internal navigation.
  A lightweight fresh page read must confirm the same login before leaving.
  Hash-only changes do not need a check. A refusal keeps the old route mounted.
- **Read:** a strict-empty-input POST server function returns only the actual
  login ID from this request's prepared access context. It does not query the
  Hub again. Its local fetch preserves errors returned before Start wraps the
  handler response, so an expired session retains its code and safe reference.
- **Return:** use a native new-tab link to the existing workspace sign-in start,
  returning to the protected /session-return page. Focus or Continue triggers
  another live read. Only the original login closes the dialog; another login
  can explicitly reload after being told its old input will be lost.
- **Freshness:** abort superseded checks and ignore a delayed refusal that began
  before the last successful check. A newer refusal cancels an older pending
  check. Failed checks remain blocked with a retry message.
- **Server guard:** compare the optional x-page-login-id header with the
  authenticated actor after the live access check and before dynamic rendering
  or actions. A mismatch returns core_identity_changed (409). The hint grants
  no permission and never replaces cookies, Hub validation or the local gate.
- **Shared pieces:** move only used Button/AlertDialog/theme styles into
  @xpro/ui. Reuse the Hub's exact Tailwind/Paraglide pins for Web. Native links
  use the shared button styles without Base UI's forced button semantics.
  Move the identical bounded JSON/Origin RPC gate into Core.
- **Local transport:** under Cloudflare Vite plugin 1.57.2, a separate local
  service hop changed HTTPS to HTTP before the Hub's strict origin check.
  Vite's development-only configureServer middleware restores these servers'
  known HTTPS scheme. Keep the real binding regression and remove this
  workaround when the platform preserves the scheme itself. Production
  authentication, origin checks and Worker configuration remain unchanged.

## Alternatives

- **Redirect the working tab:** loses its in-memory draft before sign-in.
- **Persist drafts in browser storage:** introduces serialization, privacy and
  cleanup obligations without a requirement to recover closed or reloaded tabs.
- **Trust a popup message or current cookie alone:** cannot establish fresh
  membership, profile, local access and matching original identity.
- **Cancel Router loads through internals:** no supported cancellation API
  meets this need in the installed version. The public blocker acts first.
- **Automatic request retry:** may duplicate a write whose reply was lost.
- **Relax HTTPS or trust forwarded headers in production:** hides the local
  transport defect by weakening the actual request boundary.

## Impact

- **Scope:** T022's mounted-tab session return is delivered. The browser tests
  use a UI-only draft fixture in a guarded source copy and the actual native
  authentication, token exchange, storage and permission paths.
- **Limits:** reloading, closing the tab or cross-document navigation loses
  unsaved input. Workspace business forms and protected client loaders do not
  exist yet. Before adding protected loaders, bind their failures to this
  controller without replacing a mounted route; the shortcut is marked in code.
- **Tooling:** add the UI workspace and reuse existing pinned frontend tools;
  there is no new external package version. Vite changes are reviewed explicitly.
  No production runtime, binding or deployment configuration changes.
- **Constitution:** the Hub retains identity, workspace data stays local, access
  remains live and there is no new save/audit safety exception. Exact source
  and documentation changes require the normal diff approval.

## References

- [Start global and per-call fetch](https://tanstack.com/start/latest/docs/framework/react/guide/middleware)
- [Start raw responses](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions#raw-responses)
- [Router navigation blocking](https://tanstack.com/router/latest/docs/framework/react/guide/navigation-blocking)
- [Base UI AlertDialog](https://base-ui.com/react/components/alert-dialog)
- [Base UI link semantics](https://base-ui.com/react/components/button#rendering-links-as-buttons)
- [shadcn Base UI AlertDialog](https://ui.shadcn.com/docs/components/base/alert-dialog)
- [Tailwind shared styles](https://tailwindcss.com/docs/detecting-classes-in-source-files)
- [Paraglide Vite integration](https://inlang.com/m/gerre34r/library-inlang-paraglideJs/vite)
- [Vite development middleware](https://vite.dev/guide/api-plugin#configureserver)
- [Cloudflare HTTP service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/)
