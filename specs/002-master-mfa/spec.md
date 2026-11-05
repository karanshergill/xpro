# Feature Specification: Master multi-factor authentication

- **Feature:** `002-master-mfa`.
- **Created:** 2026-10-30.
- **Planning stage:** scope, recovery policy and acceptance scenarios. Technical
  design and implementation tasks require their own review before coding.

## Scope and intended behavior

The terms below follow the [shared glossary](../../docs/GLOSSARY.md).

- **Master users:** all global xpro master logins, including the first master and
  any added later. A tenant's Account holder or workspace owner/admin is not a
  master user unless separately granted that global role.
- **Required sign-in:** a master enters their email or username and password,
  then a code from their authenticator app before using STMS or workspace data.
  A master without an authenticator must finish enrollment before gaining access.
- **Backup sign-in:** a saved, single-use backup code may replace the authenticator
  code at sign-in. It does not replace a lost authenticator. Authenticator
  replacement and loss of all factors must be defined in the recovery section
  before implementation is approved.
- **Session checks:** an existing password-only master session cannot gain access
  merely because the login now has MFA enabled. It must complete enrollment or
  start a fresh sign-in that includes the second factor, as applicable.
- **Remembered devices:** each fresh master sign-in requires the second factor.
  A session that already passed MFA continues under the normal session rules;
  users do not enter another code for every page or action.
- **Other logins:** Account holders, workspace owners/admins and other users keep
  the existing sign-in behavior when they do not hold the global master role.
  Public sign-up remains unavailable.
- **Release approval:** approving this scope does not approve implementation or
  deployment. The [existing release hold](../001-sign-in-and-accounts/checklists/release-review.md)
  stays in place until its requirements are separately satisfied and approved.

## Recovery and authenticator replacement

- **Save backup codes:** show the codes during enrollment and let the master copy
  or download them for safekeeping. Keep them out of logs and browser local
  storage. A used code cannot be used again.
- **Lost authenticator:** the master may sign in with their password and an unused
  backup code, then start replacing the authenticator.
- **Verify changes:** starting authenticator replacement or generating new backup
  codes requires the current password and MFA verified within the last five
  minutes. An existing signed-in session without that recent verification is
  insufficient. The backup code used in a recent recovery sign-in counts; a
  second backup code is not required, so the last unused code still works.
- **Replace the authenticator:** starting replacement ends the login's previous
  sessions, related tokens and pending sign-in challenges, and invalidates the
  old authenticator and backup codes. Access stays limited to enrollment and
  sign-out until a code from the new authenticator is verified. Provide a new
  set of backup codes with the new enrollment.
- **Replace backup codes:** generating a new set invalidates the entire previous
  set. The authenticator remains enrolled.
- **All second factors lost:** if the authenticator and all unused backup codes
  are unavailable, sign-in stays blocked. Automatic recovery is deferred. Any
  manual reset needs a separately reviewed and approved private operator
  procedure that ends old access and requires new authenticator enrollment
  before protected access. This section does not approve that procedure or tool.
- **Password reset:** resetting a password does not remove MFA or supply a backup
  code. The initial-master setup remains a first-login creation action and
  cannot recover an existing master.
- **Implementation review:** verify these behaviors and the handling of
  interrupted changes in the technical plan before coding. This policy accepts
  no additional database-consistency exception and does not lift the release
  hold.

## User Scenarios & Testing *(mandatory)*

- **Evidence status:** these are required outcomes for the planned feature. MFA
  implementation and passing application tests are not claimed by this section.
- **Test approach:** each named scenario needs a matching permanent behavior test
  under the [testing conventions](../../docs/conventions/testing.md). Use real
  sign-in and migrations; check that unrelated logins and workspaces stay
  unchanged. Technical design must settle failure handling before coding.

### User Story 1 - Enroll and sign in as a master (Priority: P1)

- **Goal:** every master completes MFA before reaching protected Hub actions or
  workspace data.
- **Independent test:** use privately created masters and the real Hub/workspace
  sign-in flow to prove that password-only access is refused and valid MFA works.

**Acceptance scenarios:**

- **Master enrollment:** given the first master or a later privately added master
  without an authenticator, when they sign in with valid credentials, then they
  must enroll and verify an authenticator code before protected access. They can
  copy or download the new backup codes.
- **Invalid enrollment code:** given an unfinished enrollment, when the master
  submits an incorrect or expired authenticator code, then MFA is not activated
  and protected access remains blocked.
