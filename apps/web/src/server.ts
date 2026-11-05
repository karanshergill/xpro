import { createErrorResponse, readForwardedRequestContext, reportUnexpectedError, requestIdHeader, secureResponse } from "@xpro/core/server";
import { readWorkspaceSettings } from "#workspace/settings.server.ts";
import { handleWorkspaceUserRequest } from "#workspace/users.server.ts";

export { Workspace } from "#workspace/workspace.db.ts";
export { WorkspaceUserWriter } from "#workspace/users.server.ts";

export default {
  async fetch(request: Request, env: WorkspaceEnv, ctx: ExecutionContext): Promise<Response> {
    return secureResponse(await handleRequest(request, env, ctx));
  },
} satisfies ExportedHandler<WorkspaceEnv>;

async function handleRequest(request: Request, env: WorkspaceEnv, ctx: ExecutionContext): Promise<Response> {
  if (new URL(request.url).pathname === "/_internal/workspace-users") {
    return await handleWorkspaceUserRequest({ request, props: ctx.props }, env);
  }
  const context = readForwardedRequestContext(request);
  try {
    const settings = readWorkspaceSettings(request, env);
    if (settings.isErr) return createErrorResponse(settings.error, context);
    const headers = new Headers(request.headers);
    headers.set(requestIdHeader, context.requestId);
    return await env.WORKSPACES.getByName(settings.value.workspaceId).fetch(new Request(request, { headers }));
  } catch { return reportUnexpectedError(context, { app: "workspace", operation: "core_workspace_fetch" }); }
}
