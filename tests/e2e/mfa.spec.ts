import { test, expect, type APIResponse, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createExpiredMfaChallenge, createMfaClockFixture, readBrowserMfaCode, readExpiredBrowserMfaCode, withBrowserHub } from "./hub-fixture";

const base = process.env.XPRO_BROWSER_TEMP;
if (!base) throw new Error("Use the isolated browser runner.");
const origin = "https://hub.localhost:3001", password = "Browser-fixture123!";
type Login = { cookie: string; loginId: string; email: string; username: string | null };
const fixtures: { logins: Record<string, Login>; clientId: string; workspace: { id: string; origin: string } } = JSON.parse(await readFile(join(base, "fixtures.json"), "utf8"));
let pageErrors: string[];
test.beforeEach(({ page }) => { pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message)); });
test.afterEach(() => expect(pageErrors).toEqual([]));

test("when a new master signs in then QR and manual enrollment retain private backups until Copy, Download and Continue", async ({ page, context }) => {
  const login = getLogin("mfaNew");
  await signIn(page, login); await expect(page).toHaveURL(origin + "/mfa");
  await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeFocused();
  await expect(page.getByRole("img", { name: "Authenticator setup QR code" })).toHaveCount(0);
  await accessible(page); await beginSetup(page);
  await expect(page.getByLabel("Setup key", { exact: true })).toBeVisible();
  await expect(page.getByText("Time-based (TOTP), 6 digits, every 30 seconds, SHA-1")).toBeVisible();
  await expect(page.getByLabel("Current password")).toHaveCount(0);
  let submitted = 0; page.on("request", (request) => { if (request.url().includes("/two-factor/verify-totp")) submitted++; });
  await page.getByLabel("Authenticator code", { exact: true }).fill("012345");
  await expect(page.getByLabel("Authenticator code", { exact: true })).toHaveValue("012345"); expect(submitted).toBe(0);
  await accessible(page);
  let release: () => void = () => {}, entered: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; }), rotated = new Promise<void>((resolve) => { entered = resolve; });
  await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(origin, "https://127.0.0.1:3001"),
      headers: { ...await route.request().allHeaders(), host: "hub.localhost:3001" } });
    entered(); await held; await route.fulfill({ response });
  });
  try {
    await verifyEnrollment(page, login); await rotated;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByLabel("Setup key", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeFocused();
  await expect(page.getByRole("img", { name: "Authenticator setup QR code" })).toHaveCount(0);
  const codes = await page.getByLabel("Save your backup codes", { exact: true }).inputValue();
  expect(Boolean(codes)).toBe(true); expect(page.url()).toBe(origin + "/mfa");
  await saveBackupCodes(page, context);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  expect((await page.getByLabel("Save your backup codes", { exact: true }).inputValue()) === codes).toBe(true);
  expect(await page.evaluate((privateValues) => {
    const stored = JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]);
    return privateValues.every((value) => !stored.includes(value));
  }, [codes, ...codes.split("\n")])).toBe(true);
  await accessible(page);
  const departure = await observeDeparture(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(departure).toBe(true);
  await expect(page).toHaveURL(origin + "/stms/logins");
});

test("when pending setup is refreshed then page reads return no stored key and the already-added authenticator can finish", async ({ page, context }) => {
  const login = getLogin("mfaRefresh"); await addLogin(context, login); await page.goto("/profile");
  await expect(page).toHaveURL(origin + "/mfa"); await beginSetup(page);
  expect(await page.evaluate(() => {
    const qr = document.querySelector("[data-mfa-qr]");
    if (!qr?.childElementCount) throw new Error("Missing setup QR drawing.");
    window.dispatchEvent(new Event("pagehide"));
    return qr.childElementCount === 0;
  })).toBe(true);
  const before = await factorFingerprint(login.loginId), response = await page.reload();
  expect(response?.headers()["cache-control"]).toBe("private, no-store"); expect(response?.headers()["vary"]).toContain("cookie");
  await expect(page.getByText(/A setup is already waiting/)).toBeVisible(); await expect(page.getByLabel("Setup key", { exact: true })).toHaveCount(0); await expect(page.getByRole("img", { name: "Authenticator setup QR code" })).toHaveCount(0);
  expect(await factorFingerprint(login.loginId) === before).toBe(true);
  await accessible(page); await verifyEnrollment(page, login);
  await expect(page.getByText(/This page no longer has your backup codes/)).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click(); await expect(page).toHaveURL(origin + "/stms/logins");
});

test("when a pending key was lost then only an explicit password-confirmed restart replaces it", async ({ page, context }) => {
  const login = getLogin("mfaRestart"); await addLogin(context, login); await page.goto("/mfa"); await beginSetup(page);
  const before = await factorFingerprint(login.loginId); await page.reload();
  await page.getByRole("button", { name: "Restart setup", exact: true }).click();
  const dialog = page.getByRole("alertdialog"); await expect(dialog).toContainText("Your previous setup key and backup codes will stop working.");
  await dialog.getByLabel("Current password").fill("Wrong-password123!"); await dialog.getByRole("button", { name: "Confirm restart" }).click();
  await expect(dialog.getByRole("alert")).toContainText("The current password is incorrect."); expect(await factorFingerprint(login.loginId) === before).toBe(true);
  await accessible(page); await dialog.getByLabel("Current password").fill(password); await dialog.getByRole("button", { name: "Confirm restart" }).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByLabel("Setup key", { exact: true })).toBeVisible();
  expect(await factorFingerprint(login.loginId) !== before).toBe(true); await verifyEnrollment(page, login);
  await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeVisible();
});

for (const method of ["totp", "backup"] as const) test("when a returning master uses " + method + " then the native challenge completes before the fixed Hub destination", async ({ page }) => {
  const login = getLogin(method === "totp" ? "mfaReturning" : "mfaBackup"); await signIn(page, login);
  await expect(page).toHaveURL(origin + "/mfa"); await expect(page.getByRole("heading", { name: "Verify your sign-in" })).toBeFocused();
  if (method === "backup") await page.getByRole("button", { name: "Use a backup code" }).click();
  const label = method === "totp" ? "Authenticator code" : "Backup code";
  await page.getByLabel(label, { exact: true }).fill(method === "totp" ? await readBrowserMfaCode(login.loginId) : await backupFor(login));
  await accessible(page); await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(origin + "/stms/logins");
});

