import { DurableObject } from "cloudflare:workers";
import { createRequestContext, parseInput, reportUnexpectedError, saveCreatedWorkspaceUser, upgradeWorkspaceDatabase,
  workspaceUserEntries, type RequestContext, type WorkspaceUsers } from "@xpro/core/server";
import { object, pipe, safeParse, string, uuid } from "valibot";
import { handleWorkspaceObjectRequest } from "./object.server";
import type { WorkspaceEnvironment } from "./settings.server";

const contextSchema = object({ requestId: pipe(string(), uuid()) });

export class Workspace extends DurableObject<WorkspaceEnvironment> {
  constructor(ctx: DurableObjectState, env: WorkspaceEnvironment) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(() => upgradeWorkspaceDatabase(ctx.storage));
  }

  async fetch(request: Request): Promise<Response> {
    return await handleWorkspaceObjectRequest(request, { state: this.ctx, env: this.env, render: async (current, workspace) => {
      const { renderWorkspace } = await import("./render.server");
      return await renderWorkspace(current, workspace);
    } });
  }

  async ensureCreatedWorkspaceUser(input: unknown, context: unknown): Promise<Awaited<ReturnType<WorkspaceUsers["ensure"]>>> {
    const parsedContext = safeParse(contextSchema, context);
    const requestContext: RequestContext = parsedContext.success ? parsedContext.output : createRequestContext();
    try {
      const parsed = parseInput(input, workspaceUserEntries);
      if (parsed.isErr) return parsed.toJSON();
      if (parsed.value.workspaceId !== this.env.WORKSPACE_ID
        || !this.ctx.id.equals(this.env.WORKSPACES.idFromName(parsed.value.workspaceId))) {
        return { variant: "Err", error: { code: "core_forbidden" } };
      }
      return (await saveCreatedWorkspaceUser(parsed.value, { storage: this.ctx.storage, workspaceId: parsed.value.workspaceId })).toJSON();
    } catch {
      reportUnexpectedError(requestContext, { app: "workspace", operation: "accounts_save_workspace_user" });
      return { variant: "Err", error: { code: "core_unexpected_error" } };
    }
  }
}
