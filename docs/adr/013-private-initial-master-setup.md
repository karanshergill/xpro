# ADR-013: Private initial-master setup

**Status:** Accepted | **Date:** 2026-10-27

## Problem

- **First login:** xpro needs one initial master without public sign-up, default
  credentials or an existing administrator session.
- **Repeats:** setup must never promote an existing login, reset its password or
  become a second way to add masters.
- **Native limitation:** Better Auth's Admin creation API saves the login and
  credential separately on D1. It cannot include our audit in one transaction.

## Decision

- **Private action:** validate explicitly supplied email and password, then refuse
  any Hub that already contains a login. Run one operator-controlled setup at a
  time before the Hub accepts writes. The existence probe reads at most one row.
- **Native creation:** use the installed Better Auth server API without request
  headers. Its configured Admin plugin assigns the global `admin` role and its
  default password handling stores the credential. No auth tables are hand-built.
- **Shared rules:** keep email normalization and the approved password rules in
  Accounts for reuse. Trim/lowercase email; preserve the password exactly. Unicode
  letters and combining marks do not count as password symbols.
- **Profile:** initialize no username, phone or placeholder name. Normal profile
  completion applies to this master when that flow is implemented.
- **Audit:** record successful initial creation with an empty actor, the new login
  ID and request ID. Keep submitted credentials and personal details out of output
  and audit entries. Report success only after the audit write finishes.
- **Local command:** Bun runs a small script using Wrangler's public
  `getPlatformProxy` and the actual Hub migrations. Fix the config and persistence
  paths to the Hub; disable remote bindings. Dispose bindings and connections.
  No application endpoint or extra service is introduced.
- **Production:** the reusable action accepts a real D1 binding and runs in workerd
  tests. Production execution and credentials require separately approved
  deployment settings; this command operates only on local development storage.

## Explicit setup exception

- **Partial failure:** login, credential and audit creation are separate steps. A
  failure can leave a master without its password, or a usable master without its
  creation audit. The command reports failure; it does not claim rollback.
- **Operator review:** stop after a failed setup and inspect/resolve it privately
  before opening the Hub. Repeating the command never repairs existing records
  and never changes their role, password or sessions.
- **Limit:** this is a serial, attended first-time setup exception. Add a
  database-backed claim and resumable setup before concurrent or unattended setup
  is supported. Other STMS changes retain their all-or-nothing audit rule; Story 6
  retains its separate approved retry/access requirements.

## Rejected options

- **General create-admin CLI:** Better Auth provides it, but it can create another
  admin after confirmation and does not enforce xpro's repeat-run restriction.
- **Public bootstrap route:** adds a privileged application surface solely for setup.
- **Existing-login promotion:** risks granting master access to an unrelated login.
- **Custom auth writes:** bypass native creation/hooks and duplicate password and
  plugin behaviour. The limited private setup exception keeps the native API.
- **Recovery service:** unnecessary for one attended setup; revisit at the stated
  concurrency/unattended trigger.

## Evidence and references

- **Checks:** permanent workerd tests use real migrations and native HTTP sign-in;
  they cover first creation, repeats, existing non-masters, invalid input, password
  boundaries/Unicode, blocked public routes and partial credential/audit failures.
- [Better Auth Admin creation](https://better-auth.com/docs/plugins/admin#create-user)
- [Better Auth create-admin command](https://better-auth.com/docs/concepts/cli#create-admin)
- [Wrangler platform proxy](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy)
- [D1 batch atomicity](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
