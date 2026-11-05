import { parseInput, reportUnexpectedError, type AccessRequest, type CoreError, type RequestContext } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { normalizePhone } from "#profile/profile.ts";
import { updateProfileEntries } from "./input";
import { saveProfile } from "./update-profile.db";

export type UpdateProfileServices = { database: D1Database; access: AccessRequest; context: RequestContext };

export async function updateProfile(input: unknown, services: UpdateProfileServices): Promise<Result<{ loginId: string }, CoreError>> {
  const actor = services.access.authorize({ kind: "protected", hasLocalPermission: true });
  if (actor.isErr) return err(actor.error);
  const parsed = parseInput(input, updateProfileEntries);
  if (parsed.isErr) return err(parsed.error);
  const phone = normalizePhone(parsed.value.phone);
  if (phone === null) return err({ code: "core_invalid_input", fields: ["phone"] });
  try {
    const loginId = actor.value.loginId;
    const isSaved = await saveProfile(services.database, {
      id: loginId, name: parsed.value.name, phone, updatedAt: new Date().toISOString(),
    });
    return isSaved ? ok({ loginId }) : err({ code: "core_unauthenticated" });
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation: "accounts_update_profile" });
    return err({ code: "core_unexpected_error" });
  }
}
