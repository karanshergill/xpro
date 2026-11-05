import { workspaceUserResultSchema, type RequestContext, type WorkspaceUserInput, type WorkspaceUsers } from "@xpro/core/server";
import { readWorkspacePlacement } from "@xpro/stms/server";
import { safeParse } from "valibot";

type Dispatch = { get(workerName: string, args: { props: { creation: WorkspaceUserInput; context: RequestContext } }): {
  fetch(request: Request): Promise<Response>;
} };

export function createWorkspaceUsers(input: { database: D1Database; DISPATCHER?: Dispatch; WORKSPACE_USERS?: unknown }): WorkspaceUsers {
  if ((input.DISPATCHER === undefined) === (input.WORKSPACE_USERS === undefined)) {
    throw new Error("Exactly one workspace creation transport is required.");
  }
  const local = input.WORKSPACE_USERS;
  // Wrangler cannot infer an RPC interface from a separately running local app.
  if (local !== undefined && !hasWorkspaceUserMethod(local)) throw new Error("The local workspace creation binding is invalid.");
  return { async ensure(creation, context) {
    const placement = await readWorkspacePlacement(input.database, creation.workspaceId);
    if (!placement) throw new Error("The workspace app is not prepared.");
    if (local) {
      // shortcut: local development has one prepared app. Verify a staging dispatch
      // namespace before releasing creation across deployed workspace Workers.
      if (placement.workerName !== "xpro") throw new Error("The local workspace app is not configured.");
      return await local.ensure(creation, context);
    }
    if (!input.DISPATCHER) throw new Error("The workspace dispatch binding is missing.");
    const worker = input.DISPATCHER.get(placement.workerName, { props: { creation, context } });
    const response = await worker.fetch(new Request(placement.origin + "/_internal/workspace-users", { method: "POST" }));
    if (!response.ok) throw new Error("The workspace creation call failed.");
    const result = safeParse(workspaceUserResultSchema, await response.json());
    if (!result.success) throw new Error("The workspace returned an invalid creation result.");
    return result.output;
  } };
}

function hasWorkspaceUserMethod(value: unknown): value is WorkspaceUsers {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "ensure") === "function";
}
