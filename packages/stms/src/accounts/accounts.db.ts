import { normalizeSearchText } from "@xpro/accounts";
import { authorizeMasterAuthority, sessionAccessQuery } from "@xpro/accounts/server";
import type { SessionAccessRow } from "@xpro/accounts/server";
import { createHubConnection, parseInput, reportUnexpectedError } from "@xpro/core/server";
import type { CoreError } from "@xpro/core/server";
import { sql } from "kysely";
import type { Kysely, RawBuilder } from "kysely";
import { err, ok } from "true-myth/result";
import type { Result } from "true-myth/result";
import { getAccountEntries, listAccountsEntries, searchAccountsEntries } from "./input";
import type { AccountPageInput, AccountSearchInput } from "./input";
import type { AccountDetails, AccountPage, AccountStatus, AccountSummary } from "./accounts";
import type { ManagementServices } from "#management/operations.ts";
import { prefixRange } from "#prefix-range.ts";

export type AccountReadError = CoreError | { code: "stms_account_not_found" };
type AccountRow = {
  accountId: string; accountName: string | null; holderLoginId: string; holderName: string;
  holderUsername: string | null; holderEmail: string; accountStatus: AccountStatus;
  accountRevision: number; accountCreatedAt: string;
};
type SnapshotRow<Row extends { accountId: string }> = SessionAccessRow & (Row | { accountId: null });
type DetailRow = AccountRow & { accountUpdatedAt: string; workspaceId: string | null; workspaceName: string | null };
const accountColumns = sql`a.id as "accountId", a.name as "accountName", a.status as "accountStatus",
  a.revision as "accountRevision", a.created_at as "accountCreatedAt", h.id as "holderLoginId",
  h.name as "holderName", h.username as "holderUsername", h.email as "holderEmail"`;

export async function listAccounts(input: unknown, services: ManagementServices): Promise<Result<AccountPage, AccountReadError>> {
  if (!services.session) return err({ code: "core_unauthenticated" });
  const parsed = parseInput(input, listAccountsEntries);
  if (parsed.isErr) return err(parsed.error);
  const rows = await readAuthorizedRows({ query: listAccountsQuery(parsed.value), services, operation: "stms_list_accounts" });
  return rows.isErr ? err(rows.error) : ok(pageResult(rows.value, parsed.value));
}

export async function searchAccounts(input: unknown, services: ManagementServices): Promise<Result<AccountPage, AccountReadError>> {
  if (!services.session) return err({ code: "core_unauthenticated" });
  const parsed = parseInput(input, searchAccountsEntries);
  if (parsed.isErr) return err(parsed.error);
  const rows = await readAuthorizedRows({ query: searchAccountsQuery(parsed.value), services, operation: "stms_search_accounts" });
  return rows.isErr ? err(rows.error) : ok(pageResult(rows.value, parsed.value));
}

export async function getAccount(input: unknown, services: ManagementServices): Promise<Result<AccountDetails, AccountReadError>> {
  if (!services.session) return err({ code: "core_unauthenticated" });
  const parsed = parseInput(input, getAccountEntries);
  if (parsed.isErr) return err(parsed.error);
  const rows = await readAuthorizedRows({ query: accountDetailQuery(parsed.value.accountId), services, operation: "stms_get_account" });
  if (rows.isErr) return err(rows.error);
  const row = rows.value[0];
  if (!row) return err({ code: "stms_account_not_found" });
  return ok({ ...summary(row), updatedAt: row.accountUpdatedAt,
    workspace: row.workspaceId !== null && row.workspaceName !== null
      ? { workspaceId: row.workspaceId, name: row.workspaceName } : null });
}

export function listAccountsQuery(input: AccountPageInput): RawBuilder<AccountRow> {
  return sql<AccountRow>`select ${accountColumns} from accounts a join user h on h.id = a.owner_login_id
    order by a.created_at desc, a.id desc limit ${input.limit + 1} offset ${input.offset}`;
}

export function searchAccountsQuery(input: AccountSearchInput): RawBuilder<AccountRow> {
  const range = prefixRange(normalizeSearchText(input.query));
  const match = range.upper === null ? sql`a.name_search >= ${range.lower}`
    : sql`a.name_search >= ${range.lower} and a.name_search < ${range.upper}`;
  // Literal indexed ranges, not LIKE wildcards or an unbounded substring scan.
  return sql<AccountRow>`select ${accountColumns} from accounts a join user h on h.id = a.owner_login_id
    where ${match} order by a.created_at desc, a.id desc limit ${input.limit + 1} offset ${input.offset}`;
}

export function accountDetailQuery(accountId: string): RawBuilder<DetailRow> {
  return sql<DetailRow>`select ${accountColumns}, a.updated_at as "accountUpdatedAt",
    o.id as "workspaceId", o.name as "workspaceName"
    from accounts a join user h on h.id = a.owner_login_id
    left join workspaces w on w.account_id = a.id left join organization o on o.id = w.id
    where a.id = ${accountId}`;
}

async function readAuthorizedRows<Row extends { accountId: string }>({ query, services, operation }: { query: RawBuilder<Row>; services: ManagementServices; operation: string }): Promise<Result<Row[], CoreError>> {
  if (!services.session) return err({ code: "core_unauthenticated" });
  try {
    const db: Kysely<unknown> = (await createHubConnection<unknown>(services.database)).withoutPlugins();
    try {
      // The LEFT JOIN retains the authority row for empty/missing data. Authority
      // and page/detail rows are read in one SQLite snapshot, never separate reads.
      const rows = (await sql<SnapshotRow<Row>>`select current_access.*, account_data.*
        from (${sessionAccessQuery({ ...services.session, workspaceId: null })}) as current_access
        left join (${query}) as account_data on true
        order by account_data."accountCreatedAt" desc, account_data."accountId" desc`.execute(db)).rows;
      const authority = authorizeMasterAuthority({ session: services.session, row: rows[0], now: Date.now() });
      if (authority.isErr) return err(authority.error);
      // A null accountId identifies the outer join's empty row, not an account.
      return ok(rows.filter((row): row is SessionAccessRow & Row => row.accountId !== null));
    } finally { await db.destroy(); }
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation });
    return err({ code: "core_unexpected_error" });
  }
}

function summary(row: AccountRow): AccountSummary {
  return { accountId: row.accountId, name: row.accountName,
    holder: { loginId: row.holderLoginId, name: row.holderName, username: row.holderUsername, email: row.holderEmail },
    status: row.accountStatus, revision: row.accountRevision, createdAt: row.accountCreatedAt };
}
function pageResult(rows: AccountRow[], input: AccountPageInput): AccountPage {
  return { accounts: rows.slice(0, input.limit).map(summary), nextOffset: rows.length > input.limit ? input.offset + input.limit : null };
}
