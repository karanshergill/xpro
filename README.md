# xpro

A multi-tenant, modular business platform on Cloudflare Workers.

## Layout

- `apps/web`: the main app (TanStack Start on Cloudflare Workers)
- `packages/`: shared code (none yet)
- `docs/`: planning and tech stack
- `.specify/memory/constitution.md`: the project constitution, the permanent rules everything follows
- `.specify/`: Spec Kit templates and scripts
- `specs/`: feature specifications

## Develop

From the repository root:

```bash
bun install
bun run dev
```

The app runs at http://localhost:3000. Pages live in `apps/web/src/routes`; TanStack Router
updates `apps/web/src/routeTree.gen.ts` for you.

## Build and deploy

```bash
bun run build
bun run deploy
```

Deploying needs a Cloudflare login (`bunx wrangler login`). Bindings (D1, R2, Durable Objects)
and plain settings go in `apps/web/wrangler.jsonc`; secrets are kept in Cloudflare Secrets Store.
