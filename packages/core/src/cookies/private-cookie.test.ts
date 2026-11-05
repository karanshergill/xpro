import { createPrivateCookie, readPrivateCookie, clearPrivateCookie } from "./private-cookie.server";
import { afterEach, describe, expect, it, vi } from "vitest";

const settings = { name: "__Host-fixture", secret: "private-cookie-fixture-" + "s".repeat(32), audience: "workspace-one", maxAge: 600 };
afterEach(() => { vi.useRealTimers(); });
function request(cookie: string) { return new Request("https://workspace.example.test", { headers: { cookie } }); }

describe("private browser cookies", () => {
  it("when a private cookie is issued then its contents are encrypted, bound to this audience and protected by browser attributes", async () => {
    const value = { verifier: "secret-verifier", state: crypto.randomUUID() };
    const header = await createPrivateCookie(value, settings);
    expect(header).not.toContain(value.verifier);
    expect(header).toContain("Secure");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=600");
    expect(header).not.toContain("Domain=");
    expect(await readPrivateCookie(request(header.split(";")[0] ?? ""), settings)).toEqual(value);
  });

  it.each(["secret", "audience", "name", "value", "duplicate", "missing", "malformed"] as const)("when the cookie has a different %s then it cannot authenticate the transaction", async (fault) => {
    const header = (await createPrivateCookie({ state: crypto.randomUUID() }, settings)).split(";")[0] ?? "";
    const changed = { ...settings };
    let cookie = header;
    if (fault === "secret") changed.secret = "different-secret-" + "x".repeat(32);
    if (fault === "audience") changed.audience = "workspace-two";
    if (fault === "name") changed.name = "__Host-other";
    if (fault === "value") cookie = header.slice(0, header.indexOf("=") + 1) + "changed" + header.slice(-15);
    if (fault === "duplicate") cookie = header + "; " + header;
    if (fault === "missing") cookie = "";
    if (fault === "malformed") cookie = settings.name + "=invalid%%%";
    expect(await readPrivateCookie(request(cookie), changed)).toBeNull();
  });

  it("when browser expiry is ignored then the authenticated server expiry still refuses the cookie", async () => {
    const header = (await createPrivateCookie({}, settings)).split(";")[0] ?? "";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + settings.maxAge * 1000);
    expect(await readPrivateCookie(request(header), settings)).toBeNull();
  });

  it("when a cookie is cleared then it uses the same host/path protection and expires immediately", () => {
    expect(clearPrivateCookie(settings.name)).toBe("__Host-fixture=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax");
  });

  it("when the supplied secret is too short or contents exceed a browser cookie then issuance fails", async () => {
    await expect(createPrivateCookie({}, { ...settings, secret: "short" })).rejects.toThrow("at least 32");
    await expect(createPrivateCookie({ input: "x".repeat(4000) }, settings)).rejects.toThrow("size limit");
  });
});
