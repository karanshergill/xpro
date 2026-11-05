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
- shadcn/ui (Base UI; components copied into our code; right-to-left ready;
  Button, AlertDialog and shared theme tokens live in @xpro/ui)
- react-image-crop 11.1.2 (Hub square picture selection; bounded Canvas output
  uses the existing private Images/R2 upload service)
- qrcode.react 4.2.0 (Hub authenticator setup; browser-local SVG from Better Auth's native setup URI, with manual-key fallback)
- Paraglide JS (translations)
- barcode-detector (camera barcode scanning; its scanner file is served from
  our own address)

## Shared libraries
- true-myth (named results for expected business outcomes)
- cookie-es (server-only cookie parsing and serialization; Web Crypto encrypts private cookies)
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
  username, admin, organization, two-factor, JWT and OAuth provider add-ons; the Hub handles
  sign-in and workspace membership. The Organization plugin manages who belongs
  to each workspace and who may manage its members; one organization per workspace)
- @better-auth/core 1.7.12 (direct Hub reference to the existing native adapter
  types and request-local endpoint context; no independent authentication runtime)
- oauth4webapi (workspace apps finish sign-in through the Hub; certified
  OpenID Connect client)
- jose (verifies signed Hub logout messages using Web Crypto)
- AccessControl v3 (to confirm when planning Access control)
- Cloudflare D1 (shared login details, workspace membership and the prepared
  workspace/address directory owned by STMS)
- Kysely (kysely-durable-objects for Durable Objects, exact version pinned;
  Better Auth's native Kysely adapter for D1 through Core's shared connection;
  module-owned table views; built-in Migrator for migrations)
- Cloudflare R2
- Cloudflare Queues
- Durable Objects (one per workspace; alarms for long workspace jobs)
- Service Bindings
- Cloudflare Workers for Platforms (one app per workspace, isolated mode)
- Cloudflare Workflows (platform app only)
- Cloudflare Workers KV (router's fast copy of the placement record, filled
  from the private Hub placement binding on a miss)
