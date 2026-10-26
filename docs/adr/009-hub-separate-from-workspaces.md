# ADR-009: Hub separate from workspaces

**Status:** Accepted | **Date:** 2026-10-02

## Problem

- Sign-up, sign-in, logins, accounts, billing and STMS serve every
  workspace, so they need one home that no single workspace controls.
- For now each person belongs to only one workspace.

## Decision

- A separate app, the Hub, at its own address, holds everything that
  serves all workspaces: sign-up, the central sign-in, logins and
  profiles, account holders' account pages, and STMS for xpro's team.
- The Hub keeps its own append-only audit log.
- xpro's own workspace is an ordinary workspace for xpro's business,
  created when xpro starts using its own modules. Account holders are
  not users there.
- The Hub uses Better Auth's Organization plugin for membership
  and roles for managing members: one organization per workspace.
- All users follow the
  [shared access checks](../../specs/001-sign-in-and-accounts/contracts/server-functions.md#access-checks).
  The Hub's global master role grants full access to every workspace,
  including tenant data, without membership or local permission assignments.
- Local user details and history, business roles and permissions,
  teams, entities and business records stay inside each workspace.
- For now the Hub's areas live in one app. They are split, and STMS
  isolated, when the business grows.

## Rejected options

- **xpro's own workspace as the control room:** needs several workspaces
  per person from day one, and ties everyone's sign-in to one workspace's
  releases.
- **Keeping workspace business roles, permissions, teams and entities
  in the Hub:** weakens the separation between workspaces.
- **Keeping membership local with a separate Hub routing field:**
  leaves member management custom instead of reusing the Organization
  plugin, and adds another field to keep consistent.

## Impact

- **Better:**
  - fits one workspace per person
  - sign-in no longer depends on xpro's own workspace
  - sign-in and STMS actions are recorded in one place
  - follows common guidance to keep this layer separate from tenants'
    work
- **Costs:**
  - account and billing pages are built in the Hub instead of reusing
    the Portal
  - the Hub must stay highly available
  - each protected workspace request needs one combined Hub check
    through a Cloudflare Service Binding; local business permissions
    are checked inside the workspace
  - how xpro bills its customers is decided with the billing feature
