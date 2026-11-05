import { parseInput, reportUnexpectedError, type AccessRequest, type CoreError, type RequestContext } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { getLoginEntries, listLoginsEntries, searchLoginsEntries, type LoginPageInput } from "./input";
import { readLogin, readLogins, searchLogins as searchRows } from "./logins.db";
import type { LoginDetails, LoginPage, LoginSummary } from "./logins";

export type LoginReadServices = { database: D1Database; access: AccessRequest; context: RequestContext };
export type LoginReadError = CoreError | { code: "stms_login_not_found" };

export async function listLogins(input: unknown, services: LoginReadServices): Promise<Result<LoginPage, LoginReadError>> {
  const actor = services.access.authorize({ kind: "protected", hasLocalPermission: false });
  if (actor.isErr) return err(actor.error);
  const parsed = parseInput(input, listLoginsEntries);
  if (parsed.isErr) return err(parsed.error);
  try { return ok(pageResult(await readLogins(services.database, parsed.value), parsed.value)); }
  catch { reportUnexpectedError(services.context, { app: "hub", operation: "stms_list_logins" }); return err({ code: "core_unexpected_error" }); }
}

export async function searchLogins(input: unknown, services: LoginReadServices): Promise<Result<LoginPage, LoginReadError>> {
  const actor = services.access.authorize({ kind: "protected", hasLocalPermission: false });
  if (actor.isErr) return err(actor.error);
  const parsed = parseInput(input, searchLoginsEntries);
  if (parsed.isErr) return err(parsed.error);
  try { return ok(pageResult(await searchRows(services.database, parsed.value), parsed.value)); }
  catch { reportUnexpectedError(services.context, { app: "hub", operation: "stms_search_logins" }); return err({ code: "core_unexpected_error" }); }
}

export async function getLogin(input: unknown, services: LoginReadServices): Promise<Result<LoginDetails, LoginReadError>> {
  const actor = services.access.authorize({ kind: "protected", hasLocalPermission: false });
  if (actor.isErr) return err(actor.error);
  const parsed = parseInput(input, getLoginEntries);
  if (parsed.isErr) return err(parsed.error);
  try {
    const login = await readLogin(services.database, parsed.value.loginId);
    return login ? ok(login) : err({ code: "stms_login_not_found" });
  } catch { reportUnexpectedError(services.context, { app: "hub", operation: "stms_get_login" }); return err({ code: "core_unexpected_error" }); }
}

function pageResult(rows: LoginSummary[], input: LoginPageInput): LoginPage {
  return { logins: rows.slice(0, input.limit), nextOffset: rows.length > input.limit ? input.offset + input.limit : null };
}
