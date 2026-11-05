import { test, expect, type APIResponse, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { verifyBrowserMfa } from "./hub-fixture";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.XPRO_BROWSER_TEMP;
if (!base) throw new Error("Use the isolated browser runner.");
type Login = { loginId: string; email: string; cookie: string };
const fixtures: { logins: Record<string, Login>; workspace: { id: string; origin: string } } =
  JSON.parse(await readFile(join(base, "fixtures.json"), "utf8"));
const origin = "https://hub.localhost:3001", password = " Reset-password456! ", oldPassword = "Browser-fixture123!";
let pageErrors: string[] = [];
test.beforeEach(({ page }) => { pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message)); });
test.afterEach(() => expect(pageErrors).toEqual([]));

test("the reset control identifies the selected login and keeps comments optional", async ({ page, context }, info) => {
  await openReset({ page, context });
  await expect(page.getByText("Set a new password for " + login("resetOther").email, { exact: false })).toBeVisible();
  await expect(page.getByLabel("New password")).toHaveAttribute("autocomplete", "new-password");
  await expect(page.getByLabel("Comment (optional)")).not.toHaveAttribute("required");
  await expect(page.getByLabel(/current password|confirm password/i)).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("reset-password.png"), fullPage: true });
});

test("server-rendered reset controls stay disabled before hydration and use POST", async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, javaScriptEnabled: false });
  try {
    await addLogin(context, login("resetMaster")); const page = await context.newPage();
    await page.goto(fixtureURL(login("resetOther"), { actor: login("resetMaster") }));
    await expect(page.locator("form")).toHaveAttribute("method", "post");
    await expect(page.getByLabel("New password")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Reset password", exact: true })).toBeDisabled();
  } finally { await context.close(); }
});

test("password checks wait for blur or submit and keep pointer activation stable", async ({ page, context }) => {
  await openReset({ page, context }, { target: "resetValidation" });
  await expect(page.locator("#reset-password-error")).toHaveCount(0);
  await page.getByLabel("New password").fill("short");
  await expect(page.locator("#reset-password-error")).toHaveCount(0); await page.keyboard.press("Tab");
  await expect(page.locator("#reset-password-error")).toContainText("12–64");
  await submit(page); await expect(page.getByLabel("New password")).toBeFocused();
  await expect(page.getByRole("alert")).toContainText("Check the details below.");
  await page.getByLabel("New password").fill(password); await submit(page);
  await expect(page.getByRole("heading", { name: "Password reset", exact: true })).toBeFocused();
});

test("a master reset ends every old target session and the ordinary new password works immediately", async ({ browser, page, context }) => {
  await openReset({ page, context }, { target: "resetTarget" });
  await page.getByLabel("New password").fill(password);
  const request = page.waitForRequest("**/_serverFn/**"); await submit(page);
  const body = (await request).postData() ?? "";
  expect(body).toContain(login("resetTarget").loginId);
  expect(body).toContain(password); expect(body).not.toContain('"comment"');
  await expectSaved(page);
  for (const key of ["resetTarget", "resetSecondDevice"]) expect(await sessionFor(browser, login(key))).toBeNull();
  expect(await sessionFor(browser, login("resetOther"))).toMatchObject({ user: { id: login("resetOther").loginId } });
  expect((await attemptSignIn(browser, { person: login("resetTarget"), password: oldPassword })).status).toBe(401);
  const signedIn = await attemptSignIn(browser, { person: login("resetTarget"), password: password });
  expect(signedIn).toMatchObject({ status: 200, session: { user: { id: login("resetTarget").loginId, role: "user" } }, path: "/no-workspace" });
});

test("an optional comment is sent through the existing reset service and cleared after success", async ({ page, context }) => {
  await openReset({ page, context }, { target: "resetComment" }); await page.getByLabel("New password").fill(password);
  await page.getByLabel("Comment (optional)").fill("Requested through usual support channel.");
  const request = page.waitForRequest("**/_serverFn/**"); await submit(page);
  expect((await request).postData() ?? "").toContain("Requested through usual support channel.");
  await expectSaved(page); await page.getByRole("button", { name: "Set another password" }).click();
  await expect(page.getByLabel("New password")).toHaveValue(""); await expect(page.getByLabel("New password")).toBeFocused();
  await expect(page.getByLabel("Comment (optional)")).toHaveValue("");
});

