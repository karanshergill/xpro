import { parseInput, reportUnexpectedError, type AccessRequest, type CoreError, type RequestContext } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { v7 as uuid } from "uuid";
import { resetPasswordEntries } from "./input";
import { hasResetLogin, savePasswordReset } from "./reset-password.db";

export type ResetPasswordError = CoreError | { code: "stms_login_not_found" };
export type ResetPasswordServices = {
  database: D1Database; access: AccessRequest; context: RequestContext;
  hashPassword(password: string): Promise<string>;
};

export async function resetPassword(input: unknown, services: ResetPasswordServices): Promise<Result<{ loginId: string }, ResetPasswordError>> {
  // Tenant permissions never grant authority over global credentials.
  const actor = services.access.authorize({ kind: "protected", hasLocalPermission: false });
  if (actor.isErr) return err(actor.error);
  const parsed = parseInput(input, resetPasswordEntries);
  if (parsed.isErr) return err(parsed.error);
  const submitted = parsed.value;
  try {
    if (!await hasResetLogin(services.database, submitted.loginId)) return err({ code: "stms_login_not_found" });
    const passwordHash = await services.hashPassword(submitted.newPassword);
    await savePasswordReset(services.database, {
      loginId: submitted.loginId, passwordHash, credentialId: uuid(), auditId: uuid(),
      actorLoginId: actor.value.loginId, comment: submitted.comment ?? null,
      requestId: services.context.requestId, createdAt: new Date().toISOString(),
    });
    return ok({ loginId: submitted.loginId });
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation: "stms_reset_password" });
    return err({ code: "core_unexpected_error" });
  }
}
