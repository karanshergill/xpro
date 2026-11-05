import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { handleProfilePage, validateProfilePage } from "./profile-page.server";

export const getProfilePage = createServerFn({ method: "POST" }).validator(validateProfilePage)
  .handler(async ({ data }) => await handleProfilePage(data, { request: getRequest(), flags: env.FLAGS,
    settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } }));