- Cloudflare Workers Cache (per-app response caching)
- Cloudflare for SaaS custom hostnames (clients' own addresses)

## Security
- Cloudflare Turnstile (server verification through Better Auth's existing CAPTCHA
  plugin; both sign-in methods require the Hub hostname and `sign-in` action)
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
- tsx 4.23.15 (development tool; runs the hosted setup TypeScript command in
  the existing Node.js tooling runtime)
- Wrangler
- Cloudflare Vite Plugin
- Cloudflare API MCP (hosted OAuth connection for inspecting and managing Cloudflare
  resources; permissions cover xpro's services; see [connection guide](./CLOUDFLARE_MCP.md))
- mkcert 1.4.4 (local HTTPS certificates; development tool only)
- Graphify CLI 0.9.97 (`graphifyy`, isolated Python development tool; static
  code mapping and Codex-assisted documentation extraction; see
  [Graphify guide](./GRAPHIFY.md))
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

## Release CI tool pins

The manual test workflow uses GitHub-hosted Ubuntu 24.04. These tool versions
match the locally checked release setup; they do not change the Workers runtime.
Action references use full commit IDs with version comments in the
[workflow](../.github/workflows/release-test.yml). Verified on 2026-11-05; all
selected releases cleared the three-day waiting period. No package is added.

| Tool | Exact version | Purpose |
|---|---|---|
| Node.js | 24.21.0 | Existing Vite, Wrangler and release-command host |
| Bun | 1.4.4 | Frozen install and project scripts |
| `actions/checkout` | 7.0.1 | Read the selected commit without persisting Git credentials |
| `actions/setup-node` | 7.1.0 | Install the pinned Node host; automatic package caching disabled |
| `oven-sh/setup-bun` | 2.2.0 | Install the pinned Bun version |
| `actions/upload-artifact` | 7.0.2 | Retain only safe native release receipts for seven days |

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
| `seroval` | 1.6.11 | Existing TanStack serializer, overridden to the patched version; direct development dependency for Workers security regressions |
| `kysely` | 0.28.18 | Typed queries and migrations; one tested version across the workspace |
| `@better-auth/kysely-adapter` | 1.7.12 | Native D1 queries, introspection and schema tooling |
| `kysely-durable-objects` | 0.2.2 | Workspace SQLite dialect |
| `oauth4webapi` | 3.8.8 | Workspace OIDC client |
| `jose` | 6.2.13 | Signed Hub logout verification; already installed through Better Auth |
| `cookie-es` | 3.1.1 | Server cookie parsing and serialization |
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
| `qrcode.react` | 4.2.0 | Hub MFA setup QR as local SVG; React 19 peer and no additional runtime dependencies |
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

T019 directly declares the already-installed `jose` 6.2.13 in the web app.
Its official documentation supports Workers; its October 20 release clears the
three-day waiting period. Native logout delivery in OAuth Provider 1.7.12 needs
`patches/@better-auth%2Foauth-provider@1.7.12.patch`: workerd rejects
`redirect: "error"`, so use `manual` and retain the native refusal of redirects.
Remove that patch when upstream supplies equivalent Workers support. See
[ADR-018](./adr/018-workspace-sessions-and-logout.md).

The root `kysely` override keeps Better Auth and the workspace dialect on the tested
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

T008 directly declares the already-installed `@better-auth/kysely-adapter`
1.7.12 and removes `kysely-d1` 0.4.0. The latter delegates introspection to
Kysely's generic SQLite introspector, which queries Cloudflare's protected
internal tables and fails during migration. Better Auth's native D1
introspector skips those tables and uses supported per-table queries.
No additional transitive package or runtime was introduced. See
[ADR-011](./adr/011-hub-auth-migrations.md).

## Later
- Cloudflare Hyperdrive (external databases for large workspaces)
- Mobile number with OTP, and Google login
- Sentry (error and uptime alerts; free plan; set up before the first real
  client)
- k6 (load testing; confirm before the first real client)

Seroval 1.6.11 is pinned across the dependency tree after the 2026-10-29 audit
reported five advisories against 1.6.7. Its upstream fixes cover malformed
deserialization and generated-code injection. This patch release was published
on 2026-10-18, beyond the three-day install waiting period. Workers regressions
exercise the JSON decoder and safe generated output without evaluating code;
the local HTTPS proof also checks TanStack Start’s real request decoder.

Sources: [Seroval 1.6.11 release](https://github.com/lxsmnsyc/seroval/releases/tag/seroval%401.6.11),
[malformed-node denial of service](https://github.com/advisories/GHSA-97r2-qh9m-474h),
[overlapping array-length advisory](https://github.com/advisories/GHSA-wp97-x4hv-qvhp),
[iterator-source validation](https://github.com/advisories/GHSA-7rv5-mrxv-xcr9),
[RegExp output injection](https://github.com/advisories/GHSA-9wx9-5pv9-3349),
[typed-array output injection](https://github.com/advisories/GHSA-f86p-h4j2-7qgj).

## T016 screen dependency pins

Verified on 2026-10-29 against the current official documentation, published npm
manifests and actual local Workers/browser runs. All selected new versions clear
the three-day waiting period; Bun still disables install scripts. The existing
phone package is now also declared by the Hub for its country selector.

| Package | Exact version | Purpose |
|---|---|---|
| `@base-ui/react` | 1.9.0 | Accessible button, input and checkbox primitives; copied shadcn controls stay in the Hub |
| `@tanstack/react-form` | 1.33.5 | Form state, field blur/submit validation and submission status |
| `class-variance-authority` | 0.7.1 | Used button/field variants |
| `tailwind-merge` | 3.7.0 | Merge copied component classes |
| `lucide-react` | 1.61.0 | Checkbox, select and working-state icons |
| `libphonenumber-js` | 1.13.15 | Already approved phone package, directly declared for country/calling-code data |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.3 | Styling compiler and Hub Vite integration |
| `@inlang/paraglide-js` | 2.29.1 | Local translation compiler and Vite integration |
| `@inlang/plugin-message-format` | 4.5.5 | Pinned local message format plugin; compilation does not fetch a CDN plugin |
| `@playwright/test` | 1.64.1 | Real Chromium screen regressions, in root development tooling |
| `@axe-core/playwright` | 4.14.0 | Automated screen accessibility checks |

Base UI/Form peers accept the existing React 19 pins; Tailwind's plugin accepts
Vite 8; Paraglide accepts Vite 8 and TypeScript 6. Playwright and axe run only in
Node tooling. Tailwind and Paraglide compilers also stay out of the Worker runtime;
generated messages use the existing Node-compat async context support for SSR.
The three app builds and real local HTTPS screen checks validate this boundary.

The selected release dates are October 9 (Base UI), August 11 (Form), July 16
(Tailwind), November 26, 2024 (CVA), September 12 (tailwind-merge), October 21
(Lucide), October 19 (Paraglide), October 20 (message plugin), October 14
(Playwright) and October 15 (axe). Versions that were too recent were not selected.
No new backend framework, auth engine, Query provider or shared UI package is
introduced for the first screen. Remaining planned frontend tools stay planned.

See [ADR-032](./adr/032-profile-completion-screen.md),
[shadcn Base UI](https://ui.shadcn.com/docs/components/base/button),
[Form validation](https://tanstack.com/form/latest/docs/framework/react/guides/validation),
[Paraglide](https://github.com/opral/paraglide-js),
[Tailwind/Vite](https://tailwindcss.com/docs/installation/using-vite) and
[Playwright accessibility](https://playwright.dev/docs/accessibility-testing).


## Browser verification transport

- **Dependency:** @mswjs/interceptors 0.45.9 is an exact root development
  dependency, already resolved transitively through MSW. Its Web FetchInterceptor
  stubs only the external Turnstile verification reply in the guarded browser
  copy. Production app dependencies and Vite settings do not change.
- **Runtime check:** the standalone Worker lacks BroadcastChannel, so it cannot
  run MSW's full network coordinator. The smaller Web fetch interceptor runs
  against the existing workerd compatibility settings and native auth tests.
- **Release check:** version 0.45.9 was published on 2026-10-17, beyond the
  three-day waiting period. No transitive version changes are introduced.

Reference: [MSW fetch interception](https://github.com/mswjs/interceptors#fetchinterceptor).
