# Feature Specification: Sign-in and Accounts

**Feature Branch**: `001-sign-in-and-accounts`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "Sign-in and accounts"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign up for an account (Priority: P1)

A person visits xpro's address and creates an account with an email and a password. This makes
them an account holder: an external user of xpro's own workspace. On their first sign-in, they
must choose a username and enter their name and phone number before they can use the Portal.

**Why this priority**: nothing else in xpro can happen without an account.

**Independent Test**: sign up with a new email, enter a username, name and phone number, and
reach the Portal.

**Acceptance Scenarios**:

1. **Given** a new email, **When** the person signs up with a valid password, **Then** the
   account is created and the person is signed in.
2. **Given** a new account, **When** the person signs in for the first time, **Then** they must
   enter a username, name and phone number, and can't use the Portal until all three are saved.
3. **Given** an email that already has an account, **When** someone signs up with it, **Then**
   sign-up is refused with the message "An account with this email already exists. Sign in
   instead?" and a link to sign in, and no account is created.
4. **Given** a username that breaks the username rules, is already taken or is reserved,
   **When** the person tries to save it, **Then** it is refused with the reason shown.
5. **Given** a valid username, **When** the person saves it, **Then** they are first warned
   "Your username can't be changed later" and must confirm.

---

### User Story 2 - Sign in, reach the right place and sign out (Priority: P1)

Anyone with a login (xpro's team, account holders, and the staff, customers and suppliers of
client workspaces) signs in on xpro's one central sign-in page with their email or username and
password. They are then sent to the right workspace, can switch between their workspaces, and
sign out when they are done.

**Why this priority**: no one can reach any part of xpro without it.

**Independent Test**: using prepared test workspaces, sign in as a person with one workspace and
as a person with several, confirm each reaches the right place, switch workspaces, sign out, and
confirm nothing can be reached without signing in again.

**Acceptance Scenarios**:

1. **Given** a person who belongs to only one workspace, **When** they sign in, **Then** they go
   straight into it: internal users to the workspace's app, external users to its Portal.
2. **Given** a person who belongs to several workspaces, **When** they sign in, **Then** they see
   a list of their workspaces and pick one.
3. **Given** a person who came from a workspace's own address, **When** they sign in, **Then**
   they are sent straight back to that workspace.
4. **Given** a signed-in person, **When** they switch to another of their workspaces, **Then**
   they go there without signing in again.
5. **Given** a wrong email, username or password, **When** the person tries to sign in, **Then**
   they see only "Incorrect email, username or password", which never says which part was wrong.
6. **Given** too many failed attempts, **When** the person tries again, **Then** they see "Too
   many attempts. Please try again in a minute."
7. **Given** a suspended login, **When** the person signs in, **Then** they see "This account is
   suspended. Please contact support."
8. **Given** an archived login, **When** the person signs in, **Then** they see "This account is
   no longer active. Please contact support."
9. **Given** a signed-in person, **When** they sign out, **Then** their session on that device
   ends straight away.
10. **Given** a person whose session ended while they were working, **When** they sign in again,
    **Then** they return to the same page, with anything they had typed still there.

---

### User Story 3 - Reset a forgotten password (Priority: P2)

A person who has forgotten their password contacts xpro's team outside the system, directly or
through their workspace admin. The master user resets the password and passes on a temporary
password. The person must choose a new password at their next sign-in.

**Why this priority**: people who forget their password are locked out until someone can help,
but it happens rarely enough that it can be handled by hand at first.

**Independent Test**: reset a person's password, sign in with the temporary password, set a new
one, and confirm the old password no longer works.

**Acceptance Scenarios**:

1. **Given** a person's login, **When** the master user resets its password, **Then** a temporary
   password is shown once, only to the master user.
2. **Given** a temporary password, **When** the person signs in with it, **Then** they must choose
   a new password before they can go anywhere else.
3. **Given** a reset, **When** it is done, **Then** all of the person's sessions end and the old
   password stops working.
4. **Given** a temporary password not used within 24 hours, **When** someone tries it, **Then** it
   no longer works.
5. **Given** a client workspace's admin, **When** they manage their users, **Then** they can't
   reset anyone's password, because one login opens all of a person's workspaces.

---

### User Story 4 - Manage own profile (Priority: P2)

Anyone with a login can view and change their own name, phone number and profile picture, and
change their password. Their email and username are shown but can't be changed. Their profile is
shared by all their workspaces.

**Why this priority**: name, phone and username are already entered on first sign-in, so editing
them later is useful but not needed to start using xpro.

**Independent Test**: change the name, phone number and picture, change the password, and confirm
the changes are saved and the old password no longer works.

**Acceptance Scenarios**:

