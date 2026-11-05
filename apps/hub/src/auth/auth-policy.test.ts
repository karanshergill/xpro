import { env } from "cloudflare:workers";
import { APIError } from "better-auth/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHubAuth, type HubAuthSettings } from "./auth.server";

const settings = {
  database: env.DB,
  baseURL: "https://hub.example.test",
  secret: `xpro-auth-test-${crypto.randomUUID()}`,
};

afterEach(() => vi.restoreAllMocks());

describe("Hub authentication configuration before migrations", () => {
  it.each(["", "short-secret"])("when the supplied secret is inadequate (%j) then setup stops", async (secret) => {
    await expect(createHubAuth({ ...settings, secret })).rejects.toThrow("at least 32 characters");
  });

  it.each(["http://hub.example.test", "invalid-url"])("when the Hub URL is unsafe (%s) then setup stops", async (baseURL) => {
    await expect(createHubAuth({ ...settings, baseURL })).rejects.toThrow();
  });

  it.each([
    { path: "/sign-up/email", method: "POST" },
    { path: "/is-username-available", method: "POST" },
    { path: "/admin/create-user", method: "POST" },
    { path: "/organization/create", method: "POST" },
    { path: "/oauth2/register", method: "POST" },
    { path: "/token", method: "GET" },
    ...["enable", "disable", "get-totp-uri", "send-otp", "verify-otp", "generate-backup-codes"]
      .map((action) => ({ path: "/two-factor/" + action, method: "POST" })),
  ])("when $method $path is requested then it is blocked even before the schema exists", async ({ path, method }) => {
    const auth = await prepareAuth();
    const request = new Request(`${settings.baseURL}/api/auth${path}`, {
      method,
      headers: { origin: settings.baseURL, "content-type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify({}) } : {}),
    });
    await expect(auth.handler(request)).resolves.toHaveProperty("status", 404);
  });

  it("when Better Auth allocates a record ID then the configured generator returns UUID v7", async () => {
    const context = await (await prepareAuth()).$context;
    expect(context.generateId({ model: "user" })).toMatch(/^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
  });

  it("when native authentication reports an error then Core records a fixed location and the supplied request ID", async () => {
    const requestContext = { requestId: crypto.randomUUID() };
    const context = await (await prepareAuth({ ...settings, requestContext })).$context;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    context.logger.error("Private database failure", { password: "private-password", authorization: "Bearer private-token" });
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      event: "core_unexpected_error",
      requestId: requestContext.requestId, app: "hub", operation: "accounts_native_auth",
    }));
  });

  it("when setup diagnostics have no HTTP request then Core assigns a fresh request ID without logging library data", async () => {
    const context = await (await prepareAuth()).$context;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    context.logger.error("Private setup failure", { secret: "private-secret" });
    expect(log).toHaveBeenCalledTimes(1);
    const events = log.mock.calls.map(([entry]) => JSON.parse(String(entry)));
    expect(events).toEqual([{ event: "core_unexpected_error", requestId: expect.any(String), app: "hub", operation: "accounts_native_auth" }]);
  });

  it.each([
    { name: "credential refusal", error: new APIError("UNAUTHORIZED", { message: "Private credentials" }), shouldReport: false },
    { name: "server failure", error: new APIError("INTERNAL_SERVER_ERROR", { message: "Private server details" }), shouldReport: true },
    { name: "unexpected exception", error: new Error("Private exception details"), shouldReport: true },
  ])("when the native API error hook receives a $name then reporting includes only the safe event and location when required", async ({ error, shouldReport }) => {
    const requestContext = { requestId: crypto.randomUUID() };
    const auth = await prepareAuth({ ...settings, requestContext });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    auth.options.onAPIError.onError(error);
    if (shouldReport) {
      expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
        event: "core_unexpected_error",
        requestId: requestContext.requestId, app: "hub", operation: "accounts_native_auth",
      }));
    } else {
      expect(log).not.toHaveBeenCalled();
    }
  });
});

async function prepareAuth(options: HubAuthSettings = settings): Promise<Awaited<ReturnType<typeof createHubAuth>>> {
  const auth = await createHubAuth(options);
  const context = await auth.$context;
  // The native preflight starts eagerly. Finish it before storage is reset.
  await expect(context.checkSchema?.()).rejects.toMatchObject({ code: "SCHEMA_MISMATCH", source: "database" });
  return auth;
}
