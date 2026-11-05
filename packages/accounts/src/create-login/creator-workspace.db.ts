import { createHubConnection } from "@xpro/core/server";
import type { CompiledQuery, Kysely } from "kysely";

type Tables = { member: { userId: string; organizationId: string }; organization: { id: string; name: string } };
export type CreatorWorkspace = { workspaceId: string; name: string };

export async function readCreatorWorkspace(database: D1Database, loginId: string): Promise<CreatorWorkspace | null> {
  const db = await createHubConnection<Tables>(database);
  try { return (await db.withoutPlugins().executeQuery(creatorWorkspaceQuery(db, loginId))).rows[0] ?? null; }
  finally { await db.destroy(); }
}

export function creatorWorkspaceQuery(db: Kysely<Tables>, loginId: string): CompiledQuery<CreatorWorkspace> {
  // One workspace per login is already enforced by the native membership index.
  return db.withoutPlugins().selectFrom("member").innerJoin("organization", "organization.id", "member.organizationId")
    .select(["member.organizationId as workspaceId", "organization.name"])
    .where("member.userId", "=", loginId).limit(1).compile();
}
