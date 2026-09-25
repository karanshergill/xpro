# ADR-001: One app per workspace

**Status:** Accepted | **Date:** 2026-09-25

## Problem

- Each workspace's data must never leak into, or depend on, another workspace.
- Some clients will need custom code that must not affect anyone else.
- Releases must be able to reach workspaces one group at a time.

## Decision

- Every workspace, including xpro's own, runs in its own copy of the app on
  Cloudflare Workers for Platforms, with its data in its own Durable Object.
- All workspace apps run the same code; only their settings differ.
- The apps run in isolated mode, so their caches never mix.
- One front router sends each visitor to the right app, using the placement
  record kept by STMS.

## Rejected options

- **One shared app for all workspaces:** one bug in a query filter could show
  one client's data to another, and custom code would reach every client.
- **A separately deployed app per client, without Workers for Platforms:** it
  does not scale past a handful of clients, and releases and routing would be
  manual.
- **Trusted mode:** shares the cache between apps, which weakens the
  separation this decision exists for.

## Impact

- **Better:** strong separation between workspaces, custom code for one
  client only, and releases workspace by workspace.
- **Costs:** Workers for Platforms needs the paid plan before the first real
  client; work spanning workspaces needs a separate platform app; and a
  router and placement record have to be built and kept correct.
