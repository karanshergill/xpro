# ADR-016: Save first-sign-in completion and its audit together

**Status:** Accepted | **Date:** 2026-10-27

## Problem

- **One-time username:** an initial username choice needs confirmation and must
  survive concurrent requests without being overwritten.
- **Atomic audit:** Better Auth's ordinary user update and a separate xpro audit
  cannot satisfy the required all-or-nothing save on D1.
- **Module boundary:** Accounts cannot import an application's save helper.

## Decision

- **Reuse the batch:** move the existing prepared-query `saveHub` implementation
  into Core's server entry. The Hub re-exports it for existing callers. Accounts
  keeps its own minimal table view and feature queries.
- **Complete only missing fields:** reuse the approved validation and availability
  helpers. Preserve valid stored details. Require explicit confirmation before
  setting or repairing a username; its new canonical spelling is also the native
  display username.
- **Guard the save:** read the person's profile by primary key. Insert the
  username audit only while that profile snapshot still matches, then update the
  same snapshot only if that new audit exists. Send both statements in one D1
  batch. Constraints refuse another owner's or a reserved name and roll back the
  audit too. No external call or interactive transaction runs inside the batch.
- **Contact details:** a name/phone-only completion uses one guarded update and
  no identifier audit. It does not reassign the unchanged username, so an existing
  owner's later reservation does not prevent completing their contact details.
- **Competing requests:** a lost snapshot is read once more to return completion
  or a named refusal. Never overwrite a newly saved valid username or retry a
  stale write. Repeating an already completed submission changes no records.
- **Legacy ownership:** repairing case or spaces may keep a claim already owned
  by this person. The existing normalized unique index proves that ownership;
  reservations still take precedence.
- **Native authentication:** the thin POST server function reads the signed
  native session, performs the shared live Hub check locally, and passes only
  server-derived services to Accounts. Submitted authority claims are refused.
- **Transport:** register the function in the Hub graph before its deferred
  screen exists. Keep Start's default CSRF middleware. Validate at that boundary
  and again in Accounts; serialize safe named failures instead of validator issues.
- **Settings:** declare required `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET` names
  for Wrangler typing and local validation. Supply their values privately;
  use the existing HTTPS/minimum-secret checks and no request-derived defaults.
- **Reporting:** each Hub request owns its request ID and error reporter.
  Native schema/logger hooks and the action boundary share that reporter so
  repeated callbacks report one safe event, without suppressing later requests.

## Rejected alternatives

- **Native update followed by audit:** can leave either an unaudited username
  or a misleading audit if the other write fails.
- **A new claim table, lock or retry service:** the existing constraints and
  conditional statements already enforce this small action.
- **A shared mutable username cache:** availability is not a reservation and
  would go stale across Workers.
- **Import the Hub app or copy its batch helper:** violates module direction or
  duplicates infrastructure that is already approved and tested.

## Impact and verification

- **Storage:** no schema migration, new resource, session, credential, Account,
  workspace or membership. Runtime targets and Worker names stay as configured.
- **Checks:** the original 47 completion cases now pass, plus regression and
  authenticated-boundary cases. Real D1 tests cover competing choices, atomic
  failures, current native sessions, safe errors and indexed save queries.
- **HTTP proof:** the built Worker was checked locally for session refusal,
  CSRF, method restriction, strict input, confirmation, own-profile saving and
  repeat submission, with unchanged neighboring records.
- **Scope:** the profile screen, browser warning and sign-in/OIDC destinations
  remain their separately scheduled tasks.

## References

- [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Kysely conditional expressions](https://kysely.dev/docs/recipes/expressions)
- [Better Auth server API](https://better-auth.com/docs/concepts/api)
- [TanStack Start server functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)
- [TanStack Start CSRF middleware](https://tanstack.com/start/latest/docs/framework/react/guide/middleware)
- [Wrangler required secrets](https://developers.cloudflare.com/workers/wrangler/configuration/#secrets-configuration-property)
