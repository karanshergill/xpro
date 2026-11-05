import { test, expect, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readBrowserMfaCode } from "./hub-fixture";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { browserOrigins } from "./addresses";
import { squarePicture } from "../support/picture-fixtures";

const base = process.env.XPRO_BROWSER_TEMP;
if (!base) throw new Error("Use the isolated browser runner.");
type Login = { email: string; cookie: string; loginId: string; username: string | null };
const fixtures: { logins: Record<string, Login> } = JSON.parse(await readFile(join(base, "fixtures.json"), "utf8"));
const origin = browserOrigins.hub, password = "Browser-fixture123!", maximumTabStops = 80;
const connection = { urlPattern: "", latency: 50, downloadThroughput: 1_250_000, uploadThroughput: 250_000 };
let pageErrors: string[] = [];

test.use({ ignoreHTTPSErrors: false });
test.beforeEach(async ({ context }) => {
  pageErrors = [];
  const observe = (page: Page) => page.on("pageerror", (error) => pageErrors.push(error.message));
  context.on("page", observe); for (const page of context.pages()) observe(page);
  // Only the outside verification SDK is substituted; native sign-in remains real.
  await context.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) => route.fulfill({
    contentType: "application/javascript",
    body: "window.turnstile = { render(element, options) { queueMicrotask(() => options.callback('XXXX.DUMMY.TOKEN.XXXX')); return 'outside-widget'; }, remove() {} };",
  }));
});
test.afterEach(() => expect(pageErrors).toEqual([]));

for (const [key, path, heading] of [
  ["a11yUnassigned", "/no-workspace", "Workspace access"],
  ["a11yAccount", "/account", "Your account"],
]) test("when a keyboard user reaches " + path + " then the destination is named, focused and accessible", async ({ page, context }) => {
  await addLogin(context, key); await page.goto(origin + path);
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeFocused();
  await scan(page);
});

test("when sign-in is operated by keyboard then paste and silent autofill work through loading and error states", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.goto(origin + "/sign-in"); await expect(page.getByRole("heading", { name: "Sign in to xpro" })).toBeFocused();
  const identifier = page.getByLabel("Email or username"), secret = page.getByLabel("Password", { exact: true });
  const submit = page.getByRole("button", { name: "Sign in", exact: true }); await expect(submit).toBeEnabled();
  await tabTo(page, submit); await page.keyboard.press("Enter");
  await expect(identifier).toBeFocused(); await scan(page);
  for (const [control, value] of [[identifier, login("a11yUnassigned").email], [secret, "Wrong-password123!"]] as const) {
    await tabTo(page, control); await page.evaluate(async (text) => navigator.clipboard.writeText(text), value);
    await page.keyboard.press("ControlOrMeta+V"); await expect(control).toHaveValue(value);
  }
  let release: (() => void) | undefined; const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/auth/sign-in/email", async (route) => { await held; await route.continue(); }, { times: 1 });
  try {
    await tabTo(page, submit); await page.keyboard.press("Enter");
    await expect(page.locator("form")).toHaveAttribute("aria-busy", "true"); await expect(secret).toBeDisabled();
    await expect(page.getByRole("button", { name: "Signing in…", exact: true })).toBeDisabled(); await scan(page);
  } finally { release?.(); }
  await expect(page.getByRole("alert")).toBeFocused(); await expect(page.getByRole("alert")).toContainText("Incorrect email, username or password");
  await expect(identifier).toHaveValue(login("a11yUnassigned").email); await scan(page);
  await tabTo(page, secret);
  // Native password managers can update an input without React change events.
  await secret.evaluate((element, value) => { if (!(element instanceof HTMLInputElement)) throw new Error("Missing native password input."); element.value = value; }, password);
  await tabTo(page, submit); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(origin + "/no-workspace"); await scan(page);
});

