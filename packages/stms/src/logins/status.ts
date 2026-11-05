import type { AccessRequest, CoreError, RequestContext } from "@xpro/core/server";

export type LoginStatusServices = { database: D1Database; access: AccessRequest; context: RequestContext };
export type LoginStatusError = CoreError | { code: "stms_login_not_found" }
  | { code: "stms_login_state_conflict" } | { code: "stms_self_suspend_forbidden" } | { code: "stms_self_archive_forbidden" };
