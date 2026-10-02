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
- The Hub keeps its own tamper-proof audit log.
- xpro's own workspace is an ordinary workspace for xpro's business,
  created when xpro starts using its own modules. Account holders are
  not users there.
- Workspace users, teams and entities stay inside each workspace.
- For now the Hub's areas live in one app. They are split, and STMS
  isolated, when the business grows.

## Rejected options

- **xpro's own workspace as the control room:** needs several workspaces
  per person from day one, and ties everyone's sign-in to one workspace's
  releases.
- **Keeping people and teams in the Hub for all workspaces:** weakens the
  separation between workspaces and would rewrite Core.

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
  - how xpro bills its customers is decided with the billing feature
