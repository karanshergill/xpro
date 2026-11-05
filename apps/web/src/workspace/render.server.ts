import { paraglideMiddleware } from "#paraglide/server.js";
import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import type { WorkspaceRequestContext } from "./request.server";

type WorkspaceRegister = { server: { requestContext: { workspace: WorkspaceRequestContext } } };
const render = createStartHandler<WorkspaceRegister>(defaultStreamHandler);

export async function renderWorkspace(request: Request, workspace: WorkspaceRequestContext): Promise<Response> {
  return await paraglideMiddleware(request, () => render(request, { context: { workspace } }));
}
