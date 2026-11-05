import { getMissingProfileFields } from "@xpro/accounts";
import { readOwnProfile } from "@xpro/accounts/server";
import { createErrorResponse, createRequestContext, parseInput, reportUnexpectedError, requestIdHeader } from "@xpro/core/server";
import type { CoreError } from "@xpro/core/server";
import { getPictureRevision } from "./picture-revision";
import type { HubAuthSettings } from "#auth/auth.server.ts";
import { createHubAccess } from "./hub-request.server";
import { authorizeProfileActor } from "./profile-request.server";
import { readPicturePolicy } from "./picture-policy.server";

export function validateProfilePage(input: unknown): { variant: "Ok"; value: Record<string, never> } | { variant: "Err"; error: CoreError } {
  return parseInput(input, {}).toJSON();
}

export async function handleProfilePage(input: ReturnType<typeof validateProfilePage>, services: {
  request: Request; settings: HubAuthSettings; flags?: Pick<Flagship, "getObjectValue">;
}): Promise<Response> {
  const context = createRequestContext();
  let hasReported = false;
  const reportError = (): Response => {
    if (hasReported) return createErrorResponse({ code: "core_unexpected_error" }, context);
    hasReported = true; return reportUnexpectedError(context, { app: "hub", operation: "accounts_profile_page" });
  };
  try {
    const { request, settings } = services, url = new URL(request.url), origin = new URL(settings.baseURL).origin;
    const isPageRead = request.method === "GET" && url.pathname === "/profile";
    const isBrowserRead = request.method === "POST" && request.headers.get("origin") === origin;
    if (url.origin !== origin || (!isPageRead && !isBrowserRead)) return createErrorResponse({ code: "core_forbidden" }, context);
    const { access } = await createHubAccess(request, { settings: { ...settings, onUnexpectedError: reportError }, context });
    const actor = authorizeProfileActor(request, access);
    if (actor.isErr) return createErrorResponse(actor.error, context);
    if (input.variant === "Err") return createErrorResponse(input.error, context);
    const profile = await readOwnProfile(settings.database, actor.value.loginId);
    if (!profile) return createErrorResponse({ code: "core_unauthenticated" }, context);
    const missing = getMissingProfileFields(profile);
    if (missing.length) return createErrorResponse({ code: "core_profile_incomplete", fields: missing }, context);
    const mfa = actor.value.isMaster ? access.authorize({ kind: "manage_mfa" }).isOk ? "ready" : "recent_required" : "unavailable";
    const pictureRevision = getPictureRevision({ loginId: profile.loginId, key: profile.pictureKey });
    const picturePolicy = await readPicturePolicy({ flags: services.flags, loginId: actor.value.loginId, context });
    return Response.json({ mfa, loginId: profile.loginId, email: profile.email, username: profile.username,
      name: profile.name, phone: profile.phone, pictureRevision, picturePolicy },
    { headers: { "cache-control": "no-store", [requestIdHeader]: context.requestId } });
  } catch { return reportError(); }
}
