# ADR-023: Complete creation after the private workspace save

**Status:** Accepted | **Date:** 2026-10-28

## Problem

- **Completion:** native login creation alone does not create the workspace user
  or its creation audit. An unfinished login must remain blocked.
- **Transport:** the Hub cannot access a tenant's storage directly. Public
  headers and request bodies cannot authorize a private workspace write.
- **Concurrency:** failed saves, lost replies and simultaneous retries must
  produce one completed creation and one audit, preserving existing records.

## Decision

- **Composition:** the thin Hub action calls Accounts' native preparation and
  completion actions. Keep Better Auth in the Hub and local saving in Core.
  Return only creation and login IDs after confirmed completion.
- **Local save:** validate the creation input and fixed workspace scope. Use
  the existing storage transaction and login-ID uniqueness. Insert only a missing
  row; preserve a matching active row and refuse a changed type or archived row.
- **Private delivery:** look up the intended workspace's authoritative Hub
  placement by ID. Dispatch to that app with creation IDs/type and request
  context in platform-supplied `props`, using its private HTTP path. No password
  or personal profile is sent. HTTP body/header claims cannot supply these props.
- **Receiving scope:** require valid private props and POST, then verify the
  configured workspace. The actual Durable Object RPC also verifies both its
  fixed deployment ID and its object identity. Parse UUID request context before
  safe error reporting. Raw database errors never cross the boundary.
- **Local development:** select the Hub's `local` Wrangler environment through
  its dev command. A private `WORKSPACE_USERS` service binding targets the prepared
  app's named `WorkspaceUserWriter`. Both transports use the same real object/save.
  The local shortcut refuses other app names; staging dispatch is required before
  releasing creation across deployed workspace Workers.
  The private initial-master command selects that same local environment, avoiding
  unsupported local dispatch and keeping its local database target explicit.
- **Receipt:** validate the serialized result and require the expected workspace,
  login and internal/external type before proceeding.
- **Final Hub save:** one D1 batch conditionally inserts the creation audit from
  the pending request and matching active native login, credential and membership.
  Only that batch's winning audit may set the created-login pointer/completion
  marker. Failure rolls both back; concurrent losers read the saved result.
  Recheck native prerequisites in that batch after the workspace call.
- **Repeats:** reauthorize and bind intent through native preparation on every
  request. Completed repeats return the saved result without another local write,
  credential change or audit. A different creator is forbidden; changed intent
  for the same creator remains a conflict.
- **Public boundary:** register the POST server function independently of its
  future screen. Check exact Origin and JSON media type and stream at most 64 KiB
  through Core's existing reader before Start deserializes the native payload.
  Preserve the serialized content; validate decoded fields again in Accounts.

## Alternatives rejected

- **One cross-database transaction:** unavailable across D1 and workspace storage.
- **Public endpoint or identity headers alone:** permits unauthorized local writes.
- **A new secret or signed-token system:** platform capabilities already carry
  private authority without another credential lifecycle.
- **Direct Hub access to workspace storage:** breaks the workspace boundary.
- **Audit and completion in separate saves:** can leave an unaudited usable login
  or duplicate creation audits.
- **Reset or overwrite on retry:** changes saved passwords, roles or local types.

## Verification and limits

- **Acceptance:** the original 87 cases now execute. Eleven additional creation
  cases cover final-batch reply loss, changed prerequisites, bad receipts, indexed
  batch lookups and origin refusal; the creation suite has 98 passing cases.
- **Boundaries:** permanent tests also cover local transactions, real private RPC,
  direct namespace bypass attempts, dispatch metadata and pre-deserialization limits.
- **Native probe:** nine built-Worker checks exercise the real Start endpoint,
  genuine native sign-in session, private binding, actual D1/DO completion and
  saved repeat, plus platform-delivered props and public refusal. Temporary
  adapters adapt transport only; they supply no authentication or creation policy.
- **Local setup:** the actual setup command creates once and skips a repeat with
  a different password. The original password still signs in, and the running
  local Hub recognizes that session, confirming its shared database target.
- **Mutation:** separating the final batch fails two tests; reversing the fixed
  workspace guard fails three. Exact sources are restored before final checks.
- **Deployment:** the hosted dispatch namespace, deployed placement/DNS/TLS and
  browser screens remain staging/release checks. The native props probe uses a
  real local service binding, not a hosted Workers for Platforms namespace.
- **Constitution:** uses ADR-010's existing creation exception. No dependency,
  schema, runtime or Vite configuration change. The Hub bindings/local dev command
  and isolated test bindings are explicit configuration changes in this patch.

## References

- [Dynamic dispatch props and capabilities](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/dynamic-dispatch/)
- [Private service-binding RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
- [SQLite Durable Object transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction)
- [D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [Cloudflare environments with Vite](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)
- [Workers for Platforms staging/local development](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/local-development/)
- [Start server functions and CSRF](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)
