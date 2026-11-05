import { WorkerEntrypoint } from "cloudflare:workers";
import { createErrorResponse, createRequestContext, parseInput, reportUnexpectedError, workspaceUserEntries,
  type CoreError, type RequestContext, type WorkspaceUsers } from "@xpro/core/server";
import { object, pipe, safeParse, strictObject, string, uuid } from "valibot";
import type { Workspace } from "./workspace.db";

type Environment = { WORKSPACE_ID: string; WORKSPACES: DurableObjectNamespace<Workspace> };
type Reply = Awaited<ReturnType<WorkspaceUsers["ensure"]>>;
const contextSchema = object({ requestId: pipe(string(), uuid()) });
const propsSchema = strictObject({ creation: strictObject(workspaceUserEntries), context: contextSchema });

export class WorkspaceUserWriter extends WorkerEntrypoint<Environment> {
  async ensure(input: unknown, context: unknown): Promise<Reply> {
    const parsed = safeParse(contextSchema, context);
    return await ensureWorkspaceUser(input, { env: this.env, context: parsed.success ? parsed.output : createRequestContext() });
  }
}

export async function handleWorkspaceUserRequest(input: { request: Request; props: unknown }, env: Environment): Promise<Response> {
  // ExecutionContext.props is supplied by the dispatch capability, never HTTP headers/body.
  const parsed = safeParse(propsSchema, input.props);
  if (!parsed.success || input.request.method !== "POST") return createErrorResponse({ code: "core_forbidden" }, createRequestContext());
  return Response.json(await ensureWorkspaceUser(parsed.output.creation, { env, context: parsed.output.context }),
    { headers: { "cache-control": "no-store" } });
}

async function ensureWorkspaceUser(input: unknown, services: { env: Environment; context: RequestContext }): Promise<Reply> {
  try {
    const parsed = parseInput(input, workspaceUserEntries);
    if (parsed.isErr) return { variant: "Err", error: parsed.error };
    if (parsed.value.workspaceId !== services.env.WORKSPACE_ID) return failure({ code: "core_forbidden" });
    return await services.env.WORKSPACES.getByName(parsed.value.workspaceId).ensureCreatedWorkspaceUser(parsed.value, services.context);
  } catch {
    reportUnexpectedError(services.context, { app: "workspace", operation: "accounts_ensure_workspace_user" });
    return failure({ code: "core_unexpected_error" });
  }
}

function failure(error: CoreError): Reply { return { variant: "Err", error }; }
