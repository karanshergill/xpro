# Tech Stack

## Frontend
- TypeScript
- React
- TanStack Start
- TanStack Router
- TanStack Query
- TanStack Form
- TanStack Store
- TanStack Table v9 and TanStack Virtual (data tables; sorting, filtering and
  paging done on the server)
- Valibot
- Vite
- Tailwind CSS v4 (styling, through its Vite plugin)
- shadcn/ui (Base UI; components copied into our code; right-to-left ready)
- react-image-crop (profile picture cropping)
- Paraglide JS (translations)
- barcode-detector (camera barcode scanning; its scanner file is served from
  our own address)

## Shared libraries
- true-myth (named results for expected business outcomes)
- uuid (IDs: UUID v7)
- Dinero.js v2 (money) and big.js (other exact decimals)
- temporal-polyfill (dates and time zones; always imported from
  `temporal-polyfill/implementation`)
- libphonenumber-js (phone numbers; strict checks on the server)
- hucre (CSV and Excel files; formula escaping always on for exports; exact
  version pinned)
- bwip-js (barcode and QR code images)

## Backend
- TypeScript
- Cloudflare Workers
- TanStack Start server functions/routes
- Better Auth (email and password; native scrypt for password hashing;
  username, admin, organization, JWT and OAuth provider add-ons; the Hub handles
  sign-in and workspace membership. The Organization plugin manages who belongs
  to each workspace and who may manage its members; one organization per workspace)
- oauth4webapi (workspace apps finish sign-in through the Hub; certified
  OpenID Connect client)
- AccessControl v3 (to confirm when planning Access control)
- Cloudflare D1 (shared login details, workspace membership and the placement record)
- Kysely (kysely-durable-objects for Durable Objects, exact version pinned;
  kysely-d1 for D1; built-in Migrator for migrations)