for (const key of ["mfaSigned", "mfaSignedNew"]) test("when " + key + " follows a signed workspace link then MFA and missing profile completion preserve its exact query", async ({ page }) => {
  const login = getLogin(key); await mockWidget(page);
  await page.route("https://workspace.example.test/auth/callback**", (route) => route.fulfill({ body: "Registered callback", contentType: "text/plain" }));
  const state = "mfa-browser-state-" + key, challenge = createHash("sha256").update("mfa-verifier-" + "s".repeat(45)).digest("base64url");
  await page.goto("/api/auth/oauth2/authorize?" + new URLSearchParams({ client_id: fixtures.clientId, redirect_uri: "https://workspace.example.test/auth/callback",
    response_type: "code", scope: "openid profile email", state, nonce: "mfa-browser-nonce", code_challenge_method: "S256", code_challenge: challenge }));
  await expect(page).toHaveURL(/\/sign-in\?/);
  await fillSignIn(page, login); await expect(page).toHaveURL(/\/mfa\?/);
  expect(new URL(page.url()).searchParams.get("state")).toBe(state);
  const mfaSearch = new URL(page.url()).search;
  if (key === "mfaSignedNew") {
    await beginSetup(page); await verifyEnrollment(page, login);
    await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeVisible();
    expect(page.url()).toBe(origin + "/mfa" + mfaSearch); await page.getByRole("button", { name: "Continue", exact: true }).click();
  } else { await page.getByLabel("Authenticator code", { exact: true }).fill(await readBrowserMfaCode(login.loginId)); await page.getByRole("button", { name: "Verify", exact: true }).click(); }
  await expect(page).toHaveURL(/\/complete-profile\?/);
  const profileSearch = new URL(page.url()).search;
  expect(new URL(page.url()).searchParams.get("state")).toBe(state);
  expect(new URLSearchParams(profileSearch).getAll("ba_param").includes("client_id")).toBe(true);
  if (key === "mfaSignedNew") expect(profileSearch === mfaSearch).toBe(true);
  await page.getByLabel("Country or region").selectOption("US"); await page.getByLabel("Number", { exact: true }).fill("2025550123");
  const callback = page.waitForRequest("https://workspace.example.test/auth/callback**"); await page.getByRole("button", { name: "Save and continue" }).click();
  const destination = new URL((await callback).url()); expect(destination.searchParams.get("state")).toBe(state); expect(Boolean(destination.searchParams.get("code"))).toBe(true);
});

test("when an ordinary login opens MFA with display-only intent then it returns to its fixed destination", async ({ page, context }) => {
  await addLogin(context, getLogin("mfaOrdinary")); await page.goto("/mfa?intent=replace");
  await expect(page).toHaveURL(origin + "/no-workspace");
});

test("when a live login change is detected then the mounted private setup display is cleared", async ({ page, context }) => {
  await addLogin(context, getLogin("mfaIdentity")); await page.goto("/mfa"); await beginSetup(page);
  await expect(page.getByLabel("Setup key", { exact: true })).toBeVisible();
  await addLogin(context, getLogin("mfaOther")); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText("The signed-in login changed.");
  await expect(page.getByLabel("Setup key", { exact: true })).toHaveCount(0); await expect(page.getByRole("img", { name: "Authenticator setup QR code" })).toHaveCount(0); await expect(page.getByLabel("Authenticator code", { exact: true })).toHaveCount(0);
});

test("when another tab restarts pending setup then the old private key is cleared without disturbing the new display", async ({ page, context }) => {
  await addLogin(context, getLogin("mfaConcurrent")); await page.goto("/mfa"); await beginSetup(page);
  const other = await context.newPage();
  try {
    await other.goto("/mfa"); await other.getByRole("button", { name: "Restart setup", exact: true }).click();
    const dialog = other.getByRole("alertdialog"); await dialog.getByLabel("Current password").fill(password);
    await dialog.getByRole("button", { name: "Confirm restart" }).click(); await expect(other.getByLabel("Setup key", { exact: true })).toBeVisible();
    await page.bringToFront(); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("alert")).toContainText("Setup changed in another tab."); await expect(page.getByLabel("Setup key", { exact: true })).toHaveCount(0); await expect(page.getByRole("img", { name: "Authenticator setup QR code" })).toHaveCount(0);
    await expect(other.getByLabel("Setup key", { exact: true })).toBeVisible();
  } finally { await other.close(); }
});

test("when a limited master requested a workspace then enrollment returns to that workspace through fixed Hub pages", async ({ page, context }) => {
  const login = getLogin("mfaRequested"); await addLogin(context, login); await page.goto("/auth/destination?requestedWorkspaceId=" + fixtures.workspace.id);
  await expect(page).toHaveURL(origin + "/mfa?requestedWorkspaceId=" + fixtures.workspace.id);
  await beginSetup(page); await verifyEnrollment(page, login); await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(fixtures.workspace.origin + "/");
});

test("when a returning master requested a workspace then MFA and missing profile completion retain that selection", async ({ page }) => {
  const login = getLogin("mfaRequestedReturning"), search = "?requestedWorkspaceId=" + fixtures.workspace.id;
  await mockWidget(page); await page.goto("/sign-in" + search); await fillSignIn(page, login);
  await expect(page).toHaveURL(origin + "/mfa" + search);
  await page.getByLabel("Authenticator code", { exact: true }).fill(await readBrowserMfaCode(login.loginId));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(origin + "/complete-profile" + search);
  await page.getByLabel("Full name").fill("Completed master"); await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(fixtures.workspace.origin + "/");
});

for (const action of ["start again", "sign out"] as const) test("when a master chooses " + action + " then typed credentials are cleared before the next document loads", async ({ page, context }) => {
  if (action === "start again") { await signIn(page, getLogin("mfaClearSignIn")); await expect(page).toHaveURL(origin + "/mfa"); }
  else { await addLogin(context, getLogin("mfaClearSetup")); await page.goto("/mfa"); }
  const field = page.getByLabel(action === "start again" ? "Authenticator code" : "Current password", { exact: true });
  await field.fill(action === "start again" ? "012345" : password);
  const departure = await observeDeparture(page);
  if (action === "start again") await page.getByRole("link", { name: "Start again" }).click();
  else await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(departure).toBe(true);
  await expect(page).toHaveURL(origin + "/sign-in");
});

test("New backup-code set", async ({ page, browser, context }) => {
  const login = getLogin("mfaManage"); await freshMaster(page, login); await page.goto("/profile");
  const region = page.getByRole("region", { name: "Two-step sign-in", exact: true }), oldCode = await backupFor(login), before = await factorFingerprint(login.loginId);
  await expect(region.getByText("Your authenticator is on.")).toBeVisible(); await accessible(page);
  await region.getByLabel("Current password").fill("Wrong-password123!"); await region.getByRole("button", { name: "Generate new backup codes" }).click();
  await expect(region.getByRole("alert")).toContainText("The current password is incorrect."); expect(await factorFingerprint(login.loginId) === before).toBe(true);
  await region.getByLabel("Current password").fill(password); await region.getByRole("button", { name: "Generate new backup codes" }).click();
  await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeFocused();
  const codes = await page.getByLabel("Save your backup codes", { exact: true }).inputValue(); expect(codes.split("\n")).toHaveLength(10);
  await saveBackupCodes(page, context);
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await expect(page.getByRole("button", { name: "Done", exact: true })).toBeEnabled();
  expect(await page.getByLabel("Save your backup codes", { exact: true }).inputValue() === codes).toBe(true); await accessible(page);
  await page.getByRole("button", { name: "Done", exact: true }).click(); await expect(page.getByLabel("Save your backup codes", { exact: true })).toHaveCount(0);
  await expect(region.getByLabel("Current password")).toHaveValue("");
  const other = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const verification = await other.newPage(); await signIn(verification, login); await verification.getByRole("button", { name: "Use a backup code" }).click();
    await verification.getByLabel("Backup code", { exact: true }).fill(oldCode); await verification.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(verification.getByRole("alert")).toContainText("That code was not accepted.");
    await verification.getByRole("button", { name: "Use an authenticator code" }).click();
    await verification.getByLabel("Authenticator code", { exact: true }).fill(await readBrowserMfaCode(login.loginId)); await verification.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(verification).toHaveURL(origin + "/stms/logins");
  } finally { await other.close(); }
});

