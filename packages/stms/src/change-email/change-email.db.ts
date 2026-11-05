import { createHubConnection, saveHub } from "@xpro/core/server";
import type { CompiledQuery, Kysely } from "kysely";
import { hasLoginChangeClaim, revokeLoginAccessQueries, type LoginChangeSave, type LoginChangeTables } from "#logins/changes.db.ts";
import { claimIdentifierChangeQuery, identifierStateQuery, readIdentifierSaveResult,
  type IdentifierSaveResult, type IdentifierState } from "#logins/identifiers.db.ts";

type EmailSave = LoginChangeSave & { email: string; comment: string | null };

export async function saveEmailChange(database: D1Database, input: EmailSave): Promise<IdentifierSaveResult> {
  const db = await createHubConnection<LoginChangeTables>(database);
  try { return readIdentifierSaveResult(await saveHub<IdentifierState>(database, emailChangeQueries(db.withoutPlugins(), input)), input.email); }
  finally { await db.destroy(); }
}

export function emailChangeQueries(db: Kysely<LoginChangeTables>, input: EmailSave): CompiledQuery[] {
  const change = { ...input, field: "email" as const, value: input.email };
  return [
    identifierStateQuery(db, change),
    claimIdentifierChangeQuery(db, change),
    // Verification of the old address does not verify the replacement address.
    db.updateTable("user").set({ email: input.email, emailVerified: 0, updatedAt: input.createdAt })
      .where("id", "=", input.loginId).where(hasLoginChangeClaim(input.auditId)).compile(),
    ...revokeLoginAccessQueries(db, input),
  ];
}
