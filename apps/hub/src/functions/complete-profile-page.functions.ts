import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { handleCompletionPage, validateCompletionPage } from "./complete-profile-page.server";

export const getCompletionPage = createServerFn({ method: "POST" })
  .validator(validateCompletionPage)
  .handler(async ({ data }) => await handleCompletionPage(data, {
    request: getRequest(),
    settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET },
  }));
