import { test, expect, type APIResponse, type BrowserContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { browserOrigins } from "./addresses";
import { readBrowserMfaCode, withBrowserHub } from "./hub-fixture";

const base = process.env.XPRO_BROWSER_TEMP;
if (!base) throw new Error("Use the isolated browser runner.");
const fixtures: { logins: Record<string, { cookie: string; email: string; loginId: string }> } = JSON.parse(await readFile(join(base, "fixtures.json"), "utf8"));
const origin = browserOrigins.hub, password = "Browser-fixture123!";
let pageErrors: string[] = [];
test.use({ ignoreHTTPSErrors: false });
test.beforeEach(async ({ page, context }) => {
  pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message));
  await context.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) => route.fulfill({
    contentType: "application/javascript",
    body: "window.turnstile = { render(element, options) { queueMicrotask(() => options.callback('XXXX.DUMMY.TOKEN.XXXX')); return 'outside-widget'; }, remove() {} };",
  }));
});
test.afterEach(() => expect(pageErrors).toEqual([]));

test("when public pages, native APIs, redirects or refusals respond then all three Workers apply the shared browser policy", async ({ page, context }) => {
  const html = await page.goto(origin + "/sign-in"); if (!html) throw new Error("Missing real HTML response."); expectPolicy(html);
  const native = await context.request.get("https://127.0.0.1:3001/api/auth/ok", { headers: { host: "hub.localhost:3001" } });
  expect(native.status()).toBe(200); expectPolicy(native);
  const refusal = await context.request.get("https://127.0.0.1:3001/_serverFn/private-probe", { headers: { host: "hub.localhost:3001" } });
  expect(refusal.status()).toBe(403); expectPolicy(refusal);
  const start = await context.request.get("https://127.0.0.1:3000/auth/start", { headers: { host: "web.localhost:3000" }, maxRedirects: 0 });
  expect(start.status()).toBe(302); expectPolicy(start); expect(start.headersArray().some(({ name, value }) => name.toLowerCase() === "set-cookie" && value.startsWith("__Host-xpro-sign-in="))).toBe(true);
  const missing = await context.request.get("https://127.0.0.1:3002/unknown", { headers: { host: "missing.customer.test:3002" }, maxRedirects: 0 });
  expect(missing.status()).toBe(302); expectPolicy(missing);
  const refused = await context.request.post("https://127.0.0.1:3002/unknown", { headers: { host: "missing.customer.test:3002" }, maxRedirects: 0 });
  expect(refused.status()).toBe(403); expectPolicy(refused);
});

test("when a valid customer workspace is embedded then the browser blocks its protected document and sends no page referrer", async ({ page, context }) => {
  await addLogin(context, "securityMaster");
  await page.goto(browserOrigins.workspace + "/auth/start"); await expect(page.getByRole("heading", { name: "xpro", exact: true })).toBeFocused();
  await page.goto(browserOrigins.customer + "/auth/start"); await expect(page.getByRole("heading", { name: "xpro", exact: true })).toBeFocused();
  const target = browserOrigins.customer + "/?frame-probe=true", response = page.waitForResponse(target);
  await page.evaluate(async (url) => await new Promise<void>((resolve) => {
    const frame = document.createElement("iframe"); frame.id = "blocked-frame"; frame.title = "Protected framing probe";
    frame.onload = () => resolve(); frame.src = url; document.body.appendChild(frame);
  }), target);
  const protectedDocument = await response;
  expect(protectedDocument.status()).toBe(200);
  expect((await protectedDocument.request().allHeaders()).referer).toBeUndefined();
  await expect(page.locator("#blocked-frame").contentFrame().getByRole("heading", { name: "xpro", exact: true })).toHaveCount(0);
  expectPolicy(protectedDocument);
  await expect(page.getByRole("heading", { name: "xpro", exact: true })).toBeVisible();
});