test("Authenticator replacement", async ({ page }) => {
  const login = getLogin("mfaReplace"); await freshMaster(page, login); await page.goto("/profile");
  const before = await factorFingerprint(login.loginId); await page.getByRole("link", { name: "Replace authenticator" }).click();
  await expect(page).toHaveURL(origin + "/mfa?intent=replace"); await page.getByRole("button", { name: "Replace authenticator", exact: true }).click();
  const dialog = page.getByRole("alertdialog"); await expect(dialog).toContainText("This signs out your other devices"); await accessible(page);
  await dialog.getByLabel("Current password").fill("Wrong-password123!"); await dialog.getByRole("button", { name: "Confirm replacement" }).click();
  await expect(dialog.getByRole("alert")).toContainText("The current password is incorrect."); expect(await factorFingerprint(login.loginId) === before).toBe(true);
  await dialog.getByLabel("Current password").fill(password); await dialog.getByRole("button", { name: "Confirm replacement" }).click();
  await expect(page.getByLabel("Setup key", { exact: true })).toBeVisible(); expect(await factorFingerprint(login.loginId) !== before).toBe(true);
  expect(await withBrowserHub(async ({ auth }) => await auth.api.getSession({ headers: { cookie: login.cookie } }) === null)).toBe(true);
  const limited = await page.context().newPage();
  try { await limited.goto("/stms/logins"); await expect(limited).toHaveURL(origin + "/mfa"); }
  finally { await limited.close(); }
  await expect(page.getByRole("img", { name: "Authenticator setup QR code" })).toBeVisible();
  await verifyEnrollment(page, login); await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeFocused();
  await expect(page.getByRole("img", { name: "Authenticator setup QR code" })).toHaveCount(0);
  await accessible(page); await page.getByRole("button", { name: "Continue", exact: true }).click(); await expect(page).toHaveURL(origin + "/stms/logins");
});

test("Last backup code", async ({ page, context }) => {
  const login = getLogin("mfaLast"); await signIn(page, login); await page.getByRole("button", { name: "Use a backup code" }).click();
  await page.getByLabel("Backup code", { exact: true }).fill(await backupFor(login)); await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(origin + "/stms/logins"); await page.goto("/profile"); await page.getByRole("link", { name: "Replace authenticator" }).click();
  await page.getByRole("button", { name: "Replace authenticator", exact: true }).click();
  const dialog = page.getByRole("alertdialog"); await dialog.getByLabel("Current password").fill(password); await dialog.getByRole("button", { name: "Confirm replacement" }).click();
  await expect(page.getByLabel("Setup key", { exact: true })).toBeVisible(); await expect(page.getByLabel("Backup code", { exact: true })).toHaveCount(0);  await verifyEnrollment(page, login); await expect(page.locator("#mfa-backup-codes")).toBeVisible();
  expect((await page.locator("#mfa-backup-codes").inputValue()).split("\n")).toHaveLength(10); await saveBackupCodes(page, context);
});

test("when the last backup code completed sign-in then password confirmation can generate a new set without another second factor", async ({ page }) => {
  const login = getLogin("mfaLastBackups"); await signIn(page, login); await page.getByRole("button", { name: "Use a backup code" }).click();
  await page.getByLabel("Backup code", { exact: true }).fill(await backupFor(login)); await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(origin + "/stms/logins"); await page.goto("/profile"); await generateFromProfile(page);
  await expect(page.getByLabel("Save your backup codes", { exact: true })).toBeVisible(); await expect(page.getByLabel("Authenticator code", { exact: true })).toHaveCount(0);
});

for (const action of ["backups", "replace"] as const) test("Current password and recent MFA — browser " + action, async ({ page, context }) => {
  const fixture = await createMfaClockFixture(290_000), login = fixture.login; await addLogin(context, login); await page.goto("/profile");
  if (action === "replace") { await page.getByRole("link", { name: "Replace authenticator" }).click(); await page.getByRole("button", { name: "Replace authenticator", exact: true }).click(); }
  const region = action === "replace" ? page.getByRole("alertdialog") : page.getByRole("region", { name: "Two-step sign-in", exact: true });
  const input = region.getByLabel("Current password"); await expect(input).toBeEnabled(); await input.fill(password);
  const before = await factorFingerprint(login.loginId);
  await expect.poll(() => Date.now() > fixture.deadline, { timeout: 20_000 }).toBe(true);
  await region.getByRole("button", { name: action === "replace" ? "Confirm replacement" : "Generate new backup codes" }).click();
  await expect(region.getByText(/For this change, sign in again/).first()).toBeVisible(); await expect(input).toHaveValue(password); await expect(input).toBeDisabled();
  expect(await factorFingerprint(login.loginId) === before).toBe(true); await accessible(page);
  await expect(region.locator("form[data-mfa-credentials]")).toHaveAttribute("aria-busy", "false");
  await mockWidget(context);
  const opened = context.waitForEvent("page"); await region.getByRole("link", { name: "Sign in in a new tab" }).click();
  const other = await opened;
  try {
    await fillSignIn(other, login); await expect(other).toHaveURL(origin + "/mfa");
    await page.bringToFront(); await expect(input).toHaveValue(password);
    await finishMasterVerification(other, login);
  } finally { await other.close(); }
  await page.bringToFront();
  const checked = page.waitForResponse((response) => response.url().includes("/_serverFn/") && response.request().method() === "POST");
  await region.getByRole("button", { name: "Check access and continue", exact: true }).click();
  const response = await checked, result = await response.json();
  expect({ status: response.status(), management: result.mfa ?? result.management, code: result.code }).toEqual({ status: 200, management: "ready", code: undefined });
  await expect(input).toBeEnabled(); await expect(input).toHaveValue(password);
  await region.getByRole("button", { name: action === "replace" ? "Confirm replacement" : "Generate new backup codes" }).click();
  if (action === "replace") await expect(page.getByLabel("Setup key", { exact: true })).toBeVisible();
  else await expect(page.getByLabel("Save your backup codes", { exact: true })).toBeVisible();
});

