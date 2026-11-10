import { normalizeSearchText } from "@xpro/accounts";
import { sql } from "kysely";
import type { Kysely, SqlBool } from "kysely";
import { err, ok } from "true-myth/result";
import type { Result } from "true-myth/result";
import type { ManagementChangeTables, PreparedManagementChange } from "#management/changes.db.ts";
import type { RenameAccountInput } from "./input";

export async function prepareAccountRename(db: Kysely<ManagementChangeTables>, input: RenameAccountInput):
Promise<Result<PreparedManagementChange, { code: "stms_account_not_found" } | { code: "stms_operation_conflict" }>> {
  const account = (await sql<{ revision: number }>`select revision from accounts where id = ${input.accountId}`.execute(db)).rows[0];
  if (!account) return err({ code: "stms_account_not_found" });
  if (account.revision !== input.expectedRevision || account.revision >= Number.MAX_SAFE_INTEGER) return err({ code: "stms_operation_conflict" });
  return ok({ receipt: { action: "stms_account_renamed", accountId: input.accountId },
    canApply: sql<SqlBool>`exists (select 1 from accounts where id = ${input.accountId}
      and revision = ${input.expectedRevision} and revision < ${Number.MAX_SAFE_INTEGER})`,
    queries: [sql`update accounts set name = ${input.name}, name_search = ${normalizeSearchText(input.name)},
      revision = revision + 1, updated_at = ${new Date().toISOString()} where id = ${input.accountId}`.compile(db)] });
}
