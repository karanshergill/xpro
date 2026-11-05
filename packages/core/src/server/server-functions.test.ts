import { createRequestContext, maxJsonBodyBytes } from "@xpro/core/server";
import { describe, expect, it } from "vitest";
import { prepareServerFunctionRequest } from "./server-functions.server";

const origin = "https://hub.example.test";
const url = origin + "/_serverFn/test-function";
describe("shared server function request boundary", () => {
  it("when bounded JSON passes input checks then its exact serialized contents reach Start", async () => {
    const body = JSON.stringify({ t: 10, i: 0, p: { k: ["data"], v: [{ t: 1, s: "RPC value" }] } });
    const result = await prepareServerFunctionRequest(new Request(url, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body,
    }), { baseURL: origin, context: createRequestContext() });
    expect(result).toBeInstanceOf(Request);
    if (result instanceof Response) throw new Error("Valid RPC JSON must be forwarded.");
    expect(await result.text()).toBe(body);
    expect(result.url).toBe(url);
  });

  it.each(["GET", "PUT", "DELETE"])("when a server function is called with %s then it is refused before parsing", async (method) => {
    const result = await prepareServerFunctionRequest(new Request(url, { method, headers: { origin } }), { baseURL: origin, context: createRequestContext() });
    await expectFailure(result, 403, "core_forbidden");
  });

  it.each(["https://other.test", "https://sibling.hub.example.test", ""])("when the Origin is %s then the request is refused", async (submittedOrigin) => {
    await expectFailure(await prepareServerFunctionRequest(new Request(url, {
      method: "POST", headers: { origin: submittedOrigin, "content-type": "application/json" }, body: "{}",
    }), { baseURL: origin, context: createRequestContext() }), 403, "core_forbidden");
  });

  it("when a JSON body exceeds the byte limit despite a false Content-Length then it is refused safely", async () => {
    const result = await prepareServerFunctionRequest(new Request(url, { method: "POST",
      headers: { origin, "content-type": "application/json", "content-length": "1" }, body: "x".repeat(maxJsonBodyBytes + 1),
    }), { baseURL: origin, context: createRequestContext() });
    await expectFailure(result, 413, "core_request_too_large");
  });

  it.each([
    { contentType: "text/plain", body: "{}", status: 415, code: "core_unsupported_media_type" },
    { contentType: "application/json", body: "private-invalid-json", status: 400, code: "core_invalid_input" },
  ])("when input uses $contentType and invalid content then only the safe error is returned", async ({ contentType, body, status, code }) => {
    const result = await prepareServerFunctionRequest(new Request(url, { method: "POST", headers: { origin, "content-type": contentType }, body }), { baseURL: origin, context: createRequestContext() });
    await expectFailure(result, status, code);
  });
});

async function expectFailure(result: Request | Response, status: number, code: string): Promise<void> {
  expect(result).toBeInstanceOf(Response);
  if (result instanceof Request) throw new Error("The request must be refused before native deserialization.");
  expect(result.status).toBe(status);
  expect(await result.json()).toEqual({ code, message: expect.any(String), requestId: result.headers.get("x-request-id"),
    ...(code === "core_invalid_input" ? { fields: [] } : {}) });
  expect(result.headers.get("cache-control")).toBe("no-store");
}
