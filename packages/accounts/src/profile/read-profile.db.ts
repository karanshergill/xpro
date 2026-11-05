import { createHubConnection } from "@xpro/core/server";
import type { CompiledQuery, Kysely } from "kysely";

export type OwnProfile = { loginId: string; email: string; username: string | null; name: string; phone: string | null; pictureKey: string | null };
export type OwnProfileTables = { user: { id: string; email: string; username: string | null; name: string; phone: string | null; picture_key: string | null } };

export async function readOwnProfile(database: D1Database, loginId: string): Promise<OwnProfile | null> {
  const db = await createHubConnection<OwnProfileTables>(database);
  try { return (await db.executeQuery(ownProfileQuery(db, loginId))).rows[0] ?? null; }
  finally { await db.destroy(); }
}

export function ownProfileQuery(db: Kysely<OwnProfileTables>, loginId: string): CompiledQuery<OwnProfile> {
  return db.withoutPlugins().selectFrom("user").select([
    "id as loginId", "email", "username", "name", "phone", "picture_key as pictureKey",
  ]).where("id", "=", loginId).limit(1).compile();
}
