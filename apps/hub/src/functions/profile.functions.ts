import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { updateProfileEntries, changePasswordEntries } from "@xpro/accounts";
import { createErrorResponse, createRequestContext, parseInput } from "@xpro/core/server";
import { handleUpdateProfile, handleChangePassword } from "./profile.server";

export const updateProfile = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, updateProfileEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleUpdateProfile(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET },
    });
  });

export const changePassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, changePasswordEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleChangePassword(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET },
    });
  });
