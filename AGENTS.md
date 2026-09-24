## Runtime and Tooling

This project uses **Bun as the package manager and script runner**, but the production application runs on **Cloudflare Workers**.

### Required environment

* Bun: package manager and script runner
* Node.js: required for Vite, Wrangler, Miniflare, and Cloudflare development tooling
* Production runtime: Cloudflare Workers / `workerd`

### Commands

Use:

```bash
bun install
bun run dev
bun run build
```

This is a Bun workspaces monorepo. Apps live in `apps/`, shared packages in `packages/`.
The root scripts run the matching script in `apps/web` (`bun --filter @xpro/web <script>`),
whose dev script is:

```bash
vite dev --port 3000
```

Therefore start development from the repository root with:

```bash
bun run dev
```

The Worker name `xpro` in `apps/web/wrangler.jsonc` must not change: Durable Object data belongs to it.

Do not replace Bun with npm, pnpm, or Yarn.

Do not change the runtime, package manager, Vite configuration, Cloudflare configuration, or deployment configuration unless explicitly requested.

Before adding a dependency:

1. Verify its current official documentation.
2. Verify compatibility with Cloudflare Workers / `workerd`.
3. Prefer Web APIs and runtime-neutral packages.
4. Do not assume Node.js compatibility implies Cloudflare Workers compatibility.

Before running or suggesting project commands, inspect the existing `package.json` and configuration files rather than assuming scripts or flags.


## Engineering Principles

- Make architectural decisions for long-term maintainability. If the long-term direction is unclear, choose the safest simple option and avoid premature optimization or engineering.
- Prefer proven dependencies over custom implementations.
- Prefer deep, cohesive modules over many shallow abstractions when justified.
- Prefer some duplication over an abstraction without a stable concept.
- Introduce abstractions only when the underlying concept is sufficiently stable.
- Write error handling only for failures that can realistically occur.
- Write tests for observable behavior, not implementation details.
- Do not keep temporary tests created only to prove a fix or removal unless they protect meaningful behavior.

After confirming changes work, review them and:

- Remove dead, speculative, or unnecessary code.
- Improve unclear names.
- Collapse abstractions that provide no benefit.
- Split code that mixes unrelated responsibilities.
- Simplify conditionals and data flow.
