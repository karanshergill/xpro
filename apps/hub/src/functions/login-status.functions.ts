import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createErrorResponse, createRequestContext, parseInput } from "@xpro/core/server";
import { suspendLoginEntries, reactivateLoginEntries, archiveLoginEntries, restoreLoginEntries } from "@xpro/stms";
import { handleSuspendLogin, handleReactivateLogin, handleArchiveLogin, handleRestoreLogin } from "./login-status.server";

export const suspendLogin = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, suspendLoginEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleSuspendLogin(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  });

export const reactivateLogin = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, reactivateLoginEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleReactivateLogin(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  });

export const archiveLogin = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, archiveLoginEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleArchiveLogin(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  });

export const restoreLogin = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, restoreLoginEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleRestoreLogin(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  });
