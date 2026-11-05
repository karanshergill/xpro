import { m } from "#paraglide/messages.js";

export type MfaFailure = { code: string; requestId?: string };
export type MfaManagement = "unavailable" | "ready" | "recent_required";
export type MfaStep = "setup" | "pending" | "verify" | "complete";
export type MfaPage = { status: "ready"; loginId: string; step: MfaStep; setupId: string | null; management: MfaManagement } | { status: "error"; error: MfaFailure };
export type SetupMaterial = { setupId: string; totpUri: string; key: string; account: string; digits: number; period: number; backupCodes: string[] };
export type MfaResult = { status: "setup"; material: SetupMaterial } | { status: "verified"; destination?: string } | { status: "error"; error: MfaFailure };
export type BackupsResult = { status: "backups"; backupCodes: string[] } | { status: "error"; error: MfaFailure };
export type CredentialKind = "password" | "totp" | "backup";

export function readSetup(input: { setupId: string; totpURI: string; backupCodes: string[] }): SetupMaterial | null {
  try {
    const uri = new URL(input.totpURI), key = uri.searchParams.get("secret"), digits = Number(uri.searchParams.get("digits")), period = Number(uri.searchParams.get("period"));
    if (uri.protocol !== "otpauth:" || uri.hostname !== "totp" || !key || !/^[A-Z2-7]+$/.test(key) || digits !== 6 || period !== 30) return null;
    const account = decodeURIComponent(uri.pathname.slice(1));
    if (!input.setupId || !account || !input.backupCodes.length || input.backupCodes.some((code) => !code)) return null;
    return { setupId: input.setupId, totpUri: input.totpURI, key, account, digits, period, backupCodes: input.backupCodes };
  } catch { return null; }
}

export function validateCredential(value: string, kind: CredentialKind): string | undefined {
  if (kind === "password") return value ? undefined : m.accounts_profile_current_required();
  if (kind === "totp") return /^\d{6}$/.test(value) ? undefined : m.accounts_mfa_code_format();
  return value.trim() ? undefined : m.accounts_mfa_backup_required();
}

export function isMfaAccessFailure(error: MfaFailure): boolean {
  return ["core_unauthenticated", "core_identity_changed", "core_login_inactive", "core_creation_incomplete", "core_forbidden", "core_mfa_required", "accounts_mfa_setup_changed"].includes(error.code);
}

export function getMfaMessage(error: MfaFailure): string {
  switch (error.code) {
    case "core_mfa_recent_verification_required": return m.accounts_mfa_recent_required();
    case "accounts_current_password_invalid": return m.accounts_profile_current_invalid();
    case "accounts_mfa_invalid_code": return m.accounts_mfa_code_invalid();
    case "accounts_mfa_limited": return m.accounts_mfa_limited();
    case "accounts_mfa_unavailable": return m.accounts_mfa_unavailable();
    case "accounts_mfa_setup_pending": return m.accounts_mfa_already_pending();
    case "core_unauthenticated": return m.accounts_mfa_expired();
    case "accounts_mfa_setup_changed": return m.accounts_mfa_setup_changed();
    case "core_identity_changed": return m.accounts_mfa_identity_changed();
    case "core_sign_in_invalid": return m.accounts_complete_profile_continuation_invalid();
    case "core_login_inactive": return m.core_login_inactive();
    case "core_creation_incomplete": return m.core_creation_incomplete();
    case "core_forbidden":
    case "core_mfa_required": return m.accounts_mfa_access_lost();
    default: return m.accounts_mfa_uncertain();
  }
}

export function readReplacementIntent(search: string): boolean {
  const query = new URLSearchParams(search);
  return query.getAll("intent").length === 1 && query.get("intent") === "replace";
}
