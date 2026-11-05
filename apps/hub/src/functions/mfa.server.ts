import { passwordSchema } from "@xpro/accounts";
import { createErrorResponse, parseInput, requestIdHeader, type RequestContext } from "@xpro/core/server";
import { applySetCookies } from "better-auth/cookies";
import { isAPIError } from "better-auth/api";
import { array, object, safeParse, string } from "valibot";
import type { HubAuthSettings } from "#auth/auth.server.ts";
import { MFA_SETUP_ID_HEADER } from "#auth/mfa/context.db.ts";
import { withHubRequest } from "./hub-request.server";

export const mfaPasswordEntries = { password: passwordSchema };
type MfaAction = "setup" | "replace" | "backups";
const setupSchema = object({ totpURI: string(), backupCodes: array(string()) });
const backupsSchema = object({ backupCodes: array(string()) });
const refusals = {
  INVALID_PASSWORD: { code: "accounts_current_password_invalid", status: 400, message: "The current password is incorrect." },
  accounts_mfa_setup_pending: { code: "accounts_mfa_setup_pending", status: 409, message: "Finish the existing setup or explicitly restart it." },
  accounts_mfa_limited: { code: "accounts_mfa_limited", status: 429, message: "Too many attempts. Please wait before trying again." },
} as const;

export async function handleMfaAction(action: MfaAction, input: unknown, services: { request: Request; settings: HubAuthSettings }): Promise<Response> {
  return await withHubRequest(services, async ({ auth, access, context, request, reportError }) => {
    const enrollment = access.authorize({ kind: "enroll_mfa" });
    const permission = action === "setup" || action === "replace" && enrollment.isOk ? enrollment : access.authorize({ kind: "manage_mfa" });
    if (permission.isErr) return createErrorResponse(permission.error, context);
    const parsed = parseInput(input, mfaPasswordEntries);
    if (parsed.isErr) return createErrorResponse(parsed.error, context);
    const headers = new Headers(request.headers), cookies: string[] = [];
    try {
      if (action === "replace") {
        const disabled = await auth.api.disableTwoFactor({ headers, body: parsed.value, asResponse: true });
        if (!disabled.ok) return await refusalResponse(disabled, { context, reportError });
        cookies.push(...disabled.headers.getSetCookie());
        applySetCookies(headers, disabled.headers.getSetCookie());
      }
      const response = action === "backups"
        ? await auth.api.generateBackupCodes({ headers, body: parsed.value, asResponse: true })
        : await auth.api.enableTwoFactor({ headers, body: parsed.value, asResponse: true });
      if (!response.ok) return await refusalResponse(response, { context, reportError });
      const body: unknown = await response.json();
      const material = action === "backups" ? safeParse(backupsSchema, body) : safeParse(setupSchema, body);
      if (!material.success) return reportError();
      const setupId = response.headers.get(MFA_SETUP_ID_HEADER);
      if (action !== "backups" && !setupId) return reportError();
      const resultHeaders = new Headers({ "cache-control": "no-store", [requestIdHeader]: context.requestId });
      for (const cookie of [...cookies, ...response.headers.getSetCookie()]) resultHeaders.append("set-cookie", cookie);
      return Response.json(action === "backups" ? material.output : { ...material.output, setupId }, { headers: resultHeaders });
    } catch (error) {
      if (!isAPIError(error)) throw error;
      return expectedRefusal(error.body?.code, { context, reportError, status: error.statusCode });
    }
  });
}

async function refusalResponse(response: Response, services: { context: RequestContext; reportError(): Response }): Promise<Response> {
  if (response.status >= 500) return services.reportError();
  const body: unknown = await response.json().catch((): unknown => null);
  const code = body && typeof body === "object" && "code" in body ? body.code : undefined;
  return expectedRefusal(code, { ...services, status: response.status });
}

function expectedRefusal(code: unknown, services: { context: RequestContext; reportError(): Response; status: number }): Response {
  if (services.status >= 500) return services.reportError();
  if (code === "core_identity_changed" || code === "core_forbidden" || code === "core_creation_incomplete" || code === "core_login_inactive"
    || code === "core_mfa_required" || code === "core_mfa_recent_verification_required") return createErrorResponse({ code }, services.context);
  const refusal = code === "INVALID_PASSWORD" || code === "accounts_mfa_setup_pending" || code === "accounts_mfa_limited" ? refusals[code] : null;
  return refusal ? Response.json({ code: refusal.code, message: refusal.message, requestId: services.context.requestId }, {
    status: refusal.status, headers: { "cache-control": "no-store", [requestIdHeader]: services.context.requestId },
  }) : createErrorResponse({ code: "core_unauthenticated" }, services.context);
}
