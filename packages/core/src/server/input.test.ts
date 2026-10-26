import { err, ok } from "true-myth/result";
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { maxJsonBodyBytes, parseInput, readJsonInput } from "./input.server";

describe("server input", () => {
  it("when input is valid then schema transformations return only declared fields", () => {
    const input = { name: "  Example  ", count: "12" };
    const result = parseInput(input, {
      name: v.pipe(v.string(), v.trim()),
      count: v.pipe(v.string(), v.toNumber()),
    });
    expect(result.toJSON()).toEqual(ok({ name: "Example", count: 12 }).toJSON());
    expect(input).toEqual({ name: "  Example  ", count: "12" });
  });

  it("when several fields are invalid then all known field names are returned once", () => {
    const result = parseInput({ email: "x", password: 123 }, {
      email: v.pipe(v.string(), v.email(), v.minLength(5)),
      password: v.string(),
    });
    expect(result.toJSON()).toEqual(err({ code: "core_invalid_input", fields: ["email", "password"] }).toJSON());
  });

  it("when validation messages contain private values then those messages are not returned", () => {
    const result = parseInput({ password: "private-password" }, {
      password: v.literal("expected-secret", "Rejected private-password and expected-secret"),
    });
    expect(result.toJSON()).toEqual(err({ code: "core_invalid_input", fields: ["password"] }).toJSON());
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("private-password");
  });

  it("when an undeclared field is submitted then it is refused without exposing its name", () => {
    expect(parseInput({ name: "Example", "private@example.test": "master" }, { name: v.string() }).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: [] }).toJSON());
  });

  it.each([{ input: undefined }, { input: null }, { input: 123 }, { input: "text" }, { input: ["value"] }])(
    "when the input is not an object ($input) then it is refused",
    ({ input }) => {
      expect(parseInput(input, { name: v.string() }).toJSON())
        .toEqual(err({ code: "core_invalid_input", fields: [] }).toJSON());
    },
  );

  it("when UTF-8 JSON arrives in separate chunks then it is decoded and validated", async () => {
    const bytes = new TextEncoder().encode('{"name":"é🙂"}');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    expect((await readJsonInput(createJsonRequest(body), { name: v.string() })).toJSON())
      .toEqual(ok({ name: "é🙂" }).toJSON());
  });

  it("when JSON is exactly at the byte limit then it is accepted", async () => {
    const value = "a".repeat(maxJsonBodyBytes - JSON.stringify({ value: "" }).length);
    expect((await readJsonInput(createJsonRequest(JSON.stringify({ value })), { value: v.string() })).toJSON())
      .toEqual(ok({ value }).toJSON());
  });

  it("when JSON exceeds the byte limit then it is refused", async () => {
    const body = JSON.stringify({ value: "small" }) + " ".repeat(maxJsonBodyBytes);
    expect((await readJsonInput(createJsonRequest(body), { value: v.string() })).toJSON())
      .toEqual(err({ code: "core_request_too_large" }).toJSON());
  });

  it("when a streamed body exceeds the limit then reading stops and the source is cancelled", async () => {
    let isCancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new Uint8Array(maxJsonBodyBytes));
      },
      cancel() {
        isCancelled = true;
      },
    });
    const request = createJsonRequest(body, { "content-length": "1" });
    expect((await readJsonInput(request, { value: v.string() })).toJSON())
      .toEqual(err({ code: "core_request_too_large" }).toJSON());
    expect(isCancelled).toBe(true);
    expect(request.body?.locked).toBe(false);
  });

  it("when cancellation fails after the body exceeds the limit then it still reports the size limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(maxJsonBodyBytes + 1));
      },
      cancel() {
        throw new Error("Private stream cancellation detail");
      },
    });
    expect((await readJsonInput(createJsonRequest(body), { value: v.string() })).toJSON())
      .toEqual(err({ code: "core_request_too_large" }).toJSON());
  });

  it("when Unicode text fits by character count but exceeds the byte limit then it is refused", async () => {
    const body = JSON.stringify({ value: "é".repeat(maxJsonBodyBytes / 2) });
    expect(body.length).toBeLessThan(maxJsonBodyBytes);
    expect((await readJsonInput(createJsonRequest(body), { value: v.string() })).toJSON())
      .toEqual(err({ code: "core_request_too_large" }).toJSON());
  });

  it.each(["text/plain", "application/x-www-form-urlencoded"])(
    "when the content type is %s then JSON input is refused",
    async (contentType) => {
      expect((await readJsonInput(createJsonRequest("{}", { "content-type": contentType }), {})).toJSON())
        .toEqual(err({ code: "core_unsupported_media_type" }).toJSON());
    },
  );

  it("when the content type is missing then JSON input is refused", async () => {
    const request = createJsonRequest("{}");
    request.headers.delete("content-type");
    expect((await readJsonInput(request, {})).toJSON())
      .toEqual(err({ code: "core_unsupported_media_type" }).toJSON());
  });

  it("when JSON has a charset parameter then it is accepted", async () => {
    expect((await readJsonInput(createJsonRequest('{"name":"Example"}', {
      "content-type": "Application/JSON; charset=utf-8",
    }), { name: v.string() })).toJSON()).toEqual(ok({ name: "Example" }).toJSON());
  });

  it.each(["", "{broken", "null", "[]"])(
    "when JSON is missing, malformed or not an object (%s) then it is refused",
    async (body) => {
      expect((await readJsonInput(createJsonRequest(body), { name: v.string() })).toJSON())
        .toEqual(err({ code: "core_invalid_input", fields: [] }).toJSON());
    },
  );

  it("when no request body exists then it is refused", async () => {
    const request = new Request("https://xpro.example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect((await readJsonInput(request, { name: v.string() })).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: [] }).toJSON());
  });

  it("when the body contains invalid UTF-8 then it is refused", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff]));
        controller.close();
      },
    });
    expect((await readJsonInput(createJsonRequest(body), {})).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: [] }).toJSON());
  });

  it("when the request stream fails then a safe input error is returned", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("Private request body detail"));
      },
    });
    expect((await readJsonInput(createJsonRequest(body), {})).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: [] }).toJSON());
  });

  it("when a schema transformation has a programming error then it is not hidden as bad input", async () => {
    const failure = new Error("Schema programming error");
    const entries = { name: v.pipe(v.string(), v.transform(() => { throw failure; })) };
    await expect(readJsonInput(createJsonRequest('{"name":"Example"}'), entries)).rejects.toBe(failure);
  });
});

function createJsonRequest(body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}): Request {
  return new Request("https://xpro.example.test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}
