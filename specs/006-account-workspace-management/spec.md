# Feature Specification: STMS account and workspace management

- **Feature:** `006-account-workspace-management`.
- **Created:** 2026-11-07.
- **Status:** implementation is in progress. The account journey (US1, T010–T016) is implemented and locally verified. Workspace creation/recovery, handover, lifecycle and hosted/cross-story acceptance remain pending.

## Scope and intended behavior

- **Purpose:** extend STMS to manage accounts and create usable workspaces without manually preparing records.
- **Authority:** only active, profile-complete masters who have passed MFA can perform these management actions. Account ownership grants no master privileges.
- **Accounts:** create, search, view and rename accounts; assign an existing login as the initial account holder. An account may exist before its workspace.
- **Workspaces:** at most one per account, with its own isolated app, storage and stable address. The account holder becomes its initial workspace owner. Preserve the existing one-workspace-per-login rule.
- **Creation:** show progress and failures in STMS. Keep unfinished workspaces inaccessible. Repeating or resuming the same creation must not create duplicates or replace credentials.
- **Lifecycle:** suspend/reactivate accounts and workspaces without deleting data or suspending people’s personal logins.
- **Management:** provide account/workspace lists, detail pages and attributable audit records for changes.
- **Ownership handover:** a master can transfer account-holder responsibility, workspace ownership, or both to eligible existing logins. Preserve continuous ownership, tenant identity, data and address, and audit the change.
- **Excluded:** billing, module selection, workspace copying/deletion, public sign-up, the TMS rename and production release.
- **Verification:** use local development and the existing test environment. New remote resources or configuration changes still require separate approval.

## Ownership and handover

- **Account holder:** each account has one existing login as its holder. The login must be active and non-archived when assigned. Missing profile details are completed through the existing sign-in flow.
- **One account per holder:** a login holds at most one account in this feature.
- **Account creation:** recording an account creates or changes no workspace membership. Existing workspace membership neither blocks this record-only action nor changes during it.
- **Initial ownership:** when the account’s workspace is created, its holder becomes the initial owner. At workspace creation, a holder already belonging to another workspace is refused, not moved.
- **Master separation:** the master performing creation or handover gains no tenant membership automatically. Existing global roles remain unchanged.
- **Successor eligibility:** a new account holder must hold no other account. For a Ready workspace, the successor must be an active internal member of that workspace. Before Ready, the successor may be unassigned or an active internal member of the same unfinished workspace, but must not belong to another workspace. A successor must be active and non-archived when assigned.
- **Transfer choice:** after Ready, a master may transfer account-holder responsibility, workspace ownership, or both. Responsibilities not selected for transfer remain unchanged. Before Ready, changing the holder also changes the intended initial owner; independent workspace-owner transfers wait until Ready.
- **Safe handover:** apply the selected ownership changes together, keeping a holder for the account and an active owner for a Ready workspace. For unfinished setup, record the successor and reconcile any partial owner assignment before activation. Refuse stale or conflicting requests without partial changes.
- **Departure:** when the old holder or owner is leaving the tenant, transfer every responsibility they hold and remove their workspace membership in the same operation. Preserve their historical records and personal login.
- **Ordinary transfer:** when the old owner is staying, remove their transferred owner role but preserve their ordinary workspace membership.
- **Access enforcement:** enforce changed membership and ownership on the next protected request, including requests from an existing session. A removed member loses workspace access; a former owner who remains a member keeps only that member's permissions.
- **Global-master limit:** tenant handover does not revoke global master authority. Ending a departing global master's access requires the separate login-management controls; handover must not claim otherwise.
- **Suspended tenants:** handover does not reactivate a suspended account or workspace.
- **Stable identity:** renaming or transferring responsibility changes neither the account/workspace identity nor its data, storage or address.
- **Audit:** record the acting master, affected account/workspace, old and new holder/owner, membership removal when applicable, and time of the handover.

## Suspension and reactivation

- **Separate states:** accounts and workspaces each have an active or suspended state. Workspace creation progress is separate; reactivation cannot make unfinished setup usable.
- **Inherited restriction:** a suspended account blocks tenant access to its workspace. A workspace may also be suspended independently.
- **Enforcement:** suspension blocks ordinary users on their next protected request, including existing sessions, direct page requests and submitted actions.
- **Master access:** global masters retain their existing workspace access and can investigate or reactivate from STMS. Tenant ownership or administration never grants this exception.
- **Safe refusal:** affected users receive a clear suspension message without a redirect loop. Their personal profile and sign-out remain available.
- **Preservation:** suspension deletes no records, changes no personal login status and grants no new permissions.
- **Reactivation:** reactivate only the selected account or workspace. Account reactivation does not clear an independent workspace suspension, and neither action overrides an inactive login or other access restriction.
- **Confirmation and audit:** suspension requires confirmation and a reason. Record the acting master, target, time, reason and optional comment for each suspension or reactivation.

