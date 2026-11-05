import { test, expect, type APIResponse, type BrowserContext, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { verifyBrowserMfa } from "./hub-fixture";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "kysely";
import { withBrowserHub } from "./hub-fixture";
import { browserOrigins } from "./addresses";

const base = process.env.XPRO_BROWSER_TEMP;
if (!base) throw new Error("Use the isolated browser runner.");
const origin = "https://hub.localhost:3001", password = " Ordinary-person123! ";
const fixtures: { logins: Record<string, { cookie: string; loginId: string; email: string }>; workspace: { id: string; origin: string } } =
  JSON.parse(await readFile(join(base, "fixtures.json"), "utf8"));
let pageErrors: string[] = [];
test.beforeEach(({ page }) => { pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message)); });
test.afterEach(() => expect(pageErrors).toEqual([]));

test("an authorized master opens a private accessible form without requesting workspace choices", async ({ page, context }, info) => {
  await signIn(context, "createMaster");
  const calls: string[] = []; page.on("request", (request) => { if (request.url().includes("/_serverFn/")) calls.push(request.url()); });
  const response = await page.goto("/create-login");
  await expect(page.getByRole("heading", { name: "Create a login" })).toBeFocused();
  expect(response?.headers()["cache-control"]).toBe("private, no-store");
  expect(response?.headers()["vary"]).toContain("cookie");
  await expect(page.getByLabel("Login destination")).toHaveValue("standalone");
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("autocomplete", "section-new-login email");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "section-new-login new-password");
  expect(calls).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("create-login.png"), fullPage: true });
});

test("the server-rendered creation form uses POST and stays disabled before hydration", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true, javaScriptEnabled: false });
  try {
    await signIn(context, "createMaster"); const page = await context.newPage(); await page.goto("/create-login");
    await expect(page.locator("form")).toHaveAttribute("method", "post");
    await expect(page.getByLabel("Email", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Create login", exact: true })).toBeDisabled();
  } finally { await context.close(); }
});

test("anonymous and non-permitted members cannot open creation", async ({ page, context }) => {
  await page.goto("/create-login"); await expect(page).toHaveURL(origin + "/sign-in");
  await signIn(context, "createMember"); await page.goto("/create-login");
  await expect(page.getByRole("alert")).toHaveText("You do not have permission to create this login. Contact your administrator.");
  await expect(page.getByRole("button", { name: "Create login", exact: true })).toHaveCount(0);
});

