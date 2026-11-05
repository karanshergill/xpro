# ADR-020: Prepared workspace address routing

**Status:** Accepted | **Date:** 2026-10-28

## Problem

- **Address:** default and custom addresses must reach the same isolated app.
- **Access:** a routing hint cannot replace the live workspace access check.
- **Scope:** T021 must connect prepared workspaces without building provisioning.

## Decision

- **Directory:** STMS owns placements and their unique HTTPS addresses in the
  existing Hub D1 database. One primary address supplies the default destination.
  Add two strict, indexed tables with native organization and placement links.
- **Private lookup:** export `HubPlacement` for the router. Return only routing
  data and distinguish missing records from unavailable storage.
- **Fast copy:** use the existing `PLACEMENTS` KV namespace. A validated hit
  avoids a directory call. A miss reads the Hub; `waitUntil` owns the copy write.
- **Dispatch:** production selects a prepared Worker by name through the native
  dispatch namespace. Preserve the request URL, method and body; overwrite
  request/workspace hints and remove untrusted identity/forwarded-origin hints.
- **Local development:** use the same router with one prepared `xpro` service.
  Cloudflare's real dispatch development path targets deployed user Workers.
  Verify actual dispatch in an approved staging namespace before rollout.
- **Workspace guard:** configured origins/ID and the real object ID must agree.
  Read the private local session and current Hub access. Non-masters also need
  an active local user. Reject cross-origin cookie-backed writes.
- **One request context:** run dynamic workspace handling in its existing object,
  then pass storage/access to native Start rendering. Actions reuse prepared
  synchronous authorization without a second authentication gateway.
- **Existing handlers:** compose native start/callback/sign-out/message behavior
  and the Accounts destination rules. The Hub chooses a primary workspace,
  account page, STMS or the approved unassigned message.
- **Setup:** each app declares the settings it requires. The `xpro` Worker name,
  runtime versions and compatibility flags stay unchanged. Added direct package
  edges reuse the already-approved Kysely/Valibot versions.

## Alternatives rejected

- **Routing from claimed user/workspace headers:** lets callers choose authority.
- **Checking identity at both router and workspace:** adds an authentication
  roundtrip while the workspace must still authorize its actions.
- **Custom dispatch/counter services:** duplicate supported platform features.
- **Live provisioning here:** exceeds the prepared-workspace scope.

## Verification and limits

- **Permanent tests:** real native auth, D1, KV and workspace objects exercise
  routed sign-in, origins, destinations, isolation, current access and safe
  failures. Directory queries use indexes; constraints and interrupted additive
  migration restart have coverage. No test bypass grants authentication.
- **Renderer:** component tests supply a small page callback. A separate built
  Worker probe verifies actual HTML streaming, private-settings exclusion,
  native callback and sign-out; its temporary adapters/data are removed.
- **Mutation:** reversing the object-ID guard fails its tests; restore the exact
  file before final verification.
- **Remaining:** screens, real browser recovery and deployed dispatch/domain
  checks remain pending. KV address-remapping invalidation and the local
  adapter's staging trigger are explicit `shortcut:` limits.
- **Rollout:** apply the additive Hub migration and private binding before the
  router depends on them. Configure the guarded workspace app before publishing
  its prepared addresses. No production migration or deployment runs in T021.
- **Constitution:** isolation, native credentials, existing saves and real-runtime
  tests remain intact. No new exception is introduced.

## References

- [Cloudflare hostname routing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/hostname-routing/)
- [Dynamic dispatch](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/dynamic-dispatch/)
- [Dispatch local-development limits](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/local-development/)
- [TanStack Start server entry and request context](https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point)
