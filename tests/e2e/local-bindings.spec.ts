import { test, expect } from "@playwright/test";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { maximumPictureBytes } from "@xpro/accounts";
import { pictureFile } from "../support/picture-fixtures";

test("local HTTP service bindings preserve HTTPS before the real Hub and workspace checks", async () => {
  const root = process.env.XPRO_BROWSER_ROOT, base = process.env.XPRO_BROWSER_TEMP;
  if (!root || !base || !basename(base).startsWith("xpro-browser-") || dirname(await realpath(root)) !== base
    || JSON.parse(await readFile(join(base, "guard.json"), "utf8")).root !== root) throw new Error("Use the isolated browser runner.");
  const fixture: { workspace: { origin: string } } = JSON.parse(await readFile(join(base, "fixtures.json"), "utf8"));
  type Binding = { fetch(request: Request): Promise<Response> };
  const proxy = await getPlatformProxy<{ HUB: Binding; LOCAL_WORKSPACE: Binding }>({
    configPath: join(root, "apps/router/wrangler.jsonc"), environment: "local",
    persist: { path: join(root, "apps/router/.wrangler/state/v3") }, remoteBindings: false,
  });
  try {
    const discovery = await proxy.env.HUB.fetch(new Request("https://hub.localhost:3001/api/auth/.well-known/openid-configuration"));
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toMatchObject({ issuer: "https://hub.localhost:3001/api/auth" });
    const response = await proxy.env.LOCAL_WORKSPACE.fetch(new Request(fixture.workspace.origin + "/orders"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "core_unauthenticated", message: "Sign in to continue.",
      requestId: response.headers.get("x-request-id") });
    expect(response.headers.get("cache-control")).toBe("no-store");
  } finally { await proxy.dispose(); }
});

test("local Flagship picture policies use seeded login audiences and paused defaults", async () => {
  const root = process.env.XPRO_BROWSER_ROOT, base = process.env.XPRO_BROWSER_TEMP;
  if (!root || !base || !basename(base).startsWith("xpro-browser-") || dirname(await realpath(root)) !== base
    || JSON.parse(await readFile(join(base, "guard.json"), "utf8")).root !== root) throw new Error("Use the isolated browser runner.");
  const fixture: { logins: Record<string, { loginId: string }> } = JSON.parse(await readFile(join(base, "fixtures.json"), "utf8"));
  const proxy = await getPlatformProxy<{ FLAGS: Flagship }>({
    configPath: join(root, "apps/hub/wrangler.jsonc"), environment: "local",
    persist: { path: join(root, "apps/hub/.wrangler/state/v3") }, remoteBindings: false,
  });
  try {
    const paused = { canUpload: false, maximumBytes: maximumPictureBytes }, reducedMaximumBytes = 1_048_576;
    const values = await Promise.all([
      proxy.env.FLAGS.getObjectValue("accounts_picture_policy", paused, { targetingKey: fixture.logins.profilePicture.loginId }),
      proxy.env.FLAGS.getObjectValue("accounts_picture_policy", paused, { targetingKey: fixture.logins.profilePicturePaused.loginId }),
      proxy.env.FLAGS.getObjectValue("accounts_picture_policy", paused, { targetingKey: fixture.logins.profilePictureReduced.loginId }),
      proxy.env.FLAGS.getObjectValue("accounts_picture_policy", paused, { targetingKey: crypto.randomUUID() }),
      proxy.env.FLAGS.getObjectValue("accounts_picture_policy", paused),
      proxy.env.FLAGS.getObjectValue("missing_picture_policy", paused),
      proxy.env.FLAGS.getObjectValue("accounts_picture_policy_disabled", { canUpload: true, maximumBytes: maximumPictureBytes },
        { targetingKey: fixture.logins.profilePicture.loginId }),
    ]);
    expect(values).toEqual([
      { canUpload: true, maximumBytes: maximumPictureBytes }, paused,
      { canUpload: true, maximumBytes: reducedMaximumBytes }, paused, paused, paused, paused,
    ]);
  } finally { await proxy.dispose(); }
});

for (const scenario of [
  { name: "standard", login: "pictureUploadStandard", size: 0, status: 200 },
  { name: "paused", login: "pictureUploadPaused", size: 0, status: 503 },
  { name: "reduced at its boundary", login: "pictureUploadReduced", size: 1_048_576, status: 200 },
  { name: "reduced above its boundary", login: "pictureUploadReduced", size: 1_048_577, status: 413 },
]) {
  test("when the native Flagship policy is " + scenario.name + " then direct authenticated uploads follow it", async ({ request }) => {
    const root = process.env.XPRO_BROWSER_ROOT, base = process.env.XPRO_BROWSER_TEMP;
    if (!root || !base || !basename(base).startsWith("xpro-browser-") || dirname(await realpath(root)) !== base
      || JSON.parse(await readFile(join(base, "guard.json"), "utf8")).root !== root) throw new Error("Use the isolated browser runner.");
    const fixture: { logins: Record<string, { loginId: string; cookie: string }> } = JSON.parse(await readFile(join(base, "fixtures.json"), "utf8"));
    const login = fixture.logins[scenario.login];
    if (!login) throw new Error("Missing native picture-upload fixture.");
    const jpeg = Buffer.from(await pictureFile("jpeg").arrayBuffer());
    const buffer = Buffer.alloc(scenario.size || jpeg.byteLength); jpeg.copy(buffer);
    // The Node request client needs loopback DNS; retain the real Hub Host and Origin checks.
    const response = await request.post("https://127.0.0.1:3001/api/v1/profile-pictures", {
      headers: { host: "hub.localhost:3001", origin: "https://hub.localhost:3001", cookie: login.cookie, "x-page-login-id": login.loginId },
      multipart: { file: { name: "portrait.jpg", mimeType: "image/jpeg", buffer } },
    });
    expect(response.status()).toBe(scenario.status);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["set-cookie"]).toBeUndefined();
    expect(response.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(await response.json()).toEqual(scenario.status === 200 ? { loginId: login.loginId } : {
      code: scenario.status === 503 ? "accounts_picture_uploads_unavailable" : "accounts_picture_too_large",
      message: scenario.status === 503 ? "Picture uploads are temporarily unavailable. You can still remove your current picture."
        : "Use a picture within the current upload limit.",
      requestId: response.headers()["x-request-id"],
    });
  });
}
