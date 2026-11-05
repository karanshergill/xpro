# Server Functions: Sign-in and Accounts

Each function checks its input, applies its business rules, and returns named results for
expected outcomes (such as `username_taken`). API tests call each one directly.

Other STMS changes are saved together with their audit entries. Successful sign-ins and
login creation follow the [documented exceptions in the plan](../plan.md#constitution-check).

## Access checks

- **Hub requests:** check the current session and login records in the Hub.
- **Creation complete:** refuse protected access for a Story 6 login whose creation
  request is unfinished, even if its session, profile and membership are valid.
- **Workspace requests:** use one combined Hub call through a Cloudflare Service Binding
  to check the current session, active login, creation completion, global role and
  any required membership of the requested workspace.
  Check profile completion in the same call.
- **Shared permission check:** all users go through the same server-side permission
  check before a protected workspace action. Reuse one implementation across
  workspaces; check local permissions alongside the action without another
  network request.
- **Permissions:** the master role grants full access across xpro without workspace
  membership or local permission assignments. Other users need membership and
  the required local permissions.
- **Normal action rules:** input checks, business rules, save rules and audit
  requirements apply to all users. Audited actions record the acting user's own login.
- **Native HTTP routes:** Better Auth routes must enforce the same xpro rules.
  Disable unused or duplicate write routes that could bypass those rules.
  Keep trusted server-side API calls available. Test that direct requests cannot
  bypass validation, session revocation or auditing.
- **Reuse within a request:** functions handling the same request share the Hub result.
  Do not reuse it across different requests.
- **Request setup:** `createAccessRequest` loads that Hub result before entering a
  local save. Its `authorize` method is synchronous and checks each action's
  current local permission fact. The server supplies that fact, never the client.
  The typed contract is in `packages/core/src/access/access.ts`; implementation is
  T012. No network call happens inside the local save.
- **Session expiry:** the same Hub result supplies the native session's original
  expiry. Workspace session creation preserves it, capped at 30 days.
- **Private transport:** `HUB_ACCESS` targets the Hub's named `HubAccess` RPC
  entrypoint. The default `HUB` HTTP binding remains available for sign-in flows.
  Malformed input and failed validation grant no access; raw database errors never
  cross the binding. Only the request boundary reports unexpected validation failures.
- **Failed check:** refuse access if a required check fails or cannot be completed.
- **Sign-out messages:** use them to clear local sessions promptly, not as a substitute
  for the checks above.
- **Availability:** assume the Hub is always available; do not build an offline mode.
- **Tests:** an ended Hub session blocks the next action, even without a sign-out message.
  Changes to roles, membership and permissions take effect on the next action.
  Master users can view and change tenant data without membership or local permissions.
  Multiple functions handling one request cause only one Hub validation.

## Required steps before using xpro

- **First sign-in:** skip profile completion if the username, name and phone are
  complete and valid. Otherwise, require only the missing or invalid details.
- **No skipping:** the server enforces this rule even if someone skips the form.
- **While unfinished:** allow only profile completion, session checks and sign-out.
- **Tests:** prove that complete profiles skip the form, incomplete profiles require
  only missing or invalid details, and skipping the form does not bypass this rule.

### Completion page

- **Read:** the Hub's T016 reader accepts only empty input and returns only the
  required profile field names. Use the native cookie and the current shared
  access result; incomplete creation and inactive/absent sessions disclose no fields.
- **Transport:** browser calls use the existing strict JSON POST boundary. Start
  may invoke the reader during GET /complete-profile SSR. Reader responses are
  no-store; rendered HTML is private/no-store and varies by Cookie.
- **Write:** the screen calls the existing completion action with only required
  fields and any required username confirmation. Its warning, confirmation reset,
  errors and retries do not weaken backend validation or username locking.
- **Continue:** use the existing Hub destination or native signed provider
  continuation, preserving query state through errors. Never accept a caller
  supplied destination as the completion result. See ADR-032 and T016.

## Hub: provided by Better Auth

- Sign in with email or username, sign out.
- Provide server-side APIs to create logins and add workspace members.
  xpro checks the creation permissions in FR-001 before calling them.
  Public sign-up is disabled.
- Get the current session; change password.
- Sign-in protocol pages for workspaces: authorize, token, user info, sign-out messages.

## Hub: own

| Function | Story | Who |
|---|---|---|
| `createLogin` | 6 | master user; workspace owner or workspace user with creation permission for their own workspace |
| `completeFirstSignIn` (username, name, phone) | 1 | the person |
| `getSignInDestination` (optional requested workspace) | 2 | the person |
| `checkUsername` (rules, taken, reserved) | 1, 6 | the person; users permitted to create logins |
| `updateProfile` (name, phone) | 4 | the person |
| `uploadPicture` / `removePicture` | 4 | the person |
| `changePassword` (checked native call) | 4 | the person, with their current password |
| `listLogins` / `searchLogins` / `getLogin` | 5 | master user |
| `suspendLogin` / `reactivateLogin` | 5 | master user |
| `archiveLogin` / `restoreLogin` | 5 | master user |
| `resetPassword` | 3, 5 | master user |
| `changeEmail` / `changeUsername` | 5 | master user |

### Own profile, picture and password

- **Owner:** Accounts supplies profile/password actions through its server-only
  public entry. The Hub registers authenticated POST functions before the
  screen, using the existing exact-Origin and bounded JSON gate. Picture upload
  has its own bounded multipart route. The /profile screen reuses these actions.
- **Authority:** use the current protected Hub access result, including active
  status, complete creation and complete profile. Derive the affected login from
  that result. A master uses the same own-profile rules; this is not an action for
  editing someone else. Refuse submitted login IDs and other server-owned fields.
- **Profile input:** a name and phone together. Reuse Accounts' name trimming and
  strict country/phone validation; store the normalized international number.
  Both remain required. Email, username, role and picture key cannot be changed
  through this action. Return only `{ loginId }`.
- **Password input:** `currentPassword` and `newPassword`. Check the new password
  against the existing 12–64-character rule, including capital, number and
  symbol. Do not trim either password. Always request native session revocation;
  callers cannot opt out. Map native incorrect-current-password refusal to
  `accounts_current_password_invalid`.
- **Current device:** the installed Better Auth 1.7.12 implementation removes
  the old sessions, updates the native credential and creates a replacement
  session. Return its actual `Set-Cookie` headers to the current browser. The
  internal Accounts result carries `{ loginId, headers }`; the Hub handler
  sends the cookie as a header and only `{ loginId }` as JSON. Never serialize
  native tokens or the whole native response. Retained workspace cookies tied to
  old Hub sessions fail on the next action; the new Hub cookie can enter the
  workspace through normal sign-in continuation.
- **Native failure limit:** on D1 these native calls are separate writes. If the
  credential update fails after session deletion, the old password remains but
  the old sessions have ended. If replacement-session creation fails, the new
  password can remain without a replacement cookie. This is the scoped native
  own-password save exception in [ADR-025](../../../docs/adr/025-native-own-password-changes.md).
  Return a safe `core_unexpected_error` with no success cookie or sensitive error.
  Do not automatically retry or accept a replay key. The person signs in with
  whichever password was saved, or asks a master to reset it.
- **Picture input:** `uploadPicture` accepts `{ file }` from the server's upload
  boundary; `removePicture` accepts `{}`. Limit actual bytes to 2 MiB
  (2,097,152 bytes, inclusive) and inspect content instead of trusting the
  browser's MIME type or file name. Accept only JPEG, PNG and WebP.
- **Picture transport:** multipart POST to `/api/v1/profile-pictures` with exactly
  one `file` field. Require the configured URL/Origin and current native session
  before reading the body. Cap streamed bytes at 2 MiB plus 64 KiB overhead,
  independently of Content-Length. Removal uses the registered `removePicture`
  JSON POST function with `{}`. Return only `{ loginId }`, no-store and a fresh
  request ID; no private key or native cookie/token appears in JSON.
- **Picture processing:** use the Images binding to decode supported content.
  Produce one still PNG with central square dimensions of min(width, height,
  512), without upscaling; PNG output discards metadata. Bound processing to ten
  seconds and output to 2 MiB. Store only this output under a generated
  `profiles/<loginId>/<uuidv7>.png` key.
- **Picture save:** stage the object, then guard the indexed D1 pointer update
  by its previous key. A competing change returns `accounts_picture_changed`;
  discard the staged loser. A confirmed pre-commit failure preserves the old
  picture. Read back a lost reply without repeating the write. If confirmation
  fails, retain possibly referenced files and return a safe error. After a
  committed change, deletion failure leaves a private orphan, reports safely
  and keeps success. This scoped exception is in
  [ADR-026](../../../docs/adr/026-bounded-private-profile-pictures.md).
  Removal clears the key before deletion; an absent picture is a no-op.
- **Picture failures:** use `accounts_picture_type_invalid`,
  `accounts_picture_too_large` or `accounts_picture_invalid` for those expected
  refusals; `accounts_picture_changed` is a 409 requiring a fresh submission.
  Invalid input uses `core_invalid_input`; unexpected processing, quota, bucket
  or database failures use the safe core error.
- **Page read:** getProfilePage is an empty-input JSON POST reader, also called
  directly by Start during GET /profile SSR. Require fresh native/Core protected
  access. Return only the actor's loginId, email, username, name, phone and nullable
  pictureRevision; never return the private key, role, token or other login.
- **Page actor:** the optional x-page-login-id header only refuses a changed
  actor after fresh authorization. The screen sends it on page refresh and all
  profile/password/upload/removal writes. Existing native authority is unchanged.
- **Browser crop:** before decoding, check the original supported signature and
  inclusive 2 MiB limit. Select a square with react-image-crop and draw it into
  bounded PNG Canvas output. Submit the generated file through the existing
  one-file multipart protocol. The server independently checks submitted bytes;
  it never receives a caller-supplied storage key or crop-coordinate contract.
- **Picture read:** GET/HEAD /api/v1/profile-pictures/<revision> requires fresh
  protected access and an exact match to the actor's current owned key. No query
  selectors. Return a private/no-store PNG with Vary: Cookie and nosniff, or safe
  accounts_picture_not_found for missing/stale/other-owned revisions. HEAD has no
  success body. A revision does not grant access by itself.
- **Evidence limit:** real local bindings verify decoded PNG bytes, dimensions,
  metadata absence, multipart transport, storage failures and concurrency.
  Installed Images development support has limited fidelity and may return
  uncoded errors for corrupt input. Hosted cropping, orientation, animation and
  decoder refusals still need staging checks. Local browser checks verify crop
  coordinates and EXIF-oriented pixels, private serving, circular display,
  initials, read-only fields and native replacement-cookie use. See
  [ADR-037](../../../docs/adr/037-private-own-profile-screen.md).

References: [Better Auth password changes](https://better-auth.com/docs/concepts/users-accounts),
[native response headers](https://better-auth.com/docs/concepts/api), and
[Cloudflare Images bindings](https://developers.cloudflare.com/images/optimization/binding/).
The Images documentation distinguishes its full implementation from limited
offline development support. T033 adds only the binding configuration; it does
not purchase a plan, provision remote resources or deploy.

### Master login-management test boundary

- **Authority:** current, complete global master access for all reads/writes.
  Workspace owners/admins cannot gain it through tenant permissions. Services
  supply the real database, prepared access and context; body fields cannot
  replace the actor or write extra properties.
- **Read input:** `listLogins({ limit?, offset? })`,
  `searchLogins({ query, limit?, offset? })` and `getLogin({ loginId })`.
  Defaults 25/zero; limit 1–100, offset a nonnegative safe integer. Search trims outer
  spaces and matches case-insensitive literal prefixes across name/email/username,
  with 1–200 UTF-16 code units after trimming. Refuse unknown fields and unpaired
  surrogates. Names use trim/JavaScript-lowercase matching and preserve accents;
  this is not full Unicode case folding (ADR-028).
- **Read output:** `{ logins, nextOffset }`, newest creation time then ID first;
  null offset when finished. Summaries allow only `loginId, username, name, email,
  phone, createdAt, status`; username/phone may be null. Hide archives normally,
  but permit known-ID detail for restoration. Detail adds only
  `workspace: { workspaceId, name } | null`. A failed read is a safe error,
  never a fabricated empty list. Offset pages are not concurrent snapshots.
- **Suspension:** `{ loginId, reason, confirmed: true, comment? }`.
  Reasons: `stms_unpaid`, `stms_abuse_or_misuse`, `stms_security_concern`,
  `stms_at_persons_request`, `stms_other`. Only Other requires a nonblank comment.
  Suspend active logins indefinitely. Refuse self-suspension with
  `stms_self_suspend_forbidden`.
- **Archive:** `{ loginId, confirmed: true, comment? }`, with no mandatory reason
  or comment. Preserve identifiers, credentials, pictures, membership and
  business history; remember active/suspended status. Refuse self-archiving with
  `stms_self_archive_forbidden`. Never physically delete a login.
- **Return:** `reactivateLogin({ loginId })` clears suspension only.
  `restoreLogin({ loginId })` removes the archive and restores the previous
  status, including suspension/reason. Preserve passwords and membership;
  neither action recreates a session or token.
- **Identifiers:** `changeEmail({ loginId, email, comment? })` and
  `changeUsername({ loginId, username, comment? })` reuse existing field rules,
  normalized email uniqueness and taken/reserved username results. Inactive
  identifiers stay unique. Keep passwords/status; comments are optional.
  A real email change clears `emailVerified`; a same-address no-op and username
  changes preserve it. An unchanged normalized value is a complete no-op.
- **Results:** only `{ loginId }` on a write. Missing target:
  `stms_login_not_found`. Repeated/inapplicable transition:
  `stms_login_state_conflict`. Other input errors use safe Core field names.
  No replay key/automatic retry; an unknown response may have committed.
- **Atomicity:** suspension, archive and identifier changes save user state,
  all-session/issued-token revocation and one audit together; username changes
  reserve the previous username in that save. Reactivate/restore save state and
  audit together. Confirmed failures preserve all prior records. Concurrent
  identifier claims have one winner; identical transitions have one audit and
  one conflict.
- **Audit:** `stms_login_suspended`, `stms_login_reactivated`,
  `stms_login_archived`, `stms_login_restored`, `stms_email_changed`,
  `stms_username_changed` identify the actual master, target and request ID.
  Keep the suspension reason/optional comment; never implicitly copy identifier
  values, credentials or tokens into the audit.
- **Evidence:** T035 uses real authentication, D1/R2 and two workspace databases;
  no missing action is faked. Existing reset tests supply Story 5's reset case.
  T036 verifies the 53 read cases, indexed plans, actual name maintenance and
  three registered Hub POST functions. T037 verifies the 58 suspension/reactivation
  cases, atomic state/audit/revocation, concurrent claims, query plans and two real
  Hub POST functions (ADR-029). T038 verifies 40 archive/restore cases, retained
  identity/history, guarded restoration, atomic revocation and two more Hub POST
  functions (ADR-030). T039 verifies the 69 identifier cases, typed atomic saves,
  native sign-in, no-ops, namespace races, displaced-name reservation, verification
  flags, indexed plans and two registered Hub functions (ADR-031). All backend
  tests/type/build checks pass. T040 adds the screens and local browser checks
  below; hosted and final acceptance remain pending.
  Boundary choices are recorded in
  [ADR-027](../../../docs/adr/027-master-login-management-boundaries.md).

### Master login-management screens

- **Pages:** /stms/logins and /stms/logins/<loginId> reuse the readers and writes
  above. /stms redirects to the directory. Only a current, complete master may
  load data; unsuccessful reads never become an empty directory.
- **Actor metadata:** successful read responses add x-page-login-id for the
  authenticated master without changing their JSON DTO. Clients may send the
  original ID on later reads/writes. Compare it only after real authorization;
  mismatch returns core_identity_changed before the action. A hint cannot grant
  authority. Reset uses the same check as the seven management writes.
- **Transport:** registered RPC stays strict JSON POST with exact Origin checks.
  Direct read invocation during SSR permits only configured-origin GETs for
  the directory or UUID-shaped detail path. No public GET RPC is added.
  Page HTML is private/no-store with Vary: Cookie.
- **Address:** query/offset preserve the existing literal prefix, paging and
  sort rules. Use the Router serializer so JSON-looking strings stay strings;
  strip defaults. Native detail/back/page links carry the same search state.
  Show explicit UTC creation times, without assuming a user's time zone.
- **Writes:** preserve all existing inputs, confirmation/comment rules, result
  DTOs and atomic guarantees. Reuse the reset control. No automatic replay or
  browser-storage drafts. Read current metadata after a confirmed state or
  identifier change; offer explicit readback after uncertain replies.
- **Session:** confirmed self-change remains a success when the subsequent read
  requires sign-in. Blocked forms retain input; only a fresh same-actor read can
  resume them. A different master must reload. Password uncertainty uses T030's
  existing normal-sign-in guidance.
- **Archives:** ordinary lists/search remain archive-free. A known detail link
  permits restoration with retained prior status; no archive listing is added.
  See [ADR-038](../../../docs/adr/038-private-stms-login-screens.md).

### `resetPassword`

- **Owner:** `@xpro/stms/server` supplies the action. The registered Hub POST
  function reads the signed native session and passes its live Hub access result
  and configured native hash function. T030 supplies the reusable reset control;
  T040 supplies its STMS detail-page host.
- **Authority:** use the current protected-access check and require a global
  master. Workspace owners, admins and members cannot reset passwords, including
  in their own workspace. Suspended, archived, expired or ended master sessions
  and incomplete profiles grant no protected access. Submitted authority is ignored
  as proof; unknown input fields are refused.
- **Page actor:** the control sends the original page login ID in the optional
  x-page-login-id header. After live master authorization and before writes, a
  different ID is refused with core_identity_changed. The hint grants no access
  and adds no preliminary identity request.
- **Input:** a UUID `loginId`, `newPassword` using the existing Accounts password
  rules, and an optional string `comment`. No current password or mandatory comment.
- **Result:** return only `{ loginId }`. Invalid input uses `core_invalid_input`
  with known field names; a missing target uses `stms_login_not_found`.
  HTTP replies carry a fresh request ID and `no-store`, with no new session cookie.
- **Save:** the native credential upsert, active access/refresh-token revocation,
  deletion of every target Hub session and one `stms_password_reset` audit commit
  through one `saveHub` batch. Refused writes preserve passwords, tokens, sessions
  and audit history. A missing credential is created as in native admin reset;
  existing credential IDs, creation times and other fields are preserved.
- **Native lifecycle:** use Better Auth's configured password hash. Explicitly
  revoke native provider tokens before deleting sessions, since foreign keys
  otherwise clear their session links without invoking native hooks. Preserve
  earlier revocation timestamps. All queries use existing indexes; see
  [ADR-024](../../../docs/adr/024-atomic-password-reset.md).
- **Audit:** record the actual acting master, target login, request ID and optional
  comment. No password, hash, cookie or session token in results, audits or logs.
- **Preservation:** the same rules cover another master and a master's own login.
  Resetting a suspended or archived login does not reactivate or restore it.
  Keep unrelated logins, memberships and workspace records unchanged.
- **Next sign-in:** the reset password has no temporary expiry or forced change.
  Every old session is refused by live Hub checks, including retained workspace
  cookies without a sign-out message. The new password permits normal sign-in.
- **Native paths:** public native reset and session-revocation routes remain
  disabled so they cannot bypass STMS's rules or audit.
- **Retries:** do not automatically retry an unknown result. A lost reply can
  follow a fully committed reset. A new submission is a separate audited action;
  no idempotency key is accepted.
- **Verified:** all original 44 cases plus 24 storage/HTTP cases execute against
  real authentication, hashing, D1, native tokens and workspace storage. The
  public boundary checks Origin and uses the existing bounded JSON POST gate.
  Password reset does not send back-channel messages; live Hub checks deny old
  workspace sessions on the next action.

References: [Better Auth admin password reset and revocation](https://better-auth.com/docs/plugins/admin),
[native password handling](https://better-auth.com/docs/authentication/email-password),
and [D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

### `checkUsername`

- **Internal helper:** `@xpro/accounts/server` exports the database check. The
  authenticated person's completion action or an authorized login-creation action
  calls it after its own access check. No public route is added by T014.
- **Rules:** refuse invalid format before reading storage. Query the normalized
  username index and reserved-name index in one statement. Inactive logins keep
  their names; a reservation always prevents reuse.
- **Result:** return only `{ username }` on success, or the named invalid/taken/
  reserved refusal. Do not return owner details, cache a decision or reserve a name.
- **Save:** a read is not a claim. The eventual save must still handle the existing
  uniqueness and reservation constraints, including competing requests.
- **Failures:** propagate unexpected database failures to the caller's safe error
  boundary; never translate a failed check into availability.

### `completeFirstSignIn`

- **Caller:** the Hub reads native authenticated headers and prepares the shared
  access check for this request. The Accounts action receives that prepared check,
  the real Hub database binding and the request context as server-only services.
  None of them can be supplied in the submitted body.
- **Submission:** accept optional `username`, `name`, `phone` (`country` and
  `number`) and `isUsernameConfirmed`. Revalidate decoded input in the action;
  refuse unknown fields, including login IDs, email and authority claims.
- **Missing details:** require all missing or invalid details before reporting
  completion. Preserve existing valid details. Save the phone in canonical
  international format using the selected country for national input.
- **Username:** enforce the approved format, xpro-wide uniqueness and reservations
  again at saving. A current valid username is locked; an unset or invalid initial
  username can be completed. Reserved names and suspended/archived logins' names
  remain unavailable.
- **Confirmation:** require explicit `isUsernameConfirmed: true` before first
  setting or repairing the username. The T016 screen must show the approved warning
  "Your username can't be changed later" before confirmation. Backend tests prove
  refusal without confirmation; they do not prove that screen has been displayed.
- **Results:** return only the signed-in `loginId` on success. Named username
  refusals use `accounts_username_invalid`, `accounts_username_taken`,
  `accounts_username_reserved`, `accounts_username_confirmation_required` or
  `accounts_username_locked`. Input and access failures use the shared Core results.
- **Audit:** setting or repairing the username records `accounts_username_set`
  under FR-027. Save it with the profile change in one Hub batch, using the acting
  login as actor and affected login, plus the current request ID. Store no submitted
  profile values or credentials in that entry. Name/phone-only completion adds no
  identifier-change audit.
- **Repeats:** the same completed submission returns its saved login ID without
  changing the choice or adding another audit. Concurrent requests cannot overwrite
  a saved username or give the same username to two logins.
- **Scope:** completion creates no Account, workspace, membership or credential.
  Refused saves leave existing records untouched. A failed audit also leaves the
  profile untouched and reports only the safe unexpected-error result.

### Hub sign-in screen

- **Public page data:** getSignInPage is a read-only POST Start function with
  strict empty input. It exposes only TURNSTILE_SITE_KEY, never the private
  verifier secret or identity/session records. Allow direct SSR GET /sign-in;
  browser RPC retains the existing exact-Origin JSON POST boundary.
- **Failures:** missing configuration returns one safe correlated Core error.
  Reader responses are no-store; sign-in HTML is private/no-store and varies
  by Cookie. The screen maps only known error codes to translated messages.
- **Credentials:** call native email or username methods, include the CAPTCHA
  header, and preserve the password verbatim. The native client selects only
  signed continuation fields; direct sign-in uses fixed /auth/destination.
- **Unassigned:** the existing destination reader now redirects to /no-workspace
  for the approved translated static message. It exposes no identity or access.
- **Scope:** this is the Hub half of T022. Workspace session return and the
  native browser exchange are delivered below; other feature screens and full
  hosted acceptance remain pending.

### Workspace session return

- **Page data:** getWorkspacePage is a read-only POST Start function with strict
  empty input. It returns only { loginId } from this request's already-authorized
  workspace context, with no-store and the same safe request ID. It performs no
  second Hub lookup and changes no records.
- **Transport:** both apps use Core's prepareServerFunctionRequest to check the
  exact configured Origin, JSON POST and actual 64 KiB streamed-byte limit before
  Start deserializes browser RPC. SSR uses the trusted prepared server context.
- **Page precondition:** x-page-login-id is an optional hint identifying the
  document's original login. After authenticating the actual session, a different
  value returns core_identity_changed (409) before dynamic handlers. It grants
  no authority and does not replace Hub validation or the local-user gate.
- **Fresh read:** resume/navigation checks deliberately omit that hint so they
  can compare the actual current login with the original one. All normal server
  access checks still run. Preserve Core refusal codes and references returned
  before Start serializes a handler response.
- **Return:** keep the working page mounted and blocked while a new tab uses
  /auth/start with the fixed /session-return destination. Resume only after fresh
  access confirms the same login. A different login requires an explicit reload;
  failed requests are never replayed.
- **Limits:** no browser storage or draft serialization. Reloads, closed tabs and
  cross-document navigation lose input. The guarded draft fixture proves the
  current mounted boundary; future business forms and protected client loaders
  must integrate it without replacing the draft on an access failure.

### Story 2 test boundaries

- **Native credentials:** T018's `handleHubAuthRequest(request, settings)` in
  `apps/hub/src/auth/oidc.server.ts` composes the existing Better Auth factory.
  Preserve native successful sign-in responses and cookies for its client;
  do not add another password checker or return database rows.
- **Public failures:** wrong email, username or password returns
  `accounts_credentials_invalid` and the one approved message. Only correctly
  verified credentials may reveal `accounts_login_suspended` or
  `accounts_login_archived`. A platform refusal returns
  `accounts_sign_in_limited`; missing or rejected bot verification returns
  `accounts_bot_verification_failed` with "Security check failed. Please try again."
  These errors have a static message, request ID,
  ID header and `no-store`; they issue no session.
- **Credential audit:** record `accounts_sign_in` with outcome `success` or
  `refused`. Success identifies the acting and affected login. A refusal has no
  actor; identify the affected login only after credentials were verified.
  Store only the refusal code as its reason, with no comment, credentials,
  submitted identifier or protocol token. Preserve the approved sign-in audit
  exception in the plan.
- **Public protection:** `handleHubAuthRequest` requires a Turnstile secret and
  the platform limiter. Refuse oversized bot tokens first. Count other parsed
  sign-in submissions against their trimmed, lower-case email or username before
  native CAPTCHA and credentials. Use one binding, with separate email and
  username keys. Both methods use native server-side
  verification for the configured Hub hostname and `sign-in` action.
  Provider outages/timeouts and limiter errors fail closed with the safe Core
  unexpected-error response; malformed or rejected verification cannot sign in.
  Bot/limit refusals receive the same safe refusal audit, without an affected
  login. Sign-out and other auth endpoints do not consume the sign-in limit.
- **Default destination:** T018 supplies `getSignInDestination(input, services)`
  in `packages/accounts/src/sign-in/sign-in.server.ts`. Services are the real
  Hub database, prepared access check and request context, as for completion.
  Accept only optional `requestedWorkspaceId`; identity and role come from
  the server. Refuse unfinished creation/profile and invalid or ended sessions.
- **Selection:** first honor an existing requested workspace when allowed.
  Otherwise choose STMS for a master, the current membership's workspace,
  the Hub account page for an account holder, or the unassigned-workspace
  message. A master still needs the requested workspace to exist.
- **Result:** return only `{ kind: "workspace", workspaceId }` or
  `{ kind: "stms" | "account" | "unassigned" }`, through a named result.
  The Hub leaves the local internal/external type to the workspace.
  A lookup changes no identity, account, workspace or membership.
- **Test services:** native authentication, D1, migrations, actual Durable
  Objects and the named Hub access binding remain real. Only Turnstile's
  outside HTTP response and controlled platform outcomes are stand-ins.
  A real local rate-limit binding also proves the application's refusal path;
  it does not establish an exact count across Cloudflare locations.

### `createLogin`

- **Reference:** use one saved login creation request for the original attempt and
  every retry, following [Login creation retries](../plan.md#login-creation-retries).
  The reference is not proof of permission; check current permissions each time.
- **Scope:** bind the reference to the creator, intended workspace and non-secret
  creation details. Refuse reuse with different details or an unrelated existing
  login, even if its email or username matches.
- **Incomplete:** if a later save fails, keep the reference available for a retry,
  report that setup is incomplete and keep the new login's access blocked.
- **Repeat:** finish only missing steps. A completed request returns its original
  result without resetting a password or adding duplicate records or audit entries.
- **Success:** return success only after all required records are confirmed and
  the Hub saves the creation audit entry and completion marker in one batch.
- **Tests:** cover failed saves, interruptions and concurrent retries; a lost success
  response; changed permission or request details; and unrelated duplicate emails
  or usernames. No retry may bypass access checks or take over an existing login.

- **Saved foundation:** server-only `prepareLoginCreation(database, input)`
  validates and saves the creator, intended workspace/type and canonical profile
  details. It refuses password fields, preserves matching repeats and returns
  `accounts_creation_conflict` for changed details or scope. A different creator
  returns `core_forbidden`. It does not authorize callers.
- **Initial association:** trusted server code passes the saved snapshot as
  `loginCreation` to the native auth factory. Its user-create before-hook writes
  the link in the initial insert, overriding native body data. Default setup
  strips a submitted link. `readCreatedLogin` uses only that indexed association.
  The snapshot is not permission proof; native preparation checks current authority.
- **Bookkeeping:** the native insert alone reports no completed creation.
  T026's final batch supplies the request's created-login pointer, completion
  marker and audit after confirming every required record.
- **Native checkpoint:** server-only Accounts `createLogin(input, services)`
  validates the input, authorizes the current creator, binds the saved intent
  and prepares only missing native login, credential and membership records.
  The Hub's `createLoginServices` supplies the actual session/Core access and
  native Organization permission check; Accounts does not import Better Auth.
- **Checkpoint result:** its named result contains a private saved `creation`
  and `loginId`, or a Core/input/identifier/creation conflict error. This is
  `PreparedLoginCreation`, not the public success DTO. Pending markers remain
  pending. The Hub action completes the local save and final batch
  before returning success. A matching completed reference returns its saved
  pointer after current permission and intent checks; it does not repair or
  reset later profile, password or membership changes.
- **Native recovery:** re-read only the initial creation link after competing
  inserts. Preserve existing passwords and membership roles. Missing passwords
  use Better Auth's configured hash/link helpers and the credential unique index;
  an existing unusable credential is refused. See
  [ADR-022](../../../docs/adr/022-native-login-creation-recovery.md).
- **Completion action:** Accounts `completeLoginCreation` validates the workspace
  receipt, then sends its guarded audit/completion statements through one Hub
  batch. The batch rechecks pending intent, linked active profile, actual password
  account and intended membership. A failed check leaves completion unset.
  Concurrent repeats produce one successful creation audit.
- **Local action:** Core `saveCreatedWorkspaceUser` revalidates scope and input
  inside the real workspace, uses its save transaction and inserts only a missing
  user. Matching active rows are preserved; changed kind or archived rows refuse.
- **Private transport:** the Hub looks up authoritative placement by workspace ID.
  Production dispatch passes IDs/type/context in platform `props` to
  `/_internal/workspace-users`. Public body/header claims never provide authority.
  The Worker and actual object RPC enforce fixed deployment and object identity.
  Local development uses the prepared app's private `WorkspaceUserWriter` binding.
- **Request boundary:** the current Hub server functions accept exact-origin JSON
  POST with at most 64 KiB of actual streamed bytes before native deserialization.
  The native payload is forwarded unchanged; strict decoded validation remains.
  See [ADR-023](../../../docs/adr/023-complete-creation-and-private-workspace-save.md).

### Story 6 test boundary

- **Entry:** component tests call the production Hub `handleCreateLogin` with
  input, an actual creator request/session, existing auth settings and one
  workspace-user capability. The handler delegates rules to Accounts'
  `createLogin`; fixtures never implement those rules.
- **Input:** `creationId`, email, username, name, country/phone and password.
  A login for a workspace also carries `workspaceId` and internal/external `kind`.
  Success returns only `{ creationId, loginId }`, with no new session cookie.
  The Hub creation audit uses `accounts_login_created`.
- **Workspace call:** `workspaceUsers.ensure` takes creation, workspace and login
  IDs plus kind. Its plain serialized result confirms workspace ID, login ID
  and kind, or a named error. Storage never crosses this boundary. The test
  transport invokes the actual Core `saveCreatedWorkspaceUser` in a real object.
- **Faults:** real database triggers refuse each save. A transparent D1 wrapper
  commits through the real binding before stopping that request's connection.
  A workspace transport fault loses only the reply after the actual save.
  Neither fault mechanism supplies business behavior.
- **Sessions:** successful cases use actual native HTTP sign-in and OIDC.
  Pending creation refuses credential sign-in after the storage fault is
  removed. A separate case uses genuine existing sessions to check that marking
  creation incomplete blocks both Hub and workspace protected requests.
- **Implemented:** the Hub action, native preparation/completion and real Core
  save now execute all original 87 cases, plus 11 additional creation checks.
  No dummy module or skip replaces the implementation.
- **Transport evidence:** a separate nine-check built-Worker probe exercises the
  actual native server function and private binding with real D1/DO saves and
  platform-delivered props. Hosted dispatch and browser UI remain unverified;
  the props probe uses a local service binding. Verify the hosted namespace in
  staging before release.

References: [Better Auth 1.7.12 creation writes](https://github.com/better-auth/better-auth/blob/v1.7.12/packages/better-auth/src/plugins/admin/routes.ts),
[organization permissions and server member addition](https://better-auth.com/docs/plugins/organization),
and [Cloudflare test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/).

## Workspace app: own

- `startSignIn`: sends the person to the Hub.
- `finishSignIn`: swaps the code, applies the shared access checks for this workspace,
  reads local user details where applicable, and starts the workspace session.
- `signOut`.
- `receiveHubSignOut`: the sign-out message from the Hub; ends matching sessions.
- `getCurrentUser`.

Story 2 tests call `startSignIn` and `finishSignIn` in
`apps/web/src/auth/oidc.server.ts`, then T019's `signOut` and public
`getCurrentUser`. Server-only services supply the fixed workspace ID/origin,
issuer, confidential client credentials, local cookie secret, real storage,
Hub HTTP/access bindings and request context. None comes from submitted claims.

T018 implements the protocol part as `validateSignInCallback(request, services)`.
It returns a named result containing only verified `loginId`, `hubSessionId`, the
ID token and a safe relative `returnTo` (or `null`). These prove identity, not
permission. T019 composes it into `finishSignIn` with live Hub access, local type
and the real Core session save. The original Hub session expiry remains the
upper limit; an ID token's expiry is not a substitute. Failed callback responses
and clearing the pending cookie are completed in that T019 handler.

T019 implements that composition and the shared session functions. A private,
workspace-bound cookie identifies the real local session; its encrypted ID token
is used only for native end-session. `getCurrentUser` permits identity checks
while a profile is unfinished. Protected actions prepare
`createWorkspaceAccessRequest` once and share its synchronous authorization.
Both successful and failed callbacks clear the pending sign-in cookie.

Prepared clients using Hub messages register
`backchannel_logout_uri: <workspace origin>/auth/back-channel-sign-out` and
`backchannel_logout_session_required: true`. The receiver validates the native
signature and logout claims before deleting matching local sessions. Delivery
is best effort; the next protected action always checks the live Hub. Native
delivery's Workers redirect-mode fix is recorded in ADR-018.

- **Protocol routes:** test `/auth/start`, the exactly registered
  `/auth/callback`, and POST `/auth/sign-out`, including a separate customer
  domain. Use native confidential clients with S256 and end-session support;
  the latter makes the provider include the original Hub session ID.
- **Callback:** bind fresh state, nonce and verifier to the initiating browser;
  reject missing, changed, duplicate, expired or replayed protocol data. Failed
  protocol validation returns only `core_sign_in_invalid`, a safe message and
  request ID. It creates no local session. Recheck live access before saving.
- **Landing:** internal users enter the app at `/`, external users the Portal at
  `/portal`; a safe return path survives reauthentication. Unsafe return paths
  use the workspace default. Missing membership returns to the Hub default;
  a non-master without a local type receives no automatic local user or access.
- **Current identity:** `getCurrentUser` returns the allow-listed access actor
  through a named result. A Hub cookie or identity header cannot stand in for a
  workspace session. The next action refuses an ended Hub session even when
  no sign-out message arrived. Signing out one device preserves the other.
- **Address resolution:** T021 connects these handlers to prepared addresses and
  the public workspace boundary. T022 now checks the Hub screens, unassigned
  message and mounted-tab input through the actual native browser exchange.
  Future business-form/loader integration and the remaining T041 acceptance
  journeys still need their own checks; backend return-path assertions alone
  do not prove browser restoration.

## Router

- **Directory:** STMS-owned `workspace_placements` and `workspace_addresses` in
  the existing Hub database map fixed HTTPS origins to workspace IDs and app
  names. Primary and custom addresses share one placement. Only the private
  `HubPlacement.resolvePlacement` binding supplies a cache miss; it returns
  found, missing or unavailable, without identity or credentials.
- **Fast copy:** read `origin:<origin>` from `PLACEMENTS`. Validate the result
  and its origin. Fill a missing or invalid-shaped copy from the Hub; attach
  derived cache writes to `waitUntil`. An unavailable directory or dispatch
  returns a safe error rather than choosing another tenant.
- **Forwarding:** preserve URL, method and body. Replace the request ID and
  workspace-ID hint; remove caller-supplied `x-xpro-*` and forwarded-origin
  hints. Production uses the dispatch namespace. The `local` environment uses
  the same routing function with one prepared `xpro` app.
- **Unknown address:** GET/HEAD redirects to the fixed Hub
  `/auth/destination`; writes receive an error without forwarding their body.
  Hub-address requests go to the Hub binding.
- **Workspace boundary:** configured ID/origins and the actual data-object ID
  must agree. Cookie-backed writes require the same Origin. Auth paths compose
  the existing start/callback/sign-out/signed-message handlers. Other dynamic
  requests use the local session plus one live Hub check before rendering.
  Non-masters need an active local user; a master may enter without one.
- **Request context:** the existing workspace object owns storage, prepared
  access and rendering for the request. Pass that context through the native
  Start handler so protected actions can reuse its synchronous authorization.
  It never comes from request headers or becomes a shared offline identity cache.
- **Destinations:** root or `/auth/destination` on the Hub uses native session
  reading and the existing Accounts destination rules. Send members to their
  prepared primary address, account holders to `/account`, masters to `/stms`,
  and unassigned people the approved message. Profile completion still gates
  entry. Workspace root sends external users to `/portal`.
- **Acceptance boundary:** tests use real migrations, D1, KV, objects and native
  sign-in. Only the external dispatch transport and page-render callback are
  adapted in component tests. A built-Worker probe separately verifies actual
  native HTML/stream completion. Deployed dispatch, DNS/TLS and complete browser
  screens remain release/browser checks. Workspace/domain creation is separate.