test("when completion is operated only by keyboard then the warning and required country can be confirmed and saved", async ({ page, context }) => {
  await addLogin(context, "a11yIncomplete"); await page.goto(origin + "/complete-profile");
  await expect(page.getByRole("heading", { name: "Complete your profile" })).toBeFocused();
  await tabTo(page, page.getByRole("button", { name: "Save and continue" })); await page.keyboard.press("Enter");
  await expect(page.getByLabel("Username", { exact: true })).toBeFocused(); await scan(page);
  await write(page, { control: page.getByLabel("Username", { exact: true }), value: "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7) });
  await tabTo(page, page.getByRole("checkbox")); await page.keyboard.press("Space"); await expect(page.getByRole("checkbox")).toBeChecked();
  await write(page, { control: page.getByLabel("Full name"), value: "Keyboard person" });
  await choose(page, { control: page.getByLabel("Country or region"), value: "US" });
  await write(page, { control: page.getByLabel("Number", { exact: true }), value: "2025550199" });
  await tabTo(page, page.getByRole("button", { name: "Save and continue" })); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(origin + "/no-workspace"); await scan(page);
});

for (const kind of ["internal", "external"] as const) test("when private " + kind + " creation uses only keyboard then sign-in reaches its accessible destination", async ({ page, context }) => {
  await addLogin(context, "createOwner"); await page.goto(origin + "/create-login");
  await expect(page.getByRole("heading", { name: "Create a login", exact: true })).toBeFocused();
  await choose(page, { control: page.getByLabel("User type"), value: kind });
  const values = { email: "keyboard-" + crypto.randomUUID() + "@example.test", username: "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7) };
  for (const [label, value] of [["Email", values.email], ["Username", values.username], ["Full name", "Keyboard created"], ["Password", password]]) {
    await write(page, { control: page.getByLabel(label, { exact: true }), value });
  }
  await choose(page, { control: page.getByLabel("Country or region"), value: "US" });
  await write(page, { control: page.getByLabel("Phone number", { exact: true }), value: "2025550123" });
  await scan(page); await tabTo(page, page.getByRole("button", { name: "Create login", exact: true })); await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeFocused(); await scan(page);
  await context.clearCookies(); await page.goto(origin + "/sign-in"); await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await write(page, { control: page.getByLabel("Email or username"), value: values.email });
  await write(page, { control: page.getByLabel("Password", { exact: true }), value: password });
  await tabTo(page, page.getByRole("button", { name: "Sign in", exact: true })); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(browserOrigins.workspace + (kind === "external" ? "/portal" : "/"));
  await expect(page.getByRole("heading", { name: kind === "external" ? "Portal" : "xpro", exact: true })).toBeFocused(); await scan(page);
  if (kind === "internal") {
    await page.goto(browserOrigins.workspace + "/session-return"); await expect(page.getByRole("heading", { name: "You’re signed in" })).toBeFocused(); await scan(page);
  }
});

test("when own-profile details, picture and password are operated by keyboard then all editors save and remain accessible", async ({ page, context }) => {
  await addLogin(context, "a11yProfile"); await page.goto(origin + "/profile");
  await expect(page.getByRole("heading", { name: "Your profile", exact: true })).toBeFocused();
  await write(page, { control: page.getByLabel("Full name"), value: "Keyboard profile" });
  await choose(page, { control: page.getByLabel("Country or region"), value: "US" });
  await write(page, { control: page.getByLabel("Number", { exact: true }), value: "2025550199" });
  await tabTo(page, page.getByRole("button", { name: "Save details", exact: true })); await page.keyboard.press("Enter");
  await expect(page.getByText("Your details have been saved.")).toBeVisible();
  await tabTo(page, page.getByLabel("Choose a picture", { exact: true }));
  const chooser = page.waitForEvent("filechooser"); await page.keyboard.press("Space");
  await (await chooser).setFiles({ name: "keyboard.png", mimeType: "image/png", buffer: Buffer.from(await squarePicture().arrayBuffer()) });
  const crop = page.getByRole("group", { name: "Move the crop square" }); await tabTo(page, crop);
  await page.keyboard.press("ArrowRight"); await scan(page);
  await tabTo(page, page.getByRole("button", { name: "Save picture", exact: true })); await page.keyboard.press("Enter");
  await expect(page.getByText("Your picture has been updated.")).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "Remove saved picture", exact: true })); await page.keyboard.press("Enter");
  await expect(page.locator('[role="img"] img')).toHaveCount(0);
  await write(page, { control: page.getByLabel("Current password", { exact: true }), value: password });
  await write(page, { control: page.getByLabel("New password", { exact: true }), value: "Keyboard-new-password456!" });
  await tabTo(page, page.getByRole("button", { name: "Change password", exact: true })); await page.keyboard.press("Enter");
  await expect(page.getByText("Your password has been changed. Your other sessions have ended.")).toBeVisible(); await scan(page);
});

