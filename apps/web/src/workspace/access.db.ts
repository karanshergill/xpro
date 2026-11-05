import { createWorkspaceDatabase } from "@xpro/core/server";

export async function readWorkspaceUserKind(storage: DurableObjectStorage, loginId: string): Promise<"internal" | "external" | null> {
  const db = createWorkspaceDatabase(storage.sql);
  try {
    return (await db.selectFrom("workspaceUsers").select("kind").where("loginId", "=", loginId)
      .where("archivedAt", "is", null).executeTakeFirst())?.kind ?? null;
  } finally { await db.destroy(); }
}
