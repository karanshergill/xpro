import { readOwnProfile } from "@xpro/accounts/server";
import { createErrorResponse, createRequestContext, reportUnexpectedError, requestIdHeader } from "@xpro/core/server";
import { is, pipe, string, uuid } from "valibot";
import type { HubAuthSettings } from "#auth/auth.server.ts";
import { createHubAccess } from "./hub-request.server";
import { authorizeProfileActor } from "./profile-request.server";
import { getPictureRevision } from "./picture-revision";

export async function handleReadPicture(services: { request: Request; settings: HubAuthSettings; pictures: R2Bucket }): Promise<Response> {
  const context = createRequestContext();
  let hasReported = false;
  const reportError = (): Response => {
    if (hasReported) return createErrorResponse({ code: "core_unexpected_error" }, context);
    hasReported = true; return reportUnexpectedError(context, { app: "hub", operation: "accounts_read_picture" });
  };
  try {
    const { request, settings } = services, url = new URL(request.url);
    if (url.origin !== new URL(settings.baseURL).origin || (request.method !== "GET" && request.method !== "HEAD")) {
      return createErrorResponse({ code: "core_forbidden" }, context);
    }
    const { access } = await createHubAccess(request, { settings: { ...settings, onUnexpectedError: reportError }, context });
    const actor = authorizeProfileActor(request, access);
    if (actor.isErr) return createErrorResponse(actor.error, context);
    const revision = url.pathname.slice("/api/v1/profile-pictures/".length);
    if (!url.pathname.startsWith("/api/v1/profile-pictures/") || url.search || !is(pipe(string(), uuid()), revision)) {
      return createErrorResponse({ code: "core_invalid_input", fields: [] }, context);
    }
    const profile = await readOwnProfile(settings.database, actor.value.loginId);
    if (!profile?.pictureKey || getPictureRevision({ loginId: actor.value.loginId, key: profile.pictureKey }) !== revision) return notFound();
    const picture = await services.pictures.get(profile.pictureKey);
    if (!picture) return notFound();
    const headers = { "content-type": "image/png", "cache-control": "private, no-store", vary: "cookie",
      "x-content-type-options": "nosniff", [requestIdHeader]: context.requestId };
    if (request.method === "HEAD") { await picture.body.cancel(); return new Response(null, { headers }); }
    return new Response(picture.body, { headers });
  } catch { return reportError(); }

  function notFound(): Response {
    return Response.json({ code: "accounts_picture_not_found", message: "This picture could not be found.", requestId: context.requestId },
      { status: 404, headers: { "cache-control": "private, no-store", vary: "cookie", [requestIdHeader]: context.requestId } });
  }
}
