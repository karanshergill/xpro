import { err, ok, type Result } from "true-myth/result";
import { safeParse, strictObject, type InferOutput, type ObjectEntries, type StrictObjectSchema } from "valibot";
import type { CoreError } from "./errors.server";

export const maxJsonBodyBytes = 64 * 1024;
type InputOutput<Entries extends ObjectEntries> = InferOutput<StrictObjectSchema<Entries, undefined>>;

export function parseInput<const Entries extends ObjectEntries>(
  input: unknown,
  entries: Entries,
): Result<InputOutput<Entries>, Extract<CoreError, { code: "core_invalid_input" }>> {
  if (Array.isArray(input)) return err({ code: "core_invalid_input", fields: [] });
  const parsed = safeParse(strictObject(entries), input, { abortEarly: false, abortPipeEarly: false });
  if (parsed.success) return ok(parsed.output);

  const fields = new Set<string>();
  for (const issue of parsed.issues) {
    const field = issue.path?.[0]?.key;
    // Schema-owned names are safe; issue messages and unknown keys can contain input.
    if (typeof field === "string" && Object.hasOwn(entries, field)) fields.add(field);
  }
  return err({ code: "core_invalid_input", fields: [...fields] });
}

export async function readJsonInput<const Entries extends ObjectEntries>(
  request: Request,
  entries: Entries,
): Promise<Result<InputOutput<Entries>, CoreError>> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return err({ code: "core_unsupported_media_type" });
  const text = await readInputText(request);
  if (text.isErr) return err(text.error);
  let input: unknown;
  try { input = JSON.parse(text.value); }
  catch { return err({ code: "core_invalid_input", fields: [] }); }
  return parseInput(input, entries);
}

export async function readFormInput<const Entries extends ObjectEntries>(request: Request,
  entries: Entries): Promise<Result<InputOutput<Entries>, CoreError>> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") return err({ code: "core_unsupported_media_type" });
  const text = await readInputText(request);
  if (text.isErr) return err(text.error);
  const parameters = new URLSearchParams(text.value);
  const seen = new Set<string>();
  for (const name of parameters.keys()) {
    if (seen.has(name)) return err({ code: "core_invalid_input", fields: Object.hasOwn(entries, name) ? [name] : [] });
    seen.add(name);
  }
  return parseInput(Object.fromEntries(parameters), entries);
}

export async function readInputText(request: Request): Promise<Result<string, CoreError>> {
  if (!request.body) return err({ code: "core_invalid_input", fields: [] });

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let readError: CoreError = { code: "core_invalid_input", fields: [] };
  let byteCount = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > maxJsonBodyBytes) {
        readError = { code: "core_request_too_large" };
        await reader.cancel();
        return err(readError);
      }
      text += decoder.decode(value, { stream: true });
    }
    return ok(text + decoder.decode());
  } catch {
    return err(readError);
  } finally {
    reader.releaseLock();
  }
}
