# Server Functions: Sign-in and Accounts

Each function checks its input, applies its business rules, saves together with its audit entry,
and returns named results for expected outcomes (such as `username_taken`). API tests call each
one directly.

## Hub: provided by Better Auth

- Sign up, sign in with email or username, sign out.
- Get the current session; change password.
- Sign-in protocol pages for workspaces: authorize, token, user info, sign-out messages.

## Hub: own

| Function | Story | Who |
|---|---|---|
| `completeFirstSignIn` (username, name, phone) | 1 | the person |
| `checkUsername` (rules, taken, reserved) | 1 | the person |
| `updateProfile` (name, phone) | 4 | the person |
| `uploadPicture` / `removePicture` | 4 | the person |
| `replaceTemporaryPassword` | 3 | the person |
| `listLogins` / `searchLogins` / `getLogin` | 5 | master user |
| `suspendLogin` / `reactivateLogin` | 5 | master user |
| `archiveLogin` / `restoreLogin` | 5 | master user |
| `resetPassword` | 3, 5 | master user |
| `changeEmail` / `changeUsername` | 5 | master user |

## Workspace app: own

- `startSignIn`: sends the person to the Hub.
- `finishSignIn`: swaps the code, checks the person is a workspace user, starts the session.
- `signOut`.
- `receiveHubSignOut`: the sign-out message from the Hub; ends matching sessions.
- `getCurrentUser`.

## Router

- Sends an address to its workspace app, or redirects as set out in the spec's edge cases.
