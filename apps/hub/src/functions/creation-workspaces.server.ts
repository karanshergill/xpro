import { createErrorResponse, parseInput, requestIdHeader } from "@xpro/core/server";
import { readWorkspaceChoices } from "@xpro/stms/server";
import { optional, pipe, string, uuid } from "valibot";
import { authorizeCreationActor } from "#auth/create-login.server.ts";
import { withHubRequest } from "./hub-request.server";

const entries = { cursor: optional(pipe(string(), uuid())) };
type ParsedInput = ReturnType<typeof parseInput<typeof entries>>;

export function validateCreationWorkspaces(input: unknown): ReturnType<ParsedInput["toJSON"]> {
  return parseInput(input, entries).toJSON();
}

export async function handleCreationWorkspaces(input: ReturnType<typeof validateCreationWorkspaces>, services: Parameters<typeof withHubRequest>[0]): Promise<Response> {
  return await withHubRequest(services, async ({ request, access, context, settings }) => {
    const actor = authorizeCreationActor(request, access);
    if (actor.isErr) return createErrorResponse(actor.error, context);
    if (!actor.value.isMaster) return createErrorResponse({ code: "core_forbidden" }, context);
    if (input.variant === "Err") return createErrorResponse(input.error, context);
    const page = await readWorkspaceChoices(settings.database, input.value.cursor);
    return Response.json(page, { headers: { "cache-control": "no-store", [requestIdHeader]: context.requestId } });
  });
}
