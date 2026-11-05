# ADR-014: Live Hub access through a private binding

**Status:** Accepted | **Date:** 2026-10-27

## Problem

- **Current identity:** a workspace must notice ended sessions, inactive logins,
  unfinished creation and current roles or membership on the next request.
- **Few calls:** multiple actions in one request need one Hub check. A local save
  cannot wait on a network call, and its permission facts may differ per action.
- **Native routes:** skipping a profile screen must not bypass the same policy
  through an enabled native HTTP route.

## Decision

- **Private RPC:** add `HUB_ACCESS`, targeting the named `HubAccess` entrypoint on
  the existing Hub Worker. Preserve its default TanStack HTTP handler and the
  existing `HUB` binding. Add no public validation route or new service.
- **One snapshot:** read session, login, linked creation and requested membership
  in one bound, indexed Kysely query. Validate session ownership and expiry; never
  trust roles or workspace hints from the caller.
- **One request:** `createAccessRequest` loads and validates the result before a
  save. Its synchronous `authorize` checks the current local permission for each
  action. No shared cache uses a login, session or correlation ID as its key.
- **One policy:** masters bypass membership and local grants, using their own
  identity. They still need an active session, completed creation and valid profile.
  Profile completion, session checks and sign-out stay available as appropriate.
- **Native hooks:** use Better Auth's HTTP middleware and session-create hook.
  Trusted direct server APIs remain available for xpro's separately authorized
  actions. Reject new sessions for archived or unfinished logins.
- **Shared validity:** Accounts owns username/name/phone validity, reused by Hub
  checks and later profile writes. Username availability remains T014.
- **Failures:** refuse access on malformed input, result or database failure. RPC
  returns a named failure without database exceptions. The request boundary logs
  only the safe event and request ID, once.
- **Types:** use Wrangler's multiple-config type generation for the actual RPC
  export. Resolve workspace imports through package import maps so consumer paths
  do not redirect imports belonging to the producer. The RPC class requires only
  its D1 binding, keeping its service contract independent of a caller's Env.
- **Runtime proof:** permanent workerd tests call the actual named Service Binding.
  The test Worker alone enables `enable_ctx_exports` for the installed test plugin;
  production compatibility settings remain unchanged. A separate temporary check
  verifies the built Hub bundle across two Workers with those production settings.

## Rejected alternatives

- **Public HTTP validation:** adds routing and another authentication mechanism
  where a private platform binding already exists.
- **Signed or cached permission claims:** cannot immediately reflect native
  session, role or membership changes without more invalidation machinery.
- **Separate validation calls:** adds runtime round trips and can mix state from
  different moments. Checking inside a save would also hold local serialization.
- **Custom native router wrapper:** duplicates path normalization and native
  routing behavior. The documented middleware is the supported extension point.

## Impact and verification

- **Existing storage:** no schema change, new Worker or workspace permission
  storage model. Keep Worker `xpro`, the Workspace class and existing data intact.
- **Checks:** all 37 T011 cases; real RPC success/revocation/failure; native HTTP
  gates; profile validity; query plans; request-result isolation; safe errors.
  Full tests, types and all three builds pass before applying the reviewed change.
- **Scope:** application sign-in/callback routes, completion writes and feature
  acceptance still follow their scheduled tasks. This is the shared foundation.

## References

- [Cloudflare RPC entrypoints](https://developers.cloudflare.com/workers/runtime-apis/rpc/)
- [Cloudflare RPC TypeScript](https://developers.cloudflare.com/workers/runtime-apis/rpc/typescript/)
- [Workers testing APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/)
- [TanStack custom Worker entrypoints](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/#custom-entrypoints)
- [Better Auth hooks](https://better-auth.com/docs/concepts/hooks)
- [Better Auth database hooks](https://better-auth.com/docs/concepts/database#database-hooks)
- [libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js)
