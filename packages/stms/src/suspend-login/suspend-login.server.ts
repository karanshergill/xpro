import { parseInput, reportUnexpectedError } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { v7 as uuid } from "uuid";
import type { LoginStatusError, LoginStatusServices } from "#logins/status.ts";
import { suspendLoginEntries } from "./input";
import { saveSuspension } from "./suspend-login.db";

export async function suspendLogin(input: unknown, services: LoginStatusServices): Promise<Result<{ loginId: string }, LoginStatusError>> {
  const actor = services.access.authorize({ kind: "protected", hasLocalPermission: false });
  if (actor.isErr) return err(actor.error);
  const parsed = parseInput(input, suspendLoginEntries);
  if (parsed.isErr) return err(parsed.error);
  const submitted = parsed.value;
  if (submitted.reason === "stms_other" && !submitted.comment?.trim()) {
    return err({ code: "core_invalid_input", fields: ["comment"] });
  }
  if (submitted.loginId === actor.value.loginId) return err({ code: "stms_self_suspend_forbidden" });
  try {
    const saved = await saveSuspension(services.database, {
      loginId: submitted.loginId, reason: submitted.reason, comment: submitted.comment ?? null,
      auditId: uuid(), actorLoginId: actor.value.loginId, requestId: services.context.requestId, createdAt: new Date().toISOString(),
    });
    if (saved === "missing") return err({ code: "stms_login_not_found" });
    if (saved === "conflict") return err({ code: "stms_login_state_conflict" });
    return ok({ loginId: submitted.loginId });
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation: "stms_suspend_login" });
    return err({ code: "core_unexpected_error" });
  }
}
