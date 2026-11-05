import { createErrorResponse, readForwardedRequestContext, reportUnexpectedError } from "@xpro/core/server";
import { handleWorkspaceRequest, type WorkspaceRequestServices } from "./request.server";
import { readWorkspaceSettings, type WorkspaceEnvironment } from "./settings.server";

export async function handleWorkspaceObjectRequest(request: Request, services: {
  state: DurableObjectState; env: WorkspaceEnvironment; render: WorkspaceRequestServices["render"];
}): Promise<Response> {
  const context = readForwardedRequestContext(request);
  try {
    const settings = readWorkspaceSettings(request, services.env);
    if (settings.isErr) return createErrorResponse(settings.error, context);
    if (!services.state.id.equals(services.env.WORKSPACES.idFromName(settings.value.workspaceId))) {
      return createErrorResponse({ code: "core_forbidden" }, context);
    }
    return await handleWorkspaceRequest(request, { ...settings.value, storage: services.state.storage, context,
      hubAccess: services.env.HUB_ACCESS, render: services.render });
  } catch { return reportUnexpectedError(context, { app: "workspace", operation: "core_workspace_object_request" }); }
}
