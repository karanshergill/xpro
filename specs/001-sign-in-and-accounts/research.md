# Research: Sign-in and Accounts

## 1. Password hashing

- **Decision:** Better Auth's default password hashing at full strength, with no custom code.
  Workers Paid from the first deploy of sign-in to the test environment.
- **Rationale:** one hash takes about 30 ms locally and is reported at 73–170 ms on Cloudflare,
  above the free plan's 10 ms limit. Better Auth already uses the fastest method available on
  Workers, and its strength has no setting.
- **Alternatives considered:** a weaker hash through custom functions until the paid plan
  (rejected: custom code, and existing test passwords would need resetting).

## 2. Getting from the Hub into a workspace

- **Decision:** the standard sign-in protocol (OpenID Connect). The Hub uses Better Auth's OAuth
  provider add-on; each workspace is a trusted app that skips the consent screen, uses
  `oauth4webapi` to finish sign-in, and keeps its own session.
- **Rationale:** the proven standard for sign-in across addresses; works for clients' own
  domains and several workspaces per person later. A local test confirmed: sign-in with no extra
  screen, single-use codes, protection against stolen codes, no refresh tokens unless asked for,
  and sign-out messages to the workspace (back-channel).
- **Required fixes found by the test:**
  - suspending does not send the sign-out message, so suspend and archive first end all the
    person's sessions;
  - setting a password as admin does not end sessions, so reset also ends them;
  - the code always travels in the web address, so FR-018 allows that single protected code;
  - workspace addresses must be https and, for sign-out messages, public, so local apps run over
    https with a test-only stand-in for sign-out messages.
- **Alternatives considered:** a shared cookie on the main domain (reaches workspaces the person
  doesn't belong to; no clients' own domains); our own one-time code hand-off (custom security
  code); signed passes with refresh tokens (suspension delayed until a pass expires, against
  SC-006); a gateway check in the router (details passed between our own apps are hints, not
  proof).

## 3. The Hub's audit log

- **Decision:** kept in the Hub's D1 database. Triggers refuse any change or deletion; an STMS
  action and its audit entry are sent as one batch; each entry's link to the previous entry is
  unique, so a fork in the chain is refused and retried.
- **Rationale:** all three behaviours were confirmed in a local test.
- **Alternatives considered:** a separate Durable Object for the Hub's audit log (two stores to
  keep in step for every STMS action).

## 4. Local development

- **Decision:** the Hub, the workspace app and the router each run with their own dev command on
  `*.localhost`, over https, and reach each other through service bindings.
- **Rationale:** Cloudflare documents cross-process bindings for both `vite dev` and
  `wrangler dev`; `*.localhost` behaves like separate addresses for cookies.
- **Alternatives considered:** one dev command for all Workers (only one is reachable from the
  browser).

## 5. Test tools and installs

- **Decision:** Vitest 4 with `@cloudflare/vitest-plugin`; Bun `exact = true` and
  `minimumReleaseAge = 259200` (3 days).
- **Rationale:** the plugin supports Vitest 4 only; Vitest 5 breaks it.

## 6. Save helper

- **Decision:** open, decided by the save helper's first test, which compares running Kysely-built
  statements inside the Durable Object's one-step transaction with running Kysely inside the
  async transaction. The result goes into ADR-002.
- **Rationale:** `kysely-durable-objects` blocks Kysely's own transactions, and the async method
  needs proof that it keeps all-or-nothing.
