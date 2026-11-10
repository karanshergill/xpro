# Management Contract

- **Feature:** [STMS account and workspace management](../spec.md).

The management interfaces follow the existing JSON POST server-function pattern and STMS layout. They do not introduce a separate REST API or redesign.

| Interface | Contract |
|---|---|
| List/search accounts and workspaces | Existing paging convention: 25 by default, maximum 100; bounded search; newest first with an ID tie-breaker |
| Get account/workspace | Allowlisted details, current revisions, holder/owner, independent statuses and creation progress |
| List handover candidates | Bounded results with current eligibility; eligibility is checked again when saving |
| Create account | Eligible existing holder, nonblank name; creates or changes no workspace membership |
| Rename account/workspace | Target ID, expected revision and name; identity, placement and ownership unchanged |
| Suspend account/workspace | Target ID, expected revision, explicit confirmation, reason and optional comment |
| Reactivate account/workspace | Target ID, expected revision, reason and optional comment; change only that status |
| Request/resume creation | The [approved provisioning contract](provisioning.md) |
| Transfer account holder | Change the holder; before Ready, also change the intended initial owner |
| Transfer workspace owner | Ready only; retain the previous owner as an ordinary member |
| Transfer both | One atomic command, not two independent transfers |
| Departure handover | Transfer every responsibility the departing person holds in that tenant and remove their membership atomically |

## Common guarantees

- Every read and change requires a current active, profile-complete, MFA-verified master.
- Mutations carry a stable `operationId`, separate from the per-request diagnostic ID.
- Use the committed audit entry's ID for deduplication. Its validated details hold the command fingerprint and minimal result, not submitted names or secrets.
- A repeated committed command returns its recorded result after checking current authority. Any currently authorized global master may recover the minimal receipt; the original audit actor stays unchanged. A preparation refusal rechecks the current-authorized recorded result so an overlapping same-key commit is recovered before a business refusal. Reusing a key for different input is refused.
- A read-only operation-status lookup resolves lost replies. Not recorded yet is not proof that an in-flight request cannot commit.
- Expected revisions and current eligibility are checked in the guarded save. Conflicts make no partial changes.
- Responses expose only declared fields. Errors use existing Core/STMS envelopes; no native records, credentials or provider responses.
- No automatic retry of a failed form submission.

## Operation receipt format

- Shared mutation inputs carry a UUID `operationId`; diagnostic `requestId` is not a substitute and unknown input fields are refused. Expected revisions are nonnegative safe integers.
- Public receipts contain `action` and only the required account, workspace or creation IDs. They contain no submitted name, credentials, provider data or authority claim.
- A private audit-details envelope has `version: 1`, a 64-character lowercase hexadecimal `fingerprint`, and the validated minimal receipt as `result`.
- Status results are `{ status: "not_recorded" }` or `{ status: "recorded", result: receipt }`. The former cannot carry a fabricated result and does not prove an in-flight write cannot commit.
- The concrete action variants and allowlisted fields are defined in `packages/stms/src/management/operations.ts`. Shared guarded commits and current-authorized lookup are implemented in `changes.db.ts` and `operations.db.ts`. The T009 HTTP owner is `apps/hub/src/functions/management-operations.functions.ts` with its `.server.ts` handler: strict operation-ID-only JSON POST, existing native master/origin/page-actor protections and safe non-cacheable responses. It introduces no separate REST route.


## Implemented account interfaces (US1)

- **Owner:** `packages/stms/src/accounts/`, `create-account/` and `rename-account/`; Hub adapters in `apps/hub/src/functions/accounts.functions.ts` and `accounts.server.ts`. The Hub router imports the function module into the production SSR graph.
- **Reads:** `listAccounts({ limit?, offset? })`, `searchAccounts({ query, limit?, offset? })` and `getAccount({ accountId })`. Page defaults are 25/0, limit is at most 100, and search is a trimmed, at-most-200-character normalized literal prefix. Ordering is newest `createdAt`, then ID, descending. All reads authorize the current native master and data in one SQLite snapshot. Empty results are not load failures.
- **Page:** `{ accounts, nextOffset }`; `nextOffset` is null at the end. Each summary contains `accountId`, nullable `name`, `holder: { loginId, name, username, email }`, `status`, `revision` and `createdAt`. Holder username may be null. Status is only `stms_active` or `stms_suspended`.
- **Details:** a summary plus `updatedAt` and nullable `workspace: { workspaceId, name }`. This account increment does not expose provisioning progress, credentials or workspace addresses. Retained null account labels stay null until an explicit rename.
- **Create:** strict `{ operationId, holderLoginId, name }`, with UUIDs and a trimmed nonblank name. The holder must be active, non-archived, creation-complete under existing login policy, and hold no other account. Missing personal profile details are allowed. Existing membership is preserved and does not block account recording; another-workspace conflicts belong to workspace creation. Create starts active at revision zero with current timestamps; names may repeat. It adds no organization, member, workspace, client or global role.
- **Rename:** strict `{ operationId, accountId, expectedRevision, name }`; the revision is a nonnegative safe integer. Rename changes only the label/search projection, revision and update time, preserving holder, workspace, address and identity. Suspended accounts may be renamed; safe-integer revision overflow is refused.
- **Failures:** `stms_account_not_found` is 404; `stms_account_holder_unavailable` and `stms_operation_conflict` are 409. Concurrent eligibility changes are guarded at commit. Existing safe Core validation, authorization and unexpected-failure envelopes remain.
- **HTTP:** JSON POST with exact-origin, native master and page-actor protections. Account reads return the request ID, `no-store` and page-actor header. SSR GET admission is restricted to the actual account list/create/UUID-detail pages; it does not make public RPC a GET interface. Successful writes return only the shared minimal receipt.
- **Uncertainty:** preserve the original actor, draft, intent and operation key through same-actor sign-in in a new tab. Status reads carry the page-actor hint without requiring a status-response actor header. A missing receipt leaves the intent frozen and offers only explicit same-key retry. A confirmed receipt followed by a failed refresh stays saved and offers read-only refresh, not another write. Changed actors must reload. Fresh detail reads advance the record and form baseline together: clean names follow the server, genuine edits survive, and leave protection compares against the refreshed server name.
