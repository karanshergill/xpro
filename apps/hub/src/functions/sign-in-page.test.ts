import { describe, expect, it, vi, afterEach } from "vitest";
import { handleSignInPage, validateSignInPage } from "./sign-in-page.server";

afterEach(() => vi.restoreAllMocks());
const origin = "https://hub.example.test", siteKey = "public-widget-site-key";

describe("public sign-in page data", () => {
  it.each(["GET", "POST"])("when the configured page is read with %s then only its public site key is returned", async (method) => {
    const response = await readPage({ method });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ siteKey });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each(["wrong page", "foreign URL", "PUT", "missing POST Origin", "foreign POST Origin"])(
    "when a read has %s then no configuration is disclosed", async (fault) => {
      const response = await readPage({
        ...(fault === "wrong page" ? { path: "/other" } : {}),
        ...(fault === "foreign URL" ? { urlOrigin: "https://other.example.test" } : {}),
        ...(fault === "PUT" ? { method: "PUT" } : {}),
        ...(fault === "missing POST Origin" ? { method: "POST", origin: null } : {}),
        ...(fault === "foreign POST Origin" ? { method: "POST", origin: "https://other.example.test" } : {}),
      });
      await expectFailure(response, { status: 403, code: "core_forbidden" });
    },
  );

  it.each([null, { siteKey: "caller-key" }, { loginId: "private-login", secret: "private-secret" }])(
    "when the caller supplies page state then strict empty input refuses it", async (input) => {
      await expectFailure(await readPage({ input }), { status: 400, code: "core_invalid_input" });
    },
  );

  it.each(["", "   "])("when the public site key is absent then the page returns one correlated safe error", async (siteKey) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await readPage({ siteKey });
    await expectFailure(response, { status: 500, code: "core_unexpected_error" });
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "accounts_sign_in_page" })]]);
  });

  it("when a caller supplies a request ID then each read replaces it with a fresh ID", async () => {
    const first = await readPage(), second = await readPage();
    expect(first.headers.get("x-request-id")).not.toBe("caller-controlled-id");
    expect(first.headers.get("x-request-id")).not.toBe(second.headers.get("x-request-id"));
  });
});

async function readPage(options: { method?: string; path?: string; urlOrigin?: string; origin?: string | null; input?: unknown; siteKey?: string } = {}): Promise<Response> {
  const method = options.method ?? "GET", headers = new Headers({ "x-request-id": "caller-controlled-id" });
  if (method === "POST" && options.origin !== null) headers.set("origin", options.origin ?? origin);
  return await handleSignInPage(validateSignInPage("input" in options ? options.input : {}), {
    request: new Request((options.urlOrigin ?? origin) + (options.path ?? "/sign-in"), { method, headers }),
    baseURL: origin, siteKey: options.siteKey ?? siteKey,
  });
}

async function expectFailure(response: Response, expected: { status: number; code: string }): Promise<void> {
  expect(response.status).toBe(expected.status);
  expect(await response.json()).toEqual({ code: expected.code, message: expect.any(String),
    requestId: response.headers.get("x-request-id"), ...(expected.code === "core_invalid_input" ? { fields: [] } : {}) });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.getSetCookie()).toEqual([]);
}