test("when an already-old verification opens Profile then management offers fresh sign-in while ordinary profile fields stay available", async ({ page, context }) => {
  const fixture = await createMfaClockFixture(300_001); await addLogin(context, fixture.login); await page.goto("/profile");
  const region = page.getByRole("region", { name: "Two-step sign-in", exact: true });
  await expect(region.getByLabel("Current password")).toBeDisabled(); await expect(region.getByRole("link", { name: "Sign in in a new tab" })).toHaveAttribute("href", "/sign-in");
  await expect(page.getByLabel("Full name")).toBeEnabled(); await accessible(page);
});

test("when replacement setup is refreshed then no key is retrieved and lost backups can be replaced through Profile after verification", async ({ page, context }) => {
  const login = getLogin("mfaRefreshReplace"); await freshMaster(page, login); await page.goto("/mfa?intent=replace");
  await page.getByRole("button", { name: "Replace authenticator", exact: true }).click(); const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Current password").fill(password); await dialog.getByRole("button", { name: "Confirm replacement" }).click();
  await expect(page.getByLabel("Setup key", { exact: true })).toBeVisible(); const before = await factorFingerprint(login.loginId); await page.reload();
  await expect(page.getByLabel("Setup key", { exact: true })).toHaveCount(0); await expect(page.getByRole("img", { name: "Authenticator setup QR code" })).toHaveCount(0); expect(await factorFingerprint(login.loginId) === before).toBe(true);
  await verifyEnrollment(page, login); await expect(page.getByText(/This page no longer has your backup codes/)).toBeVisible();
  const opened = context.waitForEvent("page"); await page.getByRole("link", { name: "Open Profile in a new tab" }).click(); const profile = await opened;
  try { await expect(profile).toHaveURL(origin + "/profile"); await generateFromProfile(profile); await expect(profile.getByLabel("Save your backup codes", { exact: true })).toBeVisible(); }
  finally { await profile.close(); }
});

test("when a generated backup display is refreshed then stored codes are not retrieved and generation is not repeated", async ({ page }) => {
  const login = getLogin("mfaManageOther"); await freshMaster(page, login); await page.goto("/profile"); let submissions = 0;
  page.on("request", (request) => { if (request.url().includes("/_serverFn/") && request.postData()?.includes('"password"')) submissions++; });
  await generateFromProfile(page); await expect(page.getByLabel("Save your backup codes", { exact: true })).toBeVisible(); const before = await factorFingerprint(login.loginId);
  await page.reload(); await expect(page.getByLabel("Save your backup codes", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Two-step sign-in", exact: true }).getByLabel("Current password")).toHaveValue("");
  expect(await factorFingerprint(login.loginId) === before).toBe(true); expect(submissions).toBe(1);
});

test("when a login changes during a private Profile display then codes are cleared while the access dialog identifies the change", async ({ page, context }) => {
  const login = getLogin("mfaManageIdentity"); await freshMaster(page, login); await page.goto("/profile"); await generateFromProfile(page);
  await expect(page.getByLabel("Save your backup codes", { exact: true })).toBeVisible();
  await addLogin(context, getLogin("mfaOrdinary")); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alertdialog")).toContainText("Your sign-in has changed."); await expect(page.getByLabel("Save your backup codes", { exact: true })).toHaveCount(0);
});

test("when a private action reply arrives after pagehide then it cannot recreate the discarded backup display", async ({ page }) => {
  const login = getLogin("mfaManageLost"); await freshMaster(page, login); await page.goto("/profile"); const before = await factorFingerprint(login.loginId);
  let release: () => void = () => {}, entered: () => void = () => {}, submissions = 0;
  const held = new Promise<void>((resolve) => { release = resolve; }), committed = new Promise<void>((resolve) => { entered = resolve; });
  await page.route("**/_serverFn/**", async (route) => {
    if (!route.request().postData()?.includes('"password"')) { await route.continue(); return; }
    submissions++; const response = await route.fetch({ url: route.request().url().replace(origin, "https://127.0.0.1:3001"), headers: { ...await route.request().allHeaders(), host: "hub.localhost:3001" } });
    entered(); await held; await route.fulfill({ response });
  });
  try { await generateFromProfile(page); await committed; await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))); }
  finally { release(); }
  await expect(page.getByRole("region", { name: "Two-step sign-in", exact: true }).getByRole("button", { name: "Generate new backup codes" })).toBeEnabled();
  await expect(page.getByLabel("Save your backup codes", { exact: true })).toHaveCount(0); expect(submissions).toBe(1); expect(await factorFingerprint(login.loginId) !== before).toBe(true);
});

test("when an ordinary login opens Profile then master MFA controls are absent", async ({ page, context }) => {
  await addLogin(context, getLogin("mfaOrdinary")); await page.goto("/profile");
  await expect(page.getByRole("region", { name: "Two-step sign-in", exact: true })).toHaveCount(0); await expect(page.getByRole("link", { name: "Replace authenticator" })).toHaveCount(0);
});

