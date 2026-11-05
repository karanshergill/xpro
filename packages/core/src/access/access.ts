import type { Result } from "true-myth/result";
import type { RequestContext } from "#server/request.ts";

export type AccessSession = { loginId: string; hubSessionId: string };
export type ProfileField = "username" | "name" | "phone";
export type WorkspaceMembershipRole = "owner" | "admin" | "member";
export type AccessActor = {
  loginId: string;
  isMaster: boolean;
  membershipRole: WorkspaceMembershipRole | null;
};
export type AccessError =
  | { code: "core_unauthenticated" | "core_login_inactive" | "core_creation_incomplete" | "core_forbidden" | "core_unexpected_error"
      | "core_mfa_required" | "core_mfa_recent_verification_required" }
  | { code: "core_profile_incomplete"; fields: ProfileField[] };

export type MfaAccessState =
  | { status: "not_required" }
  | { status: "enrollment_required" }
  | { status: "sign_in_required" }
  | { status: "verified"; verifiedAt: string };

export type HubAccessInput = AccessSession & { workspaceId: string | null; context: RequestContext };
export type HubAccessResult =
  | { status: "valid"; actor: AccessActor; sessionExpiresAt: string; isCreationComplete: boolean;
      missingProfileFields: ProfileField[]; mfa: MfaAccessState }
  | { status: "invalid"; code: "core_unauthenticated" | "core_login_inactive" | "core_unexpected_error" };
export type HubAccessBinding = { validateAccess(input: HubAccessInput): Promise<HubAccessResult> };

// Server code supplies this permission fact; it must not come from request input.
export type AccessAction =
  | { kind: "complete_profile" | "check_session" | "sign_out" | "enroll_mfa" | "manage_mfa" }
  | { kind: "protected"; hasLocalPermission: boolean };
// Prepare the Hub result before entering a save; local authorization then stays synchronous.
export type AccessRequest = { readonly sessionExpiresAt: string | null; authorize(action: AccessAction): Result<AccessActor, AccessError> };
export type AccessRequestInput = {
  app: "hub" | "workspace";
  session: AccessSession | null;
  workspaceId: string | null;
  hub: HubAccessBinding;
  context: RequestContext;
};
