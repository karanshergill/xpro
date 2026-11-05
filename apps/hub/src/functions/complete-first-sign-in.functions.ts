import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { handleFirstSignIn, validateFirstSignIn } from "./complete-first-sign-in.server";

export const completeFirstSignIn = createServerFn({ method: "POST" })
  .validator(validateFirstSignIn)
  .handler(async ({ data }) => await handleFirstSignIn(data, {
    request: getRequest(),
    settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET },
  }));
