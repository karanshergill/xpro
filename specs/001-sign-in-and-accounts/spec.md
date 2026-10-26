# Feature Specification: Sign-in and Accounts

**Feature Branch**: `001-sign-in-and-accounts`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "Sign-in and accounts"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Complete first sign-in (Priority: P1)

A person uses a login created privately through trusted setup, by a master user,
by their workspace owner or by a workspace user with permission to create logins
for that workspace. They complete only missing or invalid profile details.
If their username, name and phone number are already complete and valid, they
skip profile completion.
Signing in creates no Account or workspace.

**Why this priority**: people need valid profile details before using xpro, without
having to enter details that are already complete.

**Independent Test**: sign in with privately created logins with complete and incomplete
profiles. Confirm that only missing or invalid details are requested, and reach the
destination described in Story 2.

**Acceptance Scenarios**:

1. **Given** a privately created login with complete and valid profile details,
   **When** the person signs in, **Then** they skip profile completion and continue
   to the destination described in Story 2.
2. **Given** a login with missing or invalid profile details, **When** the person signs in,
   **Then** they must complete only those details before continuing.
3. **Given** a public visitor, **When** they try to sign up, **Then** registration is unavailable
   and no login or Account is created.
4. **Given** a username that breaks the username rules, is already taken or is reserved,
   **When** the person tries to save it, **Then** it is refused with the reason shown.
5. **Given** a valid username, **When** the person saves it, **Then** they are first warned
   "Your username can't be changed later" and must confirm.

---

### User Story 2 - Sign in, reach their workspace and sign out (Priority: P1)

Anyone with a login (xpro's team, account holders, and the staff, customers and suppliers of
client workspaces) signs in on the Hub's central sign-in page with their email or username and
password. They are then sent to where they belong, and sign out when they are done.

**Why this priority**: no one can reach any part of xpro without it.

**Independent Test**: using prepared test workspaces, sign in as an internal user, as an
external user and as an account holder without a workspace, confirm each reaches their
workspace's app, its Portal or their account page, sign out, and confirm nothing can be reached
without signing in again.

**Acceptance Scenarios**:

1. **Given** a person with a workspace, **When** they sign in, **Then** they go straight into it:
   internal users to the workspace's app, external users to its Portal.
2. **Given** an account holder without a workspace, **When** they sign in, **Then** they go to
   their account page in the Hub.
3. **Given** the master user, **When** they sign in, **Then** they go to STMS in the Hub.
4. **Given** a wrong email, username or password, **When** the person tries to sign in, **Then**
   they see only "Incorrect email, username or password", which never says which part was wrong.
5. **Given** too many sign-in attempts, **When** the person tries again, **Then** they see "Too
   many attempts. Please try again shortly."
6. **Given** a suspended login, **When** the person signs in, **Then** they see "This account is
   suspended. Please contact support."
7. **Given** an archived login, **When** the person signs in, **Then** they see "This account is
   no longer active. Please contact support."
8. **Given** a signed-in person, **When** they sign out, **Then** their session on that device
   ends straight away.
9. **Given** a person whose session ended while they were working, **When** they sign in again,
   **Then** they return to the same page, with anything they had typed still there.

---

### User Story 3 - Reset a forgotten password (Priority: P2)

A person who has forgotten their password contacts xpro's team outside the system, directly or
through their workspace admin. The master user sets a new password and passes it to the person.
The person can sign in with it without having to change it.

**Why this priority**: people who forget their password are locked out until someone can help,
but it happens rarely enough that it can be handled by hand at first.

**Independent Test**: reset a person's password, confirm their existing sessions end and the
old password no longer works, then sign in with the new password without a required change.

**Acceptance Scenarios**:

1. **Given** a person's login, **When** the master user resets its password, **Then**
   the old password stops working and all of the person's sessions end.
2. **Given** an active login with a reset password, **When** the person signs in with it,
   **Then** they can continue without a required password change.
3. **Given** someone other than a master user, **When** they try to reset another
   person's password, **Then** the request is refused.

---

### User Story 4 - Manage own profile (Priority: P2)

Anyone with a login can view and change their own name, phone number and profile picture, and
change their password. Their email and username are shown, but only the master user can change
them.

