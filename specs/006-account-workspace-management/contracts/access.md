# Access Contract

- **Feature:** [STMS account and workspace management](../spec.md).

## Protocol

- Require `protocolVersion: 2` on Hub access requests and responses.
- Preserve the existing login, session, profile and MFA facts.
- Add workspace facts: `null` for Hub-only requests; otherwise the requested workspace ID and `missing`, `not_ready` or `ready`.
- A `ready` result includes the live account and workspace statuses.
- Reject missing versions, mismatched workspace IDs and incomplete facts. Do not infer active from omitted fields.

## Authorization

- Preserve existing login/MFA/profile checks and local permissions.
- Refuse unknown workspaces and unauthorized non-members without exposing tenant details.
- Refuse incomplete workspaces to everyone, including masters.
- For completed workspaces, ordinary members require both statuses active. Masters retain the approved suspension exception.
- Personal profile, session inspection and sign-out remain identity operations, not workspace business access.
- OAuth tokens identify the login; they do not cache tenant authorization.

## Denial behavior

| Condition | Safe code |
|---|---|
| Known workspace is incomplete | `core_workspace_not_ready` |
| Account is suspended | `core_account_suspended` |
| Workspace is suspended | `core_workspace_suspended` |

- JSON actions return the appropriate code without replaying writes.
- Page navigation uses a fixed Hub `/workspace-unavailable` page, not `/auth/destination`.
- That page rechecks access and offers an explicit return only when the workspace is accessible. It accepts no arbitrary return URL.
- Tenant restrictions alone do not clear session cookies or trigger sign-in.
- Mounted forms preserve unsaved values and show the restriction instead of entering a redirect or re-authentication loop.

## Cutover

- Update the shared parser, Hub producers, direct Hub callers, workspace consumers and their contract tests together.
- Compatible consumers must be deployed before enabling management controls. Mixed versions fail closed.
- Guarded deployment must reject pre-feature rollback artifacts after the new controls are in use.
