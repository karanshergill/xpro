# xpro — Planning

## Tenants

- **Account:** the tenant. A person's login to the Portal. An account can
  own several workspaces.
- **Workspace:** what it is for is up to the account holder.
- **Billing:** each workspace has its own subscription and is billed
  separately.
- **Isolation:** workspaces share no data. The only shared thing is
  each person's login, contact and personal details, which are kept
  in one place. Everything else about a person, such as their roles,
  teams and entities, stays inside each workspace.

## Portal

- **Purpose:** where xpro manages its tenants. It lives outside the
  workspaces.
- **Accounts:** sign-up and management of accounts.
- **Workspaces:** create, name, copy, delete.
- **Modules:** picking which modules each workspace gets.
- **Subscriptions and billing:** plans, payments, invoices.
- **Portal users:** xpro's own users. For now, only one master
  user with complete access.

## Data storage

- **Per workspace:** each workspace has its own storage.
- **Small and medium workspaces:** a Cloudflare Durable Object with
  its own built-in database (10 GB limit each).
- **All-or-nothing saves:** related changes (for example, a dispatch
  updating stock and the invoice) are saved together, or not at all.
- **Large workspaces:** can connect to an external database (such as
  PostgreSQL or MySQL) with no size limit.
- **Location-independent:** the app must not depend on where a
  workspace's data lives.
- **Module split:** only heavy modules get their own database, and
  only if their data doesn't need to be saved together with another
  module's.

## App layout

- **Shared app:** one app that serves all standard workspaces. Each
  workspace's data sits in its own Durable Object, owned by the
  shared app.
- **Dedicated app:** a workspace's own copy of the app, for tenants
  who need custom code, a fixed version, or stronger separation. Its
  data sits in its own Durable Object, owned by that app. Runs on
  Cloudflare Workers for Platforms.
- **One codebase:** the shared app and dedicated apps run the same
  code; only their settings differ.
- **Router:** one front router sends each workspace's visitors to the
  shared app or to its dedicated app. Addresses never change.
- **Placement record:** the Portal records which app serves each
  workspace and where its data is stored.
- **Custom work:** no-code changes (fields, forms, workflows) work in
  every app. Real custom code goes only into dedicated apps.
- **External databases:** a workspace on an external database can be
  served by the shared app or a dedicated app.
- **Moving between apps:** moving a workspace between the shared app
  and a dedicated app is a planned data move (export and import).
- **Business logic:** written once, and runs both inside a Durable
  Object and against an external database.
- **Start:** shared app only. Workers for Platforms is added when the
  first tenant needs a dedicated app.

## Web addresses

- **Workspace address:** each workspace gets its own address, even
  if its data is split across several databases.
- **Custom address:** on paid plans, customers can use their own
  address (e.g. `erp.acme.com`).
- **Portal address:** the Portal has its own address.
- **Domain:** not chosen yet.

## Core: Workspace users

- **Workspace users:** the tenant's people inside a workspace.
  Separate from accounts and portal users.
- **Internal users:** the tenant's staff, who use the modules.
- **External users:** the tenant's customers and suppliers, who see
  only their own records.
- **First admin:** the account holder who creates a workspace
  becomes its first admin.
- **Archiving:** users are archived, never deleted, so history stays
  intact.
- **Teams:** groups of internal users, used for grouping people,
  assigning work and controlling access. A user can be in several
  teams, and teams can contain other teams. External users can't be
  in teams.
- **Entities:** each user is given the companies and branches they
  can work in, and can switch between them.
