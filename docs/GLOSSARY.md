# Glossary

Each business term has one meaning, used the same way in the plan, code,
database and screens. Add a term here before using it.

- **Account:** a person or business that owns a workspace; the tenant.
  An account can exist before its workspace is created. At most one
  workspace per account for now; several come later.
- **Account holder:** the person behind an account, who manages it from
  their account page in the Hub.
  A login holds at most one account for now. A master may transfer this
  responsibility without changing the account's identity.
- **Authenticator app:** an app that generates changing verification codes for
  sign-in from a saved secret.
- **Backup code:** a saved, single-use verification code used in place of an
  authenticator code at sign-in. It does not replace the authenticator.
- **Core:** the part installed in every workspace: workspace users,
  teams, entities, the audit log and unusual-activity limits.
- **Entity:** a company or branch inside a workspace. Each user is given
  the entities they can work in.
- **External user:** a workspace user from outside the tenant, such as a
  customer or supplier, who sees only their own records in the Portal.
- **Hub:** the separate app that serves every workspace: sign-in,
  logins, profiles, workspace membership, account pages and STMS.
  Public sign-up is deferred for now.
- **Internal user:** a workspace user on the tenant's staff, who uses the
  modules.
- **Login:** a person's one email or username and password, kept in the
  Hub.
- **Login creation request:** the saved reference for creating one login,
  tied to its creator and intended workspace, if any. Retrying it finishes
  missing steps; the new login cannot use xpro until creation is complete.
- **Master user:** an xpro-wide administrator who manages Accounts,
  workspaces, modules, subscriptions, billing and global logins.
  Has full access across xpro, including viewing and changing tenant
  data in every workspace, without requiring workspace membership
  or a tenant role.
- **Membership:** the Hub's record that a login belongs to a workspace.
  The Hub also records who may manage members. Business roles and
  permissions stay inside the workspace.
- **Module:** a self-contained part of the app for one business area,
  with its own screens, data and rules.
- **Multi-factor authentication (MFA):** sign-in with a password and an
  authenticator code, or a saved backup code in place of that code.
- **Portal:** the area where external users see their own records.
- **Site:** a physical place, such as a plant or warehouse. Part of ERP.
- **STMS:** SaaS Tenant Management System, the module that manages
  accounts, workspaces, modules and billing. In the Hub it can create,
  change and suspend workspaces; in a client's workspace it manages
  their own customers, without that power.
- **Team:** a group of internal users, used to group people, assign work
  and control access. Teams can contain other teams.
- **Workspace:** one separate business space owned by an account, with
  its own data, users, modules and subscription.
- **Workspace creation:** the recorded intent and progress for creating one
  account's workspace. It keeps a stable workspace identity so an authorised
  master can resume interrupted setup without creating another workspace.
- **Workspace owner:** the top-level user for managing a workspace's
  members, using the Organization plugin's `owner` role in the Hub.
  Initially the Account holder has this role. It does not grant
  xpro-wide master access.
  After workspace setup completes, workspace ownership and account-holder
  responsibility can be transferred separately.
- **Workspace user:** a person inside a workspace, internal or external.
  Their local record keeps workspace details and history but does not
  grant access by itself. One login belongs to at most one workspace
  for now.
