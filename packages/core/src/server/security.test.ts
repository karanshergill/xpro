import { describe, expect, it } from "vitest";
import { secureResponse } from "@xpro/core/server";

const framePolicy = "frame-ancestors 'none'; base-uri 'none'; object-src 'none'";

describe("public response security", () => {
  it.each([200, 302, 400, 403, 404, 500])("when an app returns status %s then browser protections retain its response", async (status) => {
    const source = new Response("body", { status, headers: { "content-type": "text/html", "cache-control": "no-store", location: "https://workspace.example.test/auth/callback?code=one-use-code" } });
    const response = secureResponse(source);
    expect(response.status).toBe(status); expect(await response.text()).toBe("body");
    expect(response.headers.get("x-frame-options")).toBe("DENY"); expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(response.headers.get("content-security-policy")).toBe(framePolicy);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBe("https://workspace.example.test/auth/callback?code=one-use-code");
    expect(source.headers.get("x-frame-options")).toBeNull();
  });

  it("when native authentication sets its own CSP and multiple cookies then both survive the shared policy", () => {
    const headers = new Headers({ "content-security-policy": "default-src 'none'; form-action 'self'" });
    for (const value of ["session=first; Secure; HttpOnly; Expires=Thu, 01 Jan 2037 00:00:00 GMT", "pending=second; Secure; HttpOnly"]) headers.append("set-cookie", value);
    const response = secureResponse(new Response(null, { status: 302, headers }));
    expect(response.headers.getSetCookie()).toEqual(headers.getSetCookie());
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; form-action 'self', " + framePolicy);
  });

  it("when a redirect has immutable headers then the policy creates an editable response", () => {
    const source = Response.redirect("https://hub.example.test/sign-in", 302), response = secureResponse(source);
    expect(response.status).toBe(302); expect(response.headers.get("location")).toBe("https://hub.example.test/sign-in");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("when a body streams or is absent then protection does not buffer or invent a body", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("streamed")); controller.close(); } });
    const response = secureResponse(new Response(stream)); expect(await response.text()).toBe("streamed");
    const empty = secureResponse(new Response(null, { status: 204 })); expect(empty.status).toBe(204); expect(empty.body).toBeNull();
  });

  it("when an upgrade carries a WebSocket then the response keeps that connection", () => {
    const pair = new WebSocketPair(); pair[1].accept();
    const response = secureResponse(new Response(null, { status: 101, webSocket: pair[0] }));
    expect(response.status).toBe(101); expect(response.webSocket).toBe(pair[0]);
    response.webSocket?.accept(); response.webSocket?.close(1000); pair[1].close(1000);
  });
});
