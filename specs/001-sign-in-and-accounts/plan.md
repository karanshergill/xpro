# Implementation Plan: Sign-in and Accounts

**Branch**: `001-sign-in-and-accounts` | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

## Summary

The Hub, a separate app, handles sign-up, the central sign-in, profiles and STMS for the
master user. Logins, accounts and sessions live in the Hub's shared database, with its own
tamper-proof audit log. Each workspace app signs people in through the Hub using the standard
sign-in protocol (OpenID Connect) and keeps its own session. Built backend first: setup, then
the save helper and audit log, then each story's server functions with tests, then screens,
then wiring.

## Technical Context

**Language/Version**: TypeScript 6
**Primary Dependencies**: TanStack Start; Better Auth (default password hashing, username,
  admin, JWT and OAuth provider add-ons); Kysely, kysely-d1, kysely-durable-objects; Valibot;
  libphonenumber-js; true-myth; uuid v7; temporal-polyfill; TanStack Query and Form; shadcn;
  Paraglide JS; react-image-crop
**Storage**: Hub: D1 for logins, accounts, sessions and the Hub's audit log; R2 for profile
  pictures. Workspace: its own Durable Object for workspace users, its sessions and its audit
  log
**Testing**: Vitest 4 with Cloudflare's test plugin (tests run inside the Workers runtime);
  Playwright later for screens
**Target Platform**: Cloudflare Workers; Workers Paid from the first deploy of sign-in to the
  test environment
**Project Type**: web apps (Hub, workspace app) plus module packages
**Performance Goals**: sign in to the right place within 3 seconds (SC-002)
**Constraints**: one workspace per person for now; nothing secret in web addresses except the
  one-time sign-in code (FR-018); local apps run over https on *.localhost
**Scale/Scope**: 5 stories, 29 requirements; first users are xpro's team and early account
  holders

## Constitution Check

Checked against constitution 3.0.0.

| Rule | Result |
|---|---|
| I. Workspace isolation | Pass. Only logins and personal details are shared, kept in the Hub. Workspace users, sessions and audit logs stay in each workspace's own storage. |
| II. Runs anywhere | Pass. Better Auth reads and writes through its own Kysely layer on D1; our code uses Kysely everywhere. |
| III. Data safety | Pass with one exception (below). STMS actions are saved in one batch with their audit entry; Better Auth's permanent "remove user" is switched off; workspaces upgrade themselves; the Hub's database is upgraded before each release. |
| IV. Cloudflare and Bun | Pass. Every new add-on was checked on the Workers runtime. |
| V. Simple and maintainable | Pass. Own code is limited to the suspend, archive and reset actions and the save helper. |
| VI. Tested behaviour | Pass. API tests for every story, written backend first. |
| Architecture rules | Pass. Locally the apps run as separate Workers; Workers for Platforms is switched on before the first client. |

**Exception:** Better Auth saves a sign-in session itself, so the sign-in's audit entry is written
straight after, with retries, not in the same save. A sign-in is never lost silently, but can be
recorded a moment late.

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
├── hub/          Hub app: sign-up, sign-in, my account, STMS screens, Better Auth
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
