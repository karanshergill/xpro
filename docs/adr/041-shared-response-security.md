# ADR-041: Shared response security policy

**Status:** Accepted | **Date:** 2026-10-30

## Problem

- **Gap:** the Hub, workspace and router return protected pages without a shared
  framing or referrer policy. Private-picture responses alone set `nosniff`.
- **Constraint:** native authentication has its own CSP and multiple cookies.
  Responses may stream or carry upgrade metadata; protection must preserve them.

## Decision

- **Boundary:** apply Core's `secureResponse` to responses returned by each public
  Worker fetch entry, including the local router. Keep routing and access rules
  inside the existing handlers.
- **Policy:** set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
  `Referrer-Policy: no-referrer`. Append a CSP containing `frame-ancestors 'none'`,
  `base-uri 'none'` and `object-src 'none'`.
- **Preservation:** use the native Response constructor with the original body
  and response initialization. Keep status, redirects, cache rules, separate
  cookies, streaming and Cloudflare WebSocket metadata. Additional CSP policies
  apply together, preserving native authentication's stricter policy.
- **Verification:** retain Workers coverage of returned response shapes and
  browser coverage of actual framing refusal, omitted referrers, literal user
  text and native logout confirmation. Verify null-Origin confirmation succeeds
  only with native same-origin metadata; cross-site confirmation stays refused.
- **Diagnostics:** retain privacy checks against real sign-in diagnostics,
  navigation URLs and audit rows. Await native schema validation in the shared
  browser fixture before disposing its database proxy; do not suppress errors.

## Rejected options

- **Headers at individual routes:** easy to omit on errors, redirects or new pages.
- **Replace native CSP or combine cookies manually:** can weaken native policy or
  damage authentication responses.
- **A header dependency or body buffering:** unnecessary for four Web API changes.
- **Immediate strict script policy or HSTS configuration:** requires separate
  production asset, inline-script, verification and domain review. No deployment
  setting is changed by this task.

## Impact

- **Scope:** no dependency, schema, runtime, Vite, Cloudflare or deployment
  configuration change. No additional Hub call or response-body buffering.
- **Boundary:** this policy covers Worker-generated responses. Platform-served
  static assets, edge errors, hosted dispatch and production source-map exposure
  still need deployment verification.
- **Privacy:** deletion requests, anonymisation and retention policy remain
  explicitly outstanding in the feature security review. This decision does not
  claim complete privacy or release acceptance.

## References

- [OWASP HTTP response headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)
- [CSP frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors)
- [Cloudflare Response API](https://developers.cloudflare.com/workers/runtime-apis/response/)
- [Better Auth security at the pinned release](https://github.com/better-auth/better-auth/blob/v1.7.12/docs/content/docs/reference/security.mdx)
- [Better Auth database schema checks](https://github.com/better-auth/better-auth/blob/v1.7.12/packages/better-auth/src/auth/base.ts)
