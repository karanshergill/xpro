import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { listAccountsEntries, searchAccountsEntries, getAccountEntries, createAccountEntries, renameAccountEntries } from "@xpro/stms";
import { createErrorResponse, createRequestContext, parseInput } from "@xpro/core/server";
import { handleListAccounts, handleSearchAccounts, handleGetAccount, handleCreateAccount, handleRenameAccount } from "./accounts.server";

export const listAccounts = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, listAccountsEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleListAccounts(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  });

export const searchAccounts = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, searchAccountsEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleSearchAccounts(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  });

export const getAccount = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, getAccountEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleGetAccount(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  });

export const createAccount = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, createAccountEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleCreateAccount(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  });

export const renameAccount = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, renameAccountEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleRenameAccount(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  });
