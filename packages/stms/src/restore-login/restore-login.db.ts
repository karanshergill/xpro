import { createHubConnection, saveHub } from "@xpro/core/server";
import type { CompiledQuery, Kysely } from "kysely";
import { claimLoginStatusQuery, hasLoginChangeClaim, loginStatusTargetQuery, readLoginStatusSaveResult, revokeLoginAccessQueries,
  type LoginStatusSaveResult, type LoginChangeTables } from "#logins/changes.db.ts";
import type { LoginChangeSave } from "#logins/changes.db.ts";

export async function saveRestore(database: D1Database, input: LoginChangeSave): Promise<LoginStatusSaveResult> {
  const db = await createHubConnection<LoginChangeTables>(database);
  try { return readLoginStatusSaveResult(await saveHub(database, restoreQueries(db.withoutPlugins(), input))); }
  finally { await db.destroy(); }
}

export function restoreQueries(db: Kysely<LoginChangeTables>, input: LoginChangeSave): CompiledQuery[] {
  return [
    loginStatusTargetQuery(db, input.loginId),
    claimLoginStatusQuery(db, { ...input, action: "stms_login_restored", reason: null, comment: null }),
    db.updateTable("user").set({ archived_at: null, status_before_archiving: null, updatedAt: input.createdAt })
      .where("id", "=", input.loginId).where(hasLoginChangeClaim(input.auditId)).compile(),
    ...revokeLoginAccessQueries(db, input),
  ];
}
