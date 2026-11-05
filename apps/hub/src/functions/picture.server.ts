import { uploadPicture, removePicture, type PictureError } from "@xpro/accounts/server";
import { createErrorResponse, requestIdHeader, type RequestContext } from "@xpro/core/server";
import type { HubAuthSettings } from "#auth/auth.server.ts";
import { withProfileRequest } from "./profile-request.server";
import { readPictureUpload } from "./picture-input.server";
import { processPicture } from "./picture-processing.server";
import { readPicturePolicy } from "./picture-policy.server";

type Services = { request: Request; settings: HubAuthSettings; pictures: R2Bucket };
const definitions = {
  accounts_picture_type_invalid: { status: 415, message: "Use a JPG, PNG or WebP picture." },
  accounts_picture_too_large: { status: 413, message: "Use a picture within the current upload limit." },
  accounts_picture_uploads_unavailable: { status: 503, message: "Picture uploads are temporarily unavailable. You can still remove your current picture." },
  accounts_picture_invalid: { status: 400, message: "This picture could not be read. Choose another file." },
  accounts_picture_changed: { status: 409, message: "Your picture changed. Please try again." },
} as const;

export async function handleUploadPicture(services: Services & { images: ImagesBinding; flags?: Pick<Flagship, "getObjectValue"> }): Promise<Response> {
  return await withProfileRequest(services, async ({ access, context, request, settings }) => {
    const actor = access.authorize({ kind: "protected", hasLocalPermission: true });
    if (actor.isErr) return createErrorResponse(actor.error, context);
    const policy = await readPicturePolicy({ flags: services.flags, loginId: actor.value.loginId, context });
    if (!policy.canUpload) return pictureErrorResponse({ code: "accounts_picture_uploads_unavailable" }, context);
    const input = await readPictureUpload(request, policy.maximumBytes);
    if (input.isErr) return pictureErrorResponse(input.error, context);
    const result = await uploadPicture(input.value, { database: settings.database, access, context, pictures: services.pictures, policy,
      async processPicture(file) { return await processPicture(file, services.images); },
    });
    return result.isErr ? pictureErrorResponse(result.error, context) : pictureResponse(result.value.loginId, context);
  });
}

export async function handleRemovePicture(input: unknown, services: Services): Promise<Response> {
  return await withProfileRequest(services, async ({ access, context, settings }) => {
    const result = await removePicture(input, { database: settings.database, access, context, pictures: services.pictures });
    return result.isErr ? pictureErrorResponse(result.error, context) : pictureResponse(result.value.loginId, context);
  });
}

function pictureErrorResponse(error: PictureError, context: RequestContext): Response {
  switch (error.code) {
    case "accounts_picture_type_invalid":
    case "accounts_picture_too_large":
    case "accounts_picture_invalid":
    case "accounts_picture_changed":
    case "accounts_picture_uploads_unavailable": {
      const definition = definitions[error.code];
      return Response.json({ code: error.code, message: definition.message, requestId: context.requestId }, {
        status: definition.status, headers: { [requestIdHeader]: context.requestId, "cache-control": "no-store" },
      });
    }
    default: return createErrorResponse(error, context);
  }
}

function pictureResponse(loginId: string, context: RequestContext): Response {
  return Response.json({ loginId }, { headers: { [requestIdHeader]: context.requestId, "cache-control": "no-store" } });
}
