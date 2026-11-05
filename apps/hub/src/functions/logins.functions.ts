import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { listLoginsEntries, searchLoginsEntries, getLoginEntries } from "@xpro/stms";
import { createErrorResponse, createRequestContext, parseInput } from "@xpro/core/server";
import { handleListLogins, handleSearchLogins, handleGetLogin } from "./logins.server";

export const listLogins = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, listLoginsEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleListLogins(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  });

export const searchLogins = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, searchLoginsEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleSearchLogins(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  });

export const getLogin = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, getLoginEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleGetLogin(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  });
