import { createErrorResponse, createRequestContext, parseInput, reportUnexpectedError, requestIdHeader } from "@xpro/core/server";
import type { WorkspaceRequestContext } from "#workspace/request.server.ts";

type ParsedInput = ReturnType<typeof parseInput<Record<string, never>>>;

export function validateWorkspacePage(input: unknown): ReturnType<ParsedInput["toJSON"]> {
  return parseInput(input, {}).toJSON();
}

export function handleWorkspacePage(input: ReturnType<typeof validateWorkspacePage>, workspace: WorkspaceRequestContext | undefined): Response {
  if (!workspace) return reportUnexpectedError(createRequestContext(), { app: "workspace", operation: "core_workspace_page" });
  if (input.variant === "Err") return createErrorResponse(input.error, workspace.context);
  // The entry boundary already made the live Hub/local access check for this
  // request. Do not perform another session or profile query for this DTO.
  return Response.json({ loginId: workspace.actor.loginId }, {
    headers: { "cache-control": "no-store", [requestIdHeader]: workspace.context.requestId },
  });
}