## Workspace creation and recovery

- **Start:** a master selects an active account without a workspace or an existing creation in progress, supplies the workspace name and intended client region, and confirms creation for the displayed account holder.
- **Stable identity:** assign one workspace identity and one address within the approved environment. Repeated requests must not create a second workspace for the account or silently choose a different address.
- **Complete setup:** prepare the workspace's isolated app, storage, owner access and sign-in before making it usable. The creating master gains no tenant membership unless separately entitled.
- **Visible progress:** STMS shows Creating, Needs attention or Ready, the associated account, and the next available action. Do not report success merely because creation was requested.
- **Incomplete access:** nobody may use an unfinished workspace. Existing account, profile and sign-out functions remain available under their normal access rules.
- **Resume:** an authorized master can reopen and resume the recorded creation after interruption. Preserve completed work, workspace identity and the original request; record who initiated and who resumed it.
- **Uncertain outcome:** after a timeout or lost response, determine whether the previous step completed before repeating it. If that cannot be established safely, show Needs attention rather than creating another resource.
- **Changed conditions:** recheck current authorization, ownership and account state before activation. A handover or suspension during setup must not leave the former holder authorized or make the workspace usable under stale conditions.
- **Suspension:** preserve completed setup work but prevent activation while the account or workspace is suspended. Reactivation does not skip any remaining setup or access checks.
- **Placement:** record the chosen initial region. Resuming, renaming or transferring ownership must not silently relocate the workspace's data.
- **Failure privacy:** show a safe explanation and request reference. Do not expose credentials, secrets or raw provider responses in screens, URLs or audit records.
- **Environment boundary:** creation is limited to the explicitly approved environment and resources. This feature does not authorize production provisioning or release.

## User Scenarios & Testing

- **Evidence status:** these are required acceptance outcomes, not claims that the feature is implemented or tested.
- **Shared checks:** every management request must enforce current master authority and preserve unrelated tenants. Changes must produce the required audit record.

### User Story 1 — Manage accounts (Priority: P1)

- **Goal:** a master can create, find, inspect and rename an account before or after its workspace exists.
- **Independent test:** create an account for an eligible existing login, find it, rename it and verify its holder and identity remain unchanged.
- **Create:** given an eligible holder, when a master creates an account, then one account is recorded without creating workspace membership.
- **Refuse conflicts:** given an ineligible holder or a concurrent attempt to assign the same holder, when creation is submitted, then no duplicate account or unintended reassignment occurs.
- **Find and rename:** given existing accounts, when a master searches, opens and renames one, then the correct account changes without changing its holder, workspace or address.

### User Story 2 — Create a usable workspace (Priority: P1)

- **Goal:** a master can bring an account's workspace into use without manually preparing its records.
- **Independent test:** create a workspace and sign in as its holder through the normal account/workspace flow.
- **Complete setup:** given an active account with an eligible holder, when setup finishes, then the workspace is Ready, its holder is an internal owner and its address reaches that workspace.
- **Preserve authority:** given a different master performs creation, when setup finishes, then that master has acquired no tenant membership and the holder has acquired no global master role.
- **Isolation:** given another workspace exists, when either workspace is used, then its data and identity remain separate from the other.
- **Existing sign-in rules:** given a holder needs profile completion or master MFA, when they sign in, then those existing requirements still apply before protected access.
- **Workspace rename:** given a Ready workspace, when a master renames it, then only its displayed name changes; identity, address, ownership and data remain unchanged.

### User Story 3 — Recover interrupted creation (Priority: P1)

- **Goal:** interruption does not expose an unfinished workspace or force a duplicate creation.
- **Independent test:** interrupt setup, reopen its saved progress as an authorized master, resume it and verify one completed workspace.
- **Resume:** given a recorded incomplete creation, when an authorized master resumes it, then completed work and the same workspace identity are preserved.
- **Lost response:** given a step may already have completed, when its response is lost, then its outcome is established before repetition or the creation shows Needs attention.
- **Concurrent attempts:** given two requests create or resume the same account's workspace, when they overlap, then at most one workspace and one effective owner assignment result.
- **Changed conditions:** given ownership, authorization or suspension changes during setup, when activation is attempted, then stale conditions cannot grant access.
- **Handover during setup:** given unfinished creation and an eligible unassigned successor, when the holder changes and setup resumes, then the same workspace finishes with the successor as initial owner and no stale owner powers.

