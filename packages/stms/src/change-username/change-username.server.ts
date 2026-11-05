import { isValidUsername } from "@xpro/accounts";
import { parseInput, reportUnexpectedError } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { v7 as uuid } from "uuid";
import type { LoginIdentifierError, LoginIdentifierServices } from "#logins/identifiers.ts";
import { changeUsernameEntries } from "./input";
import { saveUsernameChange } from "./change-username.db";

export async function changeUsername(input: unknown, services: LoginIdentifierServices): Promise<Result<{ loginId: string }, LoginIdentifierError>> {
  const actor = services.access.authorize({ kind: "protected", hasLocalPermission: false });
  if (actor.isErr) return err(actor.error);
  const parsed = parseInput(input, changeUsernameEntries);
  if (parsed.isErr) return err(parsed.error);
  const submitted = parsed.value;
  if (!isValidUsername(submitted.username)) return err({ code: "accounts_username_invalid" });
  try {
    const saved = await saveUsernameChange(services.database, { loginId: submitted.loginId, username: submitted.username,
      comment: submitted.comment ?? null, auditId: uuid(), reservationId: uuid(), actorLoginId: actor.value.loginId,
      requestId: services.context.requestId, createdAt: new Date().toISOString() });
    if (saved === "missing") return err({ code: "stms_login_not_found" });
    if (saved === "reserved") return err({ code: "accounts_username_reserved" });
    if (saved === "taken") return err({ code: "accounts_username_taken" });
    return ok({ loginId: submitted.loginId });
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation: "stms_change_username" });
    return err({ code: "core_unexpected_error" });
  }
}
