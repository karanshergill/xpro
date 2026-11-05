import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createErrorResponse, createRequestContext, parseInput } from "@xpro/core/server";
import { createLoginEntries } from "@xpro/accounts";
import { handleCreateLogin } from "./create-login.server";
import { createWorkspaceUsers } from "./workspace-users.server";

export const createLogin = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseInput(input, createLoginEntries).toJSON())
  .handler(async ({ data }) => {
    if (data.variant === "Err") return createErrorResponse(data.error, createRequestContext());
    return await handleCreateLogin(data.value, { request: getRequest(),
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET },
      workspaceUsers: createWorkspaceUsers({ database: env.DB, DISPATCHER: env.DISPATCHER, WORKSPACE_USERS: env.WORKSPACE_USERS }),
    });
  });
