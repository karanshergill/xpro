# ADR-048: Render authenticator setup QR codes locally

**Status:** Accepted | **Date:** 2026-11-05

## Problem

- **Scanning:** authenticator enrollment must offer a QR code. ADR-044 initially
  used manual key entry and deferred scanning until it became a requirement.
- **Private material:** Better Auth already returns a setup URI containing the
  account and shared secret. A separate QR service would receive that material.

## Decision

- **Native source:** retain the existing validated `totpURI` as `totpUri` in
  temporary setup state. Encode that exact value rather than rebuilding its
  secret, issuer or settings. Keep native setup and code verification unchanged.
- **Local SVG:** pin `qrcode.react` 4.2.0 in the Hub and render its `QRCodeSVG`
  directly in the existing setup and replacement screen. Keep its black-on-white
  drawing and four-module quiet zone. Add a translated accessible title and
  instructions, preserve manual key copy and allow the image to fit narrow views.
- **Private lifecycle:** remove the QR on verification, refresh, identity/setup
  changes and leaving the page. Blank its SVG children synchronously through the
  existing private cleanup before a document can be suspended. Reuse the current
  form-generation guard against late replies and the pending/restart flow.
- **Verification:** check QR decoding against the native URI, real local MFA and
  replacement journeys, fallback, accessibility, translations and private-state
  cleanup. Check the package in the existing Workers build and keep its version
  exact. Preserve the runtime, deployment configuration and authentication guards.

## Rejected options

- **Manual key alone:** retains the onboarding limit the owner now requires removed.
- **Worker QR endpoint:** adds a request and server route for data already available
  to the screen. Reconsider if another feature requires server-generated QR images.
- **SVG-string adapter:** the broader barcode library listed in the stack is not
  installed. A React SVG component provides the required display directly.
- **External QR service:** discloses private authenticator setup material.

## Impact

- **Dependency:** one React 19-compatible package with no additional runtime
  dependencies. The existing barcode-library direction remains for its broader
  feature scope.
- **Limits:** setup still stays in temporary memory; refresh does not retrieve a
  saved secret or start a factor automatically. Hosted MFA and release acceptance
  remain separate from local QR verification.

## References

- [Better Auth 1.7 two-factor setup](https://better-auth.com/docs/plugins/2fa)
- [qrcode.react SVG renderer](https://github.com/zpao/qrcode.react)
- [Initial display decision](044-hub-mfa-screens.md)
