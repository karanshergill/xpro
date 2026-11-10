import { array, integer, maxValue, minValue, nullable, number, object, optional, picklist, pipe, safeParse, strictObject, string, uuid, type InferOutput } from "valibot";
import { pageLoginIdHeader } from "@xpro/core";
import { defaultStringifySearch } from "@tanstack/react-router";
import { createAccountEntries, renameAccountEntries, defaultAccountPageSize, defaultLoginPageSize, managementOperationStatusSchema, managementReceiptSchema,
  type AccountDetails, type AccountPage, type LoginPage, type ManagementOperationStatus, type ManagementReceipt } from "@xpro/stms";
import { callHubFunction } from "#functions/call";
import { createAccount, getAccount, listAccounts, renameAccount, searchAccounts } from "#functions/accounts.functions";
import { getLogin, listLogins, searchLogins } from "#functions/logins.functions";
import { getManagementOperation } from "#functions/management-operations.functions";
import { getFailureMessage, type LoginSearch, type ManagementFailure, type ManagementPage } from "#features/stms/management";
import { m } from "#paraglide/messages.js";

const id = pipe(string(), uuid()), revision = pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER));
const holder = strictObject({ loginId: id, name: string(), username: nullable(string()), email: string() });
const accountEntries = { accountId: id, name: nullable(string()), holder, status: picklist(["stms_active", "stms_suspended"]), revision, createdAt: string() };
const pageSchema = strictObject({ accounts: array(strictObject(accountEntries)), nextOffset: nullable(revision) });
const detailSchema = strictObject({ ...accountEntries, updatedAt: string(), workspace: nullable(strictObject({ workspaceId: id, name: string() })) });
const loginEntries = { loginId: id, name: string(), username: nullable(string()), email: string(), phone: nullable(string()), createdAt: string(), status: picklist(["active", "suspended", "archived"]) };
const holdersSchema = strictObject({ logins: array(strictObject(loginEntries)), nextOffset: nullable(revision) });
const loginSchema = strictObject({ ...loginEntries, workspace: nullable(strictObject({ workspaceId: id, name: string() })) });
// Core failures include a safe message; consume only the fields needed by the UI.
const failureSchema = object({ code: string(), requestId: optional(id), fields: optional(array(string())) });
export const createSchema = strictObject(createAccountEntries), renameSchema = strictObject(renameAccountEntries);
export type AccountCommand = { kind: "create"; data: InferOutput<typeof createSchema> } | { kind: "rename"; data: InferOutput<typeof renameSchema> };
export type AccountReceipt = Extract<ManagementReceipt, { accountId: string }>;
export const defaultAccountSearch: LoginSearch = { query: "", offset: 0 };
export function accountListHref(search: LoginSearch): string {
  return "/stms/accounts" + defaultStringifySearch({ ...(search.query ? { query: search.query } : {}), ...(search.offset ? { offset: search.offset } : {}) });
}
export function accountDetailHref(accountId: string, search: LoginSearch = defaultAccountSearch): string {
  return "/stms/accounts/" + encodeURIComponent(accountId) + accountListHref(search).slice("/stms/accounts".length);
}
export function accountFailureMessage(error: ManagementFailure): string {
  switch (error.code) {
    case "stms_account_not_found": return m.stms_accounts_not_found();
    case "stms_account_holder_unavailable": return m.stms_accounts_holder_unavailable();
    case "stms_operation_conflict": return m.stms_accounts_conflict();
    case "core_forbidden": return m.stms_accounts_forbidden();
    case "core_profile_incomplete": return m.stms_accounts_profile_required();
    case "core_mfa_required": return m.stms_accounts_mfa_required();
    case "core_invalid_input": return m.stms_accounts_errors();
    case "core_request_too_large": return m.stms_accounts_too_large();
    default: return getFailureMessage(error);
  }
}
async function failure(response: Response): Promise<ManagementFailure> {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object") return { code: "core_unexpected_error" };
    const parsed = safeParse(failureSchema, value);
    if (parsed.success) return parsed.output;
  } catch { /* An unreadable failure has an uncertain outcome, not a safe refusal. */ }
  return { code: "core_unexpected_error" };
}
function headers(pageLoginId?: string): HeadersInit | undefined { return pageLoginId ? { [pageLoginIdHeader]: pageLoginId } : undefined; }
function actor(response: Response, expected?: string): string | null {
  const parsed = safeParse(id, response.headers.get(pageLoginIdHeader));
  return parsed.success && (!expected || parsed.output === expected) ? parsed.output : null;
}
export async function loadAccounts(search: LoginSearch, signal?: AbortSignal): Promise<ManagementPage<AccountPage>> {
  const data = { limit: defaultAccountPageSize, offset: search.offset };
  const response = await callHubFunction((fetch) => search.query ? searchAccounts({ data: { ...data, query: search.query }, signal, fetch }) : listAccounts({ data, signal, fetch }));
  if (!response.ok) return { status: "error", error: await failure(response) };
  const parsed = safeParse(pageSchema, await response.json()), pageLoginId = actor(response);
  if (!parsed.success || !pageLoginId) throw new Error("Invalid account page.");
  return { status: "ready", value: parsed.output, pageLoginId };
}
export async function loadAccount(accountId: string, options: { pageLoginId?: string; signal?: AbortSignal } = {}): Promise<ManagementPage<AccountDetails>> {
  const response = await callHubFunction((fetch) => getAccount({ data: { accountId }, headers: headers(options.pageLoginId), signal: options.signal, fetch }));
  if (!response.ok) return { status: "error", error: await failure(response) };
  const parsed = safeParse(detailSchema, await response.json()), pageLoginId = actor(response, options.pageLoginId);
  if (!pageLoginId) return { status: "error", error: { code: "core_identity_changed" } };
  if (!parsed.success || parsed.output.accountId !== accountId) throw new Error("Invalid account details.");
  return { status: "ready", value: parsed.output, pageLoginId };
}
export async function loadHolders(search: LoginSearch, options: { pageLoginId?: string; signal?: AbortSignal } = {}): Promise<ManagementPage<LoginPage>> {
  const data = { limit: defaultLoginPageSize, offset: search.offset }, request = { headers: headers(options.pageLoginId), signal: options.signal };
  const response = await callHubFunction((fetch) => search.query ? searchLogins({ ...request, data: { ...data, query: search.query }, fetch }) : listLogins({ ...request, data, fetch }));
  if (!response.ok) return { status: "error", error: await failure(response) };
  const parsed = safeParse(holdersSchema, await response.json()), pageLoginId = actor(response, options.pageLoginId);
  if (!pageLoginId) return { status: "error", error: { code: "core_identity_changed" } };
  if (!parsed.success) throw new Error("Invalid holder directory.");
  return { status: "ready", value: parsed.output, pageLoginId };
}
export async function checkHolderAccess(loginId: string, pageLoginId: string): Promise<ManagementFailure | undefined> {
  const response = await callHubFunction((fetch) => getLogin({ data: { loginId }, headers: headers(pageLoginId), fetch }));
  if (!response.ok) return await failure(response);
  if (!actor(response, pageLoginId)) return { code: "core_identity_changed" };
  const parsed = safeParse(loginSchema, await response.json());
  if (!parsed.success || parsed.output.loginId !== loginId) throw new Error("Invalid access read.");
}
export function receiptMatches(command: AccountCommand, receipt: ManagementReceipt): receipt is AccountReceipt {
  return "accountId" in receipt && (command.kind === "create" ? receipt.action === "stms_account_created"
    : receipt.action === "stms_account_renamed" && receipt.accountId === command.data.accountId);
}
export async function saveAccount(command: AccountCommand, pageLoginId: string): Promise<{ status: "saved"; receipt: AccountReceipt } | { status: "error"; error: ManagementFailure }> {
  const response = await callHubFunction((fetch) => command.kind === "create" ? createAccount({ data: command.data, headers: headers(pageLoginId), fetch }) : renameAccount({ data: command.data, headers: headers(pageLoginId), fetch }));
  if (!response.ok) return { status: "error", error: await failure(response) };
  const parsed = safeParse(managementReceiptSchema, await response.json());
  if (!parsed.success || !receiptMatches(command, parsed.output)) throw new Error("Invalid account receipt.");
  return { status: "saved", receipt: parsed.output };
}
export async function readAccountOperation(command: AccountCommand, pageLoginId: string): Promise<ManagementOperationStatus | { status: "error"; error: ManagementFailure }> {
  const response = await callHubFunction((fetch) => getManagementOperation({ data: { operationId: command.data.operationId }, headers: headers(pageLoginId), fetch }));
  if (!response.ok) return { status: "error" as const, error: await failure(response) };
  const parsed = safeParse(managementOperationStatusSchema, await response.json());
  if (!parsed.success || (parsed.output.status === "recorded" && !receiptMatches(command, parsed.output.result))) throw new Error("Invalid recovered account receipt.");
  return parsed.output;
}
