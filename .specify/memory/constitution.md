# xpro Constitution

## Core Principles

### I. Workspace Isolation

- **No shared data:** workspaces MUST NOT share business data. Each workspace has its own storage.
- **Only shared thing:** each person's login, contact and personal details, kept in one place.
- **Everything else stays inside:** roles, teams, entities and all records live in the workspace.
- **Why:** a tenant's data must never leak into, or depend on, another workspace.

### II. Runs Anywhere

- **One codebase:** all workspace apps run the same code; only settings differ.
- **Location-independent:** business logic MUST be written once and run both inside a Durable
  Object and against an external database (PostgreSQL or MySQL).
- **One way to reach data:** all database access goes through Kysely. No code may depend on
  where a workspace's data lives.
- **Why:** workspaces can grow or move without rewriting features.

### III. Data Safety

- **All-or-nothing saves:** related changes MUST be saved together, or not at all.
- **Archive, never delete:** users and business records are archived, so history stays intact.
- **Self-upgrading storage:** each workspace upgrades its own database when first opened
  after a release.
- **Why:** manufacturers rely on correct stock, money and audit history.

### IV. Cloudflare and Bun

- **Runtime:** production runs on Cloudflare Workers.
- **Tools:** Bun is the only package manager and script runner.
- **New add-ons:** before adding one, check its current official docs and confirm it works on
  Workers. Prefer standard web features. Working on Node.js does not prove it works on Workers.
- **Protected setup:** runtime, Vite, Cloudflare and deployment settings change only on request.

### V. Simple and Maintainable

- **Long-term choices:** when the direction is unclear, pick the safest simple option.
- **Proven over custom:** use well-known libraries instead of building our own.
- **Abstractions:** add them only for stable ideas. Some repetition beats a wrong abstraction.
- **Errors:** handle only failures that can really happen.
- **Never simplified away:** input checks at trust boundaries, error handling that prevents data
  loss, security and accessibility.
- **Clean-up:** after a change works, remove dead code, fix unclear names and simplify.

### VI. Tested Behaviour

- **What to test:** what users and callers can see, not internal details.
- **Throwaway tests:** tests written only to prove a fix are removed unless they protect
  real behaviour.
- **Done means checked:** a feature is done only when its "done when" checks pass.

## Architecture Rules

- **xpro's own workspace:** xpro runs its business in its own workspace. Accounts, workspaces,
  modules and billing are managed by STMS, a module installed only there. Only STMS can create,
  change or suspend other workspaces.
- **One app per workspace:** every workspace runs in its own app on Workers for Platforms, in
  Cloudflare's isolated mode.
- **Custom code:** real custom code goes only into the app of the workspace it was built for.
  No-code changes (fields, forms, workflows) work everywhere.
- **Custom code authors:** only the xpro team writes code that runs inside xpro. Tenants use
  public APIs.
- **Module split:** only heavy modules get their own database, and only when their data never
  needs to be saved together with another module's.

## Development Workflow

- **Plan before code:** nothing is built until it is planned and approved.
- **Approval:** no text goes into planning documents without the product owner's approval,
  one section at a time.
- **Diffs first:** every change to an existing project file is shown as a diff and approved
  before it is written.
- **Decision records:** every decision with real alternatives gets a short record in
  `docs/adr/`: the problem, the decision, the rejected options and the impact.
- **Feature steps:** specify → clarify if needed → plan → tasks → implement → converge.
- **Plain language:** planning documents use short bullets in the form "**Term:** meaning".
- **References:** outside products used as inspiration are not named in project documents.

## Governance

- **Priority:** this constitution overrides all other practices. `AGENTS.md` holds the
  day-to-day tool instructions and MUST agree with it.
- **Changes:** amendments need the product owner's approval and a version bump.
- **Versioning:** major = a rule removed or redefined; minor = a rule added or expanded;
  patch = wording only.
- **Checks:** every plan and review MUST confirm it follows these rules. Any exception MUST
  be written down with its reason.

**Version**: 2.1.0 | **Ratified**: 2026-09-24 | **Last Amended**: 2026-09-25
