import type { CoreError } from "@xpro/core/server";
import { pageLoginIdHeader } from "@xpro/core";
import { createErrorResponse, createRequestContext, isMfaRecent, parseInput, reportUnexpectedError, requestIdHeader } from "@xpro/core/server";
import { createAuthMiddleware } from "better-auth/api";
import { createHubAuth, type HubAuthSettings } from "#auth/auth.server.ts";
import { getMfaAccessState, isLoginCreationComplete, isLoginInactive } from "@xpro/accounts/server";
import { readMfaSessionPage, readMfaChallengePage } from "#auth/mfa/page.db.ts";

export function validateMfaPage(input: unknown): { variant: "Ok"; value: Record<string, never> } | { variant: "Err"; error: CoreError } { return parseInput(input, {}).toJSON(); }

export async function handleMfaPage(input: ReturnType<typeof validateMfaPage>, services: {
  request: Request; settings: HubAuthSettings;
}): Promise<Response> {
  const context = createRequestContext();
  if (input.variant === "Err") return createErrorResponse(input.error, context);
  try {
    const { request, settings } = services, url = new URL(request.url), origin = new URL(settings.baseURL).origin;
    const isPageRead = request.method === "GET" && url.pathname === "/mfa";
    const isBrowserRead = request.method === "POST" && request.headers.get("origin") === origin;
    if (url.origin !== origin || !isPageRead && !isBrowserRead) return createErrorResponse({ code: "core_forbidden" }, context);
    const auth = await createHubAuth(settings), native = await auth.$context;
    // Native session/verification readers delete expired rows. This middleware
    // verifies cookies without invoking their persistence hooks or cleanup.
    const readCookies = createAuthMiddleware(async (ctx) => ({
      token: await ctx.getSignedCookie(native.authCookies.sessionToken.name, native.secret),
      challenge: await ctx.getSignedCookie(native.createAuthCookie("two_factor").name, native.secret),
    }));
    const cookies = await readCookies({ headers: request.headers });
    const session = cookies.token ? await readMfaSessionPage(settings.database, cookies.token) : undefined;
    const hasSession = session && Date.parse(session.expiresAt) > Date.now();
    if (hasSession && cookies.challenge) return createErrorResponse({ code: "core_unauthenticated" }, context);
    const challenge = !hasSession && cookies.challenge ? await readMfaChallengePage(settings.database, cookies.challenge) : undefined;
    const row = hasSession ? session : challenge;
    if (!row || !(Date.parse(row.expiresAt) > Date.now())) return createErrorResponse({ code: "core_unauthenticated" }, context);
    if (isLoginInactive(row)) return createErrorResponse({ code: "core_login_inactive" }, context);
    if (!isLoginCreationComplete(row)) return createErrorResponse({ code: "core_creation_incomplete" }, context);
    const expected = request.headers.get(pageLoginIdHeader);
    if (expected !== null && expected !== row.loginId) return createErrorResponse({ code: "core_identity_changed" }, context);
    const isMaster = row.role?.split(",").includes("admin") ?? false;
    const revision = "sessionAuthRevision" in row ? row.sessionAuthRevision : row.sourceRevision;
    if (revision === null || !hasSession && !isMaster) return createErrorResponse({ code: "core_unauthenticated" }, context);
    const mfa = getMfaAccessState({ ...row, isMaster, sessionAuthRevision: revision,
      mfaVerifiedAt: "mfaVerifiedAt" in row ? row.mfaVerifiedAt : null, now: Date.now() });
    if (!mfa || !hasSession && mfa.status !== "sign_in_required" || hasSession && mfa.status === "sign_in_required") {
      return createErrorResponse({ code: "core_unauthenticated" }, context);
    }
    const step = !hasSession ? "verify" : mfa.status === "enrollment_required" ? row.factorId ? "pending" : "setup" : "complete";
    const management = mfa.status === "verified" ? isMfaRecent(mfa, Date.now()) ? "ready" : "recent_required" : "unavailable";
    return Response.json({ loginId: row.loginId, step, setupId: isMaster ? row.factorId : null, management }, { headers: { "cache-control": "no-store", [requestIdHeader]: context.requestId } });
  } catch { return reportUnexpectedError(context, { app: "hub", operation: "accounts_mfa_page" }); }
}
