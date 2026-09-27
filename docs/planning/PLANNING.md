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
- **Backups:** every database can be restored to any point in the last
  30 days, using Cloudflare's built-in restore. Restoring is rehearsed
  before the first real client and after every major change.

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
- **Workspace location:** a workspace's data stays where it is first
  created. STMS picks the location from the client's region when the
  workspace is created, and records it in the placement record.
- **Workspace identity:** each workspace stores its own ID when it is
  created. Every call to it carries that ID, and a call with a different
  ID is refused.
- **Removing a workspace:** when a workspace is deleted, all of its
  stored data is wiped in one step, including its scheduled jobs.
- **Platform app:** a separate app runs work that spans workspaces, such
  as setting up a workspace, releases, billing runs and backups.
- **No hand edits:** live data is never edited by hand. One-off fixes are
  saved scripts, run through the platform app with the same code and
  settings as the apps, and recorded in the audit log.
- **Workspace jobs:** long jobs inside one workspace, such as imports,
  reports and recurring invoices, run step by step inside its Durable
  Object.
- **One job runner:** each workspace has one job runner. It owns the
  workspace's only timer and schedules all its jobs, including sending
  outgoing messages.
- **Wakes only for work:** the runner sets its timer only when a job is
  due, never on a short repeating schedule.
- **Progress saved as it goes:** a long job saves its progress after each
  step, so it carries on where it stopped if the workspace restarts.
- **Long jobs split:** no step runs longer than Cloudflare allows (15
  minutes). Bigger jobs are split into steps.
- **Failures:** a job that fails for a temporary reason is retried later,
  waiting longer each time. One that fails for a permanent reason stops
  at once and is reported. The runner reschedules itself before
  Cloudflare's own retries run out.
- **Safe to repeat:** every job step gives the same result if it runs
  twice.
- **Clean-up:** records kept only for a while, such as the keys used for
  safe retries, are deleted by a regular clean-up job.
- **Custom work:** no-code changes (fields, forms, workflows) work in
  every workspace. Real custom code goes only into that workspace's app.
- **External databases:** a workspace's data can move to an external
  database; the connection is a setting of that workspace.
- **Business logic:** written once, and runs both inside a Durable
  Object and against an external database.
- **Releases:** new code is released workspace by workspace, in an order
  xpro chooses. New features are switched on gradually with feature flags.
- **Versions:** every workspace app reports the exact code version it
  runs, and STMS records it, so xpro always knows which version each
  workspace is on.
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

## Core: Audit log

- **What:** every important action in a workspace is recorded: who did
  it (a person or an automatic job), what was done, and exactly when.
- **Tamper-proof:** entries can only be added, never changed or deleted,
  not even by admins.
- **Where:** each workspace's audit log is kept inside that workspace's
  own storage.
- **What counts as important:** decided for each module when it is
  planned.
- **Action details:** every action and event records who triggered it
  (a person or an automatic job), when, the request it belongs to, and
  which earlier action caused it. The audit log is written from these
  details.
- **Blocked in the database:** the database itself refuses to change or
  delete audit entries.
- **Chained:** each entry stores a fingerprint of the one before it, so a
  changed or removed entry breaks the chain.
- **Daily outside proof:** once a day, each workspace's latest
  fingerprint is sent to an independent public timestamp service, which
  proves it existed at that time. xpro cannot alter that record, so even
  a change by xpro's own team would be caught.
- **Checked:** a regular job re-checks every chain and alerts xpro if one
  is broken. Workspace admins can run the check themselves.

## Core: Unusual activity

- **Bulk limits:** unusually large actions, such as exporting all
  customers at once or deleting many records, are slowed down or
  blocked, even for users who are allowed to see that data.
- **Normal work unaffected:** limits are set for each module from what
  normal work looks like, when the module is planned.
- **Adjustable:** xpro sets the default limits; a workspace's admins can
  change them for their own workspace.
- **Recorded:** every slowed or blocked action is written to the audit
  log.

## Core: Document numbers

- **Readable numbers:** documents such as invoices, orders and dispatch
  notes get a readable number, separate from their internal ID.
