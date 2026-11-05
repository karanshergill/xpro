import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createErrorResponse, createRequestContext, parseInput } from "@xpro/core/server";
import { resetPasswordEntries } from "@xpro/stms";
import { handleResetPassword } from "./reset-password.server";

export const resetPassword = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, resetPasswordEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleResetPassword(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET },
    });
  });
