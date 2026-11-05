import { pageLoginIdHeader } from "@xpro/core";
import { array, object, optional, pipe, safeParse, string, uuid } from "valibot";
import { resetPassword } from "#functions/reset-password.functions.ts";
import { callHubFunction } from "#functions/call";

export type ResetFailure = { code: string; requestId?: string; fields?: string[] };
const receiptSchema = object({ loginId: pipe(string(), uuid()) });
const failureSchema = object({ code: string(), requestId: optional(pipe(string(), uuid())), fields: optional(array(string())) });

export async function submitPasswordReset(input: { loginId: string; newPassword: string; comment: string }, pageLoginId: string): Promise<
  { status: "saved" } | { status: "error"; error: ResetFailure }
> {
  const { loginId, newPassword, comment } = input;
  const response = await callHubFunction((fetch) => resetPassword({ data: {
    loginId, newPassword, ...(comment.trim() ? { comment } : {}),
  }, headers: { [pageLoginIdHeader]: pageLoginId }, fetch }));
  if (!response.ok) {
    const failure = safeParse(failureSchema, await response.json());
    return { status: "error", error: failure.success ? failure.output : { code: "core_unexpected_error" } };
  }
  const receipt = safeParse(receiptSchema, await response.json());
  return receipt.success && receipt.output.loginId === loginId ? { status: "saved" }
    : { status: "error", error: { code: "core_unexpected_error" } };
}
