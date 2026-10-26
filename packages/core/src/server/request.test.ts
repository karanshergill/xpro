import { describe, expect, it } from "vitest";
import * as v from "valibot";
import { createRequestContext, readForwardedRequestContext, requestIdHeader } from "./request";

describe("request context", () => {
  it("when two requests are started then each gets a fresh ID and separate context", () => {
    const first = createRequestContext();
    const second = createRequestContext();
    expect(v.is(v.pipe(v.string(), v.uuid()), first.requestId)).toBe(true);
    expect(v.is(v.pipe(v.string(), v.uuid()), second.requestId)).toBe(true);
    expect(first.requestId).not.toBe(second.requestId);
    expect(first).not.toBe(second);
    expect(Object.keys(first)).toEqual(["requestId"]);
  });

  it("when an internal call forwards its ID then the next worker keeps that ID", () => {
    const context = createRequestContext();
    const request = new Request("https://xpro.example.test", {
      headers: {
        [requestIdHeader]: context.requestId,
        "x-user-role": "master",
        "x-workspace-id": "another-workspace",
      },
    });
    expect(readForwardedRequestContext(request)).toEqual(context);
    expect(request.headers.get(requestIdHeader)).toBe(context.requestId);
  });

  it.each([null, "not-an-id", "private@example.test", "a".repeat(1000)])(
    "when the forwarded ID is %s then a new valid ID is used",
    (requestId) => {
      const request = new Request("https://xpro.example.test", {
        headers: requestId === null ? {} : { [requestIdHeader]: requestId },
      });
      const context = readForwardedRequestContext(request);
      expect(v.is(v.pipe(v.string(), v.uuid()), context.requestId)).toBe(true);
      expect(context.requestId).not.toBe(requestId);
    },
  );
});
