import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createErrorResponse, createRequestContext, parseInput } from "@xpro/core/server";
import { handleMfaAction, mfaPasswordEntries } from "./mfa.server";

export const startMfaSetup = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, mfaPasswordEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleMfaAction("setup", data.value, { request: getRequest(), settings: {
      database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET, rateLimiter: env.SIGN_IN_RATE_LIMITER,
    } });
  });

export const replaceMfaAuthenticator = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, mfaPasswordEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleMfaAction("replace", data.value, { request: getRequest(), settings: {
      database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET, rateLimiter: env.SIGN_IN_RATE_LIMITER,
    } });
  });

export const replaceMfaBackupCodes = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, mfaPasswordEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleMfaAction("backups", data.value, { request: getRequest(), settings: {
      database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET, rateLimiter: env.SIGN_IN_RATE_LIMITER,
    } });
  });
