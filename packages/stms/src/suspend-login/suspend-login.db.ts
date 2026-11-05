import { createHubConnection, saveHub } from "@xpro/core/server";
import type { CompiledQuery, Kysely } from "kysely";
import { claimLoginStatusQuery, hasLoginChangeClaim, loginStatusTargetQuery, readLoginStatusSaveResult, revokeLoginAccessQueries,
  type LoginStatusSaveResult, type LoginChangeTables } from "#logins/changes.db.ts";
import type { LoginChangeSave } from "#logins/changes.db.ts";
import type { SuspensionReason } from "./input";

type SuspensionSave = LoginChangeSave & { reason: SuspensionReason; comment: string | null };

export async function saveSuspension(database: D1Database, input: SuspensionSave): Promise<LoginStatusSaveResult> {
  const db = await createHubConnection<LoginChangeTables>(database);
  try { return readLoginStatusSaveResult(await saveHub(database, suspensionQueries(db.withoutPlugins(), input))); }
  finally { await db.destroy(); }
}

export function suspensionQueries(db: Kysely<LoginChangeTables>, input: SuspensionSave): CompiledQuery[] {
  const claimed = hasLoginChangeClaim(input.auditId);
  return [
    loginStatusTargetQuery(db, input.loginId),
    claimLoginStatusQuery(db, { ...input, action: "stms_login_suspended" }),
    db.updateTable("user").set({ banned: 1, banReason: input.reason, banExpires: null, updatedAt: input.createdAt })
      .where("id", "=", input.loginId).where(claimed).compile(),
    ...revokeLoginAccessQueries(db, input),
  ];
}