test("when real sign-in and sign-out complete then credentials stay out of navigation URLs and Hub audit records", async ({ page, context }) => {
  const urls: string[] = [], codes: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin && url.origin !== browserOrigins.workspace) return;
    urls.push(url.href);
    if (url.origin === browserOrigins.workspace && url.pathname === "/auth/callback") { const code = url.searchParams.get("code"); if (code) codes.push(code); }
  });
  await page.goto(browserOrigins.workspace + "/auth/start");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await page.getByLabel("Email or username").fill(login("securityMaster").email); await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/mfa\?/);
  await page.getByLabel("Authenticator code", { exact: true }).fill(await readBrowserMfaCode(login("securityMaster").loginId));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(browserOrigins.workspace + "/"); await expect(page.getByRole("heading", { name: "xpro", exact: true })).toBeFocused();
  const cookies = (await context.cookies([origin, browserOrigins.workspace])).filter(({ name }) => name.includes("better-auth") || name === "__Host-xpro-session").map(({ value }) => value);
  await page.goto(origin + "/profile"); await expect(page.getByRole("heading", { name: "Your profile", exact: true })).toBeVisible();
  const sessionSecrets = await page.evaluate(async () => {
    const value: unknown = await (await fetch("/api/auth/get-session")).json();
    if (!value || typeof value !== "object" || !("session" in value) || !value.session || typeof value.session !== "object") throw new Error("Missing genuine native session.");
    return Object.entries(value.session).filter(([key, value]) => ["id", "token"].includes(key) && typeof value === "string").map(([, value]) => String(value));
  });
  await page.goto(browserOrigins.workspace + "/"); expect(await page.evaluate(async () => (await fetch("/auth/sign-out", { method: "POST" })).status)).toBe(200);
  await page.goto(browserOrigins.workspace + "/"); await expect(page).toHaveURL(/hub\.localhost:3001\/sign-in\?/);
  const diagnostics: unknown[][] = [], report = console.error;
  console.error = (...args) => { diagnostics.push(args); report(...args); };
  const audits = await withBrowserHub(async ({ db }) => await db.selectFrom("auditEntries").selectAll().execute())
    .finally(() => { console.error = report; });
  expect(diagnostics.length).toBe(0);
  expect(codes.length).toBeGreaterThan(0); expect(cookies.length).toBeGreaterThan(0); expect(sessionSecrets.length).toBeGreaterThan(0);
  const safeUrls = urls.map((raw) => { const url = new URL(raw); if (url.origin === browserOrigins.workspace && url.pathname === "/auth/callback") url.searchParams.delete("code"); return url.href; });
  const forbidden = ["password", "session", "session_token", "access_token", "refresh_token", "id_token", "id_token_hint", "logout_token", "client_secret", "authorization", "cookie"];
  const badParameters = urls.flatMap((raw) => { const url = new URL(raw); return [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()].filter((key) => forbidden.includes(key.toLowerCase())); });
  expect(badParameters).toEqual([]);
  const secrets = [password, ...codes, ...cookies, ...sessionSecrets], artifact = JSON.stringify({ urls: safeUrls, audits });
  expect(secrets.some((value) => artifact.includes(value) || artifact.includes(encodeURIComponent(value)))).toBe(false);
});

test("when a saved name contains HTML then the actual directory renders literal text instead of executing it", async ({ page, context }) => {
  await addLogin(context, "securityProfile"); await page.goto(origin + "/profile");
  const name = "<img src=x onerror='window.xproUnexpectedScript=true'>";
  await page.getByLabel("Full name").fill(name); await page.getByRole("button", { name: "Save details", exact: true }).click();
  await expect(page.getByText("Your details have been saved.")).toBeVisible();
  await context.clearCookies(); await addLogin(context, "securityMaster"); await page.goto(origin + "/stms/logins");
  await page.getByLabel("Search by name, email or username").fill(login("securityProfile").email); await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1); await expect(page.locator("tbody")).toContainText(name);
  await expect(page.locator("tbody img")).toHaveCount(0); expect(await page.evaluate(() => Reflect.get(window, "xproUnexpectedScript"))).toBeUndefined();
});

test("when the native logout confirmation submits without a referrer then its own CSP, cookies and same-origin CSRF checks still work", async ({ page, context }) => {
  await addLogin(context, "securityMaster");
  const response = await page.goto(origin + "/api/auth/oauth2/end-session"); if (!response) throw new Error("Missing native confirmation response.");
  expectPolicy(response); expect(response.headers()["content-security-policy"]).toContain("default-src 'none'");
  await expect(page.getByRole("heading", { name: "Confirm logout", exact: true })).toBeVisible();
  const submitted = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/auth/oauth2/end-session/confirm" && request.method() === "POST");
  await page.getByRole("button", { name: "Confirm logout", exact: true }).click();
  const headers = await (await submitted).allHeaders(); expect(headers.referer).toBeUndefined(); expect(headers.origin).toBe("null");
  await expect(page.locator('[data-oidc-logout-state="logged-out"]')).toBeVisible();
  await page.goto(origin + "/profile"); await expect(page).toHaveURL(origin + "/sign-in");
});

function login(key: string): { cookie: string; email: string; loginId: string } { const actor = fixtures.logins[key]; if (!actor) throw new Error("Missing security fixture."); return actor; }
async function addLogin(context: BrowserContext, key: string): Promise<void> {
  await context.addCookies(login(key).cookie.split("; ").map((part) => { const index = part.indexOf("="); return { name: part.slice(0, index), value: part.slice(index + 1), url: origin, httpOnly: true, secure: true, sameSite: "Lax" as const }; }));
}
function expectPolicy(response: Pick<APIResponse, "headers">): void {
  const headers = response.headers(); expect(headers["x-content-type-options"]).toBe("nosniff"); expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("no-referrer"); expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
}
