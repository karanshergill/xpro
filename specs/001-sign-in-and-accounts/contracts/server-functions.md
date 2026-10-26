# Server Functions: Sign-in and Accounts

Each function checks its input, applies its business rules, and returns named results for
expected outcomes (such as `username_taken`). API tests call each one directly.

Other STMS changes are saved together with their audit entries. Successful sign-ins and
login creation follow the [documented exceptions in the plan](../plan.md#constitution-check).

## Access checks

- **Hub requests:** check the current session and login records in the Hub.
- **Creation complete:** refuse protected access for a Story 6 login whose creation
  request is unfinished, even if its session, profile and membership are valid.
- **Workspace requests:** use one combined Hub call through a Cloudflare Service Binding
  to check the current session, active login, creation completion, global role and
  any required membership of the requested workspace.
  Check profile completion in the same call.
- **Shared permission check:** all users go through the same server-side permission
  check before a protected workspace action. Reuse one implementation across
  workspaces; check local permissions alongside the action without another
  network request.
- **Permissions:** the master role grants full access across xpro without workspace
  membership or local permission assignments. Other users need membership and
  the required local permissions.
- **Normal action rules:** input checks, business rules, save rules and audit
  requirements apply to all users. Audited actions record the acting user's own login.
- **Native HTTP routes:** Better Auth routes must enforce the same xpro rules.
  Disable unused or duplicate write routes that could bypass those rules.
  Keep trusted server-side API calls available. Test that direct requests cannot
  bypass validation, session revocation or auditing.
- **Reuse within a request:** functions handling the same request share the Hub result.
  Do not reuse it across different requests.
- **Failed check:** refuse access if a required check fails or cannot be completed.
- **Sign-out messages:** use them to clear local sessions promptly, not as a substitute
  for the checks above.
- **Availability:** assume the Hub is always available; do not build an offline mode.
- **Tests:** an ended Hub session blocks the next action, even without a sign-out message.
  Changes to roles, membership and permissions take effect on the next action.
  Master users can view and change tenant data without membership or local permissions.
  Multiple functions handling one request cause only one Hub validation.

## Required steps before using xpro

- **First sign-in:** skip profile completion if the username, name and phone are
  complete and valid. Otherwise, require only the missing or invalid details.
- **No skipping:** the server enforces this rule even if someone skips the form.
- **While unfinished:** allow only profile completion, session checks and sign-out.
- **Tests:** prove that complete profiles skip the form, incomplete profiles require
  only missing or invalid details, and skipping the form does not bypass this rule.

## Hub: provided by Better Auth

- Sign in with email or username, sign out.
- Provide server-side APIs to create logins and add workspace members.
  xpro checks the creation permissions in FR-001 before calling them.
  Public sign-up is disabled.
- Get the current session; change password.
- Sign-in protocol pages for workspaces: authorize, token, user info, sign-out messages.

## Hub: own

| Function | Story | Who |
|---|---|---|
| `createLogin` | 6 | master user; workspace owner or workspace user with creation permission for their own workspace |
| `completeFirstSignIn` (username, name, phone) | 1 | the person |
| `checkUsername` (rules, taken, reserved) | 1, 6 | the person; users permitted to create logins |
| `updateProfile` (name, phone) | 4 | the person |
| `uploadPicture` / `removePicture` | 4 | the person |
| `listLogins` / `searchLogins` / `getLogin` | 5 | master user |
| `suspendLogin` / `reactivateLogin` | 5 | master user |
| `archiveLogin` / `restoreLogin` | 5 | master user |
| `resetPassword` | 3, 5 | master user |
| `changeEmail` / `changeUsername` | 5 | master user |

### `createLogin`

- **Reference:** use one saved login creation request for the original attempt and
  every retry, following [Login creation retries](../plan.md#login-creation-retries).
  The reference is not proof of permission; check current permissions each time.
- **Scope:** bind the reference to the creator, intended workspace and non-secret
  creation details. Refuse reuse with different details or an unrelated existing
  login, even if its email or username matches.
- **Incomplete:** if a later save fails, keep the reference available for a retry,
  report that setup is incomplete and keep the new login's access blocked.
- **Repeat:** finish only missing steps. A completed request returns its original
  result without resetting a password or adding duplicate records or audit entries.
- **Success:** return success only after all required records are confirmed and
  the Hub saves the creation audit entry and completion marker in one batch.
- **Tests:** cover failed saves, interruptions and concurrent retries; a lost success
  response; changed permission or request details; and unrelated duplicate emails
  or usernames. No retry may bypass access checks or take over an existing login.

## Workspace app: own

- `startSignIn`: sends the person to the Hub.
- `finishSignIn`: swaps the code, applies the shared access checks for this workspace,
  reads local user details where applicable, and starts the workspace session.
- `signOut`.
- `receiveHubSignOut`: the sign-out message from the Hub; ends matching sessions.
- `getCurrentUser`.

## Router

- Sends an address to its workspace app, or redirects as set out in the spec's edge cases.
