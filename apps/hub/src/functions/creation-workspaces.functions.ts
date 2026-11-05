import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { handleCreationWorkspaces, validateCreationWorkspaces } from "./creation-workspaces.server";

export const getCreationWorkspaces = createServerFn({ method: "POST" }).validator(validateCreationWorkspaces)
  .handler(async ({ data }) => await handleCreationWorkspaces(data, { request: getRequest(),
    settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET },
  }));
