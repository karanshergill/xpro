import { emailSchema } from "@xpro/accounts";
import { createErrorResponse, createRequestContext, readJsonInput, reportUnexpectedError, requestIdHeader, type RequestContext } from "@xpro/core/server";
import { parseSetCookieHeader } from "better-auth/cookies";
import { boolean, optional, string } from "valibot";
import { createHubAuth, type HubAuthSettings } from "./auth.server";
import { readLoginByIdentifier, recordSignIn } from "./sign-in.db";
import { canAttemptSignIn, type SignInProtectionSettings } from "./sign-in-protection.server";
import { handleMfaVerification } from "#auth/mfa/http.server.ts";
import { validateHubLocalAccess } from "@xpro/accounts/server";

export type HubRequestSettings = HubAuthSettings & SignInProtectionSettings;

const maximumCaptchaTokenLength = 2_048;
const signInFailures = {
  accounts_credentials_invalid: { status: 401, message: "Incorrect email, username or password" },
  accounts_login_suspended: { status: 403, message: "This account is suspended. Please contact support." },
  accounts_login_archived: { status: 403, message: "This account is no longer active. Please contact support." },
  accounts_sign_in_limited: { status: 429, message: "Too many attempts. Please try again shortly." },
  accounts_bot_verification_failed: { status: 403, message: "Security check failed. Please try again." },
} as const;
type SignInFailure = keyof typeof signInFailures;

export async function handleHubAuthRequest(request: Request, settings: HubRequestSettings): Promise<Response> {
  const context = createRequestContext();
  let hasReportedError = false;
  const reportError = (): Response => {
    if (hasReportedError) return createErrorResponse({ code: "core_unexpected_error" }, context);
    hasReportedError = true;
    return reportUnexpectedError(context, { app: "hub", operation: "accounts_hub_auth_request" });
  };
  try {
    // The public entry must never fall back to the trusted server-only configuration.
    if (!settings.turnstileSecret?.trim()) return reportError();
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && (path === "/api/auth/two-factor/verify-totp" || path === "/api/auth/two-factor/verify-backup-code")) {
      return await handleMfaVerification(request, { settings, context, reportError });
    }
    const method = path === "/api/auth/sign-in/email" ? "email" : path === "/api/auth/sign-in/username" ? "username" : null;
    const parsed = method && request.method === "POST" ? await readJsonInput(request, {
      ...(method === "email" ? { email: emailSchema } : { username: string() }), password: string(),
      rememberMe: optional(boolean()), callbackURL: optional(string()), oauth_query: optional(string()),
    }) : null;
    if (parsed?.isErr) return createErrorResponse(parsed.error, context);
    const identifier = parsed && ("email" in parsed.value ? parsed.value.email
      : "username" in parsed.value ? parsed.value.username : undefined);
    if (parsed && method) {
      if (typeof identifier !== "string") return reportError();
      const token = request.headers.get("x-captcha-response");
      let failure: SignInFailure | null = null;
      if (token && token.length > maximumCaptchaTokenLength) failure = "accounts_bot_verification_failed";
      else if (!await canAttemptSignIn({ method, identifier }, settings.rateLimiter)) failure = "accounts_sign_in_limited";
      if (failure) {
        await recordSignIn(settings.database, { loginId: null, reason: failure, context });
        return signInFailure(failure, context);
      }
    }
    const auth = await createHubAuth({ ...settings, requestContext: context, onUnexpectedError: reportError });
    if (!parsed || !method) {
      const response = await auth.handler(request);
      return response.status >= 500 ? createErrorResponse({ code: "core_unexpected_error" }, context) : withContext(response, context);
    }
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.set(requestIdHeader, context.requestId);
    const response = await auth.handler(new Request(request.url, { method: "POST", headers, body: JSON.stringify(parsed.value) }));
    if (response.status >= 500) return createErrorResponse({ code: "core_unexpected_error" }, context);
    const nativeCookies = parseSetCookieHeader(response.headers.get("set-cookie") ?? "");
    const sessionCookieName = (await auth.$context).authCookies.sessionToken.name;
    // Native OAuth continuation can return either JSON or an HTML navigation redirect.
    if (response.status < 400 && nativeCookies.get(sessionCookieName)?.value) {
      const cookie = [...nativeCookies]
        .map(([name, value]) => `${name}=${value.value}`).join("; ");
      const session = await auth.api.getSession({ headers: { cookie }, query: { disableCookieCache: true } });
      if (!session) return reportError();
      const live = await validateHubLocalAccess(settings.database, { loginId: session.user.id, hubSessionId: session.session.id,
        workspaceId: null, context });
      if (live.status === "invalid") return createErrorResponse({ code: live.code }, context);
      // A password-only master session is limited to enrollment and sign-out.
      if (live.actor.isMaster && live.mfa.status !== "verified") return withContext(response, context);
      // shortcut: session and audit commit separately in the initial version;
      // add coordination if complete sign-in audit coverage becomes required.
      await recordSignIn(settings.database, { loginId: session.user.id, reason: null, context });
      return withContext(response, context);
    }
    const body: unknown = await response.clone().json().catch((): unknown => null);
    if (response.ok) {
      if (body && typeof body === "object" && "twoFactorRedirect" in body && body.twoFactorRedirect === true) {
        return withContext(response, context);
      }
      return reportError();
    }
    const nativeCode = body && typeof body === "object" && "code" in body ? body.code : undefined;
    if (nativeCode === "MISSING_RESPONSE" || nativeCode === "VERIFICATION_FAILED") {
      await recordSignIn(settings.database, { loginId: null, reason: "accounts_bot_verification_failed", context });
      return signInFailure("accounts_bot_verification_failed", context);
    }
    const hasInvalidContinuation = body && typeof body === "object" && "error" in body && body.error === "invalid_signature";
    if (response.status === 400 && hasInvalidContinuation) {
      await recordSignIn(settings.database, { loginId: null, reason: "core_sign_in_invalid", context });
      return createErrorResponse({ code: "core_sign_in_invalid" }, context);
    }
    let failure: SignInFailure = "accounts_credentials_invalid";
    let loginId: string | null = null;
    const hasVerifiedCredentials = nativeCode === "core_login_inactive" || nativeCode === "BANNED_USER" || nativeCode === "core_creation_incomplete";
    if (response.status === 403 && hasVerifiedCredentials) {
      if (typeof identifier !== "string") return reportError();
      const verifiedLogin = await readLoginByIdentifier(settings.database, { method, identifier });
      if (!verifiedLogin) return reportError();
      loginId = verifiedLogin.id;
      if (nativeCode === "core_creation_incomplete") {
        await recordSignIn(settings.database, { loginId, reason: "core_creation_incomplete", context });
        return createErrorResponse({ code: "core_creation_incomplete" }, context);
      }
      failure = verifiedLogin.archivedAt ? "accounts_login_archived" : "accounts_login_suspended";
    } else if (response.status !== 401 && response.status !== 400) return withContext(response, context);
    await recordSignIn(settings.database, { loginId, reason: failure, context });
    return signInFailure(failure, context);
  } catch { return reportError(); }
}

function signInFailure(code: SignInFailure, context: RequestContext): Response {
  const definition = signInFailures[code];
  return Response.json({ code, message: definition.message, requestId: context.requestId }, {
    status: definition.status, headers: { [requestIdHeader]: context.requestId, "cache-control": "no-store" },
  });
}

function withContext(response: Response, context: RequestContext): Response {
  const headers = new Headers(response.headers);
  headers.set(requestIdHeader, context.requestId);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
