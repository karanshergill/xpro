import { err, ok, type Result } from "true-myth/result";
import { array, literal, picklist, pipe, strictObject, string, union, uuid as uuidSchema } from "valibot";
import { v7 as uuid } from "uuid";
import { createWorkspaceDatabase } from "#database/workspace.db.ts";
import { save } from "#save/save.db.ts";
import { parseInput } from "#server/input.server.ts";
import type { CoreError } from "#server/errors.server.ts";
import type { RequestContext } from "#server/request.ts";

export type WorkspaceUserInput = { creationId: string; workspaceId: string; loginId: string; kind: "internal" | "external" };
export type WorkspaceUserReceipt = Omit<WorkspaceUserInput, "creationId">;
export type WorkspaceUsers = { ensure(input: WorkspaceUserInput, context: RequestContext): Promise<ReturnType<Result<WorkspaceUserReceipt, CoreError>["toJSON"]>> };
const idSchema = pipe(string(), uuidSchema());
export const workspaceUserEntries = { creationId: idSchema, workspaceId: idSchema, loginId: idSchema, kind: picklist(["internal", "external"]) };
export const workspaceUserResultSchema = union([
  strictObject({ variant: literal("Ok"), value: strictObject({ workspaceId: idSchema, loginId: idSchema, kind: picklist(["internal", "external"]) }) }),
  strictObject({ variant: literal("Err"), error: union([
    strictObject({ code: picklist(["core_forbidden", "core_creation_incomplete", "core_unexpected_error"]) }),
    strictObject({ code: literal("core_invalid_input"), fields: array(picklist(["creationId", "workspaceId", "loginId", "kind"])) }),
  ]) }),
]);

// Only a trusted Hub creation capability calls this save; the reference is not authorization.
export async function saveCreatedWorkspaceUser(input: unknown, services: { storage: DurableObjectStorage; workspaceId: string }): Promise<Result<WorkspaceUserReceipt, CoreError>> {
  const parsed = parseInput(input, workspaceUserEntries);
  if (parsed.isErr) return err(parsed.error);
  const submitted = parsed.value;
  if (submitted.workspaceId !== services.workspaceId) return err({ code: "core_forbidden" });
  const db = createWorkspaceDatabase(services.storage.sql);
  try {
    return await save(services.storage, async () => {
      const saved = await db.selectFrom("workspaceUsers").select(["loginId", "kind", "archivedAt"])
        .where("loginId", "=", submitted.loginId).executeTakeFirst();
      if (saved && (saved.kind !== submitted.kind || saved.archivedAt !== null)) return err({ code: "core_creation_incomplete" });
      if (!saved) await db.insertInto("workspaceUsers").values({ id: uuid(), loginId: submitted.loginId, kind: submitted.kind,
        createdAt: new Date().toISOString(), archivedAt: null }).execute();
      return ok({ workspaceId: services.workspaceId, loginId: submitted.loginId, kind: submitted.kind });
    });
  } finally { await db.destroy(); }
}
