# Tech Stack

## Frontend
- TypeScript
- React
- TanStack Start
- TanStack Router
- TanStack Query
- TanStack Form
- TanStack Store
- Valibot
- Vite

## Backend
- TypeScript
- Cloudflare Workers
- TanStack Start server functions/routes
- Better Auth (email and password; native scrypt for password hashing)
- AccessControl v3 (to confirm when planning Access control)
- Cloudflare D1 (shared login details and the placement record)
- Kysely
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
- Cloudflare Vitest Plugin
- Playwright
- Oxlint
- Oxfmt
- GitHub Actions (checks and deploys)
- Dependabot

## Later
- Cloudflare Hyperdrive (external databases for large workspaces)
- Mobile number with OTP, and Google login
