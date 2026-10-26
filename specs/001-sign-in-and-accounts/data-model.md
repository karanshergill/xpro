# Data Model: Sign-in and Accounts

## Hub database (D1)

### Better Auth's own tables

- `user`, `session`, `account` (password), `verification`, `jwks` and the OAuth provider tables.
- `organization`, `member`, `invitation` from the Organization plugin.
- Each organization represents one workspace. A member links a login to that workspace;
  its role controls member management, not permissions inside business modules.
- The plugin's session fields include `activeOrganizationId`: the selected workspace,
  not proof of current membership.
- Invitations are unused initially. Optional plugin teams and dynamic roles stay off.
- Add-on fields on `user`: username, display username, role, banned, ban reason.
- These tables keep Better Auth's names and are not strict tables (exception in the database
  conventions).

### Fields added to Better Auth's `user`

- phone, in one international format
- picture key, pointing to the picture in R2
- `archived_at`, and the status before archiving
- `login_creation_id`, a server-set link to the login creation request for Story 6.
  It is written with the initial login record and cannot be supplied or changed
  through public or native HTTP routes.

### Own tables

- **`accounts`:** id, owner login, `created_at`.
- **`reserved_usernames`:** username, `added_at`.
- **`login_creations`:** id (the stable creation reference), creator login, intended
  workspace if any, created login when known, chosen internal/external type where
  applicable, non-secret creation details, `created_at`, `completed_at`.
  Save it before the first login write. A request identifies at most one new login;
  the login's `login_creation_id` is unique. Never store a readable password here.
- **`audit_entries`:** id, action (a stored code such as `stms_login_suspended`), outcome,
  actor and affected login IDs (when known), reason, comment, request ID, moment (UTC).
  Triggers refuse changes and deletions.

### Login status

- active → suspended (with a reason) → active
- any status → archived → back to the status before archiving

### Creation completion

- Story 6 logins remain unavailable while their creation request's `completed_at`
  is empty, even when their login status is active and their profile is complete.
- Save the successful creation audit entry and `completed_at` in one Hub batch,
  only after confirming the password record and any required membership and
  workspace user record. The audit entry records the request's original creator.
- Retrying uses the saved reference and linked login, finishes only missing steps,
  and preserves existing passwords and records. A completed retry returns the
  original result. Matching an email or username alone is never enough to resume.
- Creation records and their links stay in the existing Hub database. They do not
  move internal/external type or business permissions out of the workspace; the
  chosen type in a creation request is only input for finishing that request.

## Workspace database (Durable Object)

- **`workspace_users`:** id, login id, kind (internal or external), `created_at`, `archived_at`.
  Keeps local user details and business history. This record alone does not grant access;
  access is decided by the [shared access checks](./contracts/server-functions.md#access-checks).
- **`sessions`:** id, Hub login id, the Hub session it came from (so a sign-out message can find
  it), `expires_at`.
  A session identifies the Hub login; a local workspace-user record is not required.
- **`audit_entries`:** same layout as the Hub's.

## Rules from the spec

- Usernames: 4–8 characters, lowercase letters, numbers, dots, dashes and underscores, starting
  with a letter, unique across xpro, not reserved (FR-004).
- Emails: unique, ignoring capital letters and spaces around them (FR-002).
- Passwords: 12–64 characters with a capital letter, a number and a symbol (FR-009).
- A login belongs to at most one workspace (FR-029).
- Login creation is safe to retry, with access blocked until completion (FR-030).
- Logins are never permanently deleted (FR-028).