- Cloudflare R2
- Cloudflare Queues
- Durable Objects (one per workspace; alarms for long workspace jobs)
- Service Bindings
- Cloudflare Workers for Platforms (one app per workspace, isolated mode)
- Cloudflare Workflows (platform app only)
- Cloudflare Workers KV (router's fast copy of the placement record)
- Cloudflare Workers Cache (per-app response caching)
- Cloudflare for SaaS custom hostnames (clients' own addresses)

## Security
- Cloudflare Turnstile (bot protection on the central sign-in page)
- Cloudflare Workers rate-limiting binding (one sign-in limit targeting 10 attempts
  per minute per normalized email or username; approximate, per Cloudflare location)
- Cloudflare Secrets Store (beta)

## Email
- Cloudflare Email Service (beta; sent from a subdomain of xpro's domain)
- React Email (email templates)

## Operations
- Cloudflare Workers Logs (errors and logs)
- Cloudflare built-in 30-day restore (backups for D1 and Durable Objects)
- Cloudflare Flagship (feature flags, beta)
- Environments: local, test, live; every change must pass on the Cloudflare test environment
- Cloudflare Workers Free plan during development; Workers Paid and Workers for Platforms
  before the first real client

## Tooling
- Bun (including `bun audit` in the automatic checks)
- Wrangler
- Cloudflare Vite Plugin
- mkcert 1.4.4 (local HTTPS certificates; development tool only)
- Vitest
- Istanbul coverage (@vitest/coverage-istanbul; Workers-compatible coverage)
- Cloudflare Vitest Plugin (@cloudflare/vitest-plugin; tests run inside the
  Workers runtime)
- MSW 3.0.3 with @msw/cloudflare 0.2.0 (outside-service test stubs; local Workers integration)
- Playwright
- Oxlint
- oxlint-tsgolint (type-aware lint rules)
- Oxfmt
- lefthook (checks before commit and before push)
- dependency-cruiser (import rules; blocks merges)
- eslint-plugin-boundaries (import rules in the editor, through Oxlint)
- knip (unused code and packages)
- design-lint (@evilmartians/design-lint; Tailwind colour and design-token rules,
  exact version pinned)
- GitHub Actions (checks and deploys)
- Dependabot
- Faker (@faker-js/faker; test data, local development data and demo data
  only)

## Sign-in foundation dependency pins

Verified on 2026-10-25 with Bun 1.4.2 and Node.js 24.21.0. This first
package set supports the backend and test foundation. Other libraries listed
above remain planned until their implementation tasks need them.

Installed in the repository after approval. The frozen install with scripts
disabled and security audit passed. After T002, all six workspaces passed
type checking, all three apps built, and local HTTPS passed verification
using the system trust store.

Runtime packages belong to the app or module that uses them: Better Auth and
its provider are in the Hub, the OIDC client is in the workspace app, shared
database/result/date/ID/validation libraries are in core, and phone validation
is in accounts. Test tools are root development dependencies. The Hub reuses
the web app's frontend and Vite tooling pins. Each module has one public
TypeScript entry; business actions are added by the later tasks.

| Package | Exact version | Purpose |
|---|---|---|
| `better-auth`, `@better-auth/oauth-provider` | 1.7.12 | Hub authentication and OIDC provider; built-in username/Admin/Organization/JWT plugins |
| `kysely` | 0.28.18 | Typed queries and migrations; one tested version across the workspace |
| `kysely-d1` | 0.4.0 | Hub D1 dialect |
| `kysely-durable-objects` | 0.2.2 | Workspace SQLite dialect |
| `oauth4webapi` | 3.8.8 | Workspace OIDC client |
| `valibot` | 1.5.0 | Input and profile validation |
| `true-myth` | 9.4.0 | Named business results |
| `uuid` | 14.0.3 | UUID v7 identifiers |
| `temporal-polyfill` | 1.0.6 | Dates and time zones through `/implementation` |
| `libphonenumber-js` | 1.13.15 | Strict phone validation through `/max` |
| `@cloudflare/vitest-plugin` | 1.4.6 | Local workerd, D1 and Durable Object tests |
| `vitest`, `@vitest/coverage-istanbul` | 4.1.12 | Matching test runner and coverage provider |
| `msw` | 3.0.3 | Outside-service HTTP/WebSocket test stubs |
| `@msw/cloudflare` | 0.2.0 | MSW integration inside workerd |
| `react`, `react-dom` | 19.3.0 | Existing web UI |
| `@tanstack/react-start` | 1.168.60 | Patched server-function transport |
| `@tanstack/react-router` | 1.170.41 | Router version used by the patched Start release |
| `vite` | 8.3.5 | Patched build tooling; shared with the root test tools |
| `@cloudflare/vite-plugin` | 1.57.2 | Existing Workers build integration |
| `wrangler` | 4.136.2 | Existing web development/deployment tooling |
| `@tanstack/router-cli` | 1.167.38 | Existing route generation |
| `@vitejs/plugin-react` | 6.1.1 | Existing React build integration |
| `typescript` | 6.0.3 | Application and test type checking |
| `@types/node` | 22.20.4 | Existing tooling types |
| `@types/react`, `@types/react-dom` | 19.3.0 | Matching React types |

Keep exact versions and the generated `bun.lock`. Bun's install settings use
`exact = true`, a 259200-second (3-day) minimum release age and
`ignoreScripts = true`. No package currently needs trusted install scripts.
Each selected direct version and override cleared the waiting period; the
minimum age also applies when resolving new transitive versions. Use
`bun install --frozen-lockfile` in automatic checks.

The root `kysely` override keeps Better Auth and both dialects on the tested
0.28.18 version, which satisfies their declared ranges. Reassess it when moving
the database stack to another tested Kysely version.

Four additional overrides patch dependencies still pinned or retained by the
current tooling graph. They are transitive dependencies, not extra application
libraries. Review them on dependency updates; remove each override once the
parent packages resolve a safe version and the frozen install, audit and
runtime tests pass without it.

| Override | Exact version | Security reference |
|---|---|---|
| `sharp` | 0.35.5 | [Image decoder advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) |
| `source-map-js` | 1.2.2 | [Source-map advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |
| `undici` | 7.30.1 | [Maintainer security fixes](https://github.com/nodejs/undici/releases/tag/v7.30.1) |
| `zod` | 4.6.7 | [Validation advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |

The Start update addresses [GHSA-qx66-fv34-fjm8](https://github.com/TanStack/router/security/advisories/GHSA-qx66-fv34-fjm8).
Better Auth uses its native D1 support; no additional ORM, password-hashing
package or backend server framework is needed.

The isolated candidate passed an install with scripts disabled, a frozen
reinstall, web type checking, the existing production build, a clean
`bun audit --json`, and ten temporary workerd dependency checks with Istanbul
coverage. Those checks exercised password verification/public-sign-up refusal,
D1 queries, Durable Object transaction rollback, OIDC PKCE, UUIDs, validation,
results, phones and time zones. They also checked the selected packages' peer
ranges against the installed versions. The temporary probes were removed;
they do not complete application acceptance tests or replace the permanent
test setup in T003. Full OIDC/browser flows and deployment are still pending.
Some published dependency source maps refer to omitted sources; the checks
passed with those diagnostic warnings.

The T003 test additions were checked on 2026-10-26. MSW 3.0.3 was
published on October 10 and the Cloudflare adapter 0.2.0 on September 28;
both clear the release waiting period. The adapter requires MSW 3 or later,
and the Vite and TypeScript versions satisfy MSW's applicable peer
ranges. Root test tooling declares the same already-pinned TypeScript,
Node types and Wrangler versions used by the apps. The candidate and repository passed a
frozen install, test and application type checks, all three builds, thirteen
workerd tests with Istanbul coverage and a clean security audit. Four
temporary negative controls in the candidate failed as expected and were removed.

MSW uses its documented `setupNetwork()` adapter and the version 3
`configure({ onUnhandledFrame })` API. Keep these pins together and run
the suite when updating them. The infrastructure tests do not implement
the application's auth, migration or acceptance-test fixtures.

References: [Bun install settings](https://bun.sh/docs/runtime/bunfig),
[Better Auth databases](https://better-auth.com/docs/concepts/database),
[Cloudflare Vitest setup](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/),
[MSW Cloudflare adapter](https://github.com/mswjs/cloudflare),
and the packages' published npm manifests for release timestamps and peer ranges.

## Later
- Cloudflare Hyperdrive (external databases for large workspaces)
- Mobile number with OTP, and Google login
- Sentry (error and uptime alerts; free plan; set up before the first real
  client)
- k6 (load testing; confirm before the first real client)
