import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { handleMfaPage, validateMfaPage } from "./mfa-page.server";

export const getMfaPage = createServerFn({ method: "POST" }).validator(validateMfaPage)
  .handler(async ({ data }) => await handleMfaPage(data, { request: getRequest(),
    settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } }));
