import { createHubConnection, saveHub } from "@xpro/core/server";
import type { CompiledQuery, Kysely } from "kysely";
import { claimLoginStatusQuery, hasLoginChangeClaim, loginStatusTargetQuery, readLoginStatusSaveResult, revokeLoginAccessQueries,
  type LoginStatusSaveResult, type LoginChangeTables } from "#logins/changes.db.ts";
import type { LoginChangeSave } from "#logins/changes.db.ts";

export async function saveReactivation(database: D1Database, input: LoginChangeSave): Promise<LoginStatusSaveResult> {
  const db = await createHubConnection<LoginChangeTables>(database);
  try { return readLoginStatusSaveResult(await saveHub(database, reactivationQueries(db.withoutPlugins(), input))); }
  finally { await db.destroy(); }
}

export function reactivationQueries(db: Kysely<LoginChangeTables>, input: LoginChangeSave): CompiledQuery[] {
  return [
    loginStatusTargetQuery(db, input.loginId),
    claimLoginStatusQuery(db, { ...input, action: "stms_login_reactivated", reason: null, comment: null }),
    db.updateTable("user").set({ banned: 0, banReason: null, banExpires: null, updatedAt: input.createdAt })
      .where("id", "=", input.loginId).where(hasLoginChangeClaim(input.auditId)).compile(),
    ...revokeLoginAccessQueries(db, input),
  ];
}