test("Private authentication material", async ({ page, context }) => {
  const login = getLogin("mfaPrivacy"), privateValues = [password], navigation: string[] = [], diagnostics: string[] = [];
  const requests: { url: string; body: string; isPasswordSubmission: boolean; isCodeSubmission: boolean }[] = [];
  const responses: { body: string; isPrivateReply: boolean; headers: string }[] = [], pending: Promise<void>[] = [];
  let hasReadFailure = false;
  const observeRequest = (request: import("@playwright/test").Request): void => {
    const url = new URL(request.url()), body = request.postData() ?? "";
    navigation.push(request.url());
    requests.push({ url: request.url(), body, isPasswordSubmission: request.method() === "POST" && url.origin === origin
      && (url.pathname === "/api/auth/sign-in/email" || url.pathname.startsWith("/_serverFn/")),
      isCodeSubmission: request.method() === "POST" && url.origin === origin && url.pathname.startsWith("/api/auth/two-factor/verify-") });
  };
  const observeResponse = (response: import("@playwright/test").Response): void => {
    if (new URL(response.url()).origin !== origin || !response.request().isNavigationRequest() && !response.url().includes("/api/auth/") && !response.url().includes("/_serverFn/")) return;
    pending.push((async () => {
      try {
        const headers = await response.allHeaders();
        if (!/json|html/.test(headers["content-type"] ?? "")) return;
        responses.push({ body: await response.text(), headers: JSON.stringify(headers), isPrivateReply: response.request().method() === "POST"
          && new URL(response.url()).pathname.startsWith("/_serverFn/") && Boolean(response.request().postData()?.includes('"password"')) });
      } catch { hasReadFailure = true; }
    })());
  };
  const observeConsole = (message: import("@playwright/test").ConsoleMessage): void => {
    pending.push((async () => { diagnostics.push(message.text()); for (const value of message.args()) diagnostics.push(JSON.stringify(await value.jsonValue()) ?? "undefined"); })()
      .catch(() => { hasReadFailure = true; }));
  };
  context.on("request", observeRequest); context.on("response", observeResponse); context.on("console", observeConsole);
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await signIn(page, login); await beginSetup(page);
    await Promise.all(pending);
    const setupReply = responses.find((response) => response.isPrivateReply);
    if (!setupReply) throw new Error("Missing native setup reply.");
    const material: { totpURI?: unknown } = JSON.parse(setupReply.body);
    if (typeof material.totpURI !== "string") throw new Error("Missing native setup URI.");
    privateValues.push(material.totpURI);
    const key = await page.getByLabel("Setup key", { exact: true }).inputValue(); privateValues.push(key);
    await page.evaluate(() => { Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async () => { throw new DOMException("Clipboard unavailable", "NotAllowedError"); } }); });
    await page.getByRole("button", { name: "Copy setup key" }).click(); await expect(page.getByText("Could not copy. Select and copy the text manually.")).toBeVisible();
    const code = await readBrowserMfaCode(login.loginId); await page.getByLabel("Authenticator code", { exact: true }).fill(code); await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page.locator("#mfa-backup-codes")).toBeVisible(); const codes = await page.locator("#mfa-backup-codes").inputValue(); privateValues.push(...codes.split("\n"));
    await page.getByRole("button", { name: "Copy backup codes" }).click(); await expect(page.getByText("Could not copy. Select and copy the text manually.")).toBeVisible();
    await page.evaluate(() => { URL.createObjectURL = () => { throw new Error("Download unavailable"); }; });
    await page.getByRole("button", { name: "Download backup codes" }).click(); await expect(page.getByText("Could not download. Copy the codes or select the text to save them.")).toBeVisible();
    await page.locator("#mfa-backup-codes").focus(); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.press("ControlOrMeta+C");
    expect(await page.evaluate(async (expected) => await navigator.clipboard.readText() === expected, codes)).toBe(true);
    expect(await page.locator("#mfa-backup-codes").inputValue() === codes).toBe(true); await accessible(page);
    await page.getByRole("button", { name: "Continue", exact: true }).click(); await expect(page).toHaveURL(origin + "/stms/logins"); await page.goto("/profile");
    await generateFromProfile(page); await expect(page.locator("#mfa-backup-codes")).toBeVisible(); privateValues.push(...(await page.locator("#mfa-backup-codes").inputValue()).split("\n"));
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const stored = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
    const audits = await withBrowserHub(async ({ db }) => JSON.stringify(await db.selectFrom("auditEntries").selectAll().execute()));
    context.off("request", observeRequest); context.off("response", observeResponse); context.off("console", observeConsole); await Promise.all(pending);
    const otp = new RegExp("(^|[^A-Za-z0-9])" + code + "([^A-Za-z0-9]|$)");
    const hasCredentials = (text: string): boolean => text.includes(password) || text.includes(encodeURIComponent(password)) || otp.test(text);
    const hasMaterial = (text: string): boolean => privateValues.filter((value) => value !== password).some((value) => text.includes(value) || text.includes(encodeURIComponent(value)));
    const hasSecret = (text: string): boolean => hasCredentials(text) || hasMaterial(text);
    const hasRequestLeak = requests.some((request) => {
      if (new URL(request.url).origin !== origin) return hasSecret(request.body);
      return request.body.includes(password) && !request.isPasswordSubmission || otp.test(request.body) && !request.isCodeSubmission || hasMaterial(request.body);
    });
    const hasResponseLeak = responses.some((response) => {
      if (hasCredentials(response.body)) return true;
      if (!response.isPrivateReply) return hasMaterial(response.body);
      const body: unknown = JSON.parse(response.body);
      if (!body || typeof body !== "object" || Array.isArray(body)) return true;
      const publicFields = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "backupCodes" && key !== "totpURI"));
      return hasMaterial(JSON.stringify(publicFields));
    });
    expect({ readsFailed: hasReadFailure, urls: navigation.some(hasSecret), console: diagnostics.some(hasSecret), storage: hasSecret(stored), audits: hasSecret(audits),
      requestBodies: hasRequestLeak, responseHeaders: responses.some((response) => hasSecret(response.headers)), responseBodies: hasResponseLeak })
      .toEqual({ readsFailed: false, urls: false, console: false, storage: false, audits: false, requestBodies: false, responseHeaders: false, responseBodies: false });
    expect([...new Set(requests.map((request) => new URL(request.url).origin).filter((value) => value !== origin))]).toEqual(["https://challenges.cloudflare.com"]);
    const privateReplies = responses.filter((response) => response.isPrivateReply); expect(privateReplies).toHaveLength(2);
    expect(privateReplies.every((response) => /no-store/.test(JSON.parse(response.headers)["cache-control"] ?? ""))).toBe(true);
    expect(privateValues.length).toBe(23); expect(code).toMatch(/^\d{6}$/);
  } finally { context.off("request", observeRequest); context.off("response", observeResponse); context.off("console", observeConsole); await Promise.all(pending); }
});

test("when a signed workspace request is changed during MFA then verification issues no callback or workspace access", async ({ page }) => {
  const login = getLogin("mfaTampered"); await mockWidget(page); let callbacks = 0;
  await page.route("https://workspace.example.test/auth/callback**", (route) => { callbacks++; return route.fulfill({ body: "Unexpected callback" }); });
  await page.goto("/api/auth/oauth2/authorize?" + new URLSearchParams({ client_id: fixtures.clientId, redirect_uri: "https://workspace.example.test/auth/callback",
    response_type: "code", scope: "openid profile email", state: "mfa-valid-state", nonce: "mfa-tamper-nonce", code_challenge_method: "S256", code_challenge: createHash("sha256").update("v".repeat(48)).digest("base64url") }));
  await fillSignIn(page, login); await expect(page).toHaveURL(/\/mfa\?/);
  const tampered = new URL(page.url()); tampered.searchParams.set("state", "changed-state"); await page.goto(tampered.href);
  await page.getByLabel("Authenticator code", { exact: true }).fill(await readBrowserMfaCode(login.loginId)); await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("sign-in link"); expect(callbacks).toBe(0); expect(new URL(page.url()).pathname).toBe("/mfa"); await accessible(page);
});

test("Invalid enrollment code", async ({ page, context }) => {
  const login = getLogin("mfaInvalidEnrollment"); await addLogin(context, login); await page.goto("/mfa"); await beginSetup(page);
  const before = await factorFingerprint(login.loginId), expired = await readExpiredBrowserMfaCode(login.loginId);
  await page.getByLabel("Authenticator code", { exact: true }).fill(expired); await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("That code was not accepted.");
  await expect(page.getByLabel("Authenticator code", { exact: true })).toHaveValue(expired); await expect(page.getByLabel("Authenticator code", { exact: true })).toBeFocused();
  expect(await factorFingerprint(login.loginId) === before).toBe(true); await accessible(page);
  const protectedTab = await context.newPage();
  try { await protectedTab.goto("/stms/logins"); await expect(protectedTab).toHaveURL(origin + "/mfa"); }
  finally { await protectedTab.close(); }
  await verifyEnrollment(page, login); await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeVisible();
});