- **Password accepted, MFA pending:** given an enrolled master, when their email
  or username and password are correct, then the response requests the second
  factor without reporting an unexpected error or completing privileged sign-in.
- **Valid master sign-in:** given an enrolled master and an active login, when
  they submit valid credentials and an authenticator code, then sign-in succeeds
  and existing profile-completion and destination rules apply.
- **Invalid or expired verification:** given a pending master MFA step, when the
  code is incorrect, outside the accepted time window, or the sign-in challenge
  has expired, then protected access is refused. An expired challenge requires a
  new credential sign-in.
- **Existing password-only session:** given a master session that has not passed
  MFA, including one created before MFA enrollment on another device, when it
  directly requests a protected Hub or workspace action, then access is refused
  even if the login now has MFA enabled.
- **Fresh sign-in on the same browser:** given a master who previously passed
  MFA, when they sign in after signing out or session expiry, then the second
  factor is required again. A remembered-device request cannot skip it.
- **Workspace sign-in continuation:** given a valid workspace sign-in request,
  when the master completes MFA and any required profile details, then the
  existing signed continuation reaches the intended workspace. Before completion
  it cannot grant workspace access; a tampered continuation is refused.

### User Story 2 - Recover access and replace factors (Priority: P1)

- **Goal:** a master can recover with saved backup codes and replace their
  authenticator without reopening password-only access.
- **Independent test:** sign in using backup codes, replace the authenticator or
  backup set, and verify that replaced factors and previous access cannot work.

**Acceptance scenarios:**

- **Single-use backup sign-in:** given valid credentials and an unused backup
  code, when the master uses it for sign-in, then sign-in succeeds and that code
  cannot be reused. Concurrent uses of the same code permit only one success.
- **Last backup code:** given a master who uses their last unused backup code to
  sign in, when they supply their current password and start replacement within
  the approved five-minute MFA window, then replacement can start without a
  second backup code.
- **Current password and recent MFA:** given an authenticator-replacement or
  backup-code-generation request, when the password is wrong or MFA was last
  verified more than five minutes ago, then the change is refused without
  changing the current factors. A session renewal without MFA does not refresh
  that verification time.
- **Authenticator replacement:** given current-password and recent-MFA checks
  have passed, when replacement starts, then the old authenticator, backup codes,
  previous sessions, related tokens and pending challenges stop working. Access
  stays limited to enrollment and sign-out until a new authenticator code is
  verified; the new enrollment provides new backup codes.
- **New backup-code set:** given current-password and recent-MFA checks have
  passed, when a new backup set is generated, then every code in the previous
  set stops working and the authenticator remains enrolled.
- **Interrupted replacement:** given replacement has invalidated the old factors,
  when it is interrupted before new-code verification, then protected access
  remains blocked and completed enrollment is not reported. Recovery from the
  interruption must follow the separately reviewed technical design.
- **Loss of all second factors:** given the master cannot use the authenticator
  or any unused backup code, when they attempt sign-in or reset their password,
  then MFA remains required and password-only access stays blocked. Repeating
  initial-master setup does not recover the existing login. No automatic recovery
  or unapproved operator tool is introduced.

### User Story 3 - Preserve existing identity and security rules (Priority: P1)

- **Goal:** MFA follows the existing live identity checks and keeps authentication
  material private.
- **Independent test:** exercise normal users, changed login state, refused MFA
  attempts and sensitive responses through the existing test boundaries.

**Acceptance scenarios:**

- **Ordinary logins:** given an Account holder, workspace owner/admin or another
  user without the global master role, when they sign in, then the existing flow
  applies. A tenant role cannot enable or administer master MFA, and public
  sign-up stays unavailable.
- **Login changes invalidate old access:** given master sessions or pending MFA
  challenges, when an existing password-reset, password-change, identifier-change
  or lifecycle action invalidates access, then its old access cannot be restored
  by completing an earlier challenge. Suspended, archived or incompletely created
  logins remain blocked; reactivation or restoration cannot revive old challenges.
  The existing own-password rule may retain only the authorized current device.
- **Limited verification attempts:** given repeated failed enrollment or MFA
  verification attempts, when the configured limit is reached, then further
  attempts are refused under the limits approved in the technical plan. Test both
  enrollment sessions and sign-in challenges.
- **Private authentication material:** given setup, sign-in or recovery, when
  responses, navigation and logs are inspected, then passwords, authenticator
  secrets and backup codes appear only in their intended credential submission,
  private setup display or explicit copy/download. They never enter logs,
  navigation URLs, browser local storage or third-party QR services.
