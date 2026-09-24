# xpro — Planning

## Tenants

- **Account:** the tenant. A person who signs up with xpro. An account can
  own several workspaces.
- **Workspace:** what it is for is up to the account holder.
- **Billing:** each workspace has its own subscription and is billed
  separately.
- **Isolation:** workspaces share no data. The only shared thing is
  each person's login, contact and personal details, which are kept
  in one place. Everything else about a person, such as their roles,
  teams and entities, stays inside each workspace.

## xpro's own workspace

- **Purpose:** xpro runs its own business in its own workspace, created at
  setup, like any other workspace.
- **xpro's team:** internal users of that workspace. The master user is its
  first admin, with complete access.
- **Account holders:** external users of xpro's workspace. They see only
  their own workspaces, subscriptions and invoices.
- **SaaS Tenant Management System (STMS):** a module installed only in
  xpro's workspace. It handles sign-up, accounts, workspaces (create, name,
  copy, delete), picking modules, and subscriptions and billing.
- **Special power:** only STMS can create, change or suspend other
  workspaces, and only from inside xpro's workspace.
- **Portal:** the area where external users of any workspace see their own
  records. Account holders use xpro's Portal.

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

- **One app per workspace:** every workspace, including xpro's own, runs
  in its own copy of the app on Cloudflare Workers for Platforms. Its data
  sits in its own Durable Object, owned by that app.
- **One codebase:** all workspace apps run the same code; only their
  settings differ.
- **Separation:** workspace apps run in Cloudflare's isolated mode, so
  their caches never mix.
- **Router:** one front router sends each visitor to the right workspace
  app, and passes on request details the app needs, such as country and
  time zone. Addresses never change.
- **Placement record:** STMS records each workspace's app, addresses and
  where its data is stored, in the shared database. The router reads a
  fast copy of it. Default and custom addresses use the same record.
- **Platform app:** a separate app runs work that spans workspaces, such
  as setting up a workspace, releases, billing runs and backups.
- **Workspace jobs:** long jobs inside one workspace, such as imports,
  reports and recurring invoices, run step by step inside its Durable
  Object.
- **Custom work:** no-code changes (fields, forms, workflows) work in
  every workspace. Real custom code goes only into that workspace's app.
- **External databases:** a workspace's data can move to an external
  database; the connection is a setting of that workspace.
- **Business logic:** written once, and runs both inside a Durable
  Object and against an external database.
- **Releases:** new code is released workspace by workspace, in an order
  xpro chooses. New features are switched on gradually with feature flags.
- **Start:** development runs locally and on Cloudflare's free plan.
  Workers for Platforms is switched on before the first real client.

## Web addresses

- **Workspace address:** each workspace gets its own address, even
  if its data is split across several databases.
- **Custom address:** on paid plans, customers can use their own
  address (e.g. `erp.acme.com`).
- **xpro's address:** xpro's own workspace, with sign-up and the Portal,
  has its own address.
- **Sign-in:** everyone signs in on one central sign-in page at xpro's
  address. Visitors to a custom address are sent there and back
  automatically.
- **Domain:** not chosen yet. It must be chosen, and managed in
  Cloudflare, before the first real client.
- **Email:** sent from a subdomain of xpro's domain, not the main domain,
  so email problems never affect the website.

## Core: Workspace users

- **Workspace users:** the people inside a workspace, internal or
  external. A person can be a user in several workspaces with one login.
- **Choosing a workspace:** people arriving at a workspace's address go
  straight to it after signing in. Others see the list of their
  workspaces and pick one; with only one, they go straight in. Signed-in
  users can switch workspaces without signing in again.
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
