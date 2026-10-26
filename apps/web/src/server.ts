import handler from "@tanstack/react-start/server-entry";

export { Workspace } from "#workspace/workspace.db";

export default {
  async fetch(request: Request): Promise<Response> {
    return await handler.fetch(request);
  },
} satisfies ExportedHandler<WorkspaceEnv>;
