import { err, ok, type Result } from "true-myth/result";
import type { AccessRequest } from "#access/access.ts";
import { createWorkspaceDatabase } from "#database/workspace.db.ts";
import { save } from "#save/save.db.ts";
import type { CoreError } from "#server/errors.server.ts";

export type WorkspaceSession = { id: string; loginId: string; hubSessionId: string; expiresAt: string };

export async function saveWorkspaceSession(storage: DurableObjectStorage,
  input: { session: WorkspaceSession; access: AccessRequest }): Promise<Result<"internal" | "external", CoreError>> {
  const db = createWorkspaceDatabase(storage.sql);
  try {
    return await save(storage, async () => {
      const actor = input.access.authorize({ kind: "protected", hasLocalPermission: true });
      if (actor.isErr) return err(actor.error);
      const user = await db.selectFrom("workspaceUsers").select("kind").where("loginId", "=", input.session.loginId)
        .where("archivedAt", "is", null).executeTakeFirst();
      const kind = actor.value.isMaster ? "internal" : user?.kind;
      if (!kind) return err({ code: "core_forbidden" });
      await db.insertInto("sessions").values(input.session).execute();
      return ok(kind);
    });
  } finally { await db.destroy(); }
}

export async function readWorkspaceSessionRow(storage: DurableObjectStorage, id: string): Promise<WorkspaceSession | undefined> {
  const db = createWorkspaceDatabase(storage.sql);
  try { return await db.selectFrom("sessions").selectAll().where("id", "=", id).executeTakeFirst(); }
  finally { await db.destroy(); }
}

export async function endWorkspaceSessions(storage: DurableObjectStorage,
  input: { hubSessionId: string; loginId: string | null }): Promise<void> {
  const db = createWorkspaceDatabase(storage.sql);
  try {
    await save(storage, async () => {
      let query = db.deleteFrom("sessions").where("hubSessionId", "=", input.hubSessionId);
      if (input.loginId !== null) query = query.where("loginId", "=", input.loginId);
      await query.execute();
      return ok(undefined);
    });
  } finally { await db.destroy(); }
}
