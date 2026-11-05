import { createAccessRequest, createErrorResponse, readJsonInput, requestIdHeader, type RequestContext } from "@xpro/core/server";
import { parseSetCookieHeader } from "better-auth/cookies";
import { optional, string } from "valibot";
import { createHubAuth, type HubAuthSettings } from "#auth/auth.server.ts";
import { recordSignIn } from "#auth/sign-in.db.ts";
import { validateHubLocalAccess } from "#auth/validate-access.server.ts";

type Services = { settings: HubAuthSettings; context: RequestContext; reportError(): Response };
const failures = {
  accounts_mfa_invalid_code: { status: 401, message: "The code is invalid or has expired. Try again or start sign-in again." },
  accounts_mfa_limited: { status: 429, message: "Too many attempts. Please wait before trying again." },
  accounts_mfa_unavailable: { status: 503, message: "Verification is temporarily unavailable. Please try again." },
  core_unauthenticated: { status: 409, message: "Start sign-in again." },
} as const;

export async function handleMfaVerification(request: Request, services: Services): Promise<Response> {
  const { settings, context, reportError } = services;
  const parsed = await readJsonInput(request, { code: string(), oauth_query: optional(string()) });
  if (parsed.isErr) return createErrorResponse(parsed.error, context);
  const auth = await createHubAuth({ ...settings, requestContext: context, onUnexpectedError: reportError });
  const headers = new Headers(request.headers);
  headers.delete("content-length"); headers.set(requestIdHeader, context.requestId);
  const response = await auth.handler(new Request(request.url, { method: "POST", headers, body: JSON.stringify(parsed.value) }));
  if (response.status >= 400) return await refusal(response, services);
  const cookies = parseSetCookieHeader(response.headers.get("set-cookie") ?? "");
  const sessionName = (await auth.$context).authCookies.sessionToken.name;
  if (!cookies.get(sessionName)?.value) return reportError();
  const cookie = [...cookies].map(([name, value]) => `${name}=${value.value}`).join("; ");
  const session = await auth.api.getSession({ headers: { cookie }, query: { disableCookieCache: true } });
  if (!session) return reportError();
  const access = await createAccessRequest({ app: "hub", session: { loginId: session.user.id, hubSessionId: session.session.id },
    workspaceId: null, context, hub: { async validateAccess(input) { return await validateHubLocalAccess(settings.database, input); } } });
  const completed = access.authorize({ kind: "complete_profile" });
  if (completed.isErr) return createErrorResponse(completed.error, context);
  // shortcut: native session and sign-in audit commit separately; add coordination
  // if complete sign-in audit coverage becomes required, as for credential sign-in.
  await recordSignIn(settings.database, { loginId: session.user.id, reason: null, context });
  const resultHeaders = new Headers(response.headers);
  resultHeaders.set(requestIdHeader, context.requestId); resultHeaders.set("cache-control", "no-store");
  if (response.status >= 300) return new Response(response.body, { status: response.status, headers: resultHeaders });
  const body: unknown = await response.json();
  const result = body && typeof body === "object" && "redirect" in body && body.redirect === true
    && "url" in body && typeof body.url === "string" ? { redirect: true, url: body.url } : { status: true };
  return Response.json(result, { headers: resultHeaders });
}

async function refusal(response: Response, services: Services): Promise<Response> {
  const { context, reportError } = services;
  const body: unknown = await response.json().catch((): unknown => null);
  const code = body && typeof body === "object" && "code" in body ? body.code : undefined;
  if (code === "accounts_mfa_unavailable") return failure(code, context);
  if (response.status >= 500) return createErrorResponse({ code: "core_unexpected_error" }, context);
  if (code === "core_unexpected_error") return reportError();
  if (body && typeof body === "object" && "error" in body && body.error === "invalid_signature") {
    return createErrorResponse({ code: "core_sign_in_invalid" }, context);
  }
  if (code === "core_identity_changed" || code === "core_forbidden" || code === "core_login_inactive" || code === "core_creation_incomplete"
    || code === "core_mfa_required" || code === "core_mfa_recent_verification_required") return createErrorResponse({ code }, context);
  if (code === "core_unauthenticated") return failure(code, context);
  if (response.status === 429) return failure("accounts_mfa_limited", context);
  if (response.status === 403) return createErrorResponse({ code: "core_forbidden" }, context);
  if (response.status === 400) return failure("core_unauthenticated", context);
  return failure("accounts_mfa_invalid_code", context);
}

function failure(code: keyof typeof failures, context: RequestContext): Response {
  const { status, message } = failures[code];
  return Response.json({ code, message, requestId: context.requestId }, {
    status, headers: { [requestIdHeader]: context.requestId, "cache-control": "no-store" },
  });
}
