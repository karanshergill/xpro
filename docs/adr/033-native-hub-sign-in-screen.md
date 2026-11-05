# ADR-033: Native Hub sign-in screen

**Status:** Accepted | **Date:** 2026-10-29

## Problem

- **Browser entry:** the credential backend exists, but people need a central
  sign-in page and readable refusal messages.
- **Continuation:** workspace sign-in must preserve the provider's signed state.
- **Input:** native paste and password-manager autofill must work without
  changing the password or losing input after a refusal.

## Decision

- **Native methods:** use Better Auth 1.7.12's email/username client methods and
  OAuth provider client. Keep the existing credential, audit, CAPTCHA and rate
  limits. Direct sign-in uses the fixed Hub destination; signed flows use the
  native returned HTTPS address. Caller query parameters never choose a target.
- **Form:** reuse the Hub's existing controls, TanStack Form and translations.
  Validate required values on blur/submit, preserve input on refusal, focus the
  error summary, disable busy controls and never retry credentials automatically.
- **Autofill:** keep native inputs uncontrolled and read FormData at submission.
  This includes password managers that emit no React change event. Normalize
  only the identifier; send the password exactly as entered.
- **Widget:** use Cloudflare's explicit browser API with action sign-in and a
  compact widget. Clear an expired/failed token; require manual retry and obtain
  a new challenge after each refused or uncertain credential submission.
- **Public setting:** require TURNSTILE_SITE_KEY alongside the existing secret.
  An empty-input read-only POST function exposes only that public key; SSR may
  call it from GET /sign-in. Keep exact-Origin JSON RPC checks and private,
  no-store HTML. Missing configuration shows a safe correlated error.
- **Unassigned:** the existing destination rules redirect unassigned people to
  /no-workspace, a translated page with the approved static message. It exposes
  no identity or permission information and grants no access.
- **Browser fixtures:** the guarded runner changes only its isolated copy to
  install an external Siteverify response stub. The Web FetchInterceptor from
  MSW's existing dependency tree avoids BroadcastChannel, which standalone
  workerd lacks. Both the external browser SDK and verification service can be
  controlled; credentials, native cookies, storage and continuation stay real.

## Alternatives

- **Custom authentication:** duplicates the existing native credential checks.
- **Another widget package:** unnecessary for one explicit browser integration.
- **Dummy keys alone:** the verification reply omits the hostname/action that
  our unchanged backend requires; it cannot prove those checks.
- **Full MSW network setup in the browser Worker:** requires BroadcastChannel.
  The lower-level Web interceptor supplies only the needed fetch boundary.

## Impact

- **Configuration:** add the public widget key to Hub settings. The test
  interceptor is an exact root development dependency already present
  transitively; application runtime dependencies and Vite settings are unchanged.
- **Scope:** this delivers the Hub sign-in part of T022. Workspace session-return
  handling is next. Account/STMS feature screens, complete browser token exchange,
  the six-story acceptance checks and hosted/release verification remain pending.
- **Constitution:** identity stays in the Hub, existing access and save/audit
  rules remain authoritative, and the approved sign-in audit exception remains.
  There is no new data-safety exception.

## References

- [Better Auth email/password](https://better-auth.com/docs/authentication/email-password)
- [Username client](https://better-auth.com/docs/plugins/username)
- [Native signed continuation](https://better-auth.com/docs/plugins/oauth-provider)
- [CAPTCHA client header](https://better-auth.com/docs/plugins/captcha)
- [Turnstile explicit rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)
- [Turnstile widget lifecycle](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/)
- [Turnstile test responses](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
- [MSW Web fetch interceptor](https://github.com/mswjs/interceptors#fetchinterceptor)