- **Series:** each document type has its own number series for each
  company or branch.
- **Pattern:** workspace admins set each series' pattern, such as a
  prefix, the year and the running number.
- **Yearly restart:** a series can restart at 1 each financial year. The
  month the financial year starts is a workspace setting.
- **No gaps:** a number is given only in the same all-or-nothing save
  that creates the document, so a failed save never uses up a number.
  Cancelled documents keep their number and are never deleted. Numbers
  are never reused.

## Core: Search

- **Searchable fields:** each module chooses which fields of its records
  can be searched, such as names, codes and numbers.
- **Search index:** searchable text is copied into a search index in the
  workspace's own database, updated in the same all-or-nothing save as
  the record, so results are never out of date.
- **Part of a word:** typing part of a name or code finds it, ignoring
  capital letters and accents.
- **Three characters:** a search needs at least three characters.
  Shorter searches only match exact codes.
- **Only what you may see:** results only include records the user is
  allowed to see.
- **External databases:** workspaces on an external database use that
  database's own search. The difference stays inside the data layer.

## Modules

- **Module:** a self-contained part of the app for one business area, with
  its own screens, data and rules.
- **Core:** installed in every workspace. It holds what all modules need:
  workspace users, teams, entities, the audit log and unusual-activity
  limits.
- **Planned modules:** CRM (customer relationships), ERP, Lead (lead
  management), Production, Quality and Dispatch. The list will grow.
- **Picking modules:** each workspace uses any combination of modules,
  chosen through STMS.
- **STMS:** a module like any other, installed only in xpro's own
  workspace.
- **Sites:** physical places such as plants and warehouses are not part of
  core. They come with the ERP module.
- **Module boundaries:** a module's internals are private. Other modules
  use only its public interface, or react to its events. They never
  reach into its files.
- **Changes and lookups:** actions that change data go through the
  module's business rules and are saved all-or-nothing. Lists and
  reports read the database directly, without the business rules, and
  never change data.
- **Events:** when something happens in a module, other modules can react
  to it. Their reactions are saved in the same all-or-nothing save.
- **Multi-step processes:** a process with many steps is coordinated in
  one place, not by a long chain of events reacting to each other.
- **Business rules stay with the data:** each record enforces its own
  rules, so it can never be saved in an invalid state. Records that must
  stay consistent with each other are changed and saved together, as one
  unit.
- **Dependencies:** a module lists the modules it needs. Adding it adds
  them too, and a module can't be removed while another module needs it.
- **Extension points:** a module can add fields, screens, rules and
  reactions to another module only through the extension points that
  module offers. It never edits the other module's code.
- **Client custom modules:** custom work for one client is a separate
  module that extends the standard modules the same way. It is included
  only in that client's app.
- **Adding a module:** its database tables are created by its own
  database upgrades when it is added to a workspace.
- **Removing a module:** its screens disappear but its data is kept, so
  history stays intact and the module can be added back later.
- **Outgoing messages:** emails, webhooks and messages to other systems
  are first saved together with the change that caused them, then sent
  afterwards. Nothing is sent for a change that failed to save, and a
  message that fails to send is retried, not lost.
- **Custom fields:** workspace admins can add their own fields to
  records. Each field's name, label, type and rules are stored as
  workspace data.
- **Stored with the record:** a record's custom values are kept together
  in one checked data field on the record, so every workspace keeps the
  same tables.
- **Same rules as built-in fields:** custom values are checked against
  their field's rules on every save. Money and exact numbers follow the
  same storage rules as built-in fields.
- **Filter and search:** a custom field that needs filtering or sorting
  gets its own index, and one marked searchable is added to the search
  index.

## Health checks

- **Status page:** every workspace app, the router and the platform app
  have a status address that checks their parts (database, storage,
  email) and reports OK, WARN or ERROR.
- **Quick check:** a lighter address that only says whether the app can
  serve requests, for monitoring tools to check often.
- **Protected:** status addresses need a monitoring key, so they never
  show details to the public.
- **Alerts:** xpro is alerted when any app reports ERROR. The alerting
  tool is chosen with the tech stack.