test("when a master searches and suspends with keyboard then confirmation is accessible and takes under one minute", async ({ page, context }, info) => {
  await addLogin(context, "a11yMaster"); await page.goto(origin + "/stms/logins");
  await expect(page.getByRole("heading", { name: "Logins", exact: true })).toBeFocused(); await scan(page);
  const target = login("a11yTarget"), started = performance.now();
  await write(page, { control: page.getByLabel("Search by name, email or username"), value: target.email });
  await tabTo(page, page.getByRole("button", { name: "Search", exact: true })); await page.keyboard.press("Enter");
  await expect(page.locator("tbody tr")).toHaveCount(1); await tabTo(page, page.locator("tbody tr").getByRole("link")); await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Manage login", exact: true })).toBeFocused();
  await tabTo(page, page.getByRole("button", { name: "Suspend login", exact: true })); await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog"); await expect(dialog.getByRole("heading")).toBeFocused();
  await choose(page, { control: page.getByLabel("Suspension reason"), value: "stms_unpaid" });
  await tabTo(page, dialog.getByRole("button", { name: "Suspend login", exact: true })); await page.keyboard.press("Enter");
  await expect(page.locator("#login-status-value")).toHaveText("Suspended");
  await measurement(info, { goal: "SC-005", elapsedMs: performance.now() - started, limitMs: 60_000, profile: "local keyboard workflow, no network emulation" });
  await scan(page);
  await tabTo(page, page.getByRole("button", { name: "Reactivate login", exact: true })); await page.keyboard.press("Enter");
  await expect(page.locator("#login-status-value")).toHaveText("Active");
  await write(page, { control: page.getByLabel("Email", { exact: true }), value: "keyboard-" + crypto.randomUUID() + "@example.test" });
  await tabTo(page, page.getByRole("button", { name: "Save email", exact: true })); await page.keyboard.press("Enter");
  await expect(page.getByText("Email saved.")).toBeVisible();
  await write(page, { control: page.getByLabel("Username", { exact: true }), value: "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7) });
  await tabTo(page, page.getByRole("button", { name: "Save username", exact: true })); await page.keyboard.press("Enter");
  await expect(page.getByText("Username saved.")).toBeVisible();
  await write(page, { control: page.getByLabel("New password", { exact: true }), value: "Keyboard-reset-password456!" });
  await tabTo(page, page.getByRole("button", { name: "Reset password", exact: true })); await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Password reset", exact: true })).toBeFocused();
  await tabTo(page, page.getByRole("button", { name: "Archive login", exact: true })); await page.keyboard.press("Enter"); await scan(page);
  await tabTo(page, dialog.getByRole("button", { name: "Cancel", exact: true })); await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0); await expect(page.locator("#login-status-title")).toBeFocused();
  await tabTo(page, page.getByRole("button", { name: "Archive login", exact: true })); await page.keyboard.press("Enter"); await tabTo(page, dialog.getByRole("button", { name: "Archive login", exact: true })); await page.keyboard.press("Enter");
  await expect(page.locator("#login-status-value")).toHaveText("Archived");
  await tabTo(page, page.getByRole("button", { name: "Restore login", exact: true })); await page.keyboard.press("Enter");
  await expect(page.locator("#login-status-value")).toHaveText("Active"); await scan(page);
});

test("when a session ends then keyboard reauthentication returns to the same draft without replay or stored form values", async ({ page, context }) => {
  const person = await createWorkspaceLogin(page, "internal"); await context.clearCookies();
  await page.goto(browserOrigins.workspace + "/auth/start?returnTo=%2Fdraft-check%3Fview%3Dkeyboard%23draft");
  await signIn(page, person.email); await expect(page).toHaveURL(browserOrigins.workspace + "/draft-check?view=keyboard#draft");
  await write(page, { control: page.getByLabel("Notes"), value: "Keep this non-secret draft" });
  await write(page, { control: page.getByLabel("Amount"), value: "1,234.50" });
  await choose(page, { control: page.getByLabel("Category"), value: "review" });
  await tabTo(page, page.getByLabel("Confirmed")); await page.keyboard.press("Space");
  const href = page.url(); let writes = 0;
  page.on("request", (request) => { if (request.url().includes("/_serverFn/") && request.headers()["x-page-login-id"]) writes++; });
  const end = await context.newPage();
  try { await end.goto(origin + "/profile"); expect(await end.evaluate(async () => (await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status)).toBe(200); }
  finally { await end.close(); }
  await page.bringToFront(); await tabTo(page, page.getByRole("button", { name: "Check access", exact: true })); await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog"); await expect(dialog.getByRole("heading")).toBeFocused();
  await expect(page.locator("#workspace-page")).toHaveAttribute("inert", "");
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press("Tab"); await expect.poll(async () => await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape"); await expect(dialog).toBeVisible(); await scan(page);
  await tabTo(page, dialog.getByRole("link", { name: "Sign in in a new tab" }));
  const opened = page.waitForEvent("popup"); await page.keyboard.press("Enter"); const popup = await opened;
  await signIn(popup, person.email); await expect(popup.getByRole("heading", { name: "You’re signed in" })).toBeFocused(); await scan(popup);
  await popup.close(); await page.bringToFront();
  // Exercise the registered resume handler; browser-native focus delivery is not asserted.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dialog).toHaveCount(0); await expect(page).toHaveURL(href);
  await expect(page.getByLabel("Notes")).toHaveValue("Keep this non-secret draft"); await expect(page.getByLabel("Amount")).toHaveValue("1,234.50");
  await expect(page.getByLabel("Category")).toHaveValue("review"); await expect(page.getByLabel("Confirmed")).toBeChecked(); expect(writes).toBe(1);
  const stored = await page.evaluate(() => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
  expect(stored.local).toEqual([]);
  expect(stored.session.filter(([key]) => !key.startsWith("tsr-scroll-restoration-"))).toEqual([]);
  expect(JSON.stringify(stored)).not.toContain("Keep this non-secret draft"); expect(JSON.stringify(stored)).not.toContain("1,234.50"); await scan(page);
});

for (const kind of ["unassigned", "account", "master", "internal", "external"] as const) test("when real " + kind + " sign-in uses a defined connection then its visible destination arrives within three seconds", async ({ page, context }, info) => {
  test.setTimeout(60_000);
  const person = kind === "internal" || kind === "external" ? await createWorkspaceLogin(page, kind)
    : login(kind === "master" ? "a11yMaster" : kind === "account" ? "a11yAccount" : "a11yUnassigned");
  await context.clearCookies();
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditionsByRule", { offline: false, matchedNetworkConditions: [connection] });
    await page.goto(origin + "/sign-in"); await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled({ timeout: 30_000 });
    await page.getByLabel("Email or username").fill(person.email); await page.getByLabel("Password", { exact: true }).fill(password);
    await tabTo(page, page.getByRole("button", { name: "Sign in", exact: true }));
    let started = performance.now(); await page.keyboard.press("Enter");
    if (kind === "master") {
      await expect(page).toHaveURL(origin + "/mfa"); await scan(page);
      await expect(page.getByLabel("Authenticator code", { exact: true })).toBeEnabled({ timeout: 30_000 });
      await write(page, { control: page.getByLabel("Authenticator code", { exact: true }), value: await readBrowserMfaCode(login("a11yMaster").loginId) });
      await tabTo(page, page.getByRole("button", { name: "Verify", exact: true }));
      // Measure the final authentication request; human code-entry time is excluded.
      started = performance.now(); await page.keyboard.press("Enter");
    }
    const destination = kind === "master" ? origin + "/stms/logins" : kind === "account" ? origin + "/account" : kind === "unassigned" ? origin + "/no-workspace"
      : browserOrigins.workspace + (kind === "external" ? "/portal" : "/");
    const title = kind === "master" ? "Logins" : kind === "account" ? "Your account" : kind === "unassigned" ? "Workspace access" : kind === "external" ? "Portal" : "xpro";
    await expect(page).toHaveURL(destination); await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await measurement(info, { goal: "SC-002:" + kind, elapsedMs: performance.now() - started, limitMs: 3_000, profile: connection });
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeFocused({ timeout: 30_000 });
  } finally { await cdp.detach(); }
});

function login(key: string): Login { const actor = fixtures.logins[key]; if (!actor) throw new Error("Missing accessibility fixture: " + key); return actor; }
async function addLogin(context: BrowserContext, key: string): Promise<void> {
  await context.addCookies(login(key).cookie.split("; ").map((part) => { const index = part.indexOf("="); return { name: part.slice(0, index), value: part.slice(index + 1), url: origin, httpOnly: true, secure: true, sameSite: "Lax" as const }; }));
}
async function scan(page: Page): Promise<void> { expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
async function tabTo(page: Page, control: Locator): Promise<void> {
  await expect(control).toBeVisible(); await expect(control).toBeEnabled();
  for (let index = 0; index < maximumTabStops; index++) {
    if (await control.evaluate((element) => element === document.activeElement)) { await expect(control).toBeFocused(); return; }
    await page.keyboard.press("Tab");
  }
  throw new Error("The keyboard cannot reach " + control.toString());
}
async function write(page: Page, input: { control: Locator; value: string }): Promise<void> {
  await tabTo(page, input.control); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.type(input.value);
}
async function choose(page: Page, input: { control: Locator; value: string }): Promise<void> {
  await tabTo(page, input.control);
  const label = await input.control.locator('option[value="' + input.value + '"]').textContent(); if (!label) throw new Error("Missing native option label.");
  await page.keyboard.press("Home"); await page.keyboard.type(label); await page.keyboard.press("Tab"); await expect(input.control).toHaveValue(input.value);
}
async function signIn(page: Page, email: string): Promise<void> {
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await write(page, { control: page.getByLabel("Email or username"), value: email });
  await write(page, { control: page.getByLabel("Password", { exact: true }), value: password });
  await tabTo(page, page.getByRole("button", { name: "Sign in", exact: true })); await page.keyboard.press("Enter");
}
async function createWorkspaceLogin(page: Page, kind: "internal" | "external"): Promise<{ email: string }> {
  await addLogin(page.context(), "createOwner"); await page.goto(origin + "/create-login");
  const email = "access-" + crypto.randomUUID() + "@example.test";
  await page.getByLabel("User type").selectOption(kind);
  for (const [label, value] of [["Email", email], ["Username", "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7)], ["Full name", "Accessibility person"], ["Password", password]]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel("Country or region").selectOption("US"); await page.getByLabel("Phone number", { exact: true }).fill("2025550123");
  await page.getByRole("button", { name: "Create login", exact: true }).click(); await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeFocused();
  return { email };
}
async function measurement(info: TestInfo, value: { goal: string; elapsedMs: number; limitMs: number; profile: unknown }): Promise<void> {
  const result = { ...value, elapsedMs: Math.round(value.elapsedMs), environment: "local Vite/workerd; outside Turnstile substituted" };
  console.info("T042 measurement " + JSON.stringify(result));
  await info.attach("timing", { body: JSON.stringify(result), contentType: "application/json" });
  expect(value.elapsedMs, value.goal).toBeLessThan(value.limitMs);
}
