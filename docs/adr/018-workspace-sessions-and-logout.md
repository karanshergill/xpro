# ADR-018: Workspace sessions with live Hub authority

**Status:** Accepted | **Date:** 2026-10-28

## Problem

- **Workspace session:** a verified Hub callback must start a session on the
  workspace's own address, including a separate customer domain.
- **Expiry:** preserve the original Hub session expiry and the 30-day limit.
- **Sign-out:** ending one device session must leave other devices signed in.

## Decision

- **One access check:** return the original expiry in the existing combined Hub
  result. Share request setup's synchronous authorization within that request.
- **Local storage:** create a random session through the existing save helper.
  Read local type inside the save. Non-masters need an active local user;
  masters may enter without membership or a local user record.
- **Original expiry:** cap the row at the original Hub expiry and 30 days. Keep
  the ID token's shorter expiry separate from session lifetime.
- **Private cookie:** bind encrypted `__Host-xpro-session` data to workspace,
  address, issuer and client. Keep the local session ID and native ID token
  inside the existing Secure, HttpOnly, SameSite=Lax cookie envelope.
- **Current identity:** read the local row and check the live Hub. Session checks
  may identify an unfinished profile; protected actions enforce the shared
  completion, membership and permission rules.
- **Device sign-out:** require a same-origin POST and use native RP-Initiated
  Logout with the stored ID token in the request body. The native provider
  verifies the hint, including after JWT expiry, and ends the original Hub
  session. Then remove its local sessions and clear the cookie.
- **Hub messages:** accept bounded URL-encoded POSTs at
  `/auth/back-channel-sign-out`. Use `jose` 6.2.13 for signature, issuer, audience,
  algorithm, type and time checks. Require the logout event, token ID and
  session ID; reject nonce claims. Remove only matching local sessions.
  Repeats have the same effect. Live Hub checks remain authoritative when
  delivery fails or a message is absent.
- **Native compatibility:** the pinned provider sends with `redirect: "error"`,
  which workerd rejects. A Bun package patch uses `manual`; its existing status
  check still refuses redirects. Its shortcut comment requires removal when
  upstream supports refusing redirects on workerd.
- **Dependency:** declare the already-installed `jose` 6.2.13 directly in the web
  app. The root manifest and lockfile record the native provider patch. Package
  versions, runtime and Cloudflare configuration are unchanged.

## Alternatives rejected

- **Shared domain cookies:** do not work on separate customer domains.
- **Custom JWT verification or logout issuance:** duplicate supported libraries'
  security work. Keep native signing, revocation and delivery.
- **Logout replay records:** add state without improving idempotent removal for
  an ended, uniquely identified Hub session.
- **Local rows as authority:** would let a missed message preserve access.

## Scope

- **Backend:** shared HTTP fixtures use the native sign-in, callback, local
  session, identity and sign-out handlers with real storage.
- **Remaining work:** placement and public route composition remain T021;
  screens and complete browser/HTTPS journeys remain T022/T041.
- **Rollout:** deploy the Hub's additional expiry field before updating workspace
  apps. Older workspace code ignores the added field; newer code requires it.
- **Constitution:** isolation, real-runtime tests, existing saves and the
  approved runtime/tooling are preserved. No new exception is introduced.

## References

- [Better Auth 1.7 documentation index](https://better-auth.com/docs/llms.txt)
- [Better Auth OAuth provider](https://better-auth.com/docs/plugins/oauth-provider)
- [OIDC Back-Channel Logout](https://openid.net/specs/openid-connect-backchannel-1_0.html)
- [OIDC RP-Initiated Logout](https://openid.net/specs/openid-connect-rpinitiated-1_0.html)
- [jose 6.2.13](https://github.com/panva/jose/tree/v6.2.13)
- [Bun dependency patches](https://bun.com/docs/pm/cli/patch)
- [Workers Request redirect modes](https://developers.cloudflare.com/workers/runtime-apis/request/)
