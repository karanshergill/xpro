# ADR-003: Dates and time zones with temporal-polyfill

**Status:** Accepted | **Date:** 2026-09-25

## Problem

- Business dates need correct time zones, calendars and date arithmetic.
- JavaScript's standard date replacement, Temporal, is not reliable on
  Cloudflare Workers yet: its clock reported time zero during requests
  (workerd issue #6907), and the fix (workerd #6943) is not merged.

## Decision

- Use temporal-polyfill, always imported from
  `temporal-polyfill/implementation`, which never uses the built-in Temporal.
- All code imports Temporal from one internal module, so switching is a
  one-file change.
- Switch to the built-in Temporal once the fix is live on Cloudflare, its
  compatibility setting is on in our apps, and our tests pass there.

## Rejected options

- **Built-in Temporal on Workers:** its clock bug gives wrong times.
- **temporal-polyfill's default import:** it quietly uses the built-in
  Temporal when one exists, which brings the bug back.
- **Plain JavaScript `Date`:** no time zones beyond local time and UTC, and
  values can be changed in place by mistake.

## Impact

- **Better:** one standard date API everywhere, with correct time zones.
- **Costs:** about 20 KB added to the app, and an import rule to enforce:
  Temporal is imported only through the internal module.
