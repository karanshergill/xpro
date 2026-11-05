import { err, ok, type Result } from "true-myth/result";
import { parseUtcTimestamp } from "#dates/dates.ts";
import type { AccessAction, AccessActor, AccessError, HubAccessResult, MfaAccessState } from "./access";

const recentMfaMilliseconds = 300_000;

export function authorizeAccess(input: {
  result: HubAccessResult; workspaceId: string | null; action: AccessAction; now: number;
}): Result<AccessActor, AccessError> {
  const { result, workspaceId, action, now } = input;
  if (result.status === "invalid") return err({ code: result.code });
  if (!isMfaStateValid({ isMaster: result.actor.isMaster, mfa: result.mfa, now })) return err({ code: "core_unauthenticated" });
  const actor = { ...result.actor };
  if (action.kind === "check_session" || action.kind === "sign_out") return ok(actor);
  if (!result.isCreationComplete) return err({ code: "core_creation_incomplete" });
  switch (action.kind) {
    case "enroll_mfa":
      return actor.isMaster && result.mfa.status === "enrollment_required" ? ok(actor) : err({ code: "core_forbidden" });
    case "manage_mfa": {
      if (!actor.isMaster) return err({ code: "core_forbidden" });
      if (result.mfa.status !== "verified") return err({ code: "core_mfa_required" });
      return isMfaRecent(result.mfa, now)
        ? ok(actor) : err({ code: "core_mfa_recent_verification_required" });
    }
    case "complete_profile":
      return actor.isMaster && result.mfa.status !== "verified" ? err({ code: "core_mfa_required" }) : ok(actor);
    case "protected":
      if (actor.isMaster && result.mfa.status !== "verified") return err({ code: "core_mfa_required" });
      if (result.missingProfileFields.length) return err({ code: "core_profile_incomplete", fields: [...result.missingProfileFields] });
      if (!actor.isMaster && ((workspaceId !== null && actor.membershipRole === null) || !action.hasLocalPermission)) {
        return err({ code: "core_forbidden" });
      }
      return ok(actor);
    default: {
      const unhandled: never = action.kind;
      throw new Error("Unsupported access action.", { cause: unhandled });
    }
  }
}

export function isMfaStateValid(input: { isMaster: boolean; mfa: MfaAccessState; now: number }): boolean {
  if (!input.isMaster) return input.mfa.status === "not_required";
  if (input.mfa.status === "not_required") return false;
  if (input.mfa.status !== "verified") return true;
  const verifiedAt = parseUtcTimestamp(input.mfa.verifiedAt);
  return verifiedAt !== null && verifiedAt <= input.now;
}

export function isMfaRecent(mfa: MfaAccessState, now: number): boolean {
  if (mfa.status !== "verified") return false;
  const verifiedAt = parseUtcTimestamp(mfa.verifiedAt);
  return verifiedAt !== null && now - verifiedAt >= 0 && now - verifiedAt <= recentMfaMilliseconds;
}
