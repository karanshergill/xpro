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
- Non-trivial logic (branches, loops, parsing, money and security paths) must leave at least one
  test that fails if the logic breaks. Trivial code needs no test.
- Fix bugs at the root cause, not the symptom: find every caller of the code being changed and fix
  the shared code once, rather than patching only the caller in which the problem appeared.
- When two solutions are equally simple, choose the one that handles edge cases correctly, not the
  shorter or more familiar one.
- Mark every deliberate shortcut with a `shortcut:` comment stating its limit and when to upgrade
  it. A shortcut comment without an upgrade trigger is not allowed. Review the list of shortcut
  comments before each release.

Before writing code, understand the problem first: read the task and every piece of code it
touches, and trace the real flow end to end. Then stop at the first step that holds:

1. Does this need to exist at all? If not, do not build it.
2. Does the codebase already have it? Reuse it.
3. Does the platform or standard library cover it? Use it.
4. Does an already-approved dependency cover it? Use it.
5. Does a proven dependency cover it? Add it only after checking its official docs and
   Cloudflare Workers compatibility.
6. Only then: write the minimum custom code that works.

After confirming changes work, review them and:

- Remove dead, speculative, or unnecessary code.
- Replace hand-built code that the platform, standard library, or an approved dependency already
  provides.
- Improve unclear names.
- Collapse abstractions that provide no benefit: an interface with one implementation, a factory
  that builds one thing, a setting nobody changes, a wrapper that only passes calls through.
  Planned extension points are the exception.
- Split code that mixes unrelated responsibilities.
- Simplify conditionals and data flow.
