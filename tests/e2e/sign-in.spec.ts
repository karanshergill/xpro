import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { currentMfaCode } from "../support/master-mfa";
import { withBrowserHub } from "./hub-fixture";
import { browserOrigins } from "./addresses";

const base = process.env.XPRO_BROWSER_TEMP;
if (!base) throw new Error("Use the isolated browser runner.");
const origin = "https://hub.localhost:3001", password = "Browser-fixture123!";
const fixtures: { logins: Record<string, { email: string; username: string | null; loginId: string; cookie: string }>; clientId: string } =
  JSON.parse(await readFile(join(base, "fixtures.json"), "utf8"));
let pageErrors: string[];
test.beforeEach(async ({ page }) => {
  pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message));
});
test.afterEach(() => expect(pageErrors).toEqual([]));

test("anonymous visitors see the central sign-in form and no public registration", async ({ page }, info) => {
  await mockWidget(page);
  const response = await page.goto("/");
  await expect(page).toHaveURL(origin + "/sign-in");
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
  expect(response?.headers()["vary"]).toContain("cookie");
  await expect(page.getByRole("heading", { name: "Sign in to xpro" })).toBeFocused();
  await expect(page.getByLabel("Email or username")).toHaveAttribute("autocomplete", "username");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "current-password");
  await expect(page.getByRole("link", { name: /sign up|register/i })).toHaveCount(0);
  await expect(page.getByText("Forgot your password? Contact your administrator.")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("sign-in.png"), fullPage: true });
});

test("server-rendered credentials stay disabled until hydration and use POST", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true, javaScriptEnabled: false });
  try {
    const page = await context.newPage(); const response = await page.goto("/sign-in");
    await expect(page.locator("form")).toHaveAttribute("method", "post");
    await expect(page.getByLabel("Email or username")).toBeDisabled();
    await expect(page.getByLabel("Password", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
    const html = await response?.text();
    expect(html).toContain("1x00000000000000000000AA");
    expect(html).not.toContain("1x0000000000000000000000000000000AA");
  } finally { await context.close(); }
});

