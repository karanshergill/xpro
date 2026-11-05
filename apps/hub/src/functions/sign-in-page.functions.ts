import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { handleSignInPage, validateSignInPage } from "./sign-in-page.server";

export const getSignInPage = createServerFn({ method: "POST" })
  .validator(validateSignInPage)
  .handler(async ({ data }) => await handleSignInPage(data, {
    request: getRequest(), baseURL: env.BETTER_AUTH_URL, siteKey: env.TURNSTILE_SITE_KEY,
  }));