for (const role of ["anonymous", "createOwner", "createAdmin", "createMember"]) test("a non-master cannot reset through the real control: " + role, async ({ browser, page, context }) => {
  if (role !== "anonymous") await addLogin(context, login(role));
  await page.goto(fixtureURL(login("resetOther"), { actor: login("resetMaster") }));
  await page.getByLabel("New password").fill(password); await submit(page);
  await expect(page.getByRole("alert")).toContainText(role === "anonymous" ? "Your session has ended" : "Only an active master user");
  await expect(page.getByLabel("New password")).toHaveValue(password);
  expect((await attemptSignIn(browser, { person: login("resetOther"), password: oldPassword })).status).toBe(200);
});

test("another master uses the same reset mechanism without gaining a forced password change", async ({ browser, page, context }) => {
  await openReset({ page, context }, { target: "resetTargetMaster" }); await page.getByLabel("New password").fill(password); await submit(page); await expectSaved(page);
  expect(await sessionFor(browser, login("resetTargetMaster"))).toBeNull();
  expect((await attemptSignIn(browser, { person: login("resetTargetMaster"), password: password })).session).toMatchObject({ user: { role: "admin" } });
});

test("self-reset succeeds once, clears the secret and offers normal sign-in after ending the master session", async ({ browser, page, context }) => {
  await openReset({ page, context }, { target: "resetSelf", actor: "resetSelf" }); await page.getByLabel("New password").fill(password); await submit(page); await expectSaved(page);
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/sign-in");
  await expect(page.getByRole("button", { name: "Set another password" })).toHaveCount(0);
  expect(await sessionFor(browser, login("resetSelf"))).toBeNull();
  expect((await attemptSignIn(browser, { person: login("resetSelf"), password: password })).status).toBe(200);
});

