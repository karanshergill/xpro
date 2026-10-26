# Implementation Plan: Sign-in and Accounts

**Branch**: `001-sign-in-and-accounts` | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

## Summary

The Hub, a separate app, handles central sign-in, profiles and STMS for the
master user. Public sign-up is disabled for now.
Logins, accounts, memberships and sessions live in the Hub's shared database, with its own
append-only audit log. Each workspace app signs people in through the Hub using the standard
sign-in protocol (OpenID Connect) and keeps its own session. Built backend first: setup, then
the save helper and audit log, then each story's server functions with tests, then screens,
then wiring.

## Technical Context

**Language/Version**: TypeScript 6
**Primary Dependencies**: TanStack Start; Better Auth (default password hashing, username,
  admin, organization, JWT and OAuth provider add-ons); Kysely, kysely-d1, kysely-durable-objects; Valibot;
  libphonenumber-js; true-myth; uuid v7; temporal-polyfill; TanStack Query and Form; shadcn;
  Paraglide JS; react-image-crop
**Storage**: Hub: D1 for logins, accounts, workspace memberships, sessions and the Hub's audit
  log; R2 for profile pictures. Workspace: its own Durable Object for local user details,
  business permissions, sessions and its audit log
**Testing**: Vitest 4 with Cloudflare's test plugin (tests run inside the Workers runtime);
  Playwright later for screens
**Target Platform**: Cloudflare Workers; Workers Paid from the first deploy of sign-in to the
  test environment
**Project Type**: web apps (Hub, workspace app) plus module packages
**Performance Goals**: sign in to the right place within 3 seconds (SC-002)
**Constraints**: one workspace per person for now; nothing secret in web addresses except the
  one-time sign-in code (FR-018); local apps run over https on *.localhost
**Scale/Scope**: 6 stories, 30 requirements; first users are xpro's team and early account
  holders

## Constitution Check

Checked against constitution 5.0.0.

| Rule | Result |
|---|---|
| I. Workspace isolation | Pass. Hub holds identity and workspace membership. Business permissions, teams, entities, records and workspace sessions stay local. |
| II. Runs anywhere | Pass. Better Auth reads and writes through its own Kysely layer on D1; our code uses Kysely everywhere. |
| III. Data safety | Pass with two exceptions (below): sign-in auditing and resumable login creation. Other STMS actions are saved in one batch with their audit entry; Better Auth's permanent "remove user" is switched off; workspaces upgrade themselves; the Hub's database is upgraded before each release. |
| IV. Cloudflare and Bun | Organization plugin runtime checks pending. Bun and Workers stay unchanged; test membership flows on D1/workerd. |
| V. Simple and maintainable | Pass. Reuse Better Auth for identity and membership; keep custom code to xpro-specific rules and storage integration. |
| VI. Tested behaviour | Pass. API tests for every story, written backend first. |
| Architecture rules | Pass. Locally the apps run as separate Workers; Workers for Platforms is switched on before the first client. |

**Sign-in audit exception:** Better Auth saves a sign-in session before the Hub writes its audit entry.
If the Worker stops between those writes, the sign-in can be missing from the audit log.
This rare case is accepted for the initial version; no extra recovery system is built for it.
Revisit if complete sign-in audit coverage becomes a requirement.

