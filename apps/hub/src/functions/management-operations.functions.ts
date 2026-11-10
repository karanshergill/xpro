import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { managementOperationEntries } from "@xpro/stms";
import { createErrorResponse, createRequestContext, parseInput } from "@xpro/core/server";
import { handleGetManagementOperation } from "./management-operations.server";

export const getManagementOperation = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, managementOperationEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleGetManagementOperation(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  });