### User Story 4 — Hand over responsibility (Priority: P1)

- **Goal:** a departing holder or owner can be replaced without losing the tenant or leaving their old access in place.
- **Independent test:** transfer both responsibilities to an eligible successor and remove the departing person's membership.
- **Departure:** given an eligible successor, when a master completes a departure handover, then the successor holds the selected responsibilities, ownership remains continuous and the old membership no longer authorizes access.
- **Owner staying:** given the old owner remains with the tenant, when only workspace ownership transfers, then they retain ordinary membership but lose the transferred owner powers.
- **Separate responsibilities:** given only account-holder responsibility or workspace ownership is selected, when it transfers, then the other responsibility remains unchanged.
- **Invalid or stale successor:** given an ineligible successor or changed ownership, when handover is submitted, then ownership and membership remain unchanged.
- **Unavailable old holder:** given the old holder's login is suspended, archived or unavailable, when a master selects an eligible successor, then handover does not require the old holder to sign in or restore their login.
- **Global authority:** given the departing person also has global master authority, when tenant handover completes, then it does not claim to revoke that separate authority.

### User Story 5 — Suspend and restore tenant access (Priority: P1)

- **Goal:** a master can stop and restore tenant access without changing personal login status or losing data.
- **Independent test:** suspend and reactivate an account and its workspace separately while ordinary and master sessions already exist.
- **Suspend:** given an ordinary user has an open session, when the account or workspace is suspended, then their next protected workspace request is refused and their personal profile and sign-out remain available.
- **Restore correctly:** given the account and workspace are independently suspended, when only one is reactivated, then the other restriction remains effective.
- **Preserve other restrictions:** given an inactive login or unfinished setup, when the tenant is reactivated, then those restrictions still prevent access.
- **Master recovery:** given a suspended tenant, when a currently authorized master investigates or performs a handover, then existing master access remains available without reactivating the tenant.
- **Unconfirmed suspension:** given missing confirmation or reason, when suspension is submitted, then status and access remain unchanged.

### Edge Cases

- Blank names, repeated display names and searches with no matches must not confuse account or workspace identities.
- Empty directories and unavailable data must have different outcomes; a failed load must not appear as an empty list.
- A lost session, changed actor or revoked master authority while a form is open must prevent an unauthorized save and preserve recoverable non-secret input.
- Existing records that conflict with the new ownership limits must be reported for review, not silently reassigned or deleted.
- Independent suspension or archiving of a holder's login must preserve security restrictions and permit a master-controlled handover.
- Management screens must work by keyboard, expose clear labels and errors, and retain the existing session-return behavior.
- Non-master holders and workspace administrators must be refused when they directly request master-only management reads or changes.

## Requirements

### Functional Requirements

- **FR-001:** Only a currently authorized, active, profile-complete master who has passed MFA may use the account/workspace management functions. Account ownership or tenant administration alone is insufficient.
- **FR-002:** A master must be able to create an account with a nonblank name and an eligible existing holder, without creating workspace membership.
- **FR-003:** Each account must have one holder and at most one workspace. Each login may hold at most one account and retain membership in at most one workspace.
- **FR-004:** Masters must be able to search, list and inspect accounts and workspaces. Empty results and failed requests must be distinguishable.
- **FR-005:** Masters must be able to rename accounts and workspaces without changing identity, ownership, address, storage or placement.
- **FR-006:** Workspace creation must establish the account link, isolated app and storage, stable address, chosen region, sign-in and initial holder's internal owner membership before ordinary use.
- **FR-007:** Creating or managing a workspace must not grant its acting master tenant membership or grant a holder global master authority.
- **FR-008:** One recorded creation must identify an account's unfinished workspace. Repeated or concurrent creation/resumption must not produce duplicate workspaces or owner assignments.
- **FR-009:** Creation must expose Creating, Needs attention or Ready and the next available action. No user, including a master, may use an unfinished workspace.
- **FR-010:** An authorized master must be able to resume recorded creation while preserving completed work and stable identity. Unknown outcomes must be resolved or shown as Needs attention before the affected operation is repeated.
- **FR-011:** Activation must recheck current authorization, holder eligibility, ownership and suspension. Stale conditions must not expose a workspace or retain a former holder's access.
- **FR-012:** Account and workspace suspension must be independent. Either suspension must deny ordinary workspace access on the next protected request, including requests from existing sessions.
- **FR-013:** Global masters must retain their existing access to completed suspended workspaces and STMS recovery actions, subject to their normal login, profile and MFA requirements.
- **FR-014:** Suspension requires confirmation and a reason. Reactivation must affect only the selected account or workspace and must not override other suspension, login or setup restrictions.
- **FR-015:** Tenant suspension or reactivation must not delete data, change personal login status or silently relocate storage.
- **FR-016:** A master must be able to transfer account-holder responsibility, workspace ownership or both, using the successor eligibility rules in Ownership and handover.
- **FR-017:** Handover must preserve continuous ownership and apply its selected responsibility and membership changes together. An invalid or stale request must make no partial changes.
- **FR-018:** Departure handover must remove the departing person's workspace membership. An owner-only transfer for a person who stays must preserve ordinary membership.
- **FR-019:** Handover must work without the old holder signing in, including when that login is suspended or archived. It must not restore that login or claim to revoke a separate global master role.
- **FR-020:** Successful creation, renaming, lifecycle changes and handovers must have attributable, immutable audit records. Preserve historical identities and existing released codes; do not rewrite history.
- **FR-021:** Screens and failure records must not expose credentials, secrets or raw provider responses. Interrupted or failed operations must not be presented as completed changes.
- **FR-022:** Forms, lists and confirmations must be keyboard-operable, clearly labelled and compatible with the existing session-return behavior. Changed identity or authority must prevent stale form submissions.
- **FR-023:** Existing records that conflict with the ownership limits must be identified for explicit review, not silently deleted, reassigned or merged.
- **FR-024:** Development and acceptance must remain within approved local/test resources. This feature does not authorize production configuration, deployment or first-client onboarding.