**Why this priority**: required profile details are complete before using xpro.
Changing the name, phone or picture later is useful but not needed to start.

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

---

### User Story 5 - xpro's team manages logins (Priority: P2)

In STMS, in the Hub, the master user sees every login, finds a person, and can suspend,
reactivate, archive or restore their login, reset its password, or change its email or username.

**Why this priority**: xpro must be able to stop misuse and help people who are locked out, but
this is rarely needed in the first days.

**Independent Test**: find a login, suspend it and confirm the person can't sign in, reactivate
it, archive and restore it, and confirm someone other than the master user can't open these pages.

**Acceptance Scenarios**:

1. **Given** the master user in STMS, **When** they open the list, **Then** they see every active
   and suspended login with its username, name, email, phone, date created and status.
2. **Given** a login in the list, **When** the master user opens it, **Then** they see which
   workspace the person belongs to, if any.
3. **Given** the list, **When** the master user searches by name, email or username, **Then** only
   matching logins are shown.
4. **Given** a login, **When** the master user suspends it, **Then** they must pick a reason
   (Unpaid, Abuse or misuse, Security concern, At the person's request, Other with a required
   comment), may add a comment, and confirm; all the person's sessions end.
5. **Given** a suspended login, **When** the master user reactivates it, **Then** the person can
   sign in again with their existing password.
6. **Given** a login, **When** the master user resets its password, **Then** it works as described
   in Story 3.
7. **Given** a login, **When** the master user changes its email or username, **Then** the new
   value must follow the rules for that field. A comment is optional. The old username stays
   taken so no one else can use it, and all the person's sessions end.
8. **Given** a login, **When** the master user archives it, **Then** they confirm and may add a
   comment; the login is hidden from the normal list, the person can't sign in, and all their
   sessions end.
9. **Given** an archived login, **When** the master user restores it, **Then** it returns to its
   previous status.
10. **Given** anyone other than the master user, **When** they try to open these pages, **Then**
    they are refused.

---

### User Story 6 - Create a login for someone else (Priority: P1)

A master user creates a non-master login for someone else. Workspace owners and
workspace users with permission to create logins can do this for their own workspace.
They enter the person's email, username, name and phone and set a password.
For a workspace user, the login is added to that workspace as internal or external.
This creates no Account or workspace.
If a save fails, the creator can retry the same creation request to finish missing
steps. The new login cannot use xpro until creation is complete.

**Why this priority**: with public sign-up disabled, people need a private way to join.

**Independent Test**: create a login for a prepared workspace and confirm the person
can sign in and enter the workspace without changing their password or entering
their profile again. Fail a save partway through creation, confirm access is blocked,
then retry the same request and confirm one complete login is created.

**Acceptance Scenarios**:

1. **Given** a master user, **When** they create a login with valid details,
   **Then** an active non-master login is created in the Hub.
2. **Given** a workspace owner or workspace user with creation permission,
   **When** they create a login for their own workspace, **Then** the non-master login
   is created and added to that workspace as the chosen internal or external user.
3. **Given** a new login with complete and valid profile details, **When** the person
   signs in, **Then** they skip profile completion and continue as described in Story 2
   without a required password change.
4. **Given** a non-master without creation permission for the requested workspace,
   **When** they try to create a login, **Then** the request is refused and nothing changes.
5. **Given** a workspace owner or permitted workspace user, **When** they try to create
   a master user, **Then** the request is refused and no master access is granted.
6. **Given** a taken email or a taken or reserved username, **When** someone tries to
   create a separate login using it, **Then** creation is refused without changing
   existing logins or memberships.
7. **Given** a creation request whose later save fails, **When** the new login tries
   to use xpro, **Then** access is blocked and creation is not reported as successful.
8. **Given** an incomplete creation request, **When** its creator retries with the same
   reference and details and still has permission, **Then** only missing steps are
   completed, with one login, any required membership and workspace user record,
   and one creation audit entry identifying the original creator.
9. **Given** a completed creation request whose success response was lost, **When**
   the creator retries it, **Then** the original result is returned without changing
   the saved password or creating duplicate records.
