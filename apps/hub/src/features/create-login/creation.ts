import { createLoginEntries, emailSchema, isValidUsername, nameSchema, normalizePhone, passwordSchema } from "@xpro/accounts";
import type { WorkspaceChoice } from "@xpro/stms";
import { is, safeParse, strictObject, type InferOutput } from "valibot";
import { v7 } from "uuid";
import { m } from "#paraglide/messages.js";

export type CreationFailure = { code: string; requestId?: string; fields?: string[] };
export type CreationPageData = { creatorLoginId: string; scope: { kind: "master" } | { kind: "workspace"; workspace: { workspaceId: string; name: string } } };
export type CreationPage = { status: "ready"; data: CreationPageData } | { status: "error"; error: CreationFailure };
export type CreationValues = { email: string; username: string; name: string; password: string;
  phone: { country: string; number: string }; target: string; workspaceId: string; kind: string };
export type CreationField = keyof CreationValues;
export type CreationErrors = Partial<Record<CreationField, string>>;
const requestSchema = strictObject(createLoginEntries);
export type CreationRequest = InferOutput<typeof requestSchema>;
export type CreationAttempt = { data: CreationRequest; wasUncertain: boolean };
export type CreationReceipt = { creationId: string; loginId: string };
export type CreatedLogin = CreationReceipt & { email: string; username: string };
export type SelectedWorkspace = WorkspaceChoice | null;

export function initialCreationValues(page: CreationPageData): CreationValues {
  return { email: "", username: "", name: "", password: "", phone: { country: "", number: "" },
    target: page.scope.kind === "workspace" ? "workspace" : "standalone",
    workspaceId: page.scope.kind === "workspace" ? page.scope.workspace.workspaceId : "", kind: "internal" };
}

export function validateCreationValues(values: CreationValues, page: CreationPageData): CreationErrors {
  const errors: CreationErrors = {};
  if (!is(emailSchema, values.email)) errors.email = m.accounts_create_login_email_invalid();
  if (!isValidUsername(values.username)) errors.username = m.accounts_create_login_username_invalid();
  if (!is(nameSchema, values.name)) errors.name = m.accounts_create_login_name_required();
  if (!is(passwordSchema, values.password)) errors.password = m.accounts_create_login_password_invalid();
  if (!values.phone.country) errors.phone = m.accounts_create_login_country_required();
  else if (!values.phone.number.trim()) errors.phone = m.accounts_create_login_number_required();
  else if (normalizePhone(values.phone) === null) errors.phone = m.accounts_create_login_phone_invalid();
  const hasWorkspace = page.scope.kind === "workspace" || values.target === "workspace";
  if (page.scope.kind === "master" && values.target !== "standalone" && values.target !== "workspace") errors.target = m.accounts_create_login_target_required();
  if (hasWorkspace && !values.workspaceId) errors.workspaceId = m.accounts_create_login_workspace_required();
  if (hasWorkspace && values.kind !== "internal" && values.kind !== "external") errors.kind = m.accounts_create_login_kind_required();
  return errors;
}

export function createAttempt(values: CreationValues, page: CreationPageData): CreationAttempt | null {
  const hasWorkspace = page.scope.kind === "workspace" || values.target === "workspace";
  if (Object.keys(validateCreationValues(values, page)).length) return null;
  const parsed = safeParse(requestSchema, { creationId: v7(), email: values.email, username: values.username,
    name: values.name, phone: values.phone, password: values.password,
    ...(hasWorkspace ? { workspaceId: page.scope.kind === "workspace" ? page.scope.workspace.workspaceId : values.workspaceId, kind: values.kind } : {}),
  });
  return parsed.success ? { data: parsed.output, wasUncertain: false } : null;
}

export function canCorrectCreation(failure: CreationFailure, attempt: CreationAttempt): boolean {
  return !attempt.wasUncertain && ["core_invalid_input", "accounts_email_taken", "accounts_username_taken", "accounts_username_reserved", "accounts_username_invalid"].includes(failure.code);
}

export function isUncertainCreation(failure: CreationFailure): boolean {
  return !["core_invalid_input", "accounts_email_taken", "accounts_username_taken", "accounts_username_reserved",
    "accounts_username_invalid", "core_unauthenticated", "core_identity_changed", "core_login_inactive", "core_forbidden",
    "core_profile_incomplete", "core_creation_incomplete", "accounts_creation_conflict"].includes(failure.code);
}

export function getCreationFailureFields(failure: CreationFailure): CreationErrors {
  const fields: CreationErrors = {};
  for (const field of failure.fields ?? []) {
    if (field === "email") fields.email = m.accounts_create_login_email_invalid();
    if (field === "username") fields.username = m.accounts_create_login_username_invalid();
    if (field === "name") fields.name = m.accounts_create_login_name_required();
    if (field === "phone") fields.phone = m.accounts_create_login_phone_invalid();
    if (field === "password") fields.password = m.accounts_create_login_password_invalid();
    if (field === "workspaceId") fields.workspaceId = m.accounts_create_login_workspace_required();
    if (field === "kind") fields.kind = m.accounts_create_login_kind_required();
  }
  switch (failure.code) {
    case "accounts_email_taken": fields.email = m.accounts_create_login_email_taken(); break;
    case "accounts_username_taken": fields.username = m.accounts_create_login_username_taken(); break;
    case "accounts_username_reserved": fields.username = m.accounts_create_login_username_reserved(); break;
    case "accounts_username_invalid": fields.username = m.accounts_create_login_username_invalid(); break;
  }
  return fields;
}

export function getCreationFailureMessage(failure: CreationFailure, fallback = m.accounts_create_login_unknown_result()): string {
  switch (failure.code) {
    case "core_unauthenticated": return m.accounts_create_login_session_ended();
    case "core_identity_changed": return m.accounts_create_login_identity_changed();
    case "core_forbidden": case "core_login_inactive": return m.accounts_create_login_forbidden();
    case "core_profile_incomplete": return m.accounts_create_login_profile_required();
    case "core_creation_incomplete": return m.accounts_create_login_not_ready();
    case "accounts_creation_conflict": return m.accounts_create_login_conflict();
    case "core_invalid_input": case "accounts_email_taken": case "accounts_username_taken":
    case "accounts_username_reserved": case "accounts_username_invalid": return m.accounts_create_login_errors_title();
    default: return fallback;
  }
}
