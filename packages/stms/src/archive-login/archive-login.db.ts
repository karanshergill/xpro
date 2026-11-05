import { createHubConnection, saveHub } from "@xpro/core/server";
import type { CompiledQuery, Kysely } from "kysely";
import { claimLoginStatusQuery, hasLoginChangeClaim, loginStatusTargetQuery, readLoginStatusSaveResult, revokeLoginAccessQueries,
  type LoginStatusSaveResult, type LoginChangeTables } from "#logins/changes.db.ts";
import type { LoginChangeSave } from "#logins/changes.db.ts";

type ArchiveSave = LoginChangeSave & { comment: string | null };

export async function saveArchive(database: D1Database, input: ArchiveSave): Promise<LoginStatusSaveResult> {
  const db = await createHubConnection<LoginChangeTables>(database);
  try { return readLoginStatusSaveResult(await saveHub(database, archiveQueries(db.withoutPlugins(), input))); }
  finally { await db.destroy(); }
}

export function archiveQueries(db: Kysely<LoginChangeTables>, input: ArchiveSave): CompiledQuery[] {
  return [
    loginStatusTargetQuery(db, input.loginId),
    claimLoginStatusQuery(db, { ...input, action: "stms_login_archived", reason: null }),
    // Derive the previous status from the row inside the batch, never a stale read.
    db.updateTable("user").set((eb) => ({
      archived_at: input.createdAt, updatedAt: input.createdAt,
      status_before_archiving: eb.case().when("banned", "=", 1).then("suspended").else("active").end(),
    })).where("id", "=", input.loginId).where(hasLoginChangeClaim(input.auditId)).compile(),
    ...revokeLoginAccessQueries(db, input),
  ];
}
