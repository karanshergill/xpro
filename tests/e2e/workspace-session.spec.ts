import { test, expect, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readBrowserMfaCode } from "./hub-fixture";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.XPRO_BROWSER_TEMP;
if (!base) throw new Error("Use the isolated browser runner.");
const fixtures: { logins: Record<string, { cookie: string; loginId: string; email: string }>; workspace: { id: string; origin: string } } =
  JSON.parse(await readFile(join(base, "fixtures.json"), "utf8"));
const hubOrigin = "https://hub.localhost:3001", origin = fixtures.workspace.origin, password = "Browser-fixture123!";
type Login = { email: string; loginId: string };
let pageErrors: string[] = [];
test.beforeEach(async ({ context }) => {
  pageErrors = [];
  context.on("page", (page) => page.on("pageerror", (error) => pageErrors.push(error.message)));
  for (const page of context.pages()) page.on("pageerror", (error) => pageErrors.push(error.message));
  await context.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) => route.fulfill({
    contentType: "application/javascript",
    body: "window.turnstile = { render(element, options) { queueMicrotask(() => options.callback('XXXX.DUMMY.TOKEN.XXXX')); return 'external-test-widget'; }, remove() {} };",
  }));
});
test.afterEach(() => expect(pageErrors).toEqual([]));

test("native workspace sign-in renders the protected page with the actual login", async ({ browser, page }) => {
  const login = await createTenant(browser);
  await openDraft(page, login);
  await expect(page.locator("#workspace-page")).toHaveAttribute("data-login-id", login.loginId);
  await expect(page.getByLabel("Notes")).toBeEnabled();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect((await page.context().cookies(origin)).some((cookie) => cookie.name === "__Host-xpro-session" && cookie.httpOnly && cookie.secure)).toBe(true);
});

test("later client navigation resets scrolling and back restores the previous position", async ({ browser, page }) => {
  await page.setViewportSize({ width: 1280, height: 240 });
  await openDraft(page, await createTenant(browser)); await expect(page.getByLabel("Notes")).toBeEnabled();
  const href = page.url(), next = page.getByRole("link", { name: "Another workspace page" });
  await next.scrollIntoViewIfNeeded(); const before = await page.evaluate(() => scrollY); expect(before).toBeGreaterThan(0);
  await next.click(); await expect(page).toHaveURL(origin + "/session-return");
  await expect(page.getByRole("heading", { name: "You’re signed in" })).toBeFocused();
  await expect.poll(async () => await page.evaluate(() => scrollY)).toBe(0);
  await page.goBack(); await expect(page).toHaveURL(href); await expect(page.getByLabel("Notes")).toBeEnabled();
  await expect.poll(async () => await page.evaluate(() => scrollY)).toBe(before);
});

test("native back, reload and initial fragments preserve document scrolling", async ({ browser, page }) => {
  await openDraft(page, await createTenant(browser)); await expect(page.getByLabel("Notes")).toBeEnabled();
  const href = page.url(); await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  const before = await page.evaluate(() => scrollY); expect(before).toBeGreaterThan(0);
  await page.goto(origin + "/"); await expect(page.getByRole("heading").first()).toBeFocused();
  await page.goBack(); await expect(page).toHaveURL(href); await expect(page.getByLabel("Notes")).toBeEnabled();
  await expect.poll(async () => await page.evaluate(() => scrollY)).toBe(before);
  await page.reload(); await expect(page.getByLabel("Notes")).toBeEnabled();
  await expect.poll(async () => await page.evaluate(() => scrollY)).toBe(before);
  await page.goto(origin + "/draft-check#draft-end"); await expect(page.getByLabel("Notes")).toBeEnabled();
  await expect(page.getByText("End of draft", { exact: true })).toBeInViewport();
});

