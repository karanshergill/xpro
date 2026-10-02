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
  username, admin, JWT and OAuth provider add-ons; the Hub is the sign-in
  provider for workspaces)
- oauth4webapi (workspace apps finish sign-in through the Hub; certified
  OpenID Connect client)
- AccessControl v3 (to confirm when planning Access control)
- Cloudflare D1 (shared login details and the placement record)
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
- Cloudflare Turnstile (bot protection on the central sign-in and sign-up pages)
- Cloudflare Workers rate limiting (sign-in attempts: 10 per minute per email or username)
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
- Bun
- Wrangler
- Cloudflare Vite Plugin
- Vitest
- Cloudflare Vitest Plugin (@cloudflare/vitest-plugin; tests run inside the
  Workers runtime)
- MSW for Cloudflare (@msw/cloudflare; stands in for outside services in tests)
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

## Later
- Cloudflare Hyperdrive (external databases for large workspaces)
- Mobile number with OTP, and Google login
- Sentry (error and uptime alerts; free plan; set up before the first real
  client)
- UI component kit on top of Tailwind (to decide)
- k6 (load testing; confirm before the first real client)
