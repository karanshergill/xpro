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
- Cloudflare D1 (Portal and shared login details)
- Kysely
- Cloudflare R2
- Cloudflare Queues
- Durable Objects (one per workspace)
- Service Bindings

## Security
- Cloudflare Turnstile (bot protection on sign-up and login)
- Cloudflare Workers rate limiting (login attempts)
- Cloudflare Secrets Store (beta)

## Email
- Cloudflare Email Service (beta)

## Operations
- Cloudflare Workers Logs (errors and logs)
- Cloudflare built-in 30-day restore (backups for D1 and Durable Objects)
- Environments: local, test, live
- Cloudflare Workers Free plan for now; paid plan before real users

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
- Cloudflare Workers for Platforms (dedicated apps)
- Mobile number with OTP, and Google login
