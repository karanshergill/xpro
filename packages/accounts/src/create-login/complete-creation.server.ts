import { reportUnexpectedError, workspaceUserResultSchema, type CoreError, type RequestContext, type WorkspaceUsers } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { safeParse } from "valibot";
import type { PreparedLoginCreation } from "./create-login.server";
import { saveCompletedCreation } from "./complete-creation.db";

export async function completeLoginCreation(input: PreparedLoginCreation, services: {
  database: D1Database; workspaceUsers: WorkspaceUsers; context: RequestContext;
}): Promise<Result<{ creationId: string; loginId: string }, CoreError>> {
  const { creation, loginId } = input;
  const completed = { creationId: creation.id, loginId };
  if (creation.completedAt !== null) return ok(completed);
  try {
    if (creation.workspaceId !== null) {
      const reply = safeParse(workspaceUserResultSchema, await services.workspaceUsers.ensure({ creationId: creation.id,
        workspaceId: creation.workspaceId, loginId, kind: creation.kind }, services.context));
      if (!reply.success) throw new Error("The workspace returned an invalid creation result.");
      if (reply.output.variant === "Err") return err(reply.output.error);
      if (reply.output.value.workspaceId !== creation.workspaceId
        || reply.output.value.loginId !== loginId || reply.output.value.kind !== creation.kind) return err({ code: "core_creation_incomplete" });
    }
    return await saveCompletedCreation(services.database, { ...input, context: services.context })
      ? ok(completed) : err({ code: "core_creation_incomplete" });
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation: "accounts_complete_login_creation" });
    return err({ code: "core_unexpected_error" });
  }
}
