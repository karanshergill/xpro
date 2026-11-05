import type { AccessRequest, CoreError, RequestContext } from "@xpro/core/server";

export type LoginIdentifierServices = { database: D1Database; access: AccessRequest; context: RequestContext };
export type LoginIdentifierError = CoreError | { code: "stms_login_not_found" } | { code: "accounts_email_taken" }
  | { code: "accounts_username_invalid" } | { code: "accounts_username_taken" } | { code: "accounts_username_reserved" };
