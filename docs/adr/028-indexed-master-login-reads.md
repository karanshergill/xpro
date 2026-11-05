# ADR-028: Indexed master login reads

**Status:** Accepted | **Date:** 2026-10-29

## Problem

- **Native reads:** Better Auth's admin list does not supply xpro's three-field
  search, archive visibility, explicit projection and safe failure contract.
- **SQLite:** built-in `lower()` folds ASCII only. D1 limits LIKE/GLOB patterns
  to 50 bytes, below the approved 200-character search input.
- **Shared storage:** a broad user-table scan would serve every workspace.

## Decision

- **Authority:** STMS list/search/detail require the current complete global
  master. The Hub uses the real native cookie and existing access checks.
- **Pages:** keep ADR-027's default 25, maximum 100, newest creation time/ID,
  offset and one extra row. List/search hide archives; known-ID detail includes
  them and the existing workspace membership.
- **Names:** store a private, nullable `user.name_search` copy using Accounts'
  `normalizeSearchText` (trim then JavaScript `toLowerCase`). Better Auth marks
  the field `input: false` and `returned: false`. Native create/update hooks
  derive it from the actual name; profile completion and own-profile saves
  update it in their existing statement/batch.
- **Matching:** normalized literal prefixes, preserving accents and punctuation.
  This is not full Unicode case folding or normalization. Context-sensitive
  lowercase, such as Greek final sigma, can differ when a prefix is lowercased
  separately. Email/username reuse the native `lower(trim(...))` indexes.
- **Ranges:** use BINARY lower-inclusive/upper-exclusive bounds. The upper bound
  increments the last possible Unicode code point, skips surrogate code points
  and carries trailing U+10FFFF; an all-maximum prefix has no upper bound.
  Refuse unpaired input surrogates. Three indexed candidate-ID queries use
  `UNION`, then fetch explicit summaries by primary key.
- **Indexes:** add `user_login_list_idx(archived_at, createdAt, id)` and
  `user_login_name_prefix_idx(name_search, id)`. Reuse the two existing normalized
  identifier indexes. Detail uses primary-key and membership indexes.
- **HTTP:** register three thin POST server functions behind the current
  exact-Origin and 64 KiB JSON boundary. Extract the unchanged authenticated
  profile-request preparation as `withHubRequest` for profile, picture and
  directory handlers. No extra Hub round trip or public native admin route.

## Upgrade and rollback

- **Forward migration:** add the nullable copy and indexes without changing a
  released migration. Fill missing copies in 25-row CASE updates, at most 100
  bound parameters per D1 statement. Canonical names/timestamps stay unchanged.
- **Restart:** each chunk commits independently; rerunning fills indexed NULL
  copies. Match the source name in each update so stale reads cannot replace a
  newly derived value. No recovery table or queue.
- **Operation:** run one Hub migrator with login creation/name writes paused.
  Check its returned error before enabling the new directory. An older writer
  does not maintain this field, so do not mix old and new name writers.
- **Rollback:** the schema is additive. If an old version writes names, pause
  those writes, set all `name_search` copies to NULL through Kysely and call
  `fillMissingLoginSearchNames` before enabling the new directory again.
  Re-running an already recorded migration alone does not rebuild stale copies.
  No remote database is upgraded by this task.

## Alternatives rejected and limits

- **SQLite NOCASE name index:** cannot supply JavaScript lowercase matching.
- **LIKE/GLOB:** the pattern-byte ceiling fails valid long search inputs.
- **FTS or a search service:** unnecessary for the initial prefix contract.
- **OR across three fields:** observed plans can select a broad active-user
  index. Separate UNION branches use the three search indexes.
- **Offset cost:** skipped rows still cost work; move to seek cursors when deep
  pages become costly. Candidate matches need sorting. Pages are not snapshots.

## Verification and sources

- **Workers:** the original 53 read cases plus 20 indexed/Unicode/name-maintenance,
  three real old-schema migration and 42 Hub HTTP cases pass. Query-plan checks
  require the list, all three search and detail indexes without a base-table scan.
  Mutations of master checks, archive filtering and the upper bound are detected.
- **Native HTTPS:** actual Start registration, cookies, Unicode search, paging,
  detail, archive visibility, refusals and unchanged canonical state are checked
  locally. Screens, real-client timing and hosted acceptance remain pending.
- **Official references:** [D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
  [SQLite optimizer](https://www.sqlite.org/optoverview.html),
  [expression indexes](https://www.sqlite.org/expridx.html),
  [Better Auth database hooks](https://better-auth.com/docs/concepts/database)
  and [Kysely migrations](https://kysely.dev/docs/migrations).
