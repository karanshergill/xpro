import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createErrorResponse, createRequestContext, parseInput } from "@xpro/core/server";
import { changeEmailEntries, changeUsernameEntries } from "@xpro/stms";
import { handleChangeEmail, handleChangeUsername } from "./login-identifiers.server";

export const changeEmail = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, changeEmailEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleChangeEmail(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  });

export const changeUsername = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, changeUsernameEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleChangeUsername(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  });
