import { parseInput, reportUnexpectedError } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { v7 as uuid } from "uuid";
import type { LoginStatusError, LoginStatusServices } from "#logins/status.ts";
import { archiveLoginEntries } from "./input";
import { saveArchive } from "./archive-login.db";

export async function archiveLogin(input: unknown, services: LoginStatusServices): Promise<Result<{ loginId: string }, LoginStatusError>> {
  const actor = services.access.authorize({ kind: "protected", hasLocalPermission: false });
  if (actor.isErr) return err(actor.error);
  const parsed = parseInput(input, archiveLoginEntries);
  if (parsed.isErr) return err(parsed.error);
  const submitted = parsed.value;
  if (submitted.loginId === actor.value.loginId) return err({ code: "stms_self_archive_forbidden" });
  try {
    const saved = await saveArchive(services.database, {
      loginId: submitted.loginId, comment: submitted.comment ?? null, auditId: uuid(),
      actorLoginId: actor.value.loginId, requestId: services.context.requestId, createdAt: new Date().toISOString(),
    });
    if (saved === "missing") return err({ code: "stms_login_not_found" });
    if (saved === "conflict") return err({ code: "stms_login_state_conflict" });
    return ok({ loginId: submitted.loginId });
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation: "stms_archive_login" });
    return err({ code: "core_unexpected_error" });
  }
}
