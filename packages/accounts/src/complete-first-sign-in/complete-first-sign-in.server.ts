import {
  parseInput, reportUnexpectedError, type AccessRequest, type CoreError, type RequestContext,
} from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { v7 as uuid } from "uuid";
import { checkUsername, type UsernameError } from "#check-username/check-username.db.ts";
import { getMissingProfileFields, isValidUsername, normalizePhone } from "#profile/profile.ts";
import { readFirstSignInProfile, saveFirstSignInProfile, type ProfileSnapshot } from "./complete-first-sign-in.db";
import { firstSignInEntries } from "./input";

export type FirstSignInError = CoreError | UsernameError | {
  code: "accounts_username_confirmation_required" | "accounts_username_locked";
};
type Services = { database: D1Database; access: AccessRequest; context: RequestContext };
type Completion = Result<{ loginId: string }, FirstSignInError>;

export async function completeFirstSignIn(input: unknown, services: Services): Promise<Completion> {
  const actor = services.access.authorize({ kind: "complete_profile" });
  if (actor.isErr) return err(actor.error);
  const parsed = parseInput(input, firstSignInEntries);
  if (parsed.isErr) return err(parsed.error);
  const submitted = parsed.value;
  const { loginId } = actor.value;
  try {
    const before = await readFirstSignInProfile(services.database, loginId);
    if (!before) return err({ code: "core_unauthenticated" });
    const missing = getMissingProfileFields(before);
    const omitted = missing.filter((field) => submitted[field] === undefined);
    if (omitted.length) return err({ code: "core_invalid_input", fields: omitted });
    if (submitted.username !== undefined && !isValidUsername(submitted.username)) return err({ code: "accounts_username_invalid" });
    if (!missing.includes("username") && submitted.username !== undefined && submitted.username !== before.username) {
      return err({ code: "accounts_username_locked" });
    }
    const after = {
      id: loginId,
      username: missing.includes("username") ? submitted.username ?? before.username : before.username,
      name: missing.includes("name") ? submitted.name ?? before.name : before.name,
      phone: missing.includes("phone") ? normalizePhone(submitted.phone) : before.phone,
    };
    const isNewUsername = after.username !== before.username;
    if (isNewUsername) {
      if (submitted.isUsernameConfirmed !== true) return err({ code: "accounts_username_confirmation_required" });
      const availability = await checkUsername(services.database, after.username);
      // The normalized unique index proves a legacy spelling belongs to this login.
      const isOwnLegacyUsername = availability.isErr && availability.error.code === "accounts_username_taken"
        && after.username === before.normalizedUsername;
      if (availability.isErr && !isOwnLegacyUsername) return err(availability.error);
    }
    if (!missing.length) return ok({ loginId });
    const updatedAt = new Date().toISOString();
    try {
      const isSaved = await saveFirstSignInProfile(services.database, {
        before, after, updatedAt,
        ...(isNewUsername ? { audit: {
          id: uuid(), action: "accounts_username_set", outcome: "success", actorLoginId: loginId, affectedLoginId: loginId,
          reason: null, comment: null, requestId: services.context.requestId, createdAt: updatedAt,
        } } : {}),
      });
      if (isSaved) return ok({ loginId });
    } catch (error) {
      if (!isUsernameConflict(error)) throw error;
      const availability = await checkUsername(services.database, after.username);
      if (availability.isErr) return err(availability.error);
      throw error;
    }
    return completionAfterRace(await readFirstSignInProfile(services.database, loginId), submitted.username);
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation: "accounts_complete_first_sign_in" });
    return err({ code: "core_unexpected_error" });
  }
}

function completionAfterRace(profile: ProfileSnapshot | undefined, username: string | undefined): Completion {
  if (!profile) return err({ code: "core_unauthenticated" });
  if (username !== undefined && profile.username !== username && profile.username !== null && isValidUsername(profile.username)) {
    return err({ code: "accounts_username_locked" });
  }
  const fields = getMissingProfileFields(profile);
  return fields.length ? err({ code: "core_profile_incomplete", fields }) : ok({ loginId: profile.id });
}

function isUsernameConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("user_username_normalized_unique") || error.message.includes("user_reserved_username");
}