test("Invalid or expired verification", async ({ page }) => {
  const login = getLogin("mfaInvalidSignIn"); await signIn(page, login);
  const expired = await readExpiredBrowserMfaCode(login.loginId); await page.getByLabel("Authenticator code", { exact: true }).fill(expired);
  await page.getByRole("button", { name: "Verify", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("That code was not accepted.");
  await expect(page.getByLabel("Authenticator code", { exact: true })).toHaveValue(expired); await accessible(page);
  await finishMasterVerification(page, login);
});

test("when an authentic expired challenge reaches MFA then fresh credential sign-in is required without replaying verification", async ({ page, context }) => {
  const login = await createExpiredMfaChallenge(); await addLogin(context, login); await mockWidget(page); let submissions = 0;
  page.on("request", (request) => { if (request.url().includes("/two-factor/verify-")) submissions++; });
  await page.goto("/mfa"); await expect(page).toHaveURL(origin + "/sign-in");
  await expect(page.getByLabel("Authenticator code", { exact: true })).toHaveCount(0); await accessible(page);
  await fillSignIn(page, login); await finishMasterVerification(page, login);
  expect(submissions).toBe(1);
});

test("Existing password-only session", async ({ page, context, browser }) => {
  const login = getLogin("mfaOldSession"); await addLogin(context, login);
  const enrolled = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const other = await enrolled.newPage(); await signIn(other, login); await beginSetup(other); await verifyEnrollment(other, login);
    await expect(other.getByRole("heading", { name: "Save your backup codes" })).toBeVisible();
    await page.goto("/stms/logins"); await expect(page).toHaveURL(/\/(sign-in|mfa)$/); await expect(page.getByRole("heading", { name: "Logins", exact: true })).toHaveCount(0);
    await page.goto(fixtures.workspace.origin + "/auth/start"); await expect(page).toHaveURL(/hub\.localhost:3001\/(sign-in|mfa)/);
    expect(await withBrowserHub(async ({ auth }) => await auth.api.getSession({ headers: { cookie: login.cookie } }) === null)).toBe(true);
  } finally { await enrolled.close(); }
});

test("Fresh sign-in on the same browser", async ({ page }) => {
  const login = getLogin("mfaFresh"); await freshMaster(page, login); await endSignIn(page); await signIn(page, login);
  await expect(page).toHaveURL(origin + "/mfa"); await expect(page.getByRole("checkbox")).toHaveCount(0);
  await finishMasterVerification(page, login);
});

test("when a genuinely expired master session returns then password acceptance still requires new MFA", async ({ page, context }) => {
  const { login } = await createMfaClockFixture(31 * 86_400_000); await addLogin(context, login); await page.goto("/profile");
  await expect(page).toHaveURL(origin + "/sign-in"); await mockWidget(page); await fillSignIn(page, login); await finishMasterVerification(page, login);
});

test("Single-use backup sign-in", async ({ page }) => {
  const login = getLogin("mfaSingleUse"), code = await backupFor(login); await signIn(page, login);
  await page.getByRole("button", { name: "Use a backup code" }).click(); await page.getByLabel("Backup code", { exact: true }).fill(code);
  const departure = await observeDeparture(page); await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(origin + "/stms/logins"); await expect.poll(departure).toBe(true); await endSignIn(page); await signIn(page, login);
  await page.getByRole("button", { name: "Use a backup code" }).click(); await page.getByLabel("Backup code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Verify", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("That code was not accepted.");
  await expect(page.getByLabel("Backup code", { exact: true })).toHaveValue(code); await accessible(page);
});

test("Interrupted replacement", async ({ page }) => {
  const login = getLogin("mfaInterrupted"); await freshMaster(page, login); await page.goto("/mfa?intent=replace");
  await page.getByRole("button", { name: "Replace authenticator", exact: true }).click(); const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Current password").fill(password); let submissions = 0;
  await page.route("**/_serverFn/**", async (route) => {
    if (!route.request().postData()?.includes('"password"')) { await route.continue(); return; }
    submissions++; expect((await forwardMfa(route)).status()).toBe(200); await route.abort("connectionreset");
  });
  await dialog.getByRole("button", { name: "Confirm replacement" }).click(); await expect(page.getByRole("alert")).toContainText("We could not confirm the result.");
  await expect(page.getByLabel("Setup key", { exact: true })).toHaveCount(0); await expect(page.getByRole("img", { name: "Authenticator setup QR code" })).toHaveCount(0); await expect(page.getByRole("heading", { name: "Save your backup codes" })).toHaveCount(0);
  await page.reload();
  if (new URL(page.url()).pathname === "/sign-in") { await fillSignIn(page, login); await expect(page).toHaveURL(/\/mfa/); }
  await expect(page.getByText(/A setup is already waiting/)).toBeVisible(); expect(submissions).toBe(1);
  await verifyEnrollment(page, login); await expect(page.getByText(/This page no longer has your backup codes/)).toBeVisible();
});

test("Loss of all second factors", async ({ page }) => {
  const login = getLogin("mfaNoFactors");
  expect(await withBrowserHub(async ({ auth }) => (await auth.api.viewBackupCodes({ headers: { cookie: login.cookie }, body: { userId: login.loginId } })).backupCodes.length)).toBe(0);
  await signIn(page, login); await page.getByRole("button", { name: "Use a backup code" }).click();
  await page.getByLabel("Backup code", { exact: true }).fill("unavailable-backup-code"); await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("That code was not accepted."); await expect(page.getByRole("link", { name: /recover|reset|skip/i })).toHaveCount(0);
  await page.goto("/stms/logins"); await expect(page).toHaveURL(/\/(sign-in|mfa)$/); await expect(page.getByRole("heading", { name: "Logins", exact: true })).toHaveCount(0);
});

test("Login changes invalidate old access", async ({ page }) => {
  const login = getLogin("mfaRevoked"); await signIn(page, login);
  await withBrowserHub(async ({ auth }) => { await auth.api.changePassword({ headers: { cookie: login.cookie }, body: {
    currentPassword: password, newPassword: "Changed-fixture456!", revokeOtherSessions: true,
  } }); });
  await page.getByLabel("Authenticator code", { exact: true }).fill(await readBrowserMfaCode(login.loginId));
  await page.getByRole("button", { name: "Verify", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("This sign-in has ended.");
  await expect(page.getByLabel("Authenticator code", { exact: true })).toHaveCount(0); await accessible(page);
});

for (const kind of ["enrollment", "sign-in"] as const) test("Limited verification attempts — " + kind, async ({ page, context }) => {
  const login = getLogin(kind === "enrollment" ? "mfaRateEnrollment" : "mfaRateSignIn");
  if (kind === "enrollment") { await addLogin(context, login); await page.goto("/mfa"); await beginSetup(page); } else await signIn(page, login);
  const expired = await readExpiredBrowserMfaCode(login.loginId); let isLimited = false, submissions = 0;
  page.on("request", (request) => { if (request.url().includes("/two-factor/verify-totp")) submissions++; });
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.getByLabel("Authenticator code", { exact: true }).fill(expired);
    const reply = page.waitForResponse((response) => response.url().endsWith("/two-factor/verify-totp"));
    await page.getByRole("button", { name: "Verify", exact: true }).click(); const status = (await reply).status();
    if (status === 429) { isLimited = true; break; }
    if (status === 409) { await page.getByRole("link", { name: "Start again" }).click(); await fillSignIn(page, login); }
    else { expect(status).toBe(401); await expect(page.getByLabel("Authenticator code", { exact: true })).toHaveValue(expired); }
  }
  expect(isLimited).toBe(true); await expect(page.getByRole("alert")).toContainText("Too many attempts.");
  await expect(page.getByRole("button", { name: "Verify", exact: true })).toBeEnabled(); expect(submissions).toBeLessThanOrEqual(12); await accessible(page);
  if (kind === "enrollment") { await page.getByRole("button", { name: "Sign out", exact: true }).click(); await expect(page).toHaveURL(origin + "/sign-in"); }
});

test("when verification transport is unavailable then the error retains input and never retries automatically", async ({ page }) => {
  const login = getLogin("mfaTransport"); await signIn(page, login); let submissions = 0;
  await page.route("**/api/auth/two-factor/verify-totp", async (route) => { submissions++; await route.abort("connectionfailed"); });
  const code = await readBrowserMfaCode(login.loginId); await page.getByLabel("Authenticator code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Verify", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("We could not confirm the result.");
  await expect(page.getByLabel("Authenticator code", { exact: true })).toHaveValue(code); await expect(page.getByRole("button", { name: "Verify", exact: true })).toBeEnabled();
  expect(submissions).toBe(1); await accessible(page);
});

test("when a committed backup-generation reply is lost then refresh checks state without retrieving or replaying codes", async ({ page }) => {
  const login = getLogin("mfaLostBackups"); await freshMaster(page, login); await page.goto("/profile"); const before = await factorFingerprint(login.loginId); let submissions = 0;
  await page.route("**/_serverFn/**", async (route) => {
    if (!route.request().postData()?.includes('"password"')) { await route.continue(); return; }
    submissions++; expect((await forwardMfa(route)).status()).toBe(200); await route.abort("connectionreset");
  });
  await generateFromProfile(page); await expect(page.getByText(/The set may have changed/)).toBeVisible();
  await expect(page.getByLabel("Save your backup codes", { exact: true })).toHaveCount(0); expect(await factorFingerprint(login.loginId) !== before).toBe(true);
  await page.reload(); expect(submissions).toBe(1); await expect(page.getByLabel("Save your backup codes", { exact: true })).toHaveCount(0);
});

test("when MFA is operated by keyboard then validation, silent autofill, paste and focus work through enrollment", async ({ page, context }) => {
  const login = getLogin("mfaKeyboard"); await addLogin(context, login); await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin }); await page.goto("/mfa");
  await activate(page, page.getByRole("button", { name: "Begin setup", exact: true })); await expect(page.getByLabel("Current password")).toBeFocused(); await accessible(page);
  await page.getByLabel("Current password").evaluate((input: HTMLInputElement, value) => { input.value = value; }, password);
  await activate(page, page.getByRole("button", { name: "Begin setup", exact: true })); await expect(page.getByLabel("Setup key", { exact: true })).toBeVisible();
  await activate(page, page.getByRole("button", { name: "Verify", exact: true })); await expect(page.getByLabel("Authenticator code", { exact: true })).toBeFocused();
  await page.evaluate(async (code) => await navigator.clipboard.writeText(code), await readBrowserMfaCode(login.loginId)); await page.keyboard.press("ControlOrMeta+V");
  await activate(page, page.getByRole("button", { name: "Verify", exact: true })); await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeFocused();
  await activate(page, page.getByRole("button", { name: "Copy backup codes" })); await accessible(page);
  await activate(page, page.getByRole("button", { name: "Continue", exact: true })); await expect(page.getByRole("heading", { name: "Logins", exact: true })).toBeFocused();
});

test("when MFA translations expand on a narrow dark RTL screen then enrollment, verification, recovery and management stay accessible", async ({ page, context }) => {
  const login = getLogin("mfaLocale"); await addLogin(context, login); await context.addCookies([{ name: "PARAGLIDE_LOCALE", value: "en-XA", url: origin }]);
  await page.setViewportSize({ width: 320, height: 800 }); await page.emulateMedia({ colorScheme: "dark" }); await page.goto("/mfa"); await checkLayout(page);
  await page.locator("#mfa-password").fill(password); await page.getByRole("button", { name: /Begin setup/ }).click(); await expect(page.locator("#mfa-setup-key")).toBeVisible();
  await expect(page.getByRole("img", { name: /Authenticator setup QR code/ })).toBeVisible(); await checkLayout(page);
  await page.locator("#mfa-totp").fill(await readBrowserMfaCode(login.loginId)); await page.getByRole("button", { name: /Verify/ }).click(); await expect(page.locator("#mfa-backup-codes")).toBeVisible(); await checkLayout(page);
  await page.getByRole("button", { name: /Cöntïnüë/ }).click(); await expect(page).toHaveURL(origin + "/stms/logins"); await page.goto("/profile"); await checkLayout(page);
  const region = page.getByRole("region", { name: /Two-step sign-in/ }); await region.locator("#mfa-password").fill(password); await region.getByRole("button", { name: /Generate new backup codes/ }).click();
  await expect(page.locator("#mfa-backup-codes")).toBeVisible(); await checkLayout(page); await page.getByRole("button", { name: /Done/ }).click();
  await page.getByRole("link", { name: /Replace authenticator/ }).click(); await page.getByRole("button", { name: /Replace authenticator/ }).click(); await checkLayout(page);
  await page.getByRole("alertdialog").locator("#mfa-password").fill("Wrong-password123!"); await page.getByRole("button", { name: /Confirm replacement/ }).click(); await checkLayout(page);
  await page.getByRole("alertdialog").locator("#mfa-password").fill(password); await page.getByRole("button", { name: /Confirm replacement/ }).click();
  await expect(page.locator("#mfa-setup-key")).toBeVisible(); await checkLayout(page); await page.reload(); await checkLayout(page);
  await page.locator("#mfa-totp").fill(await readBrowserMfaCode(login.loginId)); await page.getByRole("button", { name: /Verify/ }).click(); await expect(page.getByText(/This page no longer has your backup codes/)).toBeVisible(); await checkLayout(page);
  await endSignIn(page); await mockWidget(page); await page.goto("/sign-in"); await page.getByLabel(/Email or username/).fill(login.email); await page.getByLabel(/Password/).fill(password);
  await page.getByRole("button", { name: /Sign in/ }).click(); await expect(page).toHaveURL(origin + "/mfa"); await checkLayout(page);
  await page.getByRole("button", { name: /Use a backup code/ }).click(); await checkLayout(page);
  const stale = await createMfaClockFixture(300_001); await context.clearCookies(); await addLogin(context, stale.login); await context.addCookies([{ name: "PARAGLIDE_LOCALE", value: "en-XA", url: origin }]);
  await page.goto("/profile");
  const staleManagement = page.getByRole("region", { name: /Two-step sign-in/ });
  await expect(staleManagement.locator("#mfa-password")).toBeDisabled(); await expect(staleManagement.locator('a[href="/sign-in"][target="_blank"]')).toBeVisible(); await checkLayout(page);

});

async function saveBackupCodes(page: Page, context: BrowserContext): Promise<void> {
  const codes = await page.getByLabel("Save your backup codes", { exact: true }).inputValue();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin }); await page.getByRole("button", { name: "Copy backup codes" }).click();
  expect(await page.evaluate(async (expected) => await navigator.clipboard.readText() === expected, codes)).toBe(true);
  const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Download backup codes" }).click();
  const download = await downloading, path = await download.path(); expect(download.suggestedFilename()).toBe("xpro-backup-codes.txt");
  expect(path ? await readFile(path, "utf8") === codes + "\n" : false).toBe(true);
}

