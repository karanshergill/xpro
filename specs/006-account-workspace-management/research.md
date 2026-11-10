# Research: STMS account and workspace management

- **Feature:** [006-account-workspace-management](spec.md).
- **Date:** 2026-11-07.

## Decisions

| Topic | Decision | Rationale | Alternative not chosen |
|---|---|---|---|
| Tenant authority | Hub D1 and native membership remain authoritative. | Preserves existing live access checks and avoids conflicting ownership copies. | Owner/permission mirrors in workspace storage. |
| Business changes | Guarded `saveHub` batches include audit changes. | D1 batches provide the required transaction boundary. | Sequential native role updates treated as atomic. |
| Provisioning execution | Private platform Worker with a native Workflow. | Continues after the browser closes without a custom scheduler. | Long Hub requests or browser-driven progress. |
| Client registration | Prepare encrypted credentials, then register through a dedicated authenticated Hub operation before dispatch. | Native registration requires session authority; the secret is otherwise returned only once. | Persisting browser cookies in a Workflow or regenerating credentials after a lost reply. |
| Deployment | Upload trusted prebuilt modules, assets and bindings through documented platform APIs. | Works with the existing application build and avoids runtime compilation. | Building source inside a Worker. |
| Retained development/test data | Inspect actual retained rows; map only missing required facts. | Older record shapes may lack the new fields; live data has not been inspected. | Guessing ownership, silently merging records or building a general adoption framework. |
| Access compatibility | Version the contract and fail closed on missing facts. | Older response parsing must not bypass new tenant restrictions. | Treating an incomplete response as an active workspace. |
| Artifact storage | Dedicated private R2 storage and pinned, verified manifests. | Separates release artifacts from personal files and permits stable resumption. | Arbitrary download URLs or runtime builds. |
| Operation replay | Immutable audit ID, command fingerprint and minimal recorded result. | Deduplicates committed changes without a second ledger. | A separate command-result store. |
| Unavailable navigation | Fixed Hub unavailable page and explicit return after rechecking access. | Prevents tenant restrictions becoming redirect or sign-in loops. | Generic destination redirects. |

## Evidence

