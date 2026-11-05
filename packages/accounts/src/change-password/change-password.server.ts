import { parseInput, reportUnexpectedError, type AccessRequest, type CoreError, type RequestContext } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { changePasswordEntries } from "./input";

export type ChangePasswordError = CoreError | { code: "accounts_current_password_invalid" };
export type PasswordChange = { loginId: string; headers: Headers };
export type ChangePasswordServices = {
  access: AccessRequest; context: RequestContext;
  changePassword(input: { currentPassword: string; newPassword: string; revokeOtherSessions: boolean }): Promise<Response>;
  onUnexpectedError?: () => void;
};

export async function changePassword(input: unknown, services: ChangePasswordServices): Promise<Result<PasswordChange, ChangePasswordError>> {
  const actor = services.access.authorize({ kind: "protected", hasLocalPermission: true });
  if (actor.isErr) return err(actor.error);
  const parsed = parseInput(input, changePasswordEntries);
  if (parsed.isErr) return err(parsed.error);
  try {
    // shortcut: a native D1 failure can end sessions before changing the password;
    // adopt an atomic native password API when D1 support becomes available.
    const response = await services.changePassword({ ...parsed.value, revokeOtherSessions: true });
    if (response.status === 401) return err({ code: "core_unauthenticated" });
    if (!response.ok) {
      const body: unknown = await response.json();
      const code = body !== null && typeof body === "object" && "code" in body ? body.code : undefined;
      if (response.status === 409 && code === "core_identity_changed") return err({ code });
      if (response.status === 403 && (code === "core_login_inactive" || code === "core_creation_incomplete"
        || code === "core_mfa_required" || code === "core_forbidden")) return err({ code });
      if (response.status === 400 && (code === "INVALID_PASSWORD" || code === "CREDENTIAL_ACCOUNT_NOT_FOUND")) {
        return err({ code: "accounts_current_password_invalid" });
      }
      throw new Error("Native password change failed.");
    }
    // The native JSON contains a session token; only its serialized cookies leave this action.
    await response.body?.cancel();
    const headers = new Headers();
    for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
    return ok({ loginId: actor.value.loginId, headers });
  } catch {
    if (services.onUnexpectedError) services.onUnexpectedError();
    else reportUnexpectedError(services.context, { app: "hub", operation: "accounts_change_password" });
    return err({ code: "core_unexpected_error" });
  }
}