async function endSignIn(page: Page): Promise<void> {
  expect(await page.evaluate(async () => (await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status)).toBe(200);
}
async function activate(page: Page, control: Locator): Promise<void> {
  await expect(control).toBeEnabled();
  for (let index = 0; index < 80; index++) {
    if (await control.evaluate((element) => element === document.activeElement)) { await page.keyboard.press("Enter"); return; }
    await page.keyboard.press("Tab");
  }
  throw new Error("The MFA control cannot be reached using the keyboard.");
}
async function checkLayout(page: Page): Promise<void> {
  await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl"));
  await expect(page.getByRole("heading").first()).toContainText("⟦");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await accessible(page);
}
async function forwardMfa(route: Route): Promise<APIResponse> {
  return await route.fetch({ url: route.request().url().replace(origin, "https://127.0.0.1:3001"), headers: { ...await route.request().allHeaders(), host: "hub.localhost:3001" } });
}

async function freshMaster(page: Page, login: Login): Promise<void> {
  await signIn(page, login); await finishMasterVerification(page, login);
}
async function finishMasterVerification(page: Page, login: Login): Promise<void> {
  await expect(page).toHaveURL(origin + "/mfa"); await page.getByLabel("Authenticator code", { exact: true }).fill(await readBrowserMfaCode(login.loginId));
  await page.getByRole("button", { name: "Verify", exact: true }).click(); await expect(page).toHaveURL(origin + "/stms/logins");
}
async function generateFromProfile(page: Page): Promise<void> {
  const region = page.getByRole("region", { name: "Two-step sign-in", exact: true }); await region.getByLabel("Current password").fill(password);
  await region.getByRole("button", { name: "Generate new backup codes" }).click();
}

async function signIn(page: Page, login: Login): Promise<void> { await mockWidget(page); await page.goto("/sign-in"); await fillSignIn(page, login); }
async function fillSignIn(page: Page, login: Login): Promise<void> {
  await page.getByLabel("Email or username").fill(login.email); await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
async function beginSetup(page: Page): Promise<void> {
  await page.getByLabel("Current password").fill(password); await page.getByRole("button", { name: "Begin setup", exact: true }).click();
  await expect(page.getByLabel("Setup key", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Authenticator setup QR code" })).toBeVisible();
}
async function verifyEnrollment(page: Page, login: Login): Promise<void> {
  await page.getByLabel("Authenticator code", { exact: true }).fill(await readBrowserMfaCode(login.loginId)); await page.getByRole("button", { name: "Verify", exact: true }).click();
}
async function backupFor(login: Login): Promise<string> {
  return await withBrowserHub(async ({ auth }) => {
    const result = await auth.api.viewBackupCodes({ headers: { cookie: login.cookie }, body: { userId: login.loginId } });
    const code = result.backupCodes[0]; if (!code) throw new Error("Missing native backup fixture."); return code;
  });
}
async function factorFingerprint(loginId: string): Promise<string> {
  return await withBrowserHub(async ({ db }) => createHash("sha256").update(JSON.stringify(await db.withoutPlugins().selectFrom("twoFactor").selectAll().where("userId", "=", loginId).executeTakeFirstOrThrow())).digest("hex"));
}
async function addLogin(context: BrowserContext, login: Login): Promise<void> {
  await context.addCookies(login.cookie.split("; ").map((part) => { const index = part.indexOf("="); return { name: part.slice(0, index), value: part.slice(index + 1), url: origin, httpOnly: true, secure: true, sameSite: "Lax" as const }; }));
}
function getLogin(key: string): Login { const login = fixtures.logins[key]; if (!login) throw new Error("Missing MFA browser fixture."); return login; }
async function accessible(page: Page): Promise<void> { expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); }
async function mockWidget(page: Page | BrowserContext): Promise<void> {
  // Only the external Turnstile SDK is replaced; application auth stays real.
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) => route.fulfill({ contentType: "application/javascript",
    body: "window.turnstile = { render(element, options) { queueMicrotask(() => options.callback('XXXX.DUMMY.TOKEN.XXXX')); return 'external-test-widget'; }, remove() {} };" }));
}

async function observeDeparture(page: Page): Promise<() => boolean | undefined> {
  let isCleared: boolean | undefined;
  await page.exposeFunction("mfaTestDeparture", (value: boolean) => { isCleared = value; });
  await page.evaluate(() => window.addEventListener("beforeunload", () => {
    // Send only a Boolean before the old document is suspended; inspecting it
    // from Playwright after navigation starts waits for the next document.
    const inputs = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("form[data-mfa-credentials] input, [data-mfa-private]")];
    const report = (window as Window & { mfaTestDeparture?: (value: boolean) => Promise<void> }).mfaTestDeparture;
    if (!report) throw new Error("Missing MFA departure observer.");
    // An undelivered report remains undefined and fails the polling assertion.
    const drawings = [...document.querySelectorAll("[data-mfa-qr]")];
    void report(inputs.every((input) => input.value === "") && drawings.every((qr) => qr.childElementCount === 0)).catch(() => {});
  }, { once: true }));
  return () => isCleared;
}
