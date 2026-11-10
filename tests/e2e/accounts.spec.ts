import { test, expect, type APIResponse, type BrowserContext, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readBrowserMfaCode, withBrowserHub } from "./hub-fixture";

const base = process.env.XPRO_BROWSER_TEMP;
if (!base) throw new Error("Use the isolated browser runner.");
type Login = { loginId: string; email: string; username: string | null; cookie: string };
const fixtures: { logins: Record<string, Login> } = JSON.parse(await readFile(join(base, "fixtures.json"), "utf8"));
const origin = "https://hub.localhost:3001", password = "Browser-fixture123!";
let pageErrors: string[];
test.beforeEach(({ page }) => { pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message)); });
test.afterEach(() => expect(pageErrors).toEqual([]));

test("a native sign-in and MFA master creates, finds and renames an account by keyboard without granting membership", async ({ page }, info) => {
  await formSignIn(page, "accountJourneyMaster");
  const before = await nativeState("accountJourneyHolder");
  await page.goto("/stms/accounts"); await page.getByRole("link", { name: "Create an account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create an account", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page.getByLabel("Account name", { exact: true })).toBeFocused();
  await expect(page.getByRole("alert")).toContainText("Choose an existing account holder.");
  await page.getByLabel("Account name", { exact: true }).fill("  Keyboard account  ");
  await chooseHolderWithKeyboard(page, "accountJourneyHolder");
  await page.getByLabel("Find a holder by name, email or username").fill("no-match-" + crypto.randomUUID());
  await page.getByRole("button", { name: "Search", exact: true }).click(); await expect(page.getByText("No matching holder logins. Your selection is kept.")).toBeVisible();
  await expect(page.getByLabel("Account name", { exact: true })).toHaveValue("  Keyboard account  ");
  await expect(page.getByRole("status").filter({ hasText: "Selected holder" })).toContainText(login("accountJourneyHolder").email);
  await accessible(page); await page.getByRole("button", { name: "Create account", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/stms\/accounts\/[a-f\d-]{36}$/); const accountId = new URL(page.url()).pathname.slice("/stms/accounts/".length);
  await expect(page.locator("dl")).toContainText("Keyboard account"); await expect(page.locator("dl")).toContainText(login("accountJourneyHolder").loginId);
  await expect(page.locator("dl")).toContainText("No workspace");
  await page.getByLabel("Account name", { exact: true }).fill("Renamed keyboard account"); await page.getByRole("button", { name: "Save account name" }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Your account change was saved."); await expect(page.locator("dl")).toContainText("Renamed keyboard account");
  const after = await nativeState("accountJourneyHolder"); expect(after.accounts).toHaveLength(1); expect(after.accounts[0]).toMatchObject({ id: accountId, ownerLoginId: login("accountJourneyHolder").loginId, name: "Renamed keyboard account", revision: 1 });
  expect(after.member).toEqual(before.member); expect(after.role).toEqual(before.role); expect(after.workspaces).toEqual(before.workspaces);
  expect(after.audits.map((row) => row.action).sort()).toEqual(["stms_account_created", "stms_account_renamed"]);
  expect(after.audits.every((row) => row.actorLoginId === login("accountJourneyMaster").loginId)).toBe(true);
  await accessible(page); await page.screenshot({ path: info.outputPath("account-keyboard-detail.png"), fullPage: true });
  await page.getByRole("link", { name: "Back to accounts" }).click(); await page.getByLabel("Search accounts by name").fill("Renamed keyboard"); await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1); await page.reload(); await page.locator("tbody tr").getByRole("link").click(); await expect(page).toHaveURL((url) => url.pathname.endsWith(accountId));
  await expect(page.locator("dl")).toContainText(login("accountJourneyHolder").loginId);
});

test("native account pages preserve bounded search, ordering, distinct no matches and semantic headers", async ({ page, context }) => {
  await addLogin(context, "accountMaster"); await page.goto("/stms/accounts?query=Account+directory");
  await expect(page.locator("tbody tr")).toHaveCount(25); await expect(page.getByRole("columnheader")).toHaveText(["Account name", "Account holder", "Status", "Created (UTC) ↓"]);
  await expect(page.getByRole("columnheader", { name: "Created (UTC)", exact: true })).toHaveAttribute("aria-sort", "descending");
  await expect(page.getByRole("rowheader")).toHaveCount(25); await expect(page.locator("tbody th").first()).toHaveAttribute("scope", "row");
  await page.getByRole("link", { name: "Next page" }).click(); await expect(page.locator("tbody tr")).toHaveCount(5); await expect(page.getByRole("link", { name: "Next page" })).toHaveCount(0);
  await page.reload(); await expect(page.locator("tbody tr")).toHaveCount(5); await page.getByRole("link", { name: "Previous page" }).click(); await expect(page.locator("tbody tr")).toHaveCount(25);
  await page.getByLabel("Search accounts by name").fill("not-present-" + crypto.randomUUID()); await page.getByRole("button", { name: "Search", exact: true }).click(); await expect(page.getByText("No matching accounts.", { exact: true })).toBeVisible();
  const response = await page.reload(); expect(response?.headers()["cache-control"]).toBe("private, no-store"); expect(response?.headers().vary).toContain("cookie"); await accessible(page);
});

test("delayed native holder reads show the active control, preserve the draft and report failure truthfully", async ({ page, context }) => {
  await openCreate({ page, context }); await page.getByLabel("Account name", { exact: true }).fill("Keep through failed read");
  await chooseHolder(page, "accountRetryHolder");
  let releaseSearch: (() => void) | undefined, releaseClear: (() => void) | undefined, reads = 0;
  const searchHeld = new Promise<void>((resolve) => { releaseSearch = resolve; });
  const clearHeld = new Promise<void>((resolve) => { releaseClear = resolve; });
  await page.route("**/_serverFn/**", async (route) => {
    const read = reads++, response = await forward(route); expect(response.status()).toBe(200);
    if (read === 0) await searchHeld;
    else if (read === 1) await clearHeld;
    else { await route.abort("connectionreset"); return; }
    await route.fulfill({ response });
  });
  const search = page.locator('form:has(#holder-search) button[type="submit"]'), holderQuery = page.getByLabel("Find a holder by name, email or username");
  const name = page.getByLabel("Account name", { exact: true }), create = page.getByRole("button", { name: "Create account", exact: true });
  const selection = page.getByRole("status").filter({ hasText: "Selected holder" });
  try {
    await search.click();
    await expect(search).toBeDisabled(); await expect(search.locator("svg")).toBeVisible();
    await expect(name).toBeDisabled(); await expect(holderQuery).toBeDisabled(); await expect(create).toBeDisabled();
    await expect(name).toHaveValue("Keep through failed read"); await expect(selection).toContainText(login("accountRetryHolder").email);
    releaseSearch?.(); await expect(search).toBeEnabled();
    const clear = page.getByRole("button", { name: "Clear search", exact: true });
    await clear.click();
    await expect(clear).toBeDisabled(); await expect(clear.locator("svg")).toBeVisible();
    await expect(search.locator("svg")).toHaveCount(0);
    await expect(name).toBeDisabled(); await expect(holderQuery).toBeDisabled(); await expect(create).toBeDisabled();
    await expect(name).toHaveValue("Keep through failed read"); await expect(selection).toContainText(login("accountRetryHolder").email);
    releaseClear?.(); await expect(clear).toHaveCount(0); await expect(search).toBeEnabled();
    await holderQuery.fill(login("accountRetryHolder").email); await search.click();
    await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByText("There are no holder logins to show.")).toHaveCount(0); await expect(page.getByText("Your account change was saved.")).toHaveCount(0);
    await expect(name).toHaveValue("Keep through failed read"); await expect(selection).toContainText(login("accountRetryHolder").email);
  } finally { releaseSearch?.(); releaseClear?.(); }
});

test("stale detail refresh follows clean names and preserves edited drafts with correct leave protection", async ({ page, context }) => {
  await openCreate({ page, context }); await fillAccount({ page, key: "accountStaleHolder", name: "Initial stale account" }); await submitCreate(page); const url = page.url();
  const second = await context.newPage();
  try {
    await second.goto(url); await expect(second.getByLabel("Account name", { exact: true })).toBeEnabled();
    await second.getByLabel("Account name", { exact: true }).fill("Other tab account"); await second.getByRole("button", { name: "Save account name" }).click(); await expect(second.locator("dl")).toContainText("Other tab account");
    await page.getByRole("button", { name: "Save account name" }).click(); await expect(page.getByRole("alert")).toContainText("The account or request changed.");
    await page.getByRole("button", { name: "Read current details and keep draft" }).click();
    await expect(page.getByLabel("Account name", { exact: true })).toHaveValue("Other tab account");
    await expect.poll(() => isLeavingBlocked(page)).toBe(false);
    await page.getByLabel("Account name", { exact: true }).fill("Original tab draft");
    await second.getByLabel("Account name", { exact: true }).fill("Newest server account"); await second.getByRole("button", { name: "Save account name" }).click(); await expect(second.locator("dl")).toContainText("Newest server account");
    await page.getByRole("button", { name: "Save account name" }).click(); await expect(page.getByRole("alert")).toContainText("The account or request changed.");
    await expect(page.getByLabel("Account name", { exact: true })).toBeDisabled(); await page.getByRole("button", { name: "Read current details and keep draft" }).click();
    await expect(page.getByLabel("Account name", { exact: true })).toHaveValue("Original tab draft"); await expect(page.locator("dl")).toContainText("Newest server account");
    await expect.poll(() => isLeavingBlocked(page)).toBe(true);
    await page.getByLabel("Account name", { exact: true }).fill("Newest server account");
    await expect.poll(() => isLeavingBlocked(page)).toBe(false);
    await page.getByLabel("Account name", { exact: true }).fill("Original tab draft");
    await page.getByRole("button", { name: "Save account name" }).click(); await expect(page.locator("dl")).toContainText("Original tab draft");
    expect((await nativeState("accountStaleHolder")).accounts[0]?.revision).toBe(3);
  } finally { await second.close(); }
});

test("a completed create whose reply is dropped resolves through a read-only receipt without replay or a second account", async ({ page, context }) => {
  await openCreate({ page, context }); await fillAccount({ page, key: "accountLostHolder", name: "Lost reply account" }); let writes = 0, operationId = "";
  await page.route("**/_serverFn/**", async (route) => {
    const response = await forward(route), body = route.request().postData() ?? "";
    if (body.includes("holderLoginId") && body.includes("operationId")) { writes++;  expect(response.status()).toBe(200); await route.abort("connectionreset"); }
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page.getByText("The submitted request may have completed.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Account name", { exact: true })).toBeDisabled(); await expect(page.getByLabel("Find a holder by name, email or username")).toBeDisabled();
  operationId = (await page.getByText("Operation reference:", { exact: false }).innerText()).match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/i)?.[0] ?? ""; expect(operationId).not.toBe("");
  await page.getByRole("button", { name: "Check request status" }).click(); await expect(page).toHaveURL(/\/stms\/accounts\/[a-f\d-]{36}$/);
  const saved = await nativeState("accountLostHolder"); expect(writes).toBe(1); expect(saved.accounts).toHaveLength(1); expect(saved.audits).toHaveLength(1); expect(saved.audits[0]?.id).toBe(operationId);
});

test("not-recorded leaves edits frozen and manual retry sends exactly the same real command and operation key", async ({ page, context }) => {
  await openCreate({ page, context }); await fillAccount({ page, key: "accountRetryHolder", name: "Manual same request account" }); const commands: string[] = [];
  await page.route("**/_serverFn/**", async (route) => {
    const body = route.request().postData() ?? "";
    if (body.includes("holderLoginId") && body.includes("operationId")) { commands.push(body); if (commands.length === 1) { await route.abort("connectionreset"); return; } }
    await route.fulfill({ response: await forward(route) });
  });
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page.getByLabel("Account name", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Check request status" }).click(); await expect(page.getByText("No result is recorded yet.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Account name", { exact: true })).toBeDisabled(); expect(commands).toHaveLength(1); expect((await nativeState("accountRetryHolder")).accounts).toHaveLength(0);
  await page.getByRole("button", { name: "Retry the same request" }).click(); await expect(page).toHaveURL(/\/stms\/accounts\/[a-f\d-]{36}$/);
  expect(commands).toHaveLength(2); expect(commands[1]).toBe(commands[0]); const saved = await nativeState("accountRetryHolder"); expect(saved.accounts).toHaveLength(1); expect(saved.audits).toHaveLength(1);
});

test("expired authentication preserves holder, draft and original operation through real same-actor sign-in in another tab", async ({ page, context }) => {
  await openCreate({ page, context, actor: "accountExpiredMaster" }); await fillAccount({ page, key: "accountExpiredHolder", name: "Preserved session draft" });
  await nativeSignOut(page); await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Your session has ended."); await expect(page.locator("#account-content")).toHaveAttribute("inert"); await expect(page.locator("#account-content")).toBeHidden();
  await expect(page.locator("#account-name")).toHaveValue("Preserved session draft");
  const popupPromise = context.waitForEvent("page"); await page.getByRole("link", { name: "Sign in in a new tab" }).click(); const popup = await popupPromise;
  try { await formSignIn(popup, "accountExpiredMaster"); } finally { await popup.close(); }
  await page.getByRole("button", { name: "Check access and continue" }).click(); await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByLabel("Account name", { exact: true })).toHaveValue("Preserved session draft"); await expect(page.getByLabel("Account name", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Check request status" }).click(); await expect(page.getByText("No result is recorded yet.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Retry the same request" }).click(); await expect(page).toHaveURL(/\/stms\/accounts\/[a-f\d-]{36}$/); expect((await nativeState("accountExpiredHolder")).accounts).toHaveLength(1);
});

test("an already assigned holder is refused by the real save and the editable draft is preserved", async ({ page, context }) => {
  await openCreate({ page, context }); await fillAccount({ page, key: "accountDuplicateHolder", name: "First holder account" }); await submitCreate(page);
  const before = await nativeState("accountDuplicateHolder"); await page.goto("/stms/accounts/new"); await expect(page.getByLabel("Account name", { exact: true })).toBeEnabled();
  await fillAccount({ page, key: "accountDuplicateHolder", name: "Refused duplicate holder" });
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("This login cannot be assigned as the holder.");
  await expect(page.getByLabel("Account name", { exact: true })).toHaveValue("Refused duplicate holder"); await expect(page.getByLabel("Account name", { exact: true })).toBeEnabled();
  expect(await nativeState("accountDuplicateHolder")).toEqual(before);
});

test("a confirmed receipt stays saved behind the access dialog when the native session ends before refresh", async ({ page, context }) => {
  await openCreate({ page, context, actor: "accountSavedMaster" }); await fillAccount({ page, key: "accountSavedHolder", name: "Saved before session ended" }); let writes = 0;
  await page.route("**/_serverFn/**", async (route) => {
    const response = await forward(route), body = route.request().postData() ?? "";
    if (body.includes("holderLoginId") && body.includes("operationId")) { writes++; expect(response.status()).toBe(200); await nativeSignOut(page); }
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Your account change was saved."); await expect(page.getByRole("alertdialog")).toContainText("Your session has ended.");
  await expect(page.locator("#account-content")).toHaveAttribute("inert"); expect((await nativeState("accountSavedHolder")).accounts).toHaveLength(1);
  const reauth = await context.newPage(); try { await formSignIn(reauth, "accountSavedMaster"); } finally { await reauth.close(); }
  await page.getByRole("button", { name: "Check access and continue" }).click(); await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh saved account" }).click(); await expect(page).toHaveURL(/\/stms\/accounts\/[a-f\d-]{36}$/); expect(writes).toBe(1);
});

test("a changed native actor cannot reuse the old actor's draft or operation key", async ({ page, context }) => {
  await openCreate({ page, context }); await fillAccount({ page, key: "accountChangedHolder", name: "Other actor must not save" }); await context.clearCookies(); await addLogin(context, "accountOtherMaster");
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page.getByRole("alertdialog")).toContainText("Your sign-in has changed.");
  await expect(page.locator("#account-content")).toHaveAttribute("inert"); await expect(page.locator("#account-content")).toBeHidden(); await expect(page.locator("#account-name")).toHaveValue("Other actor must not save");
  await expect(page.getByRole("button", { name: "Check access and continue" })).toHaveCount(0); await expect(page.getByRole("button", { name: "Reload this page" })).toBeVisible();
  expect((await nativeState("accountChangedHolder")).accounts).toHaveLength(0);
});

test("a receipt-confirmed create remains visibly saved when its following real detail response is lost", async ({ page, context }) => {
  await openCreate({ page, context }); await fillAccount({ page, key: "accountRefreshHolder", name: "Confirmed saved account" }); let writes = 0, dropRead = true;
  await page.route("**/_serverFn/**", async (route) => {
    const body = route.request().postData() ?? "", response = await forward(route);
    if (body.includes("holderLoginId") && body.includes("operationId")) writes++;
    if (body.includes("accountId") && !body.includes("operationId") && dropRead) { dropRead = false; expect(response.status()).toBe(200); await route.abort("connectionreset"); }
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Your account change was saved." })).toBeVisible();
  await expect(page.getByText("The save is confirmed, but current account details could not be refreshed.", { exact: false })).toBeVisible(); await expect(page.getByRole("button", { name: "Retry the same request" })).toHaveCount(0);
  expect(writes).toBe(1); await page.getByRole("button", { name: "Refresh saved account" }).click(); await expect(page).toHaveURL(/\/stms\/accounts\/[a-f\d-]{36}$/); expect(writes).toBe(1);
});

for (const key of ["createOwner", "createAdmin", "createMember"]) test("direct native workspace " + key + " cannot read any account route or holder choices", async ({ page, context }) => {
  const accountId = await withBrowserHub(async ({ db }) => (await db.selectFrom("accounts").select("id").where("nameSearch", "like", "account directory%").executeTakeFirstOrThrow()).id);
  await addLogin(context, key);
  for (const path of ["/stms/accounts", "/stms/accounts/new", "/stms/accounts/" + accountId]) {
    await page.goto(path); await expect(page.getByRole("alert")).toContainText("Only xpro master users can manage accounts.");
    await expect(page.locator("tbody")).toHaveCount(0); await expect(page.locator("dl")).toHaveCount(0); await expect(page.getByLabel("Account name", { exact: true })).toHaveCount(0);
  }
});

test("expanded translations on narrow RTL dark account list, create, detail and access dialog remain operable", async ({ page, context }, info) => {
  await addLogin(context, "accountMaster"); await context.addCookies([{ name: "PARAGLIDE_LOCALE", value: "en-XA", url: origin }]);
  await page.setViewportSize({ width: 320, height: 800 }); await page.emulateMedia({ colorScheme: "dark" }); await page.goto("/stms/accounts?query=Account+directory");
  await rtlAccessible(page); await expect(page.getByRole("heading", { level: 1 })).toContainText("⟦");
  await page.goto("/stms/accounts/new"); await expect(page.locator("#account-name")).toBeEnabled(); await rtlAccessible(page); await page.locator("#account-name").fill("RTL account draft");
  await page.locator("#holder-search").fill(login("accountLocaleHolder").email); await page.locator("#holder-search").press("Enter"); await expect(page.getByRole("radio")).toHaveCount(1); await page.getByRole("radio").check();
  await page.getByRole("button").filter({ hasText: "Crëátë áccöünt" }).click(); await expect(page).toHaveURL(/\/stms\/accounts\/[a-f\d-]{36}$/); await rtlAccessible(page);
  await page.locator("#account-name").fill("RTL preserved rename"); await nativeSignOut(page); await page.getByRole("button").filter({ hasText: "Sávë áccöünt námë" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible(); await rtlAccessible(page); expect(await page.getByRole("alertdialog").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("accounts-rtl-dark-access.png"), fullPage: true });
});

function login(key: string): Login { const value = fixtures.logins[key]; if (!value) throw new Error("Missing account fixture: " + key); return value; }
async function addLogin(context: BrowserContext, key: string): Promise<void> {
  await context.addCookies(login(key).cookie.split("; ").map((part) => { const index = part.indexOf("="); return { name: part.slice(0, index), value: part.slice(index + 1), url: origin, httpOnly: true, secure: true, sameSite: "Lax" as const }; }));
}
async function openCreate({ page, context, actor = "accountMaster" }: { page: Page; context: BrowserContext; actor?: string }): Promise<void> {
  await addLogin(context, actor); await page.goto("/stms/accounts/new"); await expect(page.getByLabel("Account name", { exact: true })).toBeEnabled();
}
async function chooseHolder(page: Page, key: string): Promise<void> {
  await page.getByLabel("Find a holder by name, email or username").fill(login(key).email); await page.getByRole("button", { name: "Search", exact: true }).click();
  const radio = page.getByRole("radio"); await expect(radio).toHaveCount(1); await radio.check();
}
async function chooseHolderWithKeyboard(page: Page, key: string): Promise<void> {
  await page.getByLabel("Find a holder by name, email or username").fill(login(key).email); await page.getByRole("button", { name: "Search", exact: true }).click();
  const radio = page.getByRole("radio"); await expect(radio).toHaveCount(1); await radio.focus(); await page.keyboard.press("Space");
}
async function fillAccount({ page, key, name }: { page: Page; key: string; name: string }): Promise<void> { await page.getByLabel("Account name", { exact: true }).fill(name); await chooseHolder(page, key); }
async function submitCreate(page: Page): Promise<void> { await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page).toHaveURL(/\/stms\/accounts\/[a-f\d-]{36}$/); await expect(page.getByLabel("Account name", { exact: true })).toBeEnabled(); }
async function forward(route: Route): Promise<APIResponse> { return await route.fetch({ url: route.request().url().replace(origin, "https://127.0.0.1:3001"), headers: { ...await route.request().allHeaders(), host: "hub.localhost:3001" } }); }
async function accessible(page: Page): Promise<void> { expect((await new AxeBuilder({ page }).analyze()).violations.filter((value) => value.impact === "serious" || value.impact === "critical")).toEqual([]); }
async function rtlAccessible(page: Page): Promise<void> { await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl")); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await accessible(page); }
async function isLeavingBlocked(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const departure = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(departure);
    return departure.defaultPrevented;
  });
}
async function nativeSignOut(page: Page): Promise<void> { expect(await page.evaluate(async () => (await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status)).toBe(200); }
async function formSignIn(page: Page, key: string): Promise<void> {
  // Only the outside CAPTCHA widget uses its documented test token; native identity, MFA and storage remain real.
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) => route.fulfill({ contentType: "application/javascript",
    body: "window.turnstile = { render(element, options) { queueMicrotask(() => options.callback('XXXX.DUMMY.TOKEN.XXXX')); return 'external-test-widget'; }, remove() {} };" }));
  await page.goto(origin + "/sign-in"); await page.getByLabel("Email or username").fill(login(key).email); await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(origin + "/mfa");
  await page.getByLabel("Authenticator code", { exact: true }).fill(await readBrowserMfaCode(login(key).loginId)); await page.getByRole("button", { name: "Verify", exact: true }).click(); await expect(page).toHaveURL(origin + "/stms/logins");
}
async function nativeState(key: string) {
  return await withBrowserHub(async ({ db }) => {
    const holder = login(key), accounts = await db.selectFrom("accounts").selectAll().where("ownerLoginId", "=", holder.loginId).execute();
    const ids = accounts.map((account) => account.id);
    return { accounts, role: await db.selectFrom("user").select(["role"]).where("id", "=", holder.loginId).executeTakeFirstOrThrow(),
      member: await db.selectFrom("member").selectAll().where("userId", "=", holder.loginId).execute(),
      workspaces: await db.selectFrom("workspaces").selectAll().execute(),
      audits: ids.length ? await db.selectFrom("auditEntries").select(["id", "action", "actorLoginId", "accountId"]).where("accountId", "in", ids).execute() : [],
    };
  });
}
