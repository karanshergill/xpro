import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { handleCreationPage, validateCreationPage } from "./creation-page.server";

export const getCreationPage = createServerFn({ method: "POST" }).validator(validateCreationPage)
  .handler(async ({ data }) => await handleCreationPage(data, { request: getRequest(),
    settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET },
  }));