### Key Entities

- **Account:** the tenant, identified independently of its editable name, with one holder, an active/suspended state and at most one workspace.
- **Login:** the existing shared personal identity. Holding an account or managing a workspace does not replace its existing authentication and global-role rules.
- **Workspace:** the account's isolated business space, with its own identity, editable name, stable address, placement, ownership, lifecycle state and creation progress.
- **Workspace creation:** the recorded intent and progress for one account's workspace, including stable identity, initiator, resumptions and safe failure information.
- **Audit entry:** immutable history identifying the action, acting master, affected account/workspace and relevant holder/owner changes, reason and time.

## Success Criteria

### Measurable Outcomes

- **SC-001:** A master can complete all five user journeys through STMS and the existing sign-in flow without manually editing tenant records or preparing each workspace outside the product.
- **SC-002:** After successful creation, the account holder reaches the correct Ready workspace with owner permissions, while existing profile-completion and MFA requirements remain enforced.
- **SC-003:** Repeated requests, including at least two concurrent creation or resumption attempts for the same account, result in one workspace identity, one assigned address and one effective initial-owner assignment.
- **SC-004:** Each tested interruption either resumes with the original identity and completed work intact or reports Needs attention. No unfinished workspace becomes usable.
- **SC-005:** Successful departure handover preserves continuous ownership and stops the old membership authorizing the next protected request. An ordinary owner transfer preserves the former owner's permitted member access.
- **SC-006:** All combinations of account and workspace suspension follow the stated precedence. Ordinary users are blocked on their next protected request, global-master recovery remains available, and reactivation bypasses no other restriction.
- **SC-007:** Acceptance checks produce no unintended changes in an unrelated account or workspace and expose no credentials or secrets in the exercised screens, URLs, errors or audit records.
- **SC-008:** All five journeys can be completed by keyboard. The affected screens have no serious or critical automated accessibility findings, and interrupted-session checks preserve recoverable non-secret input without permitting a different actor to submit it.

- **Evidence boundary:** these are release criteria for this feature, not reported test results. Verification uses approved local/test resources; production readiness remains a separate gate.

## Assumptions

- **Existing identity:** reuse the current login, profile, MFA, membership and session rules. This feature does not add public sign-up, invitations, email verification or password recovery.
- **Successor preparation:** existing login-creation and membership flows supply eligible internal successors. Handover does not silently move a person from another workspace.
- **Names:** account and workspace names are display labels and may repeat. Stable identities and workspace addresses distinguish records; blank names are rejected.
- **Ready workspace:** Ready means a usable instance of the existing workspace application, not delivery of new business modules.
- **Region:** the selected region guides initial placement. This feature makes no new legal data-residency guarantee and does not move existing workspace data.
- **Test prerequisites:** the existing test environment is the starting point, not proof that arbitrary workspace provisioning is already implemented. The technical plan must identify and obtain approval for additional resources, permissions or configuration.
- **Implementation gate:** follow the approved plan and tasks; exact code/configuration changes and remote actions require separate approval. Existing runtime and deployment rules and the production release hold remain in force.
