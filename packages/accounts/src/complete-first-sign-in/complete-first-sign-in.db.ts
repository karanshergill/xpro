import { normalizeSearchText } from "#profile/profile.ts";
import { createHubConnection, saveHub } from "@xpro/core/server";
import type { CompiledQuery, ExpressionBuilder, Kysely } from "kysely";

export type Profile = { id: string; username: string | null; name: string; phone: string | null };
type Audit = {
  id: string; action: string; outcome: string; actorLoginId: string | null; affectedLoginId: string | null;
  reason: string | null; comment: string | null; requestId: string; createdAt: string;
};
type Tables = { user: Profile & { displayUsername: string | null; updatedAt: string; nameSearch: string | null }; auditEntries: Audit };
export type ProfileSnapshot = Profile & { normalizedUsername: string | null };
export type ProfileSave = { before: Profile; after: Profile; updatedAt: string; audit?: Audit };

export async function readFirstSignInProfile(database: D1Database, loginId: string): Promise<ProfileSnapshot | undefined> {
  const db = await createHubConnection<Tables>(database);
  try {
    return await db.selectFrom("user").select(["id", "username", "name", "phone"])
      .select(({ fn }) => fn<string | null>("lower", [fn<string | null>("trim", ["username"])]).as("normalizedUsername"))
      .where("id", "=", loginId).executeTakeFirst();
  } finally { await db.destroy(); }
}

export async function saveFirstSignInProfile(database: D1Database, input: ProfileSave): Promise<boolean> {
  const db = await createHubConnection<Tables>(database);
  try {
    const results = await saveHub(database, firstSignInSaveQueries(db, input));
    return results.at(-1)?.meta.changes === 1;
  } finally { await db.destroy(); }
}

export function firstSignInSaveQueries(db: Kysely<Tables>, input: ProfileSave): CompiledQuery[] {
  const { before, after, audit, updatedAt } = input;
  // Better Auth owns these camelCase columns; the Hub's naming plugin is for xpro tables.
  const native = db.withoutPlugins().withTables<{ user: { name_search: string | null }; audit_entries: { id: string } }>();
  let update = native.updateTable("user").set({
    name: after.name, name_search: normalizeSearchText(after.name), phone: after.phone, updatedAt,
    ...(audit ? { username: after.username, displayUsername: after.username } : {}),
  }).where((eb) => profileUnchanged(eb, before));
  if (!audit) return [update.compile()];

  // The guarded insert claims this snapshot. D1 commits it and the update together,
  // or rolls both back, including when a competing login takes the username.
  const insert = db.insertInto("auditEntries")
    .columns(["id", "action", "outcome", "actorLoginId", "affectedLoginId", "reason", "comment", "requestId", "createdAt"])
    .expression(db.selectFrom("user").select((eb) => [
      eb.val(audit.id).as("id"), eb.val(audit.action).as("action"), eb.val(audit.outcome).as("outcome"),
      eb.val(audit.actorLoginId).as("actorLoginId"), eb.val(audit.affectedLoginId).as("affectedLoginId"),
      eb.val(audit.reason).as("reason"), eb.val(audit.comment).as("comment"),
      eb.val(audit.requestId).as("requestId"), eb.val(audit.createdAt).as("createdAt"),
    ]).where((eb) => profileUnchanged(eb, before))).compile();
  update = update.where((eb) => eb.exists(
    eb.selectFrom("audit_entries").select("id").where("id", "=", audit.id),
  ));
  return [insert, update.compile()];
}

function profileUnchanged(eb: ExpressionBuilder<Tables, "user">, profile: Profile) {
  return eb.and([
    eb("id", "=", profile.id),
    eb("username", profile.username === null ? "is" : "=", profile.username),
    eb("name", "=", profile.name),
    eb("phone", profile.phone === null ? "is" : "=", profile.phone),
  ]);
}