test("expired actions keep the mounted draft and same-login return restores it without replay", async ({ browser, page }, info) => {
  const login = await createTenant(browser);
  await openDraft(page, login); await enterDraft(page);
  const before = await readDraft(page);
  let actionRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/_serverFn/") && request.headers()["x-page-login-id"]) actionRequests++;
  });
  await expireHubSession(page.context());
  await page.getByRole("button", { name: "Check access" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Your session has ended");
  await expect(page.locator("#workspace-page")).toHaveAttribute("inert", "");
  await expect(page.locator("#workspace-page")).toHaveAttribute("aria-hidden", "true");
  expect(await readDraft(page)).toEqual(before);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toContainText("Your session has ended");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("session-expired.png"), fullPage: true });
  const returned = await returnSignIn(page, login);
  await expect(returned.getByRole("heading", { name: "You’re signed in" })).toBeVisible();
  await expect(returned.getByRole("heading", { name: "You’re signed in" })).toBeFocused();
  await returned.close(); await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dialog).toHaveCount(0);
  expect(await readDraft(page)).toEqual(before);
  expect(actionRequests).toBe(1);
  await expect(page.getByRole("button", { name: "Check access" })).toBeEnabled();
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
});

test("expired navigation keeps the same route and a different login cannot unlock its draft", async ({ browser, page }) => {
  const login = await createTenant(browser);
  await openDraft(page, login); await enterDraft(page);
  const before = await readDraft(page);
  await expireHubSession(page.context());
  await page.getByRole("link", { name: "Another workspace page" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Your session has ended");
  expect(await readDraft(page)).toEqual(before);
  const master = fixtures.logins.masterSignIn;
  if (!master) throw new Error("Missing master fixture.");
  const returned = await returnSignIn(page, master);
  await expect(returned).toHaveURL(/\/mfa\?/);
  await returned.getByLabel("Authenticator code", { exact: true }).fill(await readBrowserMfaCode(master.loginId));
  await returned.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(returned.getByRole("heading", { name: "You’re signed in" })).toBeVisible();
  await returned.close(); await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alertdialog")).toContainText("different");
  expect(await readDraft(page)).toEqual(before);
  await expect(page.getByRole("button", { name: "Reload this page" })).toBeVisible();
  await page.getByRole("button", { name: "Reload this page" }).click();
  await expect(page.getByLabel("Notes")).toHaveValue("");
  await expect(page.locator("#workspace-page")).toHaveAttribute("data-login-id", master.loginId);
});


test("a failed navigation check keeps its draft and manual retry resumes only after a fresh read", async ({ browser, page }) => {
  const login = await createTenant(browser);
  await openDraft(page, login); await enterDraft(page);
  const before = await readDraft(page);
  // Interrupt the connection; no app endpoint or authentication result is substituted.
  await page.route("**/_serverFn/**", (route) => route.abort("failed"), { times: 1 });
  await page.getByRole("link", { name: "Another workspace page" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("We couldn’t check your access");
  await expect(page.getByRole("link", { name: "Sign in in a new tab" })).toHaveCount(0);
  expect(await readDraft(page)).toEqual(before);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await readDraft(page)).toEqual(before);
  await page.getByRole("link", { name: "Another workspace page" }).click();
  await expect(page).toHaveURL(origin + "/session-return");
  await expect(page.getByRole("heading", { name: "You’re signed in" })).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("a lost action reply is not replayed or mistaken for an ended session", async ({ browser, page }) => {
  const login = await createTenant(browser);
  await openDraft(page, login); await enterDraft(page);
  const before = await readDraft(page);
  let requestCount = 0;
  page.on("request", (request) => { if (request.headers()["x-page-login-id"]) requestCount++; });
  await page.route("**/_serverFn/**", async (route) => {
    const response = await forwardWorkspaceRequest(route);
    expect(response.status()).toBe(200);
    await route.abort("failed");
  }, { times: 1 });
  await page.getByRole("button", { name: "Check access" }).click();
  await expect(page.getByRole("status")).toContainText(["Connection failed", ""]);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await readDraft(page)).toEqual(before);
  expect(requestCount).toBe(1);
});

test("a delayed old refusal cannot relock a draft after the same login is freshly verified", async ({ browser, page }) => {
  const login = await createTenant(browser);
  await openDraft(page, login); await enterDraft(page);
  const before = await readDraft(page);
  await expireHubSession(page.context());
  let release: () => void = () => undefined, received: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const captured = new Promise<void>((resolve) => { received = resolve; });
  // Delay an actual refusal from the real endpoint; do not manufacture a result.
  await page.route("**/_serverFn/**", async (route) => {
    const response = await forwardWorkspaceRequest(route);
    expect(response.status()).toBe(401);
    received(); await held;
    await route.fulfill({ response });
  }, { times: 1 });
  try {
    await page.getByRole("button", { name: "Check access" }).click();
    await captured;
    await page.getByRole("link", { name: "Another workspace page" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Your session has ended");
    const returned = await returnSignIn(page, login);
    await expect(returned.getByRole("heading", { name: "You’re signed in" })).toBeVisible();
    await returned.close(); await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    release();
    await expect(page.getByRole("status")).toContainText(["Refused", ""]);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(await readDraft(page)).toEqual(before);
  } finally { release(); }
});

test("the session dialog supports keyboard focus, pseudo language, narrow RTL and dark mode", async ({ browser, page, context }, info) => {
  const login = await createTenant(browser);
  await openDraft(page, login);
  await context.addCookies([{ name: "PARAGLIDE_LOCALE", value: "en-XA", url: origin }]);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.reload(); await enterDraft(page);
  await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl"));
  const before = await readDraft(page);
  await expireHubSession(context);
  await page.getByRole("button", { name: "Check access" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-XA");
  await expect(dialog.getByRole("heading")).toContainText("⟦");
  await expect(dialog.getByRole("heading")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("link")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(await readDraft(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("session-expired-rtl-dark.png"), fullPage: true });
});

async function forwardWorkspaceRequest(route: Route) {
  return await route.fetch({ url: route.request().url().replace(origin, "https://127.0.0.1:3000"),
    headers: { ...await route.request().allHeaders(), host: "web.localhost:3000" } });
}

async function createTenant(browser: Browser): Promise<Login> {
  const creator = fixtures.logins.master;
  if (!creator) throw new Error("Missing master fixture.");
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    await context.addCookies(creator.cookie.split("; ").map((pair) => {
      const separator = pair.indexOf("=");
      return { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: hubOrigin, secure: true, httpOnly: true };
    }));
    const page = await context.newPage(); await page.goto(hubOrigin + "/no-workspace");
    const email = "draft-" + crypto.randomUUID() + "@example.test";
    const created = await page.evaluate(async ({ email, password, workspaceId }) => {
      const source = "/src/functions/create-login.functions.ts";
      const { createLogin } = await import(source);
      const response: Response = await createLogin({ data: {
        creationId: crypto.randomUUID(), email, password, username: "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7),
        name: "Draft owner", phone: { country: "US", number: "2025550123" }, workspaceId, kind: "internal",
      } });
      return { status: response.status, body: await response.json() };
    }, { email, password, workspaceId: fixtures.workspace.id });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ loginId: expect.any(String) });
    if (!created.body || typeof created.body !== "object" || !("loginId" in created.body) || typeof created.body.loginId !== "string") throw new Error("Missing created login ID.");
    return { email, loginId: created.body.loginId };
  } finally { await context.close(); }
}

async function openDraft(page: Page, login: Login): Promise<void> {
  await page.goto(origin + "/auth/start?returnTo=%2Fdraft-check%3Fview%3Dediting%23draft");
  expect(new URL(page.url()).pathname, await page.locator("body").innerText()).toBe("/sign-in");
  await signIn(page, login.email);
  await expect(page).toHaveURL(origin + "/draft-check?view=editing#draft");
  await expect(page.getByRole("heading", { name: "Unsaved draft fixture" })).toBeVisible();
}

async function signIn(page: Page, email: string): Promise<void> {
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await page.getByLabel("Email or username").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function expireHubSession(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(hubOrigin + "/no-workspace");
    expect(await page.evaluate(async () => (await fetch("/api/auth/sign-out", { method: "POST",
      headers: { "content-type": "application/json" }, body: "{}" })).status)).toBe(200);
  } finally { await page.close(); }
}

async function returnSignIn(page: Page, login: Login): Promise<Page> {
  const opened = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Sign in in a new tab" }).click();
  const popup = await opened;
  await signIn(popup, login.email);
  return popup;
}

async function enterDraft(page: Page): Promise<void> {
  await page.getByLabel("Notes").fill("An unsaved note");
  await page.getByLabel("Amount").fill("1,234.50");
  await page.getByLabel("Category").selectOption("review");
  await page.getByLabel("Confirmed").check();
}

async function readDraft(page: Page) {
  return { url: page.url(), note: await page.getByLabel("Notes").inputValue(), amount: await page.getByLabel("Amount").inputValue(),
    category: await page.getByLabel("Category").inputValue(), isConfirmed: await page.getByLabel("Confirmed").isChecked() };
}
