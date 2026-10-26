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

- **Decision:** kept in the Hub's D1 database. Triggers refuse changes and deletions.
  Other STMS actions and their audit entries are sent as one batch. Login creation
  follows the exception in section 8 below. No fingerprint chain is used.
- **Rationale:** earlier local tests confirmed blocked changes/deletions and all-or-nothing
  batches. Independent proof is deferred until a customer or audit requirement calls for it.
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

- **Decision:** pin the tested Vitest 4.1.12 and `@cloudflare/vitest-plugin`
  1.4.6, with matching Istanbul coverage 4.1.12. Bun uses `exact = true`,
  `minimumReleaseAge = 259200` (3 days) and `ignoreScripts = true`.
- **Rationale:** this combination passed local workerd checks. The plugin's
  published 1.4.6 peer range is `^4.1.0 || ^5.0.0`; Vitest 5 is not categorically
  unsupported. Keep the tested 4.1.12 pin and revalidate before a major upgrade.

## 6. Save helper

- **Decision:** ordinary Kysely code inside the Durable Object's async all-or-nothing block,
  through one save helper (ADR-002).
- **Rationale:** a local test confirmed all-or-nothing on failure, reads inside a save, and
  correct numbering with 500 saves at once. Saves run one at a time per workspace, so no outside
  call happens inside a save.
- **Alternatives considered:** Kysely-built statements run as plain SQL in the one-step block
  (no reading and deciding in the middle of a save).

## 7. Workspace membership and access checks

- **Decision:** use Better Auth's Organization plugin in the Hub, one organization per
  workspace. Business roles, permissions, teams, entities and history stay local.
- **Rationale:** reuse built-in member management instead of building it ourselves.
  Membership also removes the need for a separate routing field on each login.
- **Initial scope:** use fixed member-management roles. Keep business teams workspace-local.
  Defer editable custom roles and invitation onboarding until needed.
  The one-workspace-per-person rule still needs xpro-specific enforcement.
- **Access checks:** all users follow the
  [shared access checks](./contracts/server-functions.md#access-checks).
  Each protected workspace request uses one combined Hub call through a Cloudflare
  Service Binding. Reuse its result only within that request; check business permissions locally.
- **Validation still needed:** test membership flows, the one-workspace rule and the
  linked access-check scenarios on D1 in the Workers runtime. Integration is not yet proven.
- **Alternatives considered:** local membership plus a Hub routing field (leaves member
  management custom); caching checks across requests (delays access removal).

## 8. Retrying interrupted login creation

- **Decision:** use the same saved login creation request to finish missing steps
  after a failed save. Keep the new login's access blocked until creation is complete.
  See [Login creation retries](./plan.md#login-creation-retries) for the rules.
- **Reason:** Better Auth's sequential server calls and a later audit or workspace
  save do not form one transaction. Failure probes left Hub records in place when
  the audit or workspace insert failed; an incomplete workspace user was denied access.
- **Storage boundary:** a [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
  protects its statements in D1. A [Durable Object transaction](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction)
  protects that object's storage. Neither rolls back writes in the other database.
- **Scope:** this is an explicit exception to all-or-nothing saving for Story 6.
  Use the existing databases; the creator retries without an additional service.
  Other STMS save and audit requirements remain in place.
- **Validation still needed:** the failure probes confirmed the partial-save problem,
  not the proposed retry fix. The local prototype had 35 passing assertions but seven
  unhandled errors and exited unsuccessfully. The retry flow needs its own passing
  behaviour tests, including failures between writes and concurrent retries.
- **Alternatives considered:** one transaction across D1 and workspace storage (not
  provided by those APIs); deleting partial logins (conflicts with keeping login
  history); a separate retry service (not needed for creator-initiated retries).