test("required errors wait for blur or submit and focus the first invalid field", async ({ page }) => {
  await openSignIn(page); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Check the details below");
  await expect(page.getByLabel("Email or username")).toBeFocused();
  await expect(page.locator("#password-error")).toHaveText("Enter your password.");
  await page.getByLabel("Email or username").fill("entered");
  await expect(page.locator("#identifier-error")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator("#identifier-error")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("email sign-in reaches the unassigned message using a genuine native cookie", async ({ page }) => {
  await openSignIn(page); const login = getLogin("emailSignIn");
  await fillCredentials(page, login.email); await submit(page);
  await expect(page).toHaveURL(origin + "/no-workspace");
  await expect(page.getByText("You don't belong to any workspace yet. Please contact your admin.")).toBeVisible();
  const native = await readSession(page);
  expect(native).toMatchObject({ user: { id: login.loginId } });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("username sign-in uses the native username method and normalized identifier", async ({ page }) => {
  await openSignIn(page); const login = getLogin("usernameSignIn");
  const request = page.waitForRequest("**/api/auth/sign-in/username");
  await fillCredentials(page, " " + (login.username ?? "").toUpperCase() + " "); await submit(page);
  expect((await request).postDataJSON()).toMatchObject({ username: login.username });
  await expect(page).toHaveURL(origin + "/no-workspace");
  expect(await readSession(page)).toMatchObject({ user: { id: login.loginId } });
});

test("a master reaches the STMS login directory", async ({ page }) => {
  await openSignIn(page); await fillCredentials(page, getLogin("masterSignIn").email); await submit(page);
  await expect(page).toHaveURL(origin + "/mfa");
  const code = await withBrowserHub(async ({ auth, db }) => await currentMfaCode({ auth, identities: { db } }, getLogin("masterSignIn").loginId));
  await page.getByLabel("Authenticator code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(origin + "/stms/logins");
});

for (const [key, message] of [
  ["wrongSignIn", "Incorrect email, username or password"],
  ["suspendedSignIn", "This account is suspended. Please contact support."],
  ["archivedSignIn", "This account is no longer active. Please contact support."],
]) test("native sign-in shows the specified refusal: " + key, async ({ page }) => {
  await openSignIn(page); const identifier = getLogin(key).email;
  const attemptedPassword = key === "wrongSignIn" ? "Wrong-password123!" : password;
  await fillCredentials(page, identifier, attemptedPassword); await submit(page);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(message); await expect(alert).toContainText("Reference:");
  await expect(alert).toBeFocused();
  await expect(page.getByLabel("Email or username")).toHaveValue(identifier);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(attemptedPassword);
  expect(await readSession(page)).toBeNull();
  if (key === "wrongSignIn") {
    await page.getByLabel("Password", { exact: true }).fill(password); await submit(page);
    await expect(page).toHaveURL(origin + "/no-workspace");
  }
});

test("a local identifier limit reaches the browser's approved refusal message", async ({ page }) => {
  await openSignIn(page); const email = getLogin("rateSignIn").email;
  const limited = await page.evaluate(async ({ email }) => {
    for (let index = 0; index < 20; index++) {
      const response = await fetch("/api/auth/sign-in/email", { method: "POST",
        headers: { "content-type": "application/json", "x-captcha-response": "XXXX.DUMMY.TOKEN.XXXX" },
        body: JSON.stringify({ email, password: "Wrong-password123!" }) });
      if (response.status === 429) return true;
      if (response.status !== 401) throw new Error("Unexpected native refusal.");
    }
    return false;
  }, { email });
  expect(limited).toBe(true);
  await fillCredentials(page, email); await submit(page);
  await expect(page.getByRole("alert")).toContainText("Too many attempts. Please try again shortly.");
  expect(await readSession(page)).toBeNull();
});

test("a rejected external verification token cannot create a native session", async ({ page }) => {
  await mockWidget(page, "browser-rejected-token"); await page.goto("/sign-in");
  await fillCredentials(page, getLogin("emailSignIn").email); await submit(page);
  await expect(page.getByRole("alert")).toContainText("Security check failed. Please try again.");
  expect(await readSession(page)).toBeNull();
});

test("an expired external widget disables submission and manual retry obtains a fresh token", async ({ page }) => {
  await openSignIn(page);
  await page.evaluate(() => {
    const widget = (window as Window & { browserWidget?: { expire(): void } }).browserWidget;
    if (!widget) throw new Error("Missing external widget fixture.");
    widget.expire();
  });
  await page.evaluate(() => (window as Window & { browserWidget?: { succeed(): void } }).browserWidget?.succeed());
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveText("Security check failed. Please try again.");
  await page.getByRole("button", { name: "Retry security check" }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
});

test("a blocked external widget script shows a manual retry and never submits credentials", async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) => route.abort());
  await page.goto("/sign-in");
  await expect(page.getByRole("alert")).toHaveText("Security check failed. Please try again.");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  await page.unroute("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"); await mockWidget(page);
  await page.getByRole("button", { name: "Retry security check" }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
});

test("native password-manager values without change events survive re-renders and are submitted exactly", async ({ page }) => {
  await openSignIn(page); const email = getLogin("spacedSignIn").email;
  await page.evaluate(({ email }) => {
    const identifier = document.querySelector<HTMLInputElement>("#identifier"), password = document.querySelector<HTMLInputElement>("#password");
    if (!identifier || !password) throw new Error("Missing native credential fields.");
    identifier.value = email; password.value = " Browser-fixture123! ";
    (window as Window & { browserWidget?: { expire(): void } }).browserWidget?.expire();
  }, { email });
  await page.getByRole("button", { name: "Retry security check" }).click();
  await expect(page.getByLabel("Email or username")).toHaveValue(email);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(" Browser-fixture123! ");
  await submit(page); await expect(page).toHaveURL(origin + "/no-workspace");
});

test("a pending native credential submission is busy and cannot be sent twice", async ({ page }) => {
  await openSignIn(page);
  let release: (() => void) | undefined, count = 0;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/auth/sign-in/email", async (route) => {
    count++; const response = await forwardRequest(route); await held; await route.fulfill({ response });
  });
  try {
    await fillCredentials(page, getLogin("pendingSignIn").email); await submit(page);
    await expect(page.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    await page.keyboard.press("Enter"); expect(count).toBe(1);
  } finally { release?.(); }
  await expect(page).toHaveURL(origin + "/no-workspace"); expect(count).toBe(1);
});

test("a lost native reply leaves credentials in place and never retries automatically", async ({ page }) => {
  await openSignIn(page); let count = 0;
  await page.route("**/api/auth/sign-in/email", async (route) => { count++; await forwardRequest(route); await route.abort("connectionreset"); });
  const email = getLogin("lostSignIn").email;
  await fillCredentials(page, email); await submit(page);
  await expect(page.getByRole("alert")).toContainText("We couldn’t complete that request.");
  await expect(page.getByLabel("Email or username")).toHaveValue(email);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(password); expect(count).toBe(1);
  expect(page.url()).toBe(origin + "/sign-in");
});

test("a signed workspace flow retains its native continuation through refused credentials and profile completion", async ({ page }) => {
  await mockWidget(page);
  await page.route("https://workspace.example.test/auth/callback**", (route) => route.fulfill({ body: "Registered callback", contentType: "text/plain" }));
  const continuation = await openWorkspaceSignIn(page), signed = continuation.url, state = continuation.state;
  await fillCredentials(page, getLogin("oauthSignIn").email, "Wrong-password123!"); await submit(page);
  await expect(page.getByRole("alert")).toContainText("Incorrect email, username or password"); expect(page.url()).toBe(signed);
  await page.getByLabel("Password", { exact: true }).fill(password); await submit(page);
  await expect(page).toHaveURL(/\/complete-profile\?/);
  await page.getByLabel("Country or region").selectOption("US"); await page.getByLabel("Number", { exact: true }).fill("2025550123");
  const callback = page.waitForRequest("https://workspace.example.test/auth/callback**");
  await page.getByRole("button", { name: "Save and continue" }).click();
  const destination = new URL((await callback).url());
  expect(destination.searchParams.get("state")).toBe(state); expect(destination.searchParams.get("code")).toBeTruthy();
  expect(destination.searchParams.has("password")).toBe(false);
});

test.describe("real customer-domain protocol", () => {
  test.use({ ignoreHTTPSErrors: false });
  test("when a master opens a customer hostname then real HTTPS, router dispatch and native back-channel logout complete", async ({ page, context }) => {
    await context.addCookies(getLogin("masterSignIn").cookie.split("; ").map((part) => {
      const index = part.indexOf("="); return { name: part.slice(0, index), value: part.slice(index + 1),
        url: origin, httpOnly: true, secure: true, sameSite: "Lax" as const };
    }));
    await page.goto(browserOrigins.customer + "/auth/start"); await expect(page).toHaveURL(browserOrigins.customer + "/");
    await expect(page.getByRole("heading", { name: "xpro", exact: true })).toBeFocused();
    const customerCookies = await context.cookies(browserOrigins.customer);
    expect(customerCookies.some((cookie) => cookie.name === "__Host-xpro-session" && cookie.secure && cookie.httpOnly)).toBe(true);
    expect(customerCookies.some((cookie) => cookie.name.includes("better-auth"))).toBe(false);
    await page.goto(origin + "/profile"); await expect(page.getByRole("heading", { name: "Your profile", exact: true })).toBeVisible();
    const outcome = await page.evaluate(async () => {
      const before = Number((await fetch("/api/auth/ok")).headers.get("x-test-backchannel-deliveries"));
      const response = await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return { status: response.status, delivered: Number(response.headers.get("x-test-backchannel-deliveries")) - before };
    });
    expect(outcome).toEqual({ status: 200, delivered: 1 });
    await page.goto(browserOrigins.customer + "/"); await expect(page).toHaveURL(/hub\.localhost:3001\/sign-in(?:\?|$)/);
  });
});

test("when a retained workspace cookie is copied to another approved address then it grants no access there", async ({ page, context }) => {
  await context.addCookies(getLogin("createOtherMaster").cookie.split("; ").map((part) => { const index = part.indexOf("="); return { name: part.slice(0, index), value: part.slice(index + 1), url: origin, httpOnly: true, secure: true, sameSite: "Lax" as const }; }));
  await page.goto(browserOrigins.workspace + "/auth/start"); await expect(page).toHaveURL(browserOrigins.workspace + "/");
  const cookie = (await context.cookies(browserOrigins.workspace)).find((item) => item.name === "__Host-xpro-session");
  if (!cookie) throw new Error("Missing native workspace cookie.");
  await page.goto(browserOrigins.customer + "/auth/start"); await expect(page).toHaveURL(browserOrigins.customer + "/");
  await context.addCookies([{ ...cookie, domain: new URL(browserOrigins.customer).hostname }]);
  const result = await page.evaluate(async () => { const response = await fetch("/", { headers: { accept: "application/json" } }), body: unknown = await response.json();
    return { status: response.status, code: body && typeof body === "object" && "code" in body ? body.code : null }; });
  expect(result).toEqual({ status: 401, code: "core_unauthenticated" });
});

test("when routing headers are forged then the customer address still selects its actual workspace and an unknown host uses the real default", async ({ page, context }) => {
  await context.addCookies(getLogin("createOtherMaster").cookie.split("; ").map((part) => { const index = part.indexOf("="); return { name: part.slice(0, index), value: part.slice(index + 1), url: origin, httpOnly: true, secure: true, sameSite: "Lax" as const }; }));
  await page.route((url) => url.origin === browserOrigins.customer, async (route) => { await route.continue({ headers: {
    ...await route.request().allHeaders(), "x-xpro-workspace-id": crypto.randomUUID(), "x-forwarded-host": "foreign.example.test", "x-forwarded-proto": "http", "x-request-id": "forged",
  } }); });
  const response = await page.goto(browserOrigins.customer + "/auth/start"); await expect(page).toHaveURL(browserOrigins.customer + "/");
  expect(response?.headers()["x-request-id"]).not.toBe("forged");
  await expect(page.locator("#workspace-page")).toHaveAttribute("data-login-id", getLogin("createOtherMaster").loginId);
  await page.goto(browserOrigins.missing + "/unknown-workspace"); await expect(page).toHaveURL(origin + "/stms/logins");
  await expect(page.getByRole("heading", { name: "Logins", exact: true })).toBeFocused();
});

test("when the first native callback has a changed state then it is refused before the original code is consumed", async ({ page, context }) => {
  const actor = getLogin("createOtherMaster");
  await context.addCookies(actor.cookie.split("; ").map((part) => { const index = part.indexOf("="); return { name: part.slice(0, index), value: part.slice(index + 1), url: origin, httpOnly: true, secure: true, sameSite: "Lax" as const }; }));
  const start = await context.request.get("https://127.0.0.1:3000/auth/start", { headers: { host: "web.localhost:3000" }, maxRedirects: 0 });
  expect(start.status()).toBe(302);
  const pending = start.headersArray().find((header) => header.name.toLowerCase() === "set-cookie" && header.value.startsWith("__Host-xpro-sign-in="))?.value.split(";")[0];
  const authorize = new URL(start.headers().location ?? "");
  const issued = await context.request.get("https://127.0.0.1:3001" + authorize.pathname + authorize.search, {
    headers: { host: "hub.localhost:3001", cookie: actor.cookie, accept: "text/html" }, maxRedirects: 0,
  });
  expect([200, 302]).toContain(issued.status());
  const payload: unknown = issued.status() === 200 ? await issued.json() : null;
  const original = issued.headers().location ?? (payload && typeof payload === "object" && "url" in payload && typeof payload.url === "string" ? payload.url : null);
  if (!pending || !original || !new URL(original).searchParams.has("code")) throw new Error("Missing native callback evidence.");
  const cookie = { name: "__Host-xpro-sign-in", value: pending.slice(pending.indexOf("=") + 1), url: browserOrigins.workspace, secure: true, httpOnly: true, sameSite: "Lax" as const };
  await context.addCookies([cookie]); const changed = new URL(original); changed.searchParams.set("state", "changed");
  const refused = await page.goto(changed.href); expect(refused?.status()).toBe(400);
  expect(await refused?.json()).toMatchObject({ code: "core_sign_in_invalid" });
  expect((await context.cookies(browserOrigins.workspace)).some((item) => item.name === "__Host-xpro-session")).toBe(false);
  await context.addCookies([cookie]); await page.goto(original); await expect(page).toHaveURL(browserOrigins.workspace + "/");
  await expect(page.getByRole("heading", { name: "xpro", exact: true })).toBeFocused();
});

test("when an authorization code has already completed then replaying it with its original pending cookie creates no new session", async ({ page, context, browser }) => {
  const actor = getLogin("createOtherMaster");
  await context.addCookies(actor.cookie.split("; ").map((part) => { const index = part.indexOf("="); return { name: part.slice(0, index), value: part.slice(index + 1), url: origin, httpOnly: true, secure: true, sameSite: "Lax" as const }; }));
  const [callbackRequest] = await Promise.all([
    page.waitForRequest((request) => { const url = new URL(request.url()); return url.origin === browserOrigins.workspace && url.pathname === "/auth/callback"; }),
    page.goto(browserOrigins.workspace + "/auth/start"),
  ]);
  await expect(page).toHaveURL(browserOrigins.workspace + "/");
  const pending = ((await callbackRequest.allHeaders()).cookie ?? "").split(/;\s*/).find((part) => part.startsWith("__Host-xpro-sign-in="));
  expect(Boolean(pending)).toBe(true);
  if (!pending) throw new Error("Missing native pending cookie.");
  const second = await browser.newContext({ ignoreHTTPSErrors: false });
  try {
    await second.addCookies([{ name: "__Host-xpro-sign-in", value: pending.slice(pending.indexOf("=") + 1), url: browserOrigins.workspace, secure: true, httpOnly: true, sameSite: "Lax" }]);
    const replay = await second.newPage(), target = new URL(callbackRequest.url());
    const response = await replay.goto(target.href); expect(response?.status()).toBe(400);
    expect(await response?.json()).toMatchObject({ code: "core_sign_in_invalid" });
    expect((await second.cookies(browserOrigins.workspace)).some((cookie) => cookie.name === "__Host-xpro-session")).toBe(false);
  } finally { await second.close(); }
  await page.reload(); await expect(page.getByRole("heading", { name: "xpro", exact: true })).toBeFocused();
});

test("when native sign-up, profile and administrator routes are called directly then they stay closed without changing the login", async ({ page, context }) => {
  const actor = getLogin("emailSignIn");
  await context.addCookies(actor.cookie.split("; ").map((part) => { const index = part.indexOf("="); return { name: part.slice(0, index), value: part.slice(index + 1), url: origin, httpOnly: true, secure: true, sameSite: "Lax" as const }; }));
  await page.goto("/profile");
  const result = await page.evaluate(async () => {
    const before = await (await fetch("/api/auth/get-session")).json(), statuses: number[] = [];
    for (const path of ["sign-up/email", "update-user", "change-password", "admin/create-user", "admin/set-role", "organization/add-member", "oauth2/register"]) {
      statuses.push((await fetch("/api/auth/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Bypass", role: "admin" }) })).status);
    }
    const after = await (await fetch("/api/auth/get-session")).json();
    return { statuses, signedIn: Boolean(before && typeof before === "object" && "user" in before && before.user && "session" in before && before.session), unchanged: JSON.stringify(before) === JSON.stringify(after) };
  });
  expect(result).toEqual({ statuses: Array(7).fill(404), signedIn: true, unchanged: true });
});

test("when an anonymous visitor skips to Portal then the real workspace gate starts central sign-in", async ({ page }) => {
  await page.goto(browserOrigins.workspace + "/portal"); await expect(page).toHaveURL(/hub\.localhost:3001\/sign-in\?/);
  await expect(page.getByRole("heading", { name: "Portal", exact: true })).toHaveCount(0);
});

test("when an account holder has no workspace then real sign-in opens a private account page", async ({ page }) => {
  await openSignIn(page); await fillCredentials(page, getLogin("protocolAccount").email); await submit(page);
  await expect(page).toHaveURL(origin + "/account"); await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeFocused();
  const response = await page.reload(); expect(response?.headers()["cache-control"]).toBe("private, no-store");
  expect(response?.headers()["vary"]).toContain("cookie");
});

test("when an anonymous visitor skips to the account page then the server requires sign-in", async ({ page }) => {
  await page.goto("/account"); await expect(page).toHaveURL(origin + "/sign-in");
});

test("pseudo language, dark theme, narrow width and RTL keep sign-in usable and accessible", async ({ page, context }) => {
  await context.addCookies([{ name: "PARAGLIDE_LOCALE", value: "en-XA", url: origin }]);
  await page.emulateMedia({ colorScheme: "dark" }); await page.setViewportSize({ width: 320, height: 800 });
  await mockWidget(page); await page.goto("/sign-in"); await page.locator("html").evaluate((element) => { element.setAttribute("dir", "rtl"); });
  await expect(page.getByRole("heading")).toContainText("⟦");
  await expect(page.getByRole("button", { name: /Sign in/ })).toBeEnabled();
  await page.getByRole("button", { name: /Sign in/ }).click();
  await expect(page.getByRole("alert")).toContainText("⟦");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("both credential fields allow native clipboard paste", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await openSignIn(page); const email = getLogin("emailSignIn").email;
  for (const [label, value] of [["Email or username", email], ["Password", password]]) {
    await page.evaluate((text) => navigator.clipboard.writeText(text), value);
    await page.getByLabel(label ?? "", { exact: true }).focus(); await page.keyboard.press("ControlOrMeta+V");
    await expect(page.getByLabel(label ?? "", { exact: true })).toHaveValue(value ?? "");
  }
  await submit(page); await expect(page).toHaveURL(origin + "/no-workspace");
});

for (const identifier of ["nobody", "not-an-email@"]) test("an unknown or malformed identifier has the same generic refusal: " + identifier, async ({ page }) => {
  await openSignIn(page); await fillCredentials(page, identifier); await submit(page);
  await expect(page.getByRole("alert")).toContainText("Incorrect email, username or password");
  expect(await readSession(page)).toBeNull();
});

test("caller query parameters cannot choose the post-sign-in address", async ({ page }) => {
  await mockWidget(page); await page.goto("/sign-in?callbackURL=" + encodeURIComponent("https://untrusted.example.test/"));
  await fillCredentials(page, getLogin("emailSignIn").email); await submit(page);
  await expect(page).toHaveURL(origin + "/no-workspace");
});

test("a changed native signed link is refused without a session or lost credentials", async ({ page }) => {
  await mockWidget(page);
  const signed = await openWorkspaceSignIn(page), tampered = new URL(signed.url);
  tampered.searchParams.set("sig", "changed"); await page.goto(tampered.href);
  const email = getLogin("emailSignIn").email; await fillCredentials(page, email); await submit(page);
  await expect(page.getByRole("alert")).toContainText("This sign-in link is invalid or has expired.");
  await expect(page.getByLabel("Email or username")).toHaveValue(email);
  expect(await readSession(page)).toBeNull();
});

async function openWorkspaceSignIn(page: Page): Promise<{ url: string; state: string }> {
  const verifier = "browser-sign-in-verifier-" + "s".repeat(45);
  const challenge = createHash("sha256").update(verifier).digest("base64url"), state = "sign-in-browser-state";
  await page.goto("/api/auth/oauth2/authorize?" + new URLSearchParams({ client_id: fixtures.clientId,
    redirect_uri: "https://workspace.example.test/auth/callback", response_type: "code", scope: "openid profile email",
    state, nonce: "browser-sign-in-nonce", code_challenge_method: "S256", code_challenge: challenge }));
  await expect(page).toHaveURL(/\/sign-in\?/);
  return { url: page.url(), state };
}

test("direct sign-in asks only for the missing profile detail", async ({ page }) => {
  await openSignIn(page); await fillCredentials(page, getLogin("incompleteSignIn").email); await submit(page);
  await expect(page).toHaveURL(origin + "/complete-profile");
  await expect(page.getByLabel("Full name")).toBeVisible();
  await expect(page.getByLabel("Username", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Country or region")).toHaveCount(0);
});

async function openSignIn(page: Page): Promise<void> { await mockWidget(page); await page.goto("/sign-in"); await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled(); }
async function fillCredentials(page: Page, identifier: string, value = password): Promise<void> {
  await page.getByLabel("Email or username").fill(identifier); await page.getByLabel("Password", { exact: true }).fill(value);
}
async function submit(page: Page): Promise<void> { await page.getByRole("button", { name: "Sign in", exact: true }).click(); }
function getLogin(key: string) {
  const login = fixtures.logins[key]; if (!login) throw new Error("Missing isolated sign-in fixture: " + key); return login;
}
async function readSession(page: Page) { return await page.evaluate(async () => await (await fetch("/api/auth/get-session")).json()); }
async function forwardRequest(route: Route) {
  return await route.fetch({ url: route.request().url().replace(origin, "https://127.0.0.1:3001"),
    headers: { ...await route.request().allHeaders(), host: "hub.localhost:3001" } });
}
async function mockWidget(page: Page, token = "XXXX.DUMMY.TOKEN.XXXX"): Promise<void> {
  // Only Cloudflare's external browser SDK is replaced. Native credentials,
  // cookie creation, profile writes and provider continuation remain real.
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) => route.fulfill({
    contentType: "application/javascript",
    body: "window.turnstile = { render(element, options) { window.browserWidget = { expire: options['expired-callback'], succeed: () => options.callback('XXXX.DUMMY.TOKEN.XXXX') };"
      + "element.setAttribute('data-browser-widget', 'true'); queueMicrotask(() => options.callback(" + JSON.stringify(token) + ")); return 'external-test-widget'; }, remove() {} };",
  }));
}
