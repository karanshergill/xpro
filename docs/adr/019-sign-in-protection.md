# ADR-019: Native bot verification and platform sign-in limits

**Status:** Accepted | **Date:** 2026-10-28

## Problem

- **Bots:** both public credential methods need server-verified bot protection.
- **Attempts:** the approved policy targets 10 attempts per minute per normalized
  email or username, with approximate counters in each Cloudflare location.
- **Scope:** initial protection must use existing libraries and platform services.

## Decision

- **Native verification:** configure Better Auth 1.7.12's CAPTCHA plugin for
  both sign-in endpoints, the configured Hub hostname and action `sign-in`.
  It supplies Siteverify calls, rejection handling and a 10-second timeout.
- **Bounded token:** refuse headers longer than Turnstile's 2,048-character
  token limit before an outside verification call.
- **One binding:** use `SIGN_IN_RATE_LIMITER` with limit 10 and period 60.
  After refusing oversized tokens, count parsed sign-in submissions before
  CAPTCHA and password verification.
  Trim and lower-case identifiers; keep email and username keys separate.
- **Public boundary:** public HTTP settings require both protection services.
  Trusted server APIs used by setup and internal actions remain available.
  Native unused routes stay disabled, and sign-out needs neither check.
- **Safe refusal:** return the approved 429 limit message, or a static 403
  bot-verification message, with request ID and `no-store`. Issue no session.
  Save a refusal audit without submitted values or an affected login.
- **Service failures:** provider outages/timeouts and limiter exceptions refuse
  sign-in through the existing safe unexpected-error reporting path.
- **Configuration:** require `TURNSTILE_SECRET_KEY` privately. Reserve namespace
  `1001` for the Hub and confirm account-wide uniqueness before deployment;
  tests use a separate local namespace. Runtime versions and flags are unchanged.

## Alternatives rejected

- **Custom CAPTCHA client:** duplicates the installed plugin's supported checks.
- **Custom counters or another library:** add storage and code beyond the approved
  approximate policy.
- **Additional IP/daily limits:** remain deferred until observed abuse bypasses
  these protections or a customer requires stronger limits.

## Scope and verification

- **Runtime:** tests use real native credentials, migrations and local D1.
  They cover both methods, outgoing Siteverify data, rejected/missing/oversized
  tokens, hostname/action checks, malformed replies, outages and timeout.
- **Limit:** controlled platform outcomes cover normalization and failures.
  The real local binding also drives the application's refusal path; this does
  not prove an exact distributed count.
- **Isolation:** refused attempts preserve unrelated records, issue no cookies
  or session, and expose no credentials or submitted identifiers in logs/audits.
- **Remaining:** placement/public route composition is T021. The visible widget,
  screens and complete browser journeys are T022/T041.
- **Constitution:** workspace isolation, native password handling, existing saves
  and local real-runtime tests are preserved. No new exception is introduced.

## References

- [Better Auth CAPTCHA](https://better-auth.com/docs/plugins/captcha)
- [Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Workers rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
