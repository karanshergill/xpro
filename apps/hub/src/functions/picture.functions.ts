import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { removePictureEntries } from "@xpro/accounts";
import { createErrorResponse, createRequestContext, parseInput } from "@xpro/core/server";
import { handleRemovePicture } from "./picture.server";

export const removePicture = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, removePictureEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleRemovePicture(data.value, { request: getRequest(), pictures: env.PROFILE_PICTURES,
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET },
    });
  });
