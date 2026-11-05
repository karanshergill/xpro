import { normalizeSearchText } from "#profile/profile.ts";
import { createHubConnection, saveHub } from "@xpro/core/server";
import type { CompiledQuery, Kysely } from "kysely";

type Profile = { id: string; name: string; phone: string; updatedAt: string };
export type ProfileTables = { user: Profile & { nameSearch: string | null } };

export async function saveProfile(database: D1Database, profile: Profile): Promise<boolean> {
  const db = await createHubConnection<ProfileTables>(database);
  try {
    const results = await saveHub(database, [updateProfileQuery(db, profile)]);
    return results[0]?.meta.changes === 1;
  } finally { await db.destroy(); }
}

export function updateProfileQuery(db: Kysely<ProfileTables>, profile: Profile): CompiledQuery {
  // Native updatedAt is camelCase; xpro's naming plugin must not rename it.
  return db.withoutPlugins().withTables<{ user: { name_search: string | null } }>().updateTable("user").set({
    name: profile.name, name_search: normalizeSearchText(profile.name), phone: profile.phone, updatedAt: profile.updatedAt,
  }).where("id", "=", profile.id).compile();
}
