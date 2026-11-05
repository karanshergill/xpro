import { parseInput, reportUnexpectedError } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { v7 as uuid } from "uuid";
import type { LoginIdentifierError, LoginIdentifierServices } from "#logins/identifiers.ts";
import { changeEmailEntries } from "./input";
import { saveEmailChange } from "./change-email.db";

export async function changeEmail(input: unknown, services: LoginIdentifierServices): Promise<Result<{ loginId: string }, LoginIdentifierError>> {
  const actor = services.access.authorize({ kind: "protected", hasLocalPermission: false });
  if (actor.isErr) return err(actor.error);
  const parsed = parseInput(input, changeEmailEntries);
  if (parsed.isErr) return err(parsed.error);
  const submitted = parsed.value;
  try {
    const saved = await saveEmailChange(services.database, { loginId: submitted.loginId, email: submitted.email,
      comment: submitted.comment ?? null, auditId: uuid(), actorLoginId: actor.value.loginId,
      requestId: services.context.requestId, createdAt: new Date().toISOString() });
    if (saved === "missing") return err({ code: "stms_login_not_found" });
    if (saved === "taken") return err({ code: "accounts_email_taken" });
    if (saved === "reserved") throw new Error("Email cannot have a username reservation.");
    return ok({ loginId: submitted.loginId });
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation: "stms_change_email" });
    return err({ code: "core_unexpected_error" });
  }
}
