# Data Model: Sign-in and Accounts

## Hub database (D1)

### Better Auth's own tables

- `user`, `session`, `account` (password), `verification`, `jwks` and the OAuth provider tables.
- Add-on fields on `user`: username, display username, role, banned, ban reason.
- These tables keep Better Auth's names and are not strict tables (exception in the database
  conventions).

### Fields added to Better Auth's `user`

- phone, in one international format
- picture key, pointing to the picture in R2
- `archived_at`, and the status before archiving
- `must_change_password`, `temporary_password_expires_at`

### Own tables

- **`accounts`:** id, owner login, `created_at`.
- **`reserved_usernames`:** username, `added_at`.
- **`audit_entries`:** id, action (a stored code such as `stms_login_suspended`), who did it,
  which login, reason, comment, request ID, moment (UTC), link to the previous entry (unique).
  Triggers refuse changes and deletions.

### Login status

- active → suspended (with a reason) → active
- any status → archived → back to the status before archiving

## Workspace database (Durable Object)

- **`workspace_users`:** id, login id, kind (internal or external), `created_at`, `archived_at`.
- **`sessions`:** id, workspace user, the Hub session it came from (so a sign-out message can find
  it), `expires_at`.
- **`audit_entries`:** same layout as the Hub's.

## Rules from the spec

- Usernames: 4–8 characters, lowercase letters, numbers, dots, dashes and underscores, starting
  with a letter, unique across xpro, not reserved (FR-004).
- Emails: unique, ignoring capital letters and spaces around them (FR-002).
- Passwords: 12–64 characters with a capital letter, a number and a symbol (FR-009).
- A login belongs to at most one workspace (FR-029).
- Logins are never permanently deleted (FR-028).
