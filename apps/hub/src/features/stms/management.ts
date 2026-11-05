import { is, safeParse } from "valibot";
import { defaultStringifySearch } from "@tanstack/react-router";
import { emailSchema, isValidUsername } from "@xpro/accounts";
import { defaultLoginPageSize, type LoginSummary, type SuspensionReason } from "@xpro/stms";
import { m } from "#paraglide/messages.js";

export type ManagementFailure = { code: string; requestId?: string; fields?: string[] };
export type ManagementPage<T> = { status: "ready"; pageLoginId: string; value: T } | { status: "error"; error: ManagementFailure };
export type SaveResult = { status: "saved" } | { status: "error"; error: ManagementFailure };
export type LoginSearch = { query: string; offset: number };
export const defaultLoginSearch: LoginSearch = { query: "", offset: 0 };
export type StatusAction = "suspend" | "reactivate" | "archive" | "restore";
export type IdentifierField = "email" | "username";

export function readLoginSearch(search: Record<string, unknown>): LoginSearch {
  const query = ["string", "number", "boolean"].includes(typeof search.query) ? String(search.query).trim() : "";
  const offset = typeof search.offset === "number" || typeof search.offset === "string" ? Number(search.offset) : 0;
  return { query, offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : 0 };
}

export function getListHref(search: LoginSearch): string {
  return "/stms/logins" + defaultStringifySearch({ ...(search.query ? { query: search.query } : {}), ...(search.offset ? { offset: search.offset } : {}) });
}

export function getDetailHref(loginId: string, search: LoginSearch): string {
  return "/stms/logins/" + encodeURIComponent(loginId) + getListHref(search).slice("/stms/logins".length);
}

export function getPreviousOffset(offset: number): number { return Math.max(0, offset - defaultLoginPageSize); }

export function validateIdentifier(field: IdentifierField, value: string): string | undefined {
  return field === "email" ? is(emailSchema, value) ? undefined : m.stms_logins_email_invalid()
    : isValidUsername(value) ? undefined : m.stms_logins_username_invalid();
}

export function normalizeIdentifier(field: IdentifierField, value: string): string {
  if (field === "username") return value;
  const parsed = safeParse(emailSchema, value);
  if (!parsed.success) throw new Error("Invalid email reached the save boundary.");
  return parsed.output;
}

export function getStatusLabel(status: LoginSummary["status"]): string {
  switch (status) {
    case "active": return m.stms_logins_active();
    case "suspended": return m.stms_logins_suspended();
    case "archived": return m.stms_logins_archived();
  }
}

export function getReasonLabel(reason: SuspensionReason): string {
  switch (reason) {
    case "stms_unpaid": return m.stms_logins_unpaid();
    case "stms_abuse_or_misuse": return m.stms_logins_abuse();
    case "stms_security_concern": return m.stms_logins_security();
    case "stms_at_persons_request": return m.stms_logins_person_request();
    case "stms_other": return m.stms_logins_other();
  }
}

export function isAccessFailure(error: ManagementFailure): boolean {
  return ["core_unauthenticated", "core_identity_changed", "core_forbidden", "core_login_inactive", "core_profile_incomplete", "core_creation_incomplete"].includes(error.code);
}

export function isUncertainFailure(error: ManagementFailure): boolean {
  return !isAccessFailure(error) && !["core_invalid_input", "core_request_too_large", "stms_login_not_found", "stms_login_state_conflict",
    "stms_self_suspend_forbidden", "stms_self_archive_forbidden", "accounts_email_taken", "accounts_username_taken", "accounts_username_reserved", "accounts_username_invalid"].includes(error.code);
}

export function getFailureMessage(error: ManagementFailure): string {
  switch (error.code) {
    case "core_unauthenticated": return m.core_session_ended();
    case "core_identity_changed": return m.stms_logins_identity_changed();
    case "core_forbidden": return m.stms_logins_forbidden();
    case "core_login_inactive": return m.core_login_inactive();
    case "core_profile_incomplete": return m.stms_logins_profile_required();
    case "core_creation_incomplete": return m.core_creation_incomplete();
    case "core_invalid_input": return m.stms_logins_errors();
    case "core_request_too_large": return m.stms_logins_too_long();
    case "stms_login_not_found": return m.stms_logins_not_found();
    case "stms_login_state_conflict": return m.stms_logins_state_changed();
    case "stms_self_suspend_forbidden": case "stms_self_archive_forbidden": return m.stms_logins_self_protected();
    case "accounts_email_taken": return m.stms_logins_email_taken();
    case "accounts_username_taken": return m.stms_logins_username_taken();
    case "accounts_username_reserved": return m.stms_logins_username_reserved();
    case "accounts_username_invalid": return m.stms_logins_username_invalid();
    default: return m.core_error_message();
  }
}
