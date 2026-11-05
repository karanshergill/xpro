# ADR-017: Native OIDC with a private browser continuation

**Status:** Accepted | **Date:** 2026-10-28

## Problem

- **Separate origins:** a workspace needs to verify a Hub sign-in, including on
  a customer's domain, without receiving the person's password or Hub cookie.
- **Continuation:** OAuth must wait for required profile details and resume after
  native credential sign-in without sending the person back to sign-in.
- **Browser binding:** the callback must belong to the browser that started it.

## Decision

- **Native protocol:** retain Better Auth's provider and confidential
  authorization-code clients. Require S256 and exact registered redirects;
  disable public registration and other grants. Trusted clients use the native
  administrator API with consent skipping and end-session support; the latter
  includes the original Hub session ID in the ID token.
- **Native completion gate:** use the provider's signed `postLogin` continuation
  and check the stored profile again on continuation. The shared access hook
  accepts the native request's newly created session during nested authorization,
  then validates it against the live Hub. Other requests still read the native
  authoritative session. Keep native JSON responses, redirects and cookies.
- **Private transaction:** keep fresh state, nonce, verifier and a safe return
  path in a ten-minute `__Host-` cookie with `Secure`, `HttpOnly`, `SameSite=Lax`
  and `Path=/`. Use Workers Web Crypto AES-GCM with a
  fresh IV and a supplied high-entropy secret of at least 32 characters. Bind the
  ciphertext to its name, workspace, origin, issuer and client. Refuse tampering,
  duplicate cookies and authenticated expiry even if a browser retains a cookie.
- **Client validation:** use `oauth4webapi` for discovery, issuer/state checks,
  confidential exchange and ID-token claims/nonce validation. All protocol fetches
  stay within the configured Hub over its trusted binding, have a timeout and
  refuse redirects. Use Workers' supported manual redirect handling.
- **Transport trust:** the token response arrives directly from that Hub binding.
  Application-level ID-token signature checking is optional for a directly
  authenticated issuer transport; no additional JWKS fetch is made per sign-in.
  Back-channel logout signature validation remains T019's separate requirement.
- **Callback boundary:** T018 supplies `validateSignInCallback`, returning only
  verified login/session IDs, the ID token and safe return path. T019 supplies
  `finishSignIn`, rechecks live access and local type, and saves the real workspace
  session. An ID token's expiry must not replace the original Hub session expiry.

## Alternatives rejected

- **Shared domain cookies:** do not work for separate customer domains.
- **Custom credentials or OAuth:** duplicate approved dependencies' security rules.
- **A transaction table:** adds storage and cleanup for short-lived browser state.
- **A JWKS request on each exchange:** adds a call without strengthening this
  direct, trusted token transport. Untrusted incoming logout tokens need signatures.

## Impact and limits

- **One pending flow:** a browser can start one flow per workspace at a time.
  Separate transaction cookies are needed if concurrent sign-in tabs become required.
- **Auditing:** record success and safe refusal codes through the real Hub save
  helper. The approved separate native-session/audit-write exception still applies.
- **Local validation:** two built-Hub attempts stopped when the local runtime
  restarted. Repeated runs on both installed tool versions and standalone
  crypto/D1 probes passed; the cause remains unconfirmed. Recheck before deployment.
- **Scope:** workspace sessions/sign-out, sign-in protection, address routing and
  screens remain T019–T022. The complete Story 2 journey is not yet delivered.
- **Dependency:** Core directly pins the already installed `cookie-es` 3.1.1 for
  cookie parsing/serialization; encryption uses Web Crypto. No installed package
  version or runtime/Cloudflare setting changes.

## References

- [Better Auth OAuth provider](https://better-auth.com/docs/plugins/oauth-provider)
- [Better Auth native hook context](https://better-auth.com/docs/concepts/hooks)
- [oauth4webapi OIDC example, v3.8.8](https://github.com/panva/oauth4webapi/blob/v3.8.8/examples/oidc.ts)
- [Direct-endpoint signature guidance](https://github.com/panva/oauth4webapi/blob/v3.8.8/docs/functions/validateApplicationLevelSignature.md)
- [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Workers Request redirects](https://developers.cloudflare.com/workers/runtime-apis/request/)
- [cookie-es](https://github.com/unjs/cookie-es)