1. **Given** a signed-in person, **When** they change their name or phone number, **Then** the
   change is saved; neither can be left empty.
2. **Given** a JPG, PNG or WebP picture of up to 2 MB, **When** the person uploads it, **Then**
   they crop it to a square and it is shown as a circle.
3. **Given** a picture that is too big or of another type, **When** the person uploads it,
   **Then** it is refused with the reason shown.
4. **Given** a person with no picture, or who removes theirs, **When** their profile is shown,
   **Then** their initials appear instead.
5. **Given** a person changing their password, **When** they enter their current password and a
   valid new one, **Then** the password changes and their sessions on other devices end.
6. **Given** a person viewing their profile, **When** they look at their email and username,
   **Then** both are shown but can't be changed.
7. **Given** a person who belongs to several workspaces, **When** they change their profile,
   **Then** the change shows in all of them.

---

### User Story 5 - xpro's team manages logins (Priority: P2)

In STMS, the master user sees every login, finds a person, and can suspend, reactivate, archive
or restore their login, or reset its password.

**Why this priority**: xpro must be able to stop misuse and help people who are locked out, but
this is rarely needed in the first days.

**Independent Test**: find a login, suspend it and confirm the person can't sign in, reactivate
it, archive and restore it, and confirm someone other than the master user can't open these pages.

**Acceptance Scenarios**:

1. **Given** the master user in STMS, **When** they open the list, **Then** they see every active
   and suspended login with its username, name, email, phone, date created and status.
2. **Given** a login in the list, **When** the master user opens it, **Then** they see which
   workspaces the person belongs to.
3. **Given** the list, **When** the master user searches by name, email or username, **Then** only
   matching logins are shown.
4. **Given** a login, **When** the master user suspends it, **Then** they must pick a reason
   (Unpaid, Abuse or misuse, Security concern, At the person's request, Other with a required
   comment), may add a comment, and confirm; all the person's sessions end.
5. **Given** a suspended login, **When** the master user reactivates it, **Then** the person can
   sign in again with their existing password.
6. **Given** a login, **When** the master user resets its password, **Then** it works as described
   in Story 3.
7. **Given** a login, **When** the master user archives it, **Then** they confirm and may add a
   comment; the login is hidden from the normal list, the person can't sign in, and all their
   sessions end.
8. **Given** an archived login, **When** the master user restores it, **Then** it returns to its
   previous status.
9. **Given** anyone other than the master user, **When** they try to open these pages, **Then**
   they are refused.

---

### Edge Cases

- **Two devices:** a person signed in on two devices stays signed in on both; signing out on one
  doesn't end the other.
- **Email typed differently:** capital letters and spaces around an email are ignored, so the same
  email can't create two logins.
- **Same username at once:** if two people pick the same free username at the same moment, only
  one gets it; the other is told it is taken.
- **Unfinished first sign-in:** a person who leaves before saving their username, name and phone
  is asked for them again at their next sign-in.
- **Suspended while signed in:** the person is signed out straight away.
- **Archived while signed in:** the person is signed out straight away.
- **Temporary password not replaced:** a person who signs in with it but doesn't set a new
  password is asked again each time, until it expires.
- **Password rules:** a new password that breaks the rules is refused with a message listing each
  missing rule.
- **Failed picture upload:** the previous picture stays.
- **Master user protects themselves:** the master user can't suspend or archive their own login.
- **Removed from a workspace while inside it:** the person loses access straight away and is sent
  to their list of workspaces.
- **Workspace address they don't belong to:** after signing in, the person sees "You don't have
  access to that workspace" and their list of workspaces.
- **No workspaces left:** a person whose login is active but who belongs to no workspace sees "You
  don't belong to any workspace yet. Please contact your admin." after signing in.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A person MUST be able to create an account, with its login, using an email and a
  password at xpro's address.
- **FR-002**: Each email MUST belong to only one login, ignoring capital letters and spaces around
  it.
- **FR-003**: At the first sign-in, a username, name and phone number MUST be entered before the
  person can go anywhere else.
- **FR-004**: Usernames MUST be 4 to 8 characters, use only lowercase letters, numbers, dots,
  dashes and underscores, start with a letter, be unique across all of xpro, and not be on the
  reserved list.
- **FR-005**: A username and an email MUST never change.
- **FR-006**: Name and phone number MUST be editable and never empty. The phone number is entered
  by picking a country and typing the number, and is stored in one international format.
- **FR-007**: A profile picture MUST be optional, a JPG, PNG or WebP of up to 2 MB, cropped to a
  square and shown as a circle, with initials shown when there is none. Location and camera
  details are removed from uploaded pictures.
