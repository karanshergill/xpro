import { err, ok } from "true-myth/result";
import { string } from "valibot";
import { describe, expect, it } from "vitest";
import { maxJsonBodyBytes, readFormInput } from "./input.server";

describe("bounded protocol form input", () => {
  it("when a UTF-8 URL-encoded form has the declared fields then it returns decoded values", async () => {
    expect((await readFormInput(form("logout_token=hello%2Bworld"), { logout_token: string() })).toJSON())
      .toEqual(ok({ logout_token: "hello+world" }).toJSON());
  });
  it.each(["logout_token=a&logout_token=b", "unknown=a&unknown=b", "unknown=a"])("when a form duplicates or adds fields then it is refused (%s)", async (body) => {
    const result = await readFormInput(form(body), { logout_token: string() });
    expect(result.isErr).toBe(true);
    expect(JSON.stringify(result.toJSON())).not.toContain("unknown");
  });
  it("when Content-Length understates a streamed body then the actual byte limit is still enforced", async () => {
    expect((await readFormInput(form("logout_token=" + "a".repeat(maxJsonBodyBytes)), { logout_token: string() })).toJSON())
      .toEqual(err({ code: "core_request_too_large" }).toJSON());
  });
  it("when a protocol form has the wrong content type then parsing is refused", async () => {
    const request = new Request("https://example.test", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect((await readFormInput(request, {})).toJSON()).toEqual(err({ code: "core_unsupported_media_type" }).toJSON());
  });
});

function form(body: string): Request {
  return new Request("https://example.test", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "1" }, body });
}
