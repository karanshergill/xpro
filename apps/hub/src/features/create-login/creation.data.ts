import { pageLoginIdHeader } from "@xpro/core";
import { httpsOriginSchema, maxWorkspaceChoices, type WorkspaceChoicePage } from "@xpro/stms";
import { array, literal, maxLength, nullable, object, optional, pipe, safeParse, string, union, uuid } from "valibot";
import { getCreationPage } from "#functions/creation-page.functions.ts";
import { getCreationWorkspaces } from "#functions/creation-workspaces.functions.ts";
import { createLogin } from "#functions/create-login.functions.ts";
import { callHubFunction } from "#functions/call";
import type { CreationFailure, CreationPage, CreationPageData, CreationRequest, CreationReceipt } from "./creation";

const id = pipe(string(), uuid());
const workspace = object({ workspaceId: id, name: string() });
const pageSchema = object({ creatorLoginId: id, scope: union([object({ kind: literal("master") }),
  object({ kind: literal("workspace"), workspace })]) });
const choicesSchema = object({ workspaces: pipe(array(object({ workspaceId: id, name: string(), origin: httpsOriginSchema })), maxLength(maxWorkspaceChoices)),
  nextCursor: nullable(id) });
const receiptSchema = object({ creationId: id, loginId: id });
const failureSchema = object({ code: string(), requestId: optional(id), fields: optional(array(string())) });

export async function loadCreationPage(signal?: AbortSignal): Promise<CreationPage> {
  const response = await callHubFunction((fetch) => getCreationPage({ data: {}, signal, fetch }));
  if (!response.ok) return { status: "error", error: await readFailure(response) };
  const parsed = safeParse(pageSchema, await response.json());
  return parsed.success ? { status: "ready", data: parsed.output satisfies CreationPageData }
    : { status: "error", error: { code: "core_unexpected_error" } };
}

export async function loadCreationWorkspaces(input: { creatorLoginId: string; cursor: string | null; signal: AbortSignal }): Promise<
  { status: "ready"; data: WorkspaceChoicePage } | { status: "error"; error: CreationFailure }
> {
  const response = await callHubFunction((fetch) => getCreationWorkspaces({ data: input.cursor ? { cursor: input.cursor } : {},
    signal: input.signal, headers: { [pageLoginIdHeader]: input.creatorLoginId }, fetch }));
  if (!response.ok) return { status: "error", error: await readFailure(response) };
  const parsed = safeParse(choicesSchema, await response.json());
  return parsed.success ? { status: "ready", data: parsed.output } : { status: "error", error: { code: "core_unexpected_error" } };
}

export async function submitCreation(input: CreationRequest, creatorLoginId: string): Promise<
  { status: "saved"; receipt: CreationReceipt } | { status: "error"; error: CreationFailure }
> {
  const response = await callHubFunction((fetch) => createLogin({ data: input, headers: { [pageLoginIdHeader]: creatorLoginId }, fetch }));
  if (!response.ok) return { status: "error", error: await readFailure(response) };
  const parsed = safeParse(receiptSchema, await response.json());
  if (!parsed.success || parsed.output.creationId !== input.creationId) return { status: "error", error: { code: "core_unexpected_error" } };
  return { status: "saved", receipt: parsed.output };
}

async function readFailure(response: Response): Promise<CreationFailure> {
  const parsed = safeParse(failureSchema, await response.json());
  return parsed.success ? parsed.output : { code: "core_unexpected_error" };
}
