import { array, nullable, number, object, optional, picklist, pipe, safeParse, string, uuid } from "valibot";
import { pageLoginIdHeader } from "@xpro/core";
import { defaultLoginPageSize, type LoginDetails, type LoginPage } from "@xpro/stms";
import { callHubFunction } from "#functions/call";
import { getLogin, listLogins, searchLogins } from "#functions/logins.functions";
import { archiveLogin, reactivateLogin, restoreLogin, suspendLogin } from "#functions/login-status.functions";
import { changeEmail, changeUsername } from "#functions/login-identifiers.functions";
import type { IdentifierField, LoginSearch, ManagementFailure, ManagementPage, SaveResult, StatusAction } from "./management";

const idSchema = pipe(string(), uuid());
const summaryEntries = { loginId: idSchema, username: nullable(string()), name: string(), email: string(), phone: nullable(string()),
  createdAt: string(), status: picklist(["active", "suspended", "archived"]) };
const listSchema = object({ logins: array(object(summaryEntries)), nextOffset: nullable(number()) });
const detailSchema = object({ ...summaryEntries, workspace: nullable(object({ workspaceId: idSchema, name: string() })) });
const receiptSchema = object({ loginId: idSchema });
const errorSchema = object({ code: string(), requestId: optional(idSchema), fields: optional(array(string())) });

export async function loadLogins(search: LoginSearch, signal?: AbortSignal): Promise<ManagementPage<LoginPage>> {
  const data = { limit: defaultLoginPageSize, offset: search.offset };
  const response = await callHubFunction((fetch) => search.query ? searchLogins({ data: { ...data, query: search.query }, signal, fetch })
    : listLogins({ data, signal, fetch }));
  if (!response.ok) return { status: "error", error: await readFailure(response) };
  const parsed = safeParse(listSchema, await response.json()), actor = safeParse(idSchema, response.headers.get(pageLoginIdHeader));
  if (!parsed.success || !actor.success) throw new Error("The login list returned invalid page data.");
  return { status: "ready", value: parsed.output, pageLoginId: actor.output };
}

export async function loadLogin(loginId: string, options: { pageLoginId?: string; signal?: AbortSignal } = {}): Promise<ManagementPage<LoginDetails>> {
  const response = await callHubFunction((fetch) => getLogin({ data: { loginId }, signal: options.signal, fetch,
    headers: options.pageLoginId ? { [pageLoginIdHeader]: options.pageLoginId } : undefined }));
  if (!response.ok) return { status: "error", error: await readFailure(response) };
  const parsed = safeParse(detailSchema, await response.json()), actor = safeParse(idSchema, response.headers.get(pageLoginIdHeader));
  if (!parsed.success || !actor.success || parsed.output.loginId !== loginId) throw new Error("The login detail returned invalid page data.");
  if (options.pageLoginId && actor.output !== options.pageLoginId) return { status: "error", error: { code: "core_identity_changed" } };
  return { status: "ready", value: parsed.output, pageLoginId: actor.output };
}

export async function submitStatus(input: { action: StatusAction; loginId: string; reason?: string; comment?: string }, pageLoginId: string): Promise<SaveResult> {
  const headers = { [pageLoginIdHeader]: pageLoginId }, comment = input.comment?.trim() ? { comment: input.comment } : {};
  const response = await callHubFunction(async (fetch) => {
    switch (input.action) {
      case "suspend": return await suspendLogin({ data: { loginId: input.loginId, reason: input.reason, confirmed: true, ...comment }, headers, fetch });
      case "archive": return await archiveLogin({ data: { loginId: input.loginId, confirmed: true, ...comment }, headers, fetch });
      case "reactivate": return await reactivateLogin({ data: { loginId: input.loginId }, headers, fetch });
      case "restore": return await restoreLogin({ data: { loginId: input.loginId }, headers, fetch });
    }
  });
  return await readSave(response, input.loginId);
}

export async function submitIdentifier(input: { field: IdentifierField; loginId: string; value: string; comment: string }, pageLoginId: string): Promise<SaveResult> {
  const headers = { [pageLoginIdHeader]: pageLoginId }, comment = input.comment.trim() ? { comment: input.comment } : {};
  const response = await callHubFunction((fetch) => input.field === "email" ? changeEmail({ data: { loginId: input.loginId, email: input.value, ...comment }, headers, fetch })
    : changeUsername({ data: { loginId: input.loginId, username: input.value, ...comment }, headers, fetch }));
  return await readSave(response, input.loginId);
}

async function readSave(response: Response, loginId: string): Promise<SaveResult> {
  if (!response.ok) return { status: "error", error: await readFailure(response) };
  const parsed = safeParse(receiptSchema, await response.json());
  if (!parsed.success || parsed.output.loginId !== loginId) throw new Error("The login action returned an invalid receipt.");
  return { status: "saved" };
}

async function readFailure(response: Response): Promise<ManagementFailure> {
  const parsed = safeParse(errorSchema, await response.json());
  return parsed.success ? parsed.output : { code: "core_unexpected_error" };
}