**Login creation exception:** Story 6 spans Better Auth's writes in D1 and, when needed,
the workspace's separate database. A later failure may leave incomplete records.
Accept those records only while access is blocked and the same creation request can
finish the missing steps, as set out in [Login creation retries](#login-creation-retries).
Other STMS changes and their audit entries are still saved together.

## First master user

- **Creation:** a private setup step creates the initial master user when xpro is
  first set up, using an explicitly supplied email and password.
- **Reuse:** use Better Auth's user creation, password hashing and admin role support.
- **Public sign-up:** disabled for now. If approved later, it must never grant
  master access.
- **Safe to repeat:** running setup again does not create another master, change
  existing roles or reset passwords.
- **Additional masters:** more master users may be added later, only by an existing
  master user. A management screen is outside this initial feature.
- **Credentials:** no default password or credentials committed to the repository.
- **Keep it small:** no public setup page or separate setup service.
- **Tests:** prove setup creates only the selected initial master, a repeat run
  leaves existing logins, roles and passwords unchanged, and public sign-up cannot
  grant master access.

## Workspace membership

- **Hub:** Better Auth's Organization plugin keeps the official membership list
  and controls who may manage members.
- **Login creation:** use the shared permission check for Story 6. Non-master
  creators need current membership and the Organization plugin's `member:create`
  permission for the requested workspace. The Hub then uses Better Auth's server
  APIs to create a non-master login and add its membership, without giving the
  creator global admin access.
- **One organization per workspace:** an organization represents a workspace,
  not the account that owns it.
- **Routing:** use the requested address and placement record to find the workspace app.
  Use Story 2 for the default destination after sign-in. The workspace app applies the
  [shared access checks](./contracts/server-functions.md#access-checks) before allowing access.
  Do not add a separate workspace-ID field to the login.
- **Workspace:** keep internal/external user type, business roles, permissions,
  teams, entities and business records locally.
- **Initial scope:** leave optional teams, dynamic roles and invitations unused.
  Each person still belongs to at most one workspace.
- **Unused endpoints:** block direct HTTP requests for creating, changing or deleting
  organizations and for invitation flows until the corresponding xpro features
  are approved. Prepared-workspace setup uses trusted server-side calls.
  Test that direct requests are refused while setup and login creation still work.
- **Workspace creation:** remains an STMS action in a later feature.
  Use prepared workspaces and memberships for this feature's tests.
- **Validation:** test login creation and membership flows on D1 in the Workers runtime.
  For Story 6, check the Hub login, membership and audit entry, the workspace-local
  internal/external type, first sign-in, permission checks and creation retries after
  failed saves. Do not treat the integration as working until these checks pass.

## Login creation retries

Decision record: [ADR-010](../../docs/adr/010-retry-incomplete-login-creation.md).

- **Reference:** after checking input and permissions, save one login creation request
  in the Hub before the first login write. Tie it to the creator, intended workspace
  and non-secret creation details. Set its reference on the new login in the initial
  login write, so an interruption cannot lose that association.
- **Blocked until complete:** a login created by Story 6 cannot use xpro until its
  password record and creation audit entry are saved, along with any required
  membership and workspace user record. This is separate from profile completion
  and suspension.
- **Retry:** keep the same reference after a failed save. Check current permissions
  again and finish only missing steps for that request. Refuse a reference used for
  a different creator, workspace or set of creation details. Matching an email or
  username alone never permits reuse of an existing login.
- **No repeated changes:** retries do not reset a saved password, change existing
  roles or create duplicate logins, memberships, workspace users or creation audit
  entries. Concurrent retries must have the same result as one completed request.
- **Completion:** after confirming all other required records, save the successful
  creation audit entry and the completion marker in one Hub batch. Only then report
  success and allow access. Repeating a completed request returns its original result.
- **Passwords:** never save a readable password in the creation request, logs or
  audit entries. Better Auth continues to hash and manage passwords.
- **Infrastructure:** use the existing Hub and workspace databases. No additional
  service or background retry system is needed; the creator retries the request.
- **Proof required:** test failures and interruptions between every creation step,
  including a lost success response, plus concurrent retries, changed permissions
  and unrelated duplicate emails or usernames. Prove blocked access until completion
  and exactly one completed creation with the original creator recorded.

## Sign-in protection

- **Bots:** Cloudflare Turnstile on sign-in. If public sign-up is approved later,
  add the same protection before enabling it.
- **Attempts:** one Cloudflare Workers rate-limiting binding for both sign-in methods,
  targeting 10 attempts per minute per normalized email or username.
  Counts are approximate and local to each Cloudflare location.
- **Keep it small:** no additional rate-limit database, library, separate IP limit
  or daily failed-attempt counter.
- **Harden later:** add stronger limits if observed abuse bypasses these protections
  or a customer security requirement calls for them.

## Project Structure

### Documentation (this feature)

```text
specs/001-sign-in-and-accounts/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── server-functions.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
apps/
├── hub/          Hub app: sign-in, my account, STMS screens, Better Auth
│                 (Worker name: xpro-hub)
├── web/          Workspace app (Worker name "xpro" must not change)
└── router/       Small front router: sends each address to the right app
packages/
├── core/         @xpro/core: save helper, audit log, workspace users
├── accounts/     @xpro/accounts: logins and profiles (username, phone and picture rules,
│                 reserved names)
└── stms/         @xpro/stms: managing logins (suspend, reactivate, archive, restore,
                  reset, change email or username)
```

**Structure Decision**: one folder per action inside each package, holding its logic, input
checks and tests. Apps stay thin: screens, settings and wiring only. `apps/web` keeps its name
until there is a real reason to rename it.

**Build order**: Setup → Foundations (save helper, then audit log) → backend for stories 1–5,
one function at a time, each with API tests → screens → wiring and checks that need a real
screen.
