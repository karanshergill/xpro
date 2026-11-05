import { array, boolean, literal, maxLength, nullable, object, picklist, pipe, safeParse, strictObject, string, union, uuid } from "valibot";
import { reportUnexpectedError } from "#server/errors.server.ts";
import type { AccessRequest, AccessRequestInput, HubAccessResult } from "./access";
import { authorizeAccess, isMfaStateValid } from "./access-policy";

const actorSchema = object({
  loginId: pipe(string(), uuid()),
  isMaster: boolean(),
  membershipRole: nullable(picklist(["owner", "admin", "member"])),
});
const resultSchema = union([
  object({ status: literal("invalid"), code: picklist(["core_unauthenticated", "core_login_inactive", "core_unexpected_error"]) }),
  object({ status: literal("valid"), actor: actorSchema, sessionExpiresAt: string(), isCreationComplete: boolean(),
    missingProfileFields: pipe(array(picklist(["username", "name", "phone"])), maxLength(3)),
    mfa: union([
      strictObject({ status: literal("not_required") }),
      strictObject({ status: literal("enrollment_required") }),
      strictObject({ status: literal("sign_in_required") }),
      strictObject({ status: literal("verified"), verifiedAt: string() }),
    ]) }),
]);

export async function createAccessRequest(input: AccessRequestInput): Promise<AccessRequest> {
  const workspaceId = input.workspaceId;
  let result: HubAccessResult = { status: "invalid", code: "core_unauthenticated" };
  if (input.session) {
    const { loginId, hubSessionId } = input.session;
    try {
      const parsed = safeParse(resultSchema, await input.hub.validateAccess({
        loginId, hubSessionId, workspaceId, context: input.context,
      }));
      if (!parsed.success || (parsed.output.status === "valid" && (parsed.output.actor.loginId !== loginId
        || !(Date.parse(parsed.output.sessionExpiresAt) > Date.now())
        || !isMfaStateValid({ isMaster: parsed.output.actor.isMaster, mfa: parsed.output.mfa, now: Date.now() })))) {
        throw new Error("Hub validation returned an invalid identity result.");
      }
      result = parsed.output;
      if (result.status === "invalid" && result.code === "core_unexpected_error") reportUnexpectedError(input.context, { app: input.app, operation: "core_validate_access" });
    } catch {
      reportUnexpectedError(input.context, { app: input.app, operation: "core_validate_access" });
      result = { status: "invalid", code: "core_unexpected_error" };
    }
  }
  return { sessionExpiresAt: result.status === "valid" ? result.sessionExpiresAt : null,
    authorize: (action) => authorizeAccess({ result, workspaceId, action, now: Date.now() }) };
}
