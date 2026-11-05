import { test, expect, type BrowserContext, type Page, type Route, type APIResponse } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const origin = "https://hub.localhost:3001";
const base = process.env.XPRO_BROWSER_TEMP;
if (!base) throw new Error("Use the isolated browser runner.");
const fixtures: { logins: Record<string, { cookie: string; loginId: string; email: string }>; clientId: string } =
  JSON.parse(await readFile(join(base, "fixtures.json"), "utf8"));
let pageErrors: string[];
test.beforeEach(async ({ page }) => { pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message)); });
test.afterEach(() => { expect(pageErrors).toEqual([]); });

const combinations: Array<{ key: string; fields: string[] }> = [
  { key: "username", fields: ["username"] }, { key: "name", fields: ["name"] }, { key: "phone", fields: ["phone"] },
  { key: "usernameName", fields: ["username", "name"] }, { key: "usernamePhone", fields: ["username", "phone"] },
  { key: "namePhone", fields: ["name", "phone"] }, { key: "all", fields: ["username", "name", "phone"] },
];
for (const { key, fields } of combinations) test("only required fields are shown: " + key, async ({ page, context }, info) => {
  await signIn(context, key);
  const response = await page.goto("/complete-profile");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
  expect(response?.headers()["vary"]).toContain("cookie");
  await expect(page.getByRole("heading", { name: "Complete your profile" })).toBeFocused();
  await expect(page.getByLabel("Username", { exact: true })).toHaveCount(fields.includes("username") ? 1 : 0);
  await expect(page.getByLabel("Full name")).toHaveCount(fields.includes("name") ? 1 : 0);
  await expect(page.getByLabel("Country or region")).toHaveCount(fields.includes("phone") ? 1 : 0);
  await expect(page.getByLabel("Number", { exact: true })).toHaveCount(fields.includes("phone") ? 1 : 0);
  await expect(page.getByText("Your username can't be changed later", { exact: true })).toHaveCount(fields.includes("username") ? 1 : 0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  if (key === "all") await page.screenshot({ path: info.outputPath("complete-profile.png"), fullPage: true });
});

test("an anonymous visitor is sent to sign in and a complete profile skips the form", async ({ page, context }) => {
  await page.goto("/complete-profile");
  await expect(page).toHaveURL(origin + "/sign-in");
  await signIn(context, "complete");
  await page.goto("/complete-profile");
  await expect(page).toHaveURL(origin + "/stms/logins");
  await expect(page.getByRole("heading", { name: "Complete your profile", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Logins", exact: true })).toBeVisible();
});

test("server-rendered controls wait for JavaScript and use POST as their native method", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true, javaScriptEnabled: false });
  try {
    await signIn(context, "all"); const page = await context.newPage(); await page.goto("/complete-profile");
    await expect(page.locator("form")).toHaveAttribute("method", "post");
    await expect(page.getByLabel("Username", { exact: true })).toBeDisabled();
    await expect(page.getByRole("checkbox")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save and continue" })).toBeDisabled();
  } finally { await context.close(); }
});

test("submitting empty fields announces a summary and focuses the first invalid field", async ({ page, context }) => {
  await signIn(context, "invalid"); await page.goto("/complete-profile");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("alert")).toContainText("Check the details below");
  await expect(page.getByLabel("Username", { exact: true })).toBeFocused();
  await expect(page.locator("#username-error")).toBeVisible();
  await expect(page.locator("#name-error")).toBeVisible();
  await expect(page.locator("#phone-error")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("a corrected phone-only form can be submitted after validation fails", async ({ page, context }) => {
  await signIn(context, "phone");
  await page.goto("/complete-profile");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await fillProfile(page, "unused");
  await expect(page.getByLabel("Country or region")).toHaveValue("US");
  await expect(page.getByLabel("Number", {exact:true})).toHaveValue("2025550123");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(origin + "/no-workspace");
});

test("validation waits for blur, and keyboard users can confirm the warning", async ({ page, context }) => {
  await signIn(context, "blur"); await page.goto("/complete-profile");
  const username = page.getByLabel("Username", { exact: true });
  await username.fill("ABC");
  await expect(page.locator("#username-error")).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(page.locator("#username-error")).toHaveText("Use a valid username in the format shown.");
  await username.fill("keyuser");
  await page.keyboard.press("Tab");
  await expect(page.locator("#username-error")).toHaveCount(0);
  const checkbox = page.getByRole("checkbox");
  await expect(checkbox).toBeFocused();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
});

test("confirmation is required and changing a confirmed username clears it", async ({ page, context }) => {
  await signIn(context, "confirm"); await page.goto("/complete-profile");
  await fillProfile(page, "confuser");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("alert")).toContainText("Confirm your username");
  await expect(page.getByRole("checkbox")).toBeFocused();
  const before = await readNativeSession(page);
  expect(before).toMatchObject({ user: { username: null } });
  await page.getByRole("checkbox").check();
  await page.getByLabel("Username", { exact: true }).fill("otherusr");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
});

for (const [key, username, message] of [
  ["taken", "takenusr", "This username is already taken. Choose another."],
  ["reserved", "reserved", "This username is reserved. Choose another."],
]) test("server refuses a " + key + " username without losing entered details", async ({ page, context }) => {
  await signIn(context, key); await page.goto("/complete-profile");
  await fillProfile(page, username); await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("alert")).toContainText(message);
  await expect(page.getByLabel("Username", { exact: true })).toHaveValue(username);
  await expect(page.getByLabel("Username", { exact: true })).toBeFocused();
  if (key === "taken") {
    await expect(page.getByLabel("Full name")).toHaveValue("Browser person");
    await expect(page.getByLabel("Number", { exact: true })).toHaveValue("2025550123");
    await page.getByLabel("Username", { exact: true }).fill("newlogin");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page).toHaveURL(origin + "/no-workspace");
  }
});

test("a valid save completes the native profile and navigates without a leave warning", async ({ page, context }) => {
  await signIn(context, "save"); await page.goto("/complete-profile");
  let dialogs = 0;
  page.on("dialog", async (dialog) => { dialogs++; await dialog.dismiss(); });
  await fillProfile(page, "saveuser"); await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(origin + "/no-workspace");
  expect(dialogs).toBe(0);
  const session = await readNativeSession(page);
  expect(session).toMatchObject({ user: { username: "saveuser", name: "Browser person" } });
});

test("a pending save shows a disabled busy button and cannot be submitted twice", async ({ page, context }) => {
  await signIn(context, "busy"); await page.goto("/complete-profile");
  let release: (() => void) | undefined, count = 0;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_serverFn/**", async (route) => {
    count++; const response = await forwardRequest(route); await held; await route.fulfill({ response });
  });
  try {
    await fillProfile(page, "busyuser"); await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await page.keyboard.press("Enter");
    expect(count).toBe(1);
  } finally { release?.(); }
  await expect(page).toHaveURL(origin + "/no-workspace");
  expect(count).toBe(1);
});

test("a lost success reply preserves input and never retries the write automatically", async ({ page, context }) => {
  await signIn(context, "lostReply"); await page.goto("/complete-profile");
  let count = 0;
  await page.route("**/_serverFn/**", async (route) => {
    count++; await forwardRequest(route); await route.abort("connectionreset");
  });
  await fillProfile(page, "lostuser"); await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("alert")).toContainText("We couldn’t complete that request.");
  await expect(page.getByLabel("Username", { exact: true })).toHaveValue("lostuser");
  expect(count).toBe(1);
  const session = await readNativeSession(page);
  expect(session).toMatchObject({ user: { username: "lostuser" } });
  await page.unroute("**/_serverFn/**");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(origin + "/no-workspace");
});

test("an ended session leaves the entered values in place with a sign-in message", async ({ page, context }) => {
  await signIn(context, "expired"); await page.goto("/complete-profile");
  await fillProfile(page, "helduser"); await page.getByRole("checkbox").check();
  expect(await page.evaluate(async () => (await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).ok)).toBe(true);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("alert")).toContainText("Your session has ended.");
  await expect(page.getByLabel("Username", { exact: true })).toHaveValue("helduser");
  await expect(page.getByLabel("Full name")).toHaveValue("Browser person");
});

test("another tab completing the profile cannot be overwritten by a stale form", async ({ page, context, browser }) => {
  await signIn(context, "concurrent"); await page.goto("/complete-profile");
  await fillProfile(page, "lateuser"); await page.getByRole("checkbox").check();
  const second = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    await signIn(second, "concurrent"); const other = await second.newPage(); await other.goto("/complete-profile");
    await fillProfile(other, "firstusr"); await other.getByRole("checkbox").check();
    await other.getByRole("button", { name: "Save and continue" }).click();
    await expect(other).toHaveURL(origin + "/no-workspace");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page).toHaveURL(origin + "/no-workspace");
    const session = await readNativeSession(page);
    expect(session).toMatchObject({ user: { username: "firstusr" } });
  } finally { await second.close(); }
});

test("pseudo language, mobile width and RTL keep the form accessible without horizontal scrolling", async ({ page, context }) => {
  await signIn(context, "locale");
  await context.addCookies([{ name: "PARAGLIDE_LOCALE", value: "en-XA", url: origin }]);
  await page.setViewportSize({ width: 360, height: 900 }); await page.goto("/complete-profile");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-XA");
  await expect(page.getByRole("heading")).toContainText("⟦");
  await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("dark theme keeps the required fields and error state accessible", async ({ page, context }) => {
  await signIn(context, "dark"); await page.emulateMedia({ colorScheme: "dark" }); await page.goto("/complete-profile");
  await page.getByRole("button", { name: "Save and continue" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("signed workspace continuation survives errors and returns to its registered callback", async ({ page, context }) => {
  await signIn(context, "oauth");
  const state = "browser-state", challenge = createHash("sha256").update("browser-verifier-" + "x".repeat(40)).digest("base64url");
  const query = new URLSearchParams({ client_id: fixtures.clientId, redirect_uri: "https://workspace.example.test/auth/callback",
    response_type: "code", scope: "openid profile email", state, nonce: "browser-nonce", code_challenge: challenge, code_challenge_method: "S256" });
  await page.goto("/api/auth/oauth2/authorize?" + query.toString());
  await expect(page).toHaveURL(/\/complete-profile\?/);
  const signed = page.url(); expect(new URL(signed).searchParams.has("sig")).toBe(true);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("alert")).toBeVisible(); expect(page.url()).toBe(signed);
  await fillProfile(page, "unused");
  const [request] = await Promise.all([
    page.waitForRequest((value) => value.url().startsWith("https://workspace.example.test/auth/callback?")),
    page.getByRole("button", { name: "Save and continue" }).click(),
  ]);
  const callback = new URL(request.url());
  expect(callback.searchParams.get("code")).toBeTruthy(); expect(callback.searchParams.get("state")).toBe(state);
});

async function signIn(context: BrowserContext, key: string): Promise<void> {
  const login = fixtures.logins[key];
  if (!login) throw new Error("Missing isolated browser fixture: " + key);
  await context.addCookies(login.cookie.split("; ").map((cookie) => {
    const separator = cookie.indexOf("=");
    return { name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: origin, httpOnly: true, secure: true, sameSite: "Lax" as const };
  }));
}

async function fillProfile(page: Page, username: string): Promise<void> {
  const name = page.getByLabel("Full name"), phone = page.getByLabel("Number", { exact: true }), user = page.getByLabel("Username", { exact: true });
  if (await user.count()) await user.fill(username);
  if (await name.count()) await name.fill("Browser person");
  if (await phone.count()) { await page.getByLabel("Country or region").selectOption("US"); await phone.fill("2025550123"); }
}

async function readNativeSession(page: Page) {
  return await page.evaluate(async () => await (await fetch("/api/auth/get-session")).json());
}

async function forwardRequest(route: Route): Promise<APIResponse> {
  // Node's resolver need not implement the browser's *.localhost mapping.
  return await route.fetch({ url: route.request().url().replace(origin, "https://127.0.0.1:3001"),
    headers: { ...await route.request().allHeaders(), host: "hub.localhost:3001" } });
}
