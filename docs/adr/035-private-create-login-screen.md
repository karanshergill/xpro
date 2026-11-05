# ADR-035: Private create-login screen and explicit retry

**Status:** Accepted | **Date:** 2026-10-29

## Problem

- **Private entry:** public sign-up is disabled. Masters and permitted workspace
  users need a screen to create ordinary non-master logins for other people.
- **Unknown result:** a lost reply may follow a completed creation. Editing the
  saved intent or issuing another reference could create duplicates or imply a
  changed password replaced the credential already saved.
- **Changed login:** the browser's current cookie may belong to another person
  before the first submission, before any reference has bound its creator.

## Decision

- **Authority:** reuse the existing native creation service and its permission,
  incomplete-login, retry and final audit rules. No new save path or safety
  exception is introduced.
- **Page:** a strict empty-input reader returns only creatorLoginId and scope.
  Masters may choose unassigned/workspace creation. Tenant scope comes from
  indexed native membership and current member:create permission, and must
  identify a prepared workspace. Tenant forms never offer another workspace.
- **Choices:** a separate master-only reader returns at most 20 prepared
  workspace choices, with ID, name and primary address. Use a native select
  with Previous/Next and preserve the selection across pages. Seek by placement
  ID and use indexed organization/address lookups; real query-plan checks
  protect both the first page and cursor pages.
- **Actor:** reuse x-page-login-id as an optional precondition. Compare it
  after fresh native authentication/access and before creation writes. A
  mismatch returns core_identity_changed. The hint grants no permission and
  adds no preliminary authorization request.
- **Form:** reuse TanStack Form, existing Hub controls, translated text and
  shared credential/profile rules. Read native values at submit for silent
  autofill. Use ordinary passwords verbatim, disabled pre-hydration/busy
  controls, blur/submit validation and focused errors.
- **Retry:** retain one immutable submitted request, including its original
  password, in mounted component memory after uncertain results. Manual retry
  uses that exact reference and payload. Known input/identifier
  refusals permit correction through a deliberate new-reference submission;
  once a result was uncertain, later refusals cannot enable editing it.
- **Session:** an ended session retains the form and offers sign-in in a new
  tab. The original creator can retry. Another login must explicitly reload.
  Failed list reads report a list failure, never an uncertain creation.
- **Transport:** keep the existing exact-Origin, bounded JSON POST boundary
  and private/no-store HTML. The local Start fetch adapter retains real HTTP
  refusals returned before Start response serialization.
- **Completion:** clear the password after confirmed success, identify the
  created email/username and offer Create another login. Handover stays outside
  xpro. No Account, workspace or master is created.

## Alternatives

- **New creation/recovery service:** duplicates an already implemented service.
- **Native organization list:** represents the actor's organizations, not the
  global prepared placement directory needed by masters.
- **Raw workspace UUID or unbounded list:** invites selection mistakes or loads
  the whole shared directory. A new search widget is unnecessary for this step.
- **Automatic retry or editable uncertain intent:** can duplicate a committed
  request or misrepresent the saved credential.
- **Browser persistence:** adds credential retention and cleanup obligations
  without a requirement to recover closed/reloaded forms.
- **Pre-submit identity read alone:** leaves a race between that check and save.

## Impact

- **Scope:** T027 supplies the private create-login screen, reusing existing
  dependencies and service contracts. No schema, runtime, Vite, Worker binding
  or deployment configuration changes.
- **Limit:** closing/reloading loses the browser's pending request. The server
  keeps its existing creation intent. A shortcut comment requires creator-owned
  pending-request retrieval when recovery across those boundaries is required.
- **Checks:** real Workers/auth/storage tests protect scope, actor binding,
  safe responses and indexed paging. Browser checks exercise actual creation,
  native sign-in, workspace entry and committed-response loss. Mutation checks
  verify actor and uncertain-request guards; restored files are checked again.
- **Constitution:** identity stays in the Hub and workspace type stays local.
  ADR-010's existing creation exception is unchanged. Exact code and document
  diffs require product-owner approval before being applied to the project.

## References

- [Better Auth organization plugin, installed 1.7.12](https://github.com/better-auth/better-auth/blob/v1.7.12/docs/content/docs/plugins/organization.mdx)
- [TanStack Form validation](https://tanstack.com/form/latest/docs/framework/react/guides/validation)
- [Start raw responses](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions#raw-responses)
- [Start per-call fetch](https://tanstack.com/start/latest/docs/framework/react/guide/middleware)
- [Kysely expression/subquery builder](https://kysely.dev/docs/recipes/expressions)
