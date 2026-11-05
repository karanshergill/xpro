import { array, object, optional, picklist, pipe, safeParse, string, uuid } from "valibot";
import type { CompletionFailure, CompletionPage, CompletionResult } from "./complete-profile";
import { getCompletionPage } from "#functions/complete-profile-page.functions.ts";
import { completeFirstSignIn } from "#functions/complete-first-sign-in.functions.ts";

const fields = ["username", "name", "phone"] as const;
const pageSchema = object({ fields: array(picklist(fields)) });
const savedSchema = object({ loginId: pipe(string(), uuid()) });
const errorSchema = object({ code: string(), requestId: pipe(string(), uuid()), fields: optional(array(string())) });


export async function loadCompletionPage(signal?: AbortSignal): Promise<CompletionPage> {
  const response = await getCompletionPage({ data: {}, signal });
  if (!response.ok) return { status: "error", error: await readFailure(response) };
  const parsed = safeParse(pageSchema, await response.json());
  if (!parsed.success) throw new Error("The completion page returned an invalid result.");
  return { status: "ready", fields: parsed.output.fields };
}

export async function saveCompletion(input: Record<string, unknown>): Promise<CompletionResult> {
  const response = await completeFirstSignIn({ data: input });
  if (!response.ok) return { status: "error", error: await readFailure(response) };
  if (!safeParse(savedSchema, await response.json()).success) throw new Error("The completion save returned an invalid result.");
  return { status: "saved" };
}

async function readFailure(response: Response): Promise<CompletionFailure> {
  const parsed = safeParse(errorSchema, await response.json());
  return parsed.success ? parsed.output : { code: "core_unexpected_error" };
}
