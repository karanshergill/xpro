import { normalizeSearchText } from "@xpro/accounts";
import { isLoginCreationComplete, isLoginInactive } from "@xpro/accounts/server";
import type { LoginAccessRow } from "@xpro/accounts/server";
import { sql } from "kysely";
import type { Kysely, SqlBool } from "kysely";
import { err, ok } from "true-myth/result";
import type { Result } from "true-myth/result";
import { v7 as uuid } from "uuid";
import type { ManagementChangeTables, PreparedManagementChange } from "#management/changes.db.ts";
import type { CreateAccountInput } from "./input";

type HolderRow = Pick<LoginAccessRow, "loginId" | "banned" | "archivedAt" | "loginCreationId" | "creationLoginId" | "creationCompletedAt">
  & { hasAccount: number };

export async function prepareAccountCreation(db: Kysely<ManagementChangeTables>, input: CreateAccountInput):
Promise<Result<PreparedManagementChange, { code: "stms_account_holder_unavailable" }>> {
  const eligible = holderQuery(input.holderLoginId);
  const holder = (await eligible.execute(db)).rows[0];
  if (!holder || isLoginInactive(holder) || !isLoginCreationComplete(holder) || holder.hasAccount !== 0) {
    return err({ code: "stms_account_holder_unavailable" });
  }
  const accountId = uuid(), now = new Date().toISOString();
  return ok({ receipt: { action: "stms_account_created", accountId }, audit: { affectedLoginId: input.holderLoginId },
    // Mirror the shared login policy, deliberately not profile completeness. This
    // predicate is evaluated by the audit claim inside the actual write batch.
    canApply: sql<SqlBool>`exists (select 1 from (${eligible}) as holder
      where holder.banned is not 1 and holder."archivedAt" is null
      and (holder."loginCreationId" is null or (holder."creationLoginId" = holder."loginId" and holder."creationCompletedAt" is not null))
      and holder."hasAccount" = 0)`,
    queries: [sql`insert into accounts (id, owner_login_id, name, name_search, status, revision, created_at, updated_at)
      values (${accountId}, ${input.holderLoginId}, ${input.name}, ${normalizeSearchText(input.name)}, 'stms_active', 0, ${now}, ${now})`.compile(db)] });
}

function holderQuery(loginId: string) {
  return sql<HolderRow>`select u.id as "loginId", u.banned, u.archived_at as "archivedAt",
    u.login_creation_id as "loginCreationId", c.created_login_id as "creationLoginId", c.completed_at as "creationCompletedAt",
    exists (select 1 from accounts a where a.owner_login_id = u.id) as "hasAccount"
    from user u left join login_creations c on c.id = u.login_creation_id where u.id = ${loginId}`;
}
