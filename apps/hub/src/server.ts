import { paraglideMiddleware } from "#paraglide/server.js";
import handler from "@tanstack/react-start/server-entry";
import { handleReadPicture } from "#functions/picture-read.server.ts";
import { handleHubRequest } from "#auth/hub.server.ts";
import { createRequestContext, prepareServerFunctionRequest, secureResponse } from "@xpro/core/server";
import { handleUploadPicture } from "#functions/picture.server.ts";

export { HubAccess } from "#auth/hub-access.server.ts";
export { HubPlacement } from "#placement/placement.server.ts";

// Service-binding consumers compile this entrypoint without the Hub's global types.
type AuthEnvironment = {
  DB: D1Database; BETTER_AUTH_URL: string; BETTER_AUTH_SECRET: string;
  TURNSTILE_SECRET_KEY: string; TURNSTILE_SITE_KEY: string; SIGN_IN_RATE_LIMITER: RateLimit;
  PROFILE_PICTURES: R2Bucket; IMAGES: ImagesBinding;
  FLAGS?: Pick<Flagship, "getObjectValue">;
};

export default {
  async fetch(request: Request, env: AuthEnvironment): Promise<Response> {
    return secureResponse(await handleRequest(request, env));
  },
} satisfies ExportedHandler<AuthEnvironment>;

async function handleRequest(request: Request, env: AuthEnvironment): Promise<Response> {
  if (new URL(request.url).pathname.startsWith("/api/v1/profile-pictures/")) {
    return await handleReadPicture({ request, pictures: env.PROFILE_PICTURES,
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET } });
  }
  if (new URL(request.url).pathname === "/api/v1/profile-pictures") {
    return await handleUploadPicture({ request, pictures: env.PROFILE_PICTURES, images: env.IMAGES, flags: env.FLAGS,
      settings: { database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET },
    });
  }
  if (new URL(request.url).pathname.startsWith("/_serverFn/")) {
    const prepared = await prepareServerFunctionRequest(request, { baseURL: env.BETTER_AUTH_URL, context: createRequestContext() });
    return prepared instanceof Response ? prepared : await renderHub(prepared);
  }
  const response = await handleHubRequest(request, {
    database: env.DB, baseURL: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET,
    turnstileSecret: env.TURNSTILE_SECRET_KEY, rateLimiter: env.SIGN_IN_RATE_LIMITER,
  });
  return response ?? await renderHub(request);
}

async function renderHub(request: Request): Promise<Response> {
  const response = await paraglideMiddleware(request, () => handler.fetch(request));
  const pathname = new URL(request.url).pathname;
  const isPrivate = ["/mfa", "/account", "/complete-profile", "/sign-in", "/no-workspace", "/create-login", "/profile", "/stms"].includes(pathname) || pathname.startsWith("/stms/");
  if (!isPrivate) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.append("vary", "cookie");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