10. **Given** an incomplete creation request, **When** a retry uses a different creator,
    workspace or set of creation details, or its creator no longer has permission,
    **Then** the retry is refused without changing existing records.

---

### Edge Cases

- **Two devices:** a person signed in on two devices stays signed in on both; signing out on one
  doesn't end the other.
- **Email typed differently:** capital letters and spaces around an email are ignored, so the same
  email can't create two logins.
- **Same username at once:** if two people pick the same free username at the same moment, only
  one gets it; the other is told it is taken.
- **Unfinished first sign-in:** a person who leaves with missing or invalid profile details
  is asked to complete only those details at their next sign-in.
- **Suspended while signed in:** the person is signed out straight away.
- **Archived while signed in:** the person is signed out straight away.
- **Password rules:** a new password that breaks the rules is refused with a message listing each
  missing rule.
- **Failed picture upload:** the previous picture stays.
- **Master user protects themselves:** the master user can't suspend or archive their own login.
- **Access changes while inside a workspace:** use current permissions on the next action.
  If workspace access is no longer allowed, refuse that action and redirect as in Story 2.
- **Workspace address:** open the requested workspace if the person's permissions allow
  access. If access is refused or the workspace does not exist, redirect them to their
  destination in Story 2.
- **No workspace:** after signing in, use the person's default destination in Story 2.
  If none applies, show "You don't belong to any workspace yet. Please contact your admin."

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Public sign-up MUST be disabled for now. There is no public sign-up page,
  and direct sign-up requests are refused. Logins MUST be created only through
  trusted setup, by a master user, by a workspace owner or by a workspace user
  with permission to create logins. Workspace owners and users with this permission
  MAY create non-master logins only for their own workspace and MUST add them to
  that workspace. Public sign-up returns only after its onboarding flows are
  separately planned and approved.
- **FR-002**: Each email MUST belong to only one login, ignoring capital letters and spaces around
  it.
- **FR-003**: A login MUST have a valid username, name and phone number before using xpro.
  Skip profile completion when these details are already complete and valid.
  Otherwise, require only the missing or invalid details before continuing.
- **FR-004**: Usernames MUST be 4 to 8 characters, use only lowercase letters, numbers, dots,
  dashes and underscores, start with a letter, be unique across all of xpro, and not be on the
  reserved list.
- **FR-005**: People MUST NOT be able to change their own username or email. Only the master
  user can change them; the new one follows the same rules, a comment is optional, the old
  username stays taken, and all the person's sessions end.
- **FR-006**: Name and phone number MUST be editable and never empty. The phone number is entered
  by picking a country and typing the number, and is stored in one international format.
- **FR-007**: A profile picture MUST be optional, a JPG, PNG or WebP of up to 2 MB, cropped to a
  square and shown as a circle, with initials shown when there is none. Location and camera
  details are removed from uploaded pictures.
- **FR-008**: A person's login, contact and personal details MUST be stored once, in the Hub.
- **FR-009**: Passwords MUST be 12 to 64 characters, with at least one capital letter, one number
  and one symbol.
- **FR-010**: Passwords MUST never be stored or shown in a readable form.
- **FR-011**: People MUST be able to sign in with their email or username, and a failed sign-in
  MUST show one message that never says which part was wrong.
- **FR-012**: Sign-in MUST be protected against automated bots. If public sign-up is
  approved later, it MUST have the same protection before it is enabled.
- **FR-013**: Sign-in attempts MUST have basic rate limiting for the same email or username,
  targeting 10 attempts per minute. This is approximate protection per serving location,
  not an exact global count. Refused attempts show "Too many attempts. Please try again shortly."
- **FR-014**: Separate internet-address limits and the 100-failed-attempts-per-day counter are
  deferred. Revisit if observed abuse bypasses the initial protections or a customer security
  requirement calls for stronger limits.
- **FR-015**: A session MUST last at most 30 days, and MUST end on sign-out,
  password reset, suspension or archiving. Password changes follow FR-016.
- **FR-016**: Changing a password MUST need the current password, and MUST end the person's
  sessions on other devices.
