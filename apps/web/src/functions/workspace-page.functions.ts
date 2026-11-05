import { createServerFn } from "@tanstack/react-start";
import type { WorkspaceRequestContext } from "#workspace/request.server.ts";
import { handleWorkspacePage, validateWorkspacePage } from "./workspace-page.server";

export const getWorkspacePage = createServerFn({ method: "POST" })
  .validator(validateWorkspacePage)
  .handler(async ({ data, context }) => {
    // Keep the context type local: a global registration also changes the Hub
    // contract when binding types import its entrypoint. Start's trusted server
    // context wins over submitted client context.
    const workspaceContext = context as { workspace?: WorkspaceRequestContext } | undefined;
    return handleWorkspacePage(data, workspaceContext?.workspace);
  });