test("validation waits for blur or submit and focuses the first field without losing pointer submission", async ({ page, context }) => {
  await openCreation(page, context); await expect(page.locator("#email-error")).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill("bad"); await page.keyboard.press("Tab");
  await expect(page.locator("#email-error")).toHaveText("Enter a valid email address.");
  await page.getByRole("button", { name: "Create login", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  await expect(page.getByRole("alert")).toContainText("Check the details below.");
  const values = await fillDetails(page);
  // The final focused field blurs onto the submit button; the same click must work.
  await page.getByLabel("Full name").focus(); await submit(page);
  await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeFocused();
  await expect(page.getByText(values.email + " can sign in", { exact: false })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Create another login" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
});

test("a master creates a complete unassigned login whose ordinary password works immediately", async ({ page, context }) => {
  await openCreation(page, context); const values = await fillDetails(page); await submit(page);
  await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeVisible();
  await context.clearCookies();
  const result = await nativeSignIn(page, values.email, password);
  expect(result.status).toBe(200);
  expect(result.session).toMatchObject({ user: { email: values.email, username: values.username, name: "Created person", role: "user" } });
  expect(result.session).not.toHaveProperty("user.phone");
  await page.goto("/"); await expect(page).toHaveURL(origin + "/no-workspace");
});

for (const [key, kind] of [["createOwner", "internal"], ["createAdmin", "external"]] as const) {
  test("a permitted " + key + " creates only in their own workspace as " + kind, async ({ page, context }) => {
    await openCreation(page, context, key);
    await expect(page.getByText("This login will belong to Browser workspace.")).toBeVisible();
    await expect(page.getByLabel("Login destination")).toHaveCount(0);
    await expect(page.getByLabel("Workspace", { exact: true })).toHaveCount(0);
    await page.getByLabel("User type").selectOption(kind);
    const values = await fillDetails(page); await submit(page);
    await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeVisible();
    await context.clearCookies();
    expect((await nativeSignIn(page, values.email, password)).status).toBe(200);
    await context.clearCookies(); await signInThroughForm(page, { email: values.email });
    if (kind === "external") {
      await expect(page).toHaveURL(fixtures.workspace.origin + "/portal");
      await expect(page.getByRole("heading", { name: "Portal", exact: true })).toBeFocused();
    }
    if (kind === "internal") {
      await expect(page).toHaveURL(fixtures.workspace.origin + "/");
      await expect(page.getByRole("heading", { name: "xpro", exact: true })).toBeVisible();
      expect((await context.cookies(fixtures.workspace.origin)).some((cookie) => cookie.name === "__Host-xpro-session")).toBe(true);
    }
  });
}

test("a master selects a prepared workspace from bounded pages and keeps the selection while browsing", async ({ page, context }) => {
  await openCreation(page, context); await page.getByLabel("Login destination").selectOption("workspace");
  const select = page.getByLabel("Workspace", { exact: true });
  await expect(select).toBeEnabled(); await expect(select.locator("option")).toHaveCount(21);
  const first = await select.locator("option").nth(1).getAttribute("value");
  if (!first) throw new Error("Missing directory choice.");
  await select.selectOption(first);
  await page.getByRole("button", { name: "Next workspaces" }).click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible(); await expect(select).toHaveValue(first);
  await expect(select.locator("option")).toHaveCount(5);
  await select.selectOption(fixtures.workspace.id);
  await page.getByRole("button", { name: "Previous workspaces" }).click();
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible(); await expect(select).toHaveValue(fixtures.workspace.id);
  await expect(select.locator("option:checked")).toHaveText("Browser workspace — " + fixtures.workspace.origin);
  await fillDetails(page); await submit(page);
  await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeVisible();
});

test("a chosen workspace is submitted even while a different list page is loading", async ({ page, context }) => {
  await openCreation(page, context); await page.getByLabel("Login destination").selectOption("workspace");
  const select = page.getByLabel("Workspace", { exact: true }); await expect(select).toBeEnabled();
  await page.getByRole("button", { name: "Next workspaces" }).click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible(); await select.selectOption(fixtures.workspace.id);
  await fillDetails(page);
  let release: (() => void) | undefined, count = 0;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_serverFn/**", async (route) => {
    count++; if (count === 1) await held; await route.fulfill({ response: await forward(route) });
  });
  try {
    await page.getByRole("button", { name: "Previous workspaces" }).click(); await expect(select).toBeDisabled();
    const write = page.waitForRequest((request) => (request.postData() ?? "").includes("creationId"));
    await submit(page); await write;
  } finally { release?.(); }
  await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeVisible();
});

test("a workspace-list transport failure retains the selected workspace without claiming creation was attempted", async ({ page, context }) => {
  await openCreation(page, context); await page.getByLabel("Login destination").selectOption("workspace");
  const select = page.getByLabel("Workspace", { exact: true }); await expect(select).toBeEnabled();
  const selected = await select.locator("option").nth(1).getAttribute("value"); if (!selected) throw new Error("Missing workspace.");
  await select.selectOption(selected);
  await page.route("**/_serverFn/**", (route) => route.abort("connectionreset"));
  await page.getByRole("button", { name: "Next workspaces" }).click();
  await expect(page.getByRole("alert")).toContainText("We could not load the workspace list.");
  await expect(page.getByText("Creation reference:", { exact: false })).toHaveCount(0);
  await expect(select).toHaveValue(selected); await expect(select).toBeEnabled();
  await page.unroute("**/_serverFn/**"); await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0); await expect(select).toHaveValue(selected);
});

for (const collision of ["email", "username", "reserved"] as const) test("an explicit correction after a known " + collision + " refusal uses a fresh creation reference", async ({ page, context }) => {
  await openCreation(page, context);
  const values = await fillDetails(page);
  const other = fixtures.logins.other; if (!other) throw new Error("Missing collision fixture.");
  if (collision === "email") await page.getByLabel("Email", { exact: true }).fill(other.email);
  else await page.getByLabel("Username", { exact: true }).fill(collision === "reserved" ? "reserved" : "takenusr");
  const requests: string[] = []; page.on("request", (request) => { if (request.url().includes("/_serverFn/")) requests.push(request.postData() ?? ""); });
  await submit(page);
  await expect(page.locator(collision === "email" ? "#email-error" : "#username-error")).toContainText(collision === "reserved" ? "reserved" : "taken");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(password);
  await expect(page.getByLabel("Email", { exact: true })).toBeEnabled();
  if (collision === "email") await page.getByLabel("Email", { exact: true }).fill(values.email);
  else await page.getByLabel("Username", { exact: true }).fill(values.username);
  await submit(page); await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeVisible();
  expect(requests).toHaveLength(2); expect(requests[1]).not.toBe(requests[0]);
});

test("a busy creation disables fields and cannot be submitted twice", async ({ page, context }) => {
  await openCreation(page, context); await fillDetails(page);
  let release: (() => void) | undefined, count = 0;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_serverFn/**", async (route) => { count++; await held; await route.fulfill({ response: await forward(route) }); });
  try {
    await submit(page); await expect(page.getByRole("button", { name: "Creating login…" })).toBeDisabled();
    await expect(page.getByLabel("Password", { exact: true })).toBeDisabled(); await page.keyboard.press("Enter"); expect(count).toBe(1);
  } finally { release?.(); }
  await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeVisible(); expect(count).toBe(1);
});

test("a lost committed reply retains an immutable request and explicit retry returns the same login", async ({ page, context }) => {
  await openCreation(page, context); const values = await fillDetails(page), bodies: string[] = [], receipts: unknown[] = [];
  await page.route("**/_serverFn/**", async (route) => {
    bodies.push(route.request().postData() ?? ""); const response = await forward(route); receipts.push(await response.json());
    if (bodies.length === 1) await route.abort("connectionreset"); else await route.fulfill({ response });
  });
  await submit(page); await expect(page.getByRole("alert")).toContainText("We could not confirm whether creation finished.");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(values.email);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(password);
  await expect(page.getByLabel("Password", { exact: true })).toBeDisabled();
  await expect(page.getByText("Creation reference:", { exact: false })).toBeVisible();
  expect(bodies).toHaveLength(1);
  await page.getByRole("button", { name: "Retry creation" }).click();
  await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]); expect(receipts[1]).toEqual(receipts[0]);
  await context.clearCookies(); expect((await nativeSignIn(page, values.email, password)).status).toBe(200);
});

test("an ended session preserves the same request until the same creator signs in again", async ({ page, context }) => {
  await openCreation(page, context, "createExpired"); const values = await fillDetails(page), bodies: string[] = [];
  await page.evaluate(async () => { await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); });
  page.on("request", (request) => { if (request.url().includes("/_serverFn/")) bodies.push(request.postData() ?? ""); });
  await submit(page); await expect(page.getByRole("alert")).toContainText("Your session has ended.");
  await expect(page.getByRole("link", { name: "Sign in in a new tab" })).toHaveAttribute("target", "_blank");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(values.email);
  const creator = fixtures.logins.createExpired; if (!creator) throw new Error("Missing expired fixture.");
  expect((await nativeSignIn(page, creator.email, "Browser-fixture123!")).status).toBe(200);
  await page.getByRole("button", { name: "Retry creation" }).click();
  await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
});

test("switching the signed-in person after opening a form refuses its first submission", async ({ page, context }) => {
  await openCreation(page, context); await fillDetails(page); await context.clearCookies(); await signIn(context, "createOtherMaster");
  await submit(page); await expect(page.getByRole("alert")).toContainText("Your sign-in has changed.");
  await expect(page.getByRole("button", { name: "Retry creation" })).toBeDisabled();
  await page.getByRole("button", { name: "Reload this page" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
});

test("when two devices use the customer address then workspace sign-out ends only its actual device through native logout", async ({ page, context, browser }) => {
  await openCreation(page, context, "createOwner"); const values = await fillDetails(page); await submit(page);
  await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeVisible(); await context.clearCookies();
  await signInThroughForm(page, { email: values.email });
  await expect(page).toHaveURL(browserOrigins.workspace + "/");
  await expect(page.getByRole("heading", { name: "xpro", exact: true })).toBeFocused();
  await page.goto(browserOrigins.customer + "/auth/start");
  await expect(page).toHaveURL(browserOrigins.customer + "/"); await expect(page.getByRole("heading", { name: "xpro", exact: true })).toBeFocused();
  const other = await browser.newContext({ ignoreHTTPSErrors: false });
  try {
    const second = await other.newPage(); second.on("pageerror", (error) => pageErrors.push(error.message));
    await signInThroughForm(second, { email: values.email, start: browserOrigins.customer + "/auth/start" }); await expect(second).toHaveURL(browserOrigins.customer + "/");
    await expect(second.getByRole("heading", { name: "xpro", exact: true })).toBeFocused();
    const invalid = await second.evaluate(async () => ({ status: (await fetch("/auth/back-channel-sign-out", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "logout_token=not-a-token" })).status,
      access: (await fetch("/", { headers: { accept: "text/html" }, redirect: "manual" })).status }));
    expect(invalid).toEqual({ status: 400, access: 200 });
    const result = await page.evaluate(async () => ({ status: (await fetch("/auth/sign-out", { method: "POST" })).status })); expect(result).toEqual({ status: 200 });
    expect(await second.evaluate(async () => (await fetch("/", { headers: { accept: "text/html" }, redirect: "manual" })).status)).toBe(200);
    await second.reload(); await expect(second.getByRole("heading", { name: "xpro", exact: true })).toBeFocused();
    await page.goto(browserOrigins.customer + "/"); await expect(page).toHaveURL(/hub\.localhost:3001\/sign-in\?/);
    const active = await withBrowserHub(async ({ db }) => {
      const row = await db.selectFrom("user").select("id").where("email", "=", values.email).executeTakeFirst(); if (!row) throw new Error("Missing created login.");
      return (await db.withoutPlugins().selectFrom("session").select("id").where("userId", "=", row.id).execute()).length;
    });
    expect(active).toBe(1);
  } finally { await other.close(); }
});

test("when the same private login changes profile and is reset and suspended then its real workspace access follows each saved change", async ({ page, context, browser }) => {
  await openCreation(page, context, "createOwner"); const values = await fillDetails(page); await submit(page);
  await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeVisible();
  await context.clearCookies(); await signIn(context, "createMaster");
  const personContext = await browser.newContext({ ignoreHTTPSErrors: false });
  try {
    const person = await personContext.newPage(); person.on("pageerror", (error) => pageErrors.push(error.message));
    await signInThroughForm(person, { email: values.email }); await expect(person).toHaveURL(browserOrigins.workspace + "/");
    await person.goto(origin + "/profile"); const name = "Journey " + crypto.randomUUID(); await person.getByLabel("Full name").fill(name);
    await person.getByRole("button", { name: "Save details", exact: true }).click(); await expect(person.getByText("Your details have been saved.")).toBeVisible();
    await page.goto(origin + "/stms/logins"); await page.getByLabel("Search by name, email or username").fill(name); await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1); await page.locator("tbody tr").getByRole("link").click(); await expect(page.locator("dl")).toContainText(values.email);
    const nextPassword = "Journey-next-password456!"; await page.getByLabel("New password", { exact: true }).fill(nextPassword); await page.getByRole("button", { name: "Reset password", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Password reset", exact: true })).toBeFocused();
    await person.goto(browserOrigins.workspace + "/"); await expect(person).toHaveURL(/hub\.localhost:3001\/sign-in\?/);
    await personContext.clearCookies(); await signInThroughForm(person, { email: values.email, password: nextPassword }); await expect(person).toHaveURL(browserOrigins.workspace + "/");
    await page.getByRole("button", { name: "Suspend login", exact: true }).click(); await page.getByLabel("Suspension reason").selectOption("stms_unpaid");
    await page.getByRole("alertdialog").getByRole("button", { name: "Suspend login", exact: true }).click(); await expect(page.locator("#login-status-value")).toHaveText("Suspended");
    await personContext.clearCookies(); await signInThroughForm(person, { email: values.email, password: nextPassword }); await expect(person.getByRole("alert")).toContainText("This account is suspended.");
    await page.getByRole("button", { name: "Reactivate login", exact: true }).click(); await expect(page.locator("#login-status-value")).toHaveText("Active");
    await signInThroughForm(person, { email: values.email, password: nextPassword }); await expect(person).toHaveURL(browserOrigins.workspace + "/");
    await person.goto(origin + "/profile"); await expect(person.getByLabel("Full name")).toHaveValue(name);
  } finally { await personContext.close(); }
});

test("when a later creation save fails then browser access is blocked until the same request finishes", async ({ page, context, browser }) => {
  await openCreation(page, context); const values = await fillDetails(page);
  await withBrowserHub(async ({ db }) => { await sql`create trigger browser_fail_creation_audit before insert on audit_entries
    when new.action = 'accounts_login_created' begin select raise(abort, 'browser_creation_save_failure'); end`.execute(db); });
  let loginId = "";
  try {
    await submit(page); await expect(page.getByRole("alert")).toContainText("We could not confirm whether creation finished.");
    loginId = await withBrowserHub(async ({ db }) => { const row = await db.selectFrom("user").select("id").where("email", "=", values.email).executeTakeFirst(); if (!row) throw new Error("Missing partial login."); return row.id; });
    const refusedContext = await browser.newContext({ ignoreHTTPSErrors: false });
    try {
      const refused = await refusedContext.newPage(); await signInThroughForm(refused, { email: values.email });
      await expect(refused.getByRole("alert")).toContainText("This login is not ready");
      await refused.goto(origin + "/profile"); await expect(refused.getByRole("heading", { name: "Your profile", exact: true })).toHaveCount(0);
    } finally { await refusedContext.close(); }
  } finally { await withBrowserHub(async ({ db }) => { await sql`drop trigger if exists browser_fail_creation_audit`.execute(db); }); }
  await page.getByRole("button", { name: "Retry creation" }).click(); await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeVisible();
  const state = await withBrowserHub(async ({ db }) => ({
    logins: (await db.selectFrom("user").select("id").where("email", "=", values.email).execute()).length,
    completed: Boolean((await db.selectFrom("loginCreations").select("completedAt").where("createdLoginId", "=", loginId).executeTakeFirst())?.completedAt),
    audits: (await db.selectFrom("auditEntries").select("id").where("affectedLoginId", "=", loginId).where("action", "=", "accounts_login_created").execute()).length,
  }));
  expect(state).toEqual({ logins: 1, completed: true, audits: 1 });
  await context.clearCookies(); await signInThroughForm(page, { email: values.email }); await expect(page).toHaveURL(origin + "/no-workspace");
});

test("when a completed workspace login is missing a profile field then real OIDC waits for only that field", async ({ page, context }) => {
  await openCreation(page, context, "createOwner"); const values = await fillDetails(page); await submit(page);
  await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeVisible();
  await withBrowserHub(async ({ auth, db, masterCookie }) => {
    const row = await db.selectFrom("user").select("id").where("email", "=", values.email).executeTakeFirst(); if (!row) throw new Error("Missing completed login.");
    await auth.api.adminUpdateUser({ headers: { cookie: masterCookie }, body: { userId: row.id, data: { phone: null } } });
  });
  await context.clearCookies(); await signInThroughForm(page, { email: values.email }); await expect(page).toHaveURL(origin + "/complete-profile");
  await expect(page.getByLabel("Username", { exact: true })).toHaveCount(0); await expect(page.getByLabel("Full name")).toHaveCount(0);
  await page.getByLabel("Country or region").selectOption("US"); await page.getByLabel("Number", { exact: true }).fill("2025550199");
  await page.getByRole("button", { name: "Save and continue", exact: true }).click(); await expect(page).toHaveURL(browserOrigins.workspace + "/");
  await expect(page.getByRole("heading", { name: "xpro", exact: true })).toBeFocused();
});

test("when organization membership is removed then the next real workspace action refuses the mounted login", async ({ page, context }) => {
  await openCreation(page, context, "createOwner"); const values = await fillDetails(page); await submit(page);
  await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeVisible();
  await context.clearCookies(); await signInThroughForm(page, { email: values.email }); await expect(page).toHaveURL(browserOrigins.workspace + "/");
  await page.goto(browserOrigins.workspace + "/draft-check"); await expect(page.getByLabel("Notes")).toBeEnabled(); await page.getByLabel("Notes").fill("Keep this draft");
  await withBrowserHub(async ({ auth, masterCookie }) => { await auth.api.removeMember({ headers: { cookie: masterCookie }, body: { memberIdOrEmail: values.email, organizationId: fixtures.workspace.id } }); });
  await page.getByRole("button", { name: "Check access", exact: true }).click(); await expect(page.getByRole("alertdialog")).toContainText("You no longer have access");
  await expect(page.getByLabel("Notes")).toHaveValue("Keep this draft");
});

test("silent password-manager values are submitted verbatim", async ({ page, context }) => {
  await openCreation(page, context); const values = newDetails();
  await page.evaluate(({ values, password }) => {
    for (const [id, value] of Object.entries({ email: values.email, username: values.username, name: "Created person", password,
      "phone-country": "US", phone: "2025550123" })) {
      const input = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
      if (!input) throw new Error("Missing form field."); input.value = value;
    }
  }, { values, password });
  await submit(page); await expect(page.getByRole("heading", { name: "Login created", exact: true })).toBeVisible();
  await context.clearCookies(); expect((await nativeSignIn(page, values.email, password)).status).toBe(200);
});

test("narrow RTL, dark and expanded translated layouts remain accessible and usable", async ({ page, context }, info) => {
  await signIn(context, "createMaster"); await context.addCookies([{ name: "PARAGLIDE_LOCALE", value: "en-XA", url: origin }]);
  await page.setViewportSize({ width: 320, height: 800 }); await page.emulateMedia({ colorScheme: "dark" }); await page.goto("/create-login");
  await expect(page.getByRole("button", { name: /Create login/ })).toBeEnabled();
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  await expect(page.getByRole("heading")).toContainText("⟦");
  await page.locator("#target").selectOption("workspace"); await expect(page.locator("#workspaceId")).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("create-login-rtl-dark.png"), fullPage: true });
});

async function openCreation(page: Page, context: BrowserContext, key = "createMaster"): Promise<void> {
  await signIn(context, key); await page.goto("/create-login");
  await expect(page.getByRole("button", { name: "Create login", exact: true })).toBeEnabled();
}
async function signIn(context: BrowserContext, key: string): Promise<void> {
  const login = fixtures.logins[key]; if (!login) throw new Error("Missing browser fixture: " + key);
  await context.addCookies(login.cookie.split("; ").map((cookie) => {
    const index = cookie.indexOf("="); return { name: cookie.slice(0, index), value: cookie.slice(index + 1),
      url: origin, httpOnly: true, secure: true, sameSite: "Lax" as const };
  }));
}
function newDetails(): { email: string; username: string } {
  return { email: "new-" + crypto.randomUUID() + "@example.test", username: "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7) };
}
async function fillDetails(page: Page): Promise<ReturnType<typeof newDetails>> {
  const values = newDetails();
  await page.getByLabel("Email", { exact: true }).fill(values.email); await page.getByLabel("Username", { exact: true }).fill(values.username);
  await page.getByLabel("Full name").fill("Created person"); await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Country or region").selectOption("US"); await page.getByLabel("Phone number", { exact: true }).fill("2025550123");
  return values;
}
async function submit(page: Page): Promise<void> { await page.getByRole("button", { name: "Create login", exact: true }).click(); }
async function nativeSignIn(page: Page, email: string, password: string) {
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

async function forward(route: Route): Promise<APIResponse> {
  return await route.fetch({ url: route.request().url().replace(origin, "https://127.0.0.1:3001"),
    headers: { ...await route.request().allHeaders(), host: "hub.localhost:3001" } });
}

async function signInThroughForm(page: Page, input: { email: string; password?: string; start?: string }): Promise<void> {
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) => route.fulfill({
    contentType: "application/javascript", body: "window.turnstile = { render(element, options) { queueMicrotask(() => options.callback('XXXX.DUMMY.TOKEN.XXXX')); return 'external-test-widget'; }, remove() {} };",
  }));
  await page.goto(input.start ?? origin + "/sign-in"); await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await page.getByLabel("Email or username").fill(input.email); await page.getByLabel("Password", { exact: true }).fill(input.password ?? password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