- **FR-017**: Sign-in forms MUST allow pasting, password managers and browser autofill.
- **FR-018**: Passwords and session details MUST never appear in a web
  address. The only exception is the one-time code that sends a person from the Hub to their
  workspace: it works once, expires within minutes, and is useless without the workspace's own
  secret.
- **FR-019**: After signing in, a person MUST be sent to where they belong, as set out in
  Story 2.
- **FR-020**: When a session ends while a person is working, signing in again MUST return them to
  the same page with what they had typed.
- **FR-021**: One initial master user MUST be created when xpro is first set up.
  Additional master users may be added later, only by an existing master user.
- **FR-022**: Only the master user MUST be able to see the list of logins in STMS, in the Hub,
  and act on them.
- **FR-023**: The master user MUST be able to suspend a login, with a reason from the fixed list
  and an optional comment (required for Other), and to reactivate it.
- **FR-024**: Only a master user MAY reset a login's password. A reset MUST end
  all of that person's sessions. Passwords set during login creation or a reset
  do not expire and do not require a change at the next sign-in.
- **FR-025**: Workspace admins MUST NOT be able to reset anyone's password.
- **FR-026**: The master user MUST be able to archive a login, after confirming and with an
  optional comment. An archived login can't sign in ("This account is no longer active. Please
  contact support."), its sessions end, it is hidden from the normal list, its data is kept, and
  its email and username stay taken. It can be restored.
- **FR-027**: Login creation, sign-ins, failed sign-ins, suspensions, reactivations,
  password resets, email and username changes, archiving and restoring MUST be
  recorded in the Hub's audit log, seen only by xpro's team.
- **FR-028**: Logins MUST never be permanently deleted.
- **FR-029**: A login MUST belong to at most one workspace for now. The Hub MUST keep the
  official membership list; a local workspace user record alone MUST NOT grant access.
- **FR-030**: Login creation in Story 6 MUST be safe to retry using the same saved
  reference, tied to its creator, intended workspace and non-secret creation details.
  Check current permissions on each retry and complete only missing steps. Incomplete
  logins MUST NOT use xpro, and creation MUST NOT be reported as successful until the
  login, password record and creation audit entry are saved, along with any required
  membership and workspace user record. Retries MUST NOT change unrelated existing
  logins, reset a saved password or create duplicate records.

### Key Entities

- **Account**: the person or business that owns a workspace, linked to the account
  holder's login. An account can exist before its workspace is created.
- **Login**: a person's email, username and password, kept in the Hub. Has a status: active,
  suspended or archived. Creation must be complete before the login can use xpro.
- **Login creation request**: the Hub's saved reference for one creation, including its
  creator, intended workspace, non-secret creation details and completion state.
- **Profile**: a person's name, phone number and optional picture, kept with their login.
- **Session**: one signed-in device for one login. Ends on sign-out, after 30 days, or when the
  login changes as described in FR-015.
- **Membership**: the Hub's record that a login belongs to a workspace and whether they may
  manage its members.
- **Workspace user**: a person's local workspace details, including whether they are internal
  or external. That type decides whether they enter the app or Portal. Business permissions
  and history stay inside the workspace.
- **Reserved usernames**: the list of usernames nobody can take.
- **Audit entry**: a record of a sign-in or login-management action, including any
  reason and comment, kept in the Hub's audit log.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person with a privately created login can continue to the destination
  described in Story 2 after completing only missing or invalid profile details.
  Complete and valid details are not requested again.
- **SC-002**: After pressing sign in with correct details, a person sees where they belong within
  3 seconds on a normal connection.
- **SC-003**: Every case in Story 2 and the edge cases sends the person to the right place, with
  no exceptions.
- **SC-004**: No password or session detail ever appears in a web address,
  log or audit entry, apart from the one-time code allowed by FR-018, which never appears in logs
  or audit entries.
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
- Workspace owners or workspace users with permission to create logins may create
  non-master logins only for their own workspace.
  Managing other people's existing global logins remains restricted to master users.
- Suspending a whole account and its workspaces comes with the workspaces feature.
- xpro's team keeps the reserved-username list, which can grow.
- xpro's domain is chosen before the first real client.
- Each login belongs to at most one workspace; belonging to several comes in a later feature.
- The Hub's areas share one app for now; they are split when the business grows.
