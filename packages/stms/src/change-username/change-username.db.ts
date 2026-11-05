import { createHubConnection, saveHub } from "@xpro/core/server";
import type { CompiledQuery, Kysely } from "kysely";
import { hasLoginChangeClaim, revokeLoginAccessQueries, type LoginChangeSave, type LoginChangeTables } from "#logins/changes.db.ts";
import { claimIdentifierChangeQuery, identifierStateQuery, normalizedIdentifier, readIdentifierSaveResult,
  type IdentifierSaveResult, type IdentifierState } from "#logins/identifiers.db.ts";

type UsernameSave = LoginChangeSave & { username: string; reservationId: string; comment: string | null };

export async function saveUsernameChange(database: D1Database, input: UsernameSave): Promise<IdentifierSaveResult> {
  const db = await createHubConnection<LoginChangeTables>(database);
  try { return readIdentifierSaveResult(await saveHub<IdentifierState>(database, usernameChangeQueries(db.withoutPlugins(), input)), input.username); }
  finally { await db.destroy(); }
}

export function usernameChangeQueries(db: Kysely<LoginChangeTables>, input: UsernameSave): CompiledQuery[] {
  const change = { ...input, field: "username" as const, value: input.username }, claimed = hasLoginChangeClaim(input.auditId);
  return [
    identifierStateQuery(db, change),
    claimIdentifierChangeQuery(db, change),
    // Reserve the actual displaced value before updating it. Incomplete logins
    // have no old username; an existing reservation keeps its original history.
    db.insertInto("reserved_usernames").columns(["id", "username", "added_at"]).expression(
      db.selectFrom("user").select((eb) => [
        eb.val(input.reservationId).as("id"), eb.fn.coalesce(normalizedIdentifier(eb, "username"), eb.val("")).as("username"),
        eb.val(input.createdAt).as("added_at"),
      ]).where("id", "=", input.loginId).where((eb) => eb(normalizedIdentifier(eb, "username"), "!=", "")).where(claimed),
    ).onConflict((conflict) => conflict.column("username").doNothing()).compile(),
    db.updateTable("user").set({ username: input.username, displayUsername: input.username, updatedAt: input.createdAt })
      .where("id", "=", input.loginId).where(claimed).compile(),
    ...revokeLoginAccessQueries(db, input),
  ];
}