test("a busy reset disables input and cannot be submitted twice", async ({ page, context }) => {
  await openReset({ page, context }, { target: "resetBusy" }); await page.getByLabel("New password").fill(password);
  let release: (() => void) | undefined, count = 0; const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_serverFn/**", async (route) => { count++; await held; await route.fulfill({ response: await forward(route) }); });
  try {
    await submit(page); await expect(page.getByRole("button", { name: "Resetting password…" })).toBeDisabled();
    await expect(page.getByLabel("New password")).toBeDisabled(); await page.keyboard.press("Enter"); expect(count).toBe(1);
  } finally { release?.(); }
  await expectSaved(page); expect(count).toBe(1);
});

test("a lost committed reply preserves values and another deliberate submission is a new reset", async ({ browser, page, context }) => {
  await openReset({ page, context }, { target: "resetLost" }); await page.getByLabel("New password").fill(password);
  await page.getByLabel("Comment (optional)").fill("Keep this comment.");
  let count = 0;
  await page.route("**/_serverFn/**", async (route) => {
    count++; const response = await forward(route); expect(response.status()).toBe(200);
    if (count === 1) await route.abort("connectionreset"); else await route.fulfill({ response });
  });
  await submit(page); await expect(page.getByRole("alert")).toContainText("It may have completed.");
  await expect(page.getByLabel("New password")).toHaveValue(password); await expect(page.getByLabel("Comment (optional)")).toHaveValue("Keep this comment.");
  expect((await attemptSignIn(browser, { person: login("resetLost"), password: password })).status).toBe(200); expect(count).toBe(1);
  const nextPassword = "Deliberate-reset789!";
  await page.getByLabel("New password").fill(nextPassword); await page.getByRole("button", { name: "Reset password again" }).click();
  await expectSaved(page); expect(count).toBe(2);
  expect((await attemptSignIn(browser, { person: login("resetLost"), password: nextPassword })).status).toBe(200);
});

test("a lost self-reset reply explains that sign-in may already require the submitted password", async ({ browser, page, context }) => {
  await openReset({ page, context }, { target: "resetSelfLost", actor: "resetSelfLost" }); await page.getByLabel("New password").fill(password);
  let count = 0; await page.route("**/_serverFn/**", async (route) => { count++; expect((await forward(route)).status()).toBe(200); await route.abort("connectionreset"); });
  await submit(page); await expect(page.getByRole("alert")).toContainText("This may already have ended your sessions.");
  await expect(page.getByRole("link", { name: "Sign in in a new tab" })).toHaveAttribute("target", "_blank");
  await expect(page.getByLabel("New password")).toHaveValue(password);
  expect(await sessionFor(browser, login("resetSelfLost"))).toBeNull();
  expect((await attemptSignIn(browser, { person: login("resetSelfLost"), password: password })).status).toBe(200); expect(count).toBe(1);
});

test("expired authentication preserves input and a new sign-in as the same master permits deliberate submission", async ({ page, context }) => {
  await openReset({ page, context }, { target: "resetExpiredTarget", actor: "resetExpired" });
  await page.getByLabel("New password").fill(password); await page.getByLabel("Comment (optional)").fill("Retain this.");
  await page.evaluate(async () => { await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); });
  await submit(page); await expect(page.getByRole("alert")).toContainText("Your session has ended.");
  await expect(page.getByRole("link", { name: "Sign in in a new tab" })).toHaveAttribute("target", "_blank");
  await expect(page.getByLabel("Comment (optional)")).toHaveValue("Retain this.");
  expect((await nativeSignIn(page, { email: login("resetExpired").email, password: oldPassword })).status).toBe(200);
  await submit(page); await expectSaved(page);
});

test("changing to another signed-in master refuses an open form before any password write", async ({ browser, page, context }) => {
  await openReset({ page, context }, { target: "resetIdentity" }); await page.getByLabel("New password").fill(password);
  await context.clearCookies(); await addLogin(context, login("resetOtherMaster"));
  await submit(page); await expect(page.getByRole("alert")).toContainText("Your sign-in has changed.");
  await expect(page.getByRole("button", { name: "Reset password", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reload this page" })).toBeVisible();
  expect((await attemptSignIn(browser, { person: login("resetIdentity"), password: oldPassword })).status).toBe(200);
});

for (const change of ["target", "actor"] as const) test("a delayed old success cannot cross a changed " + change + " form", async ({ page, context }) => {
  await addLogin(context, login("resetMaster"));
  const next: Record<string, string> = change === "target" ? { nextLoginId: login("resetOther").loginId, nextEmail: login("resetOther").email }
    : { nextPageLoginId: login("resetOtherMaster").loginId };
  await page.goto(fixtureURL(login("resetDelayed"), { actor: login("resetMaster"), next }));
  await page.getByLabel("New password").fill(password);
  let release: (() => void) | undefined; const held = new Promise<void>((resolve) => { release = resolve; });
  let committed: (() => void) | undefined; const saved = new Promise<void>((resolve) => { committed = resolve; });
  await page.route("**/_serverFn/**", async (route) => { const response = await forward(route); expect(response.status()).toBe(200); committed?.(); await held; await route.fulfill({ response }); });
  try {
    await submit(page); await saved;
    if (change === "actor") { await context.clearCookies(); await addLogin(context, login("resetOtherMaster")); }
    await page.getByRole("button", { name: change === "target" ? "Change displayed login" : "Change page login" }).click();
    await expect(page.getByLabel("New password")).toHaveValue("");
  } finally { release?.(); }
  await expect(page.getByRole("button", { name: "Reset password", exact: true })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Password reset", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("New password")).toHaveValue("");
});

test("a pre-Start oversized-body refusal is a correctable comment error with a safe reference", async ({ page, context }) => {
  await openReset({ page, context }); await page.getByLabel("New password").fill(password); await page.getByLabel("Comment (optional)").fill("x".repeat(70_000));
  await submit(page); await expect(page.locator("#reset-comment-error")).toContainText("Shorten the comment");
  await expect(page.getByLabel("Comment (optional)")).toBeFocused();
  await expect(page.getByRole("alert")).toContainText("Reference:");
  await expect(page.getByLabel("New password")).toHaveValue(password);
  await page.getByLabel("Comment (optional)").fill("A shorter comment.");
  await submit(page); await expectSaved(page);
});

test("silent autofill submits the exact password without requiring a comment", async ({ browser, page, context }) => {
  await openReset({ page, context }, { target: "resetAutofill" });
  await page.evaluate((value) => { const field = document.querySelector<HTMLInputElement>("#reset-password"); if (!field) throw new Error("Missing password field."); field.value = value; }, password);
  await submit(page); await expectSaved(page);
  expect((await attemptSignIn(browser, { person: login("resetAutofill"), password: password })).status).toBe(200);
});

test("a missing target keeps the entered values with a safe not-found message", async ({ page, context }) => {
  await addLogin(context, login("resetMaster"));
  await page.goto(fixtureURL({ loginId: crypto.randomUUID(), email: "missing@example.test" }, { actor: login("resetMaster") }));
  await page.getByLabel("New password").fill(password); await submit(page);
  await expect(page.getByRole("alert")).toContainText("This login could not be found.");
  await expect(page.getByLabel("New password")).toHaveValue(password);
});

test("the reset control is usable in narrow RTL, dark theme and expanded translations", async ({ page, context }, info) => {
  await addLogin(context, login("resetMaster")); await context.addCookies([{ name: "PARAGLIDE_LOCALE", value: "en-XA", url: origin }]);
  await page.setViewportSize({ width: 320, height: 800 }); await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(fixtureURL(login("resetLongEmail"), { actor: login("resetMaster") })); await expect(page.locator('button[type="submit"]')).toBeEnabled();
  await expect(page.getByRole("heading", { level: 2 })).toContainText("⟦"); await page.locator("html").evaluate((element) => { element.setAttribute("dir", "rtl"); });
  await page.locator('button[type="submit"]').click(); await expect(page.locator("#reset-password-error")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("reset-password-rtl-dark.png"), fullPage: true });
});

function login(key: string): Login { const found = fixtures.logins[key]; if (!found) throw new Error("Missing reset fixture: " + key); return found; }
function fixtureURL(target: { loginId: string; email: string }, { actor, next = {} }: { actor: { loginId: string }; next?: Record<string, string> }): string {
  return origin + "/reset-check?" + new URLSearchParams({ loginId: target.loginId, email: target.email, pageLoginId: actor.loginId, ...next });
}
async function addLogin(context: BrowserContext, value: Login): Promise<void> {
  await context.addCookies(value.cookie.split("; ").map((cookie) => {
    const index = cookie.indexOf("="); return { name: cookie.slice(0, index), value: cookie.slice(index + 1),
      url: origin, httpOnly: true, secure: true, sameSite: "Lax" as const };
  }));
}
async function openReset({ page, context }: { page: Page; context: BrowserContext }, { target = "resetOther", actor = "resetMaster" }: { target?: string; actor?: string } = {}): Promise<void> {
  await addLogin(context, login(actor)); await page.goto(fixtureURL(login(target), { actor: login(actor) }));
  await expect(page.getByRole("button", { name: "Reset password", exact: true })).toBeEnabled();
}
async function submit(page: Page): Promise<void> { await page.getByRole("button", { name: "Reset password", exact: true }).click(); }
async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Password reset", exact: true })).toBeFocused();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
}
async function forward(route: Route): Promise<APIResponse> {
  return await route.fetch({ url: route.request().url().replace(origin, "https://127.0.0.1:3001"),
    headers: { ...await route.request().allHeaders(), host: "hub.localhost:3001" } });
}
async function nativeSignIn(page: Page, input: { email: string; password: string }) {
  const { email, password } = input;
  const result = await page.evaluate(async ({ email, password }) => {
    const response = await fetch("/api/auth/sign-in/email", { method: "POST", headers: {
      "content-type": "application/json", "x-captcha-response": "XXXX.DUMMY.TOKEN.XXXX" }, body: JSON.stringify({ email, password }) });
    const body: unknown = await response.json();
    return { status: response.status, isMfaRequired: Boolean(body && typeof body === "object" && "twoFactorRedirect" in body && body.twoFactorRedirect === true) };
  }, { email, password });
  if (result.isMfaRequired) {
    const person = Object.values(fixtures.logins).find((person) => person.email === email);
    if (!person) throw new Error("Missing actual master fixture.");
    await verifyBrowserMfa(page, person.loginId);
  }
  return { status: result.status, session: await page.evaluate(async () => await (await fetch("/api/auth/get-session")).json()) };
}

async function attemptSignIn(browser: Browser, { person: value, password }: { person: Login; password: string }) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage(); await page.goto(fixtureURL(value, { actor: login("resetMaster") }));
    const result = await nativeSignIn(page, { email: value.email, password });
    if (result.status === 200) await page.goto(origin + "/");
    return { ...result, path: new URL(page.url()).pathname };
  } finally { await context.close(); }
}
async function sessionFor(browser: Browser, value: Login): Promise<unknown> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    await addLogin(context, value); const page = await context.newPage(); await page.goto(fixtureURL(value, { actor: login("resetMaster") }));
    return await page.evaluate(async () => await (await fetch("/api/auth/get-session")).json());
  } finally { await context.close(); }
}