- [D1 batch guarantees](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
- [Workflow execution rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/).
- [User Worker upload API](https://developers.cloudflare.com/api/resources/workers_for_platforms/subresources/dispatch/subresources/namespaces/subresources/scripts/methods/update/).
- [Static asset upload flow](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/static-assets/).
- [Native OAuth generation options](https://better-auth.com/docs/plugins/oauth-provider/reference#storage-and-generation).
- Installed Better Auth 1.7.12 interfaces and the existing Hub save/access paths.
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
- [Hostname routing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/hostname-routing/).

## Required implementation proofs

- Native credential recovery.
- Per-Worker storage and asset isolation.
- Atomic handover and live access enforcement.
- Safe handling of retained development/test records and incompatible-version refusal.

No hosted provisioning success or completed STMS implementation is claimed by this research.

Initial design research used source, installed interfaces and official documentation. The local proofs below add runtime evidence; hosted data was not inspected. Final decision records are linked from the [plan](plan.md#decision-records).

## Native credential feasibility (T001)

- **Runtime:** Better Auth and OAuth provider 1.7.12, exercised through the existing workerd harness.
- **Recovery:** discarded the native registration response after its write, retrieved the encrypted envelope, and reconstructed a fresh auth instance. The recorded client remained usable through the real workspace OAuth flow.
- **Isolation:** the ordinary auth instance retained independent generators; the unrelated client remained unchanged and usable. One client existed for the recorded ID, and native storage contained no plaintext copy of its secret.
- **Wrong key:** the encryption helper rejected decryption with a different key.
- **Checks:** `bun run test tests/t001-credential-proof.test.ts` passed one test; `bun run typecheck:tests` passed.
- **Limits:** the envelope used isolated test Durable Object storage, not the future Hub creation table. This simulated a lost reply and fresh auth instance, not a process crash, Workflow recovery or hosted deployment.
- **Warnings:** dependency sourcemap and form-body warnings appeared; no test or typecheck failed.
- **Retention:** the disposable probe was removed. No application/configuration change was retained.

## Native Workflow feasibility (T002)

- **Runtime:** local workerd through Miniflare 5.20261019.1-beta, with isolated persisted state and external Worker requests denied.
- **Deduplication:** two concurrent creations using the same instance ID produced one success and one rejection; lookup returned the original ID.
- **Recovery:** paused after the first durable side effect, disposed and recreated the runtime against the same storage, and recovered the paused instance. Resume and an event completed the Workflow.
- **Replay:** durable counters were `{first: 1, second: 0}` before and after runtime recreation, and `{first: 1, second: 1}` after completion. The first side effect was not repeated.
- **Check:** `bun exec "node .wrangler/t002-proof/host.mjs"` passed.
- **Harness corrections:** event waiting reported `running`; the probe used its durable counter and native pause confirmation instead. Host assertions compared explicit RPC fields rather than proxy objects.
- **Limits:** graceful pause/dispose/recreation, not abrupt-crash recovery, hosted reliability, provider uploads or tenant isolation.
- **Retention:** disposable source files and isolated persisted state were removed. No application/configuration change was retained.

## Read-only retained-data preflight (T004)

- **Implementation:** the [operator command](quickstart.md#retained-data-preflight) reports duplicate holders, missing labels/account links, unresolved retained ownership and missing creation records. Output is limited to IDs and issue codes, with 100 records per issue and an explicit `hasMore` flag.
- **Checks:** `bun run test apps/hub/scripts/account-workspace-preflight.test.ts` passed 11 workerd tests. `bun run test:cli tests/cli/account-workspace-preflight.spec.ts` passed 10 option-boundary tests. `bun run typecheck:tests` and `bun --filter @xpro/hub typecheck` passed.
- **Populated smoke:** a disposable workerd/D1 store reported `clear` when empty, then `needs_review` for two accounts with one holder and missing labels. Both account rows remained unchanged.
- **Local store:** `bun run preflight:account-workspaces --env local` reported `uninitialized` with missing `accounts`, `organization` and `member` tables; exit 2 was the documented result. No initialization or repair was attempted.
- **Limits:** no hosted data was read and no retained-store migration ran. Post-migration cases remain for T005–T006. T003 configuration and hosted approvals remain open.
- **Retention:** the disposable smoke source and its isolated state were removed. The preflight command and behavioral tests are retained.

## Schema and operation contract verification (T005–T007)

- **Schema:** additive, restartable account/workspace/creation storage; duplicate retained holders stop the upgrade before other changes. Canonical workspace labels, immutable allocation, completion/envelope state and restricted references are enforced without blocking native session deletion.
- **Preservation:** 29 real-workerd migration tests passed, including interrupted DDL, native identity/session and audit preservation, and post-migration preflight cases.
- **Contracts:** five real-workerd boundary tests and a public-export smoke passed. Operation IDs remain distinct from diagnostic request IDs; receipts and versioned audit details reject undeclared data.
- **Checks:** full typechecking, 71 CLI tests, 2,271 Workers tests and 234 uninstrumented browser checks passed. The final full Workers and browser runs were sequential. Repairs, removed diagnostics and the limits of attributing the earlier browser failures are recorded in the [local checkpoint](quickstart.md#local-implementation-checkpoint).
- **Limits at this checkpoint:** no retained-store migration, hosted provisioning, guarded business save or operation-status HTTP endpoint was claimed. T003, T008 onward and final acceptance remained open. Disposable smoke source/state was removed; the later checkpoints follow below.

## Guarded operations and current authority (T008)

- **Ownership:** native session/login queries, access evaluation and the pure MFA projection now live in `packages/accounts/src/access/`, exposed only by `@xpro/accounts/server`. Core retains its protected-action policy and request-local cache; the Hub retains native authentication and the public validation binding. All old implementation/test paths were removed, not aliased.
- **Trusted identity:** management services carry native login/session IDs separately from cached access. Status and replay authorize one joined native-authority/audit snapshot. Any currently authorized global master may recover the minimal receipt; the immutable original actor remains unchanged.
- **Atomic save:** one `saveHub` batch starts transaction-local FK deferral, then attempts one guarded audit INSERT before domain writes. A false authority/business predicate selects a NULL required ID; a duplicate also aborts the batch. Existing audit rows and diagnostic request IDs never authorize a second write. Exact native facts and the database execution clock fence prepared authority.
- **Recovery:** SHA-256 fingerprints cover deterministic normalized non-secret command semantics, excluding request/session identity and newly allocated result IDs. Batch errors use fresh authorized recorded-result recovery, not SQLite error-text matching or automatic retries. Missing status does not prove an in-flight write cannot later commit.
- **Referential integrity:** keep deferral enabled through final commit. A standalone on-only D1 batch rejected invalid final references and rolled back every write. The actual helper independently rolled back an invalid audit reference and an earlier business update outside Vitest, left no FK violations, and accepted the next guarded write. The explicit-off alternative retained invalid data in its disposable probe and is not used.
- **Diagnostic limit:** the deliberately invalid-FK Vitest case emitted a workerd input-gate diagnostic. Its state assertions passed, but the rollback claim is additionally grounded in the standalone actual-helper proof, not that diagnostic or a green test alone. No runtime warning was suppressed.
- **Handover boundary:** the later handover actions still need validated old/new holder/owner and membership-removal audit history. Their public receipts remain minimal; the current operation envelope alone is not that history. Those actions are not implemented by T008.
- **Checks:** 79 focused cases, 2,318 full Workers cases, 72 CLI cases, 234 browser checks and the applicable typechecks passed. The deliberate false-guard mutant failed, and the correct source was restored before final regression proof. See the [guarded-operation checkpoint](quickstart.md#guarded-operation-verification-t008) for the native smoke, source-copy repair and evidence limits.
- **Limits at this checkpoint:** no operation-status HTTP boundary, product account/workspace journey, handover or hosted provisioning was claimed. T003, T009 onward and final acceptance remained open; retained stores and remote resources were untouched. The T009 results follow below.


## Operation-status HTTP boundary (T009)

- **Boundary:** `management-operations.functions.ts` follows the existing strict JSON POST server-function pattern. Its server handler uses `withMasterRequest`, not the login-page SSR GET exception, then reads the current native authority and audit together. Only a UUID operation ID is accepted. Responses use the existing safe Core envelopes, generated request ID and `no-store`.
- **Production reachability:** a router-side import keeps this standalone module in the SSR graph. The actual production resolver registered its handler, and a disposable native-D1 smoke exercised the built Worker over HTTP. A dev-only lazy load would not establish this.
- **Behavior:** 13 native HTTP cases cover safe minimal/absent receipts, exact-Origin/POST protections, ordinary-role and stale-actor refusals, ended/expired/stale sessions, in-flight revocation, another authorized master, corrupt persisted data and one safe storage-error report. Read-only refers to business/audit state; native authentication retains its expired-session cleanup.
- **Review fixes:** direct status UUID validation now lives in the shared service too. A preparation refusal re-reads current native authority and the immutable operation before failing; the same-key concurrent commit recovers its original receipt without another prepare/write. Three native assertions failed before the fixes and passed afterward; an actual-helper/D1 smoke independently confirmed one effective write and original audit attribution.
- **Test execution:** the approved native pool cap is `min(4, availableParallelism())`; no deadline/case was relaxed. Timestamp rejection coverage retained all writes while eliminating redundant snapshots. The MFA fixture retains all ten native consumptions, separating initial arrangement from the final transition. The final unchanged root commands passed, not just the bounded diagnostic.
- **Checks:** 98 focused tests, all workspace/test-project typechecks, the local production-mode Hub build, built HTTP smoke, 2,335 full Workers tests, 72 CLI tests and 234 browser checks passed. Full suites ran sequentially. See the [HTTP checkpoint](quickstart.md#operation-status-http-verification-t009).
- **Limits at this checkpoint:** account/workspace product journeys, handover, retained-store migration and hosted provisioning were not claimed. T010–T016 was the next local increment; its results follow below. T003 approvals and hosted acceptance remain open. No dependency or source runtime/deployment configuration changed.


## Account management (T010-T016)

- **Implemented boundary:** framework-free account DTOs, strict paging/search/create/rename inputs and guarded saves; native Hub POST functions and list/create/detail screens reuse existing request, identity, design and recovery owners. Reads combine current native authority and rows in one snapshot.
- **Eligibility and preservation:** active/non-archived, creation-complete holders may lack personal profile fields but hold no other account. Account recording preserves existing membership; another-workspace eligibility is enforced at workspace creation. Rename, including suspended accounts, changes only label/search projection, revision and update time.
- **Recovery:** one original intent/key survives uncertain replies and same-actor reauthentication. Another actor cannot reuse the draft. An acknowledged save remains confirmed after refresh failure. Native audits retain the original actor and minimal receipt across replay.
- **Fixture correction:** real account saves create normal fixture records. Identity-only empty fixtures avoid deleting audit-referenced rows. Native tracing scoped reply loss to the guarded save rather than auth introspection; all behavioral cases and deadlines remain. The isolated sign-out case has no uncaught runtime error; the existing deliberately invalid-FK case independently emits the documented input-gate diagnostic.
- **Evidence:** actual D1/MFA SDK and compiled-Worker HTTP smokes, manual keyboard/layout/storage readback, focused native/browser checks and full type/build/Workers/CLI/browser regression passed. Exact results and limitations are in the [account checkpoint](quickstart.md#account-management-verification-t010-t016).
- **Limits:** this establishes local US1 acceptance, not usable workspace creation, handover, lifecycle enforcement, retained-store migration or hosted provisioning. T003 configuration approvals, T017 onward and final cross-story acceptance remain open. No dependencies or production runtime/deployment configuration changed.