- **FR-008**: A person's login, contact and personal details MUST be stored once, in one shared
  place, and used by all their workspaces.
- **FR-009**: Passwords MUST be 12 to 64 characters, with at least one capital letter, one number
  and one symbol.
- **FR-010**: Passwords MUST never be stored or shown in a readable form.
- **FR-011**: People MUST be able to sign in with their email or username, and a failed sign-in
  MUST show one message that never says which part was wrong.
- **FR-012**: Sign-up and sign-in MUST be protected against automated bots.
- **FR-013**: Sign-in attempts MUST be limited to 10 per minute for the same email or username.
  Further attempts within that minute are refused with "Too many attempts. Please try again in a
  minute."
- **FR-014**: Failed sign-ins from the same internet address MUST also be limited to 100 a day,
  whichever emails or usernames are tried.
- **FR-015**: A session MUST last at most 30 days, and MUST end on sign-out, password change,
  password reset, suspension or archiving.
- **FR-016**: Changing a password MUST need the current password, and MUST end the person's
  sessions on other devices.
- **FR-017**: Sign-in forms MUST allow pasting, password managers and browser autofill.
- **FR-018**: Passwords, temporary passwords and session details MUST never appear in a web
  address.
- **FR-019**: After signing in, a person MUST be sent to their workspace as set out in Story 2,
  and MUST be able to switch between their workspaces without signing in again.
- **FR-020**: When a session ends while a person is working, signing in again MUST return them to
  the same page with what they had typed.
- **FR-021**: Exactly one master user MUST be created when xpro is set up, as the first admin of
  xpro's own workspace.
- **FR-022**: Only the master user MUST be able to see the list of logins in STMS and act on them.
- **FR-023**: The master user MUST be able to suspend a login, with a reason from the fixed list
  and an optional comment (required for Other), and to reactivate it.
- **FR-024**: A password reset MUST create a temporary password, shown once to the master user,
  that expires after 24 hours unused, must be replaced at the next sign-in, and ends all the
  person's sessions.
- **FR-025**: Workspace admins MUST NOT be able to reset anyone's password.
- **FR-026**: The master user MUST be able to archive a login, after confirming and with an
  optional comment. An archived login can't sign in ("This account is no longer active. Please
  contact support."), its sessions end, it is hidden from the normal list, its data is kept, and
  its email and username stay taken. It can be restored.
- **FR-027**: Sign-ins, failed sign-ins, suspensions, reactivations, password resets, archiving
  and restoring MUST be recorded in the audit log of xpro's own workspace, seen only by xpro's
  team.
- **FR-028**: Logins MUST never be permanently deleted.

### Key Entities

- **Account**: the tenant created at sign-up. Linked to the login of the person who signed up
  (the account holder).
- **Login**: a person's email, username and password, shared by all their workspaces. Has a
  status: active, suspended or archived.
- **Profile**: a person's name, phone number and optional picture, kept with their login and shown
  in all their workspaces.
- **Temporary password**: created by a reset, shown once, valid for 24 hours, and replaced at the
  next sign-in.
- **Session**: one signed-in device for one login. Ends on sign-out, after 30 days, or when the
  login changes as described in FR-015.
- **Workspace user**: links a login to one workspace, as an internal or external user. It decides
  where the person lands after signing in and which workspaces are in their list.
- **Reserved usernames**: the list of usernames nobody can take.
- **Audit entry**: a record of a sign-in or an action by xpro's team, including any suspension
  reason and comment, kept in xpro workspace's audit log.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new person can sign up and finish their first sign-in in under 3 minutes.
- **SC-002**: After pressing sign in with correct details, a person sees their workspace or
  workspace list within 3 seconds on a normal connection.
- **SC-003**: Every case in Story 2 and the edge cases sends the person to the right place, with
  no exceptions.
- **SC-004**: No password, temporary password or session detail ever appears in a web address,
  log or audit entry.
- **SC-005**: The master user can find any login and suspend it in under 1 minute.
- **SC-006**: A suspended or archived person loses access at their next action, wherever they are
  signed in.
- **SC-007**: Every screen in this feature can be used with the keyboard alone and passes the
  automatic accessibility check.

## Assumptions

- The master user signs in with a password only for now; two-step sign-in comes in a later
  feature.
- Emails are not confirmed, and there is no password reset by email yet; both come with a later
  email feature. Until then, xpro's team resets passwords by hand.
- Creating workspaces comes in a later feature. Until then, the workspace cases are tested with
  prepared test workspaces.
- Roles beyond the master user come later; until then, only the master user manages logins.
- Suspending a whole account and its workspaces comes with the workspaces feature.
- xpro's team keeps the reserved-username list, which can grow.
- xpro's domain is chosen before the first real client.
