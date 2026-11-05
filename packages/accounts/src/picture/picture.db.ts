import { createHubConnection, saveHub } from "@xpro/core/server";
import type { CompiledQuery, Kysely } from "kysely";

export type PictureTables = { user: { id: string; picture_key: string | null; updatedAt: string } };
export type PictureChange = { loginId: string; previousKey: string | null; nextKey: string | null; updatedAt: string };

export async function readPicture(database: D1Database, loginId: string): Promise<{ key: string | null } | undefined> {
  const db = await createHubConnection<PictureTables>(database);
  try {
    const result = await db.withoutPlugins().executeQuery<{ key: string | null }>(readPictureQuery(db, loginId));
    return result.rows[0];
  }
  finally { await db.destroy(); }
}

export async function changePicture(database: D1Database, input: PictureChange): Promise<boolean> {
  const db = await createHubConnection<PictureTables>(database);
  try { return (await saveHub(database, [changePictureQuery(db, input)]))[0]?.meta.changes === 1; }
  finally { await db.destroy(); }
}

export function readPictureQuery(db: Kysely<PictureTables>, loginId: string): CompiledQuery {
  return db.withoutPlugins().selectFrom("user").select("picture_key as key").where("id", "=", loginId).compile();
}

export function changePictureQuery(db: Kysely<PictureTables>, input: PictureChange): CompiledQuery {
  // Keep native updatedAt and xpro's private picture_key in their physical spelling.
  return db.withoutPlugins().updateTable("user").set({ picture_key: input.nextKey, updatedAt: input.updatedAt })
    .where("id", "=", input.loginId).where("picture_key", input.previousKey === null ? "is" : "=", input.previousKey).compile();
}
