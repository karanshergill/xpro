import { test, expect, type APIResponse, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { verifyBrowserMfa } from "./hub-fixture";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.XPRO_BROWSER_TEMP;
if (!base) throw new Error("Use the isolated browser runner.");
type Login = { loginId: string; email: string; username: string; cookie: string };
const fixtures: { logins: Record<string, Login>; workspace: { id: string; origin: string } } = JSON.parse(await readFile(join(base, "fixtures.json"), "utf8"));
const origin = "https://hub.localhost:3001", password = "Browser-fixture123!", nextPassword = " STMS-new-password456! ";
let pageErrors: string[] = [];
test.beforeEach(({ page }) => { pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message)); });
test.afterEach(() => expect(pageErrors).toEqual([]));

test("when a master opens STMS then the indexed directory supports native URL search, paging and creation-time sorting", async ({ page, context }, info) => {
  await addLogin(context, login("stmsMaster")); await page.goto(origin + "/stms");
  await expect(page).toHaveURL(origin + "/stms/logins"); await expect(page.getByRole("heading", { name: "Logins", exact: true })).toBeFocused();
  await expect(page.getByRole("columnheader")).toHaveText(["Username", "Full name", "Email", "Phone", "Created (UTC) ↓", "Status"]);
  await expect(page.getByRole("columnheader", { name: "Created (UTC)", exact: true })).toHaveAttribute("aria-sort", "descending");
  await page.getByLabel("Search by name, email or username").fill("Directory case"); await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/stms/logins" && url.searchParams.get("query") === "Directory case"); await expect(page.locator("tbody tr")).toHaveCount(25);
  await page.reload(); await expect(page.getByLabel("Search by name, email or username")).toHaveValue("Directory case"); await expect(page.locator("tbody tr")).toHaveCount(25);
  await page.getByRole("link", { name: "Next page" }).click(); await expect(page).toHaveURL((url) => url.pathname === "/stms/logins" && url.searchParams.get("offset") === "25");
  await expect(page.locator("tbody tr")).toHaveCount(5); await expect(page.getByRole("link", { name: "Next page" })).toHaveCount(0);
  await page.getByRole("link", { name: "Previous page" }).click(); await expect(page.locator("tbody tr")).toHaveCount(25);
  await page.getByLabel("Search by name, email or username").fill(login("stmsListTarget").username.toUpperCase()); await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1); await expect(page.locator("tbody")).toContainText(login("stmsListTarget").email);
  const response = await readResponse(page, "/stms/logins"); expect(response.headers["cache-control"]).toBe("private, no-store"); expect(response.headers.vary).toContain("cookie");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); await page.screenshot({ path: info.outputPath("stms-list.png"), fullPage: true });
});

test("when hydration finishes during a pagination press then native navigation still receives the release", async ({ page, context }) => {
  await addLogin(context, login("stmsMaster"));
  let release: (() => void) | undefined; const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route((url) => url.pathname.includes("tanstack-start") && url.pathname.includes("client-entry"), async (route) => {
    const response = await forward(route); await held; await route.fulfill({ response });
  });
  try {
    await page.goto(origin + "/stms/logins?query=Directory+case", { waitUntil: "commit" });
    const next = page.getByRole("link", { name: "Next page" }); await next.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    const box = await next.boundingBox(); if (!box) throw new Error("The pagination link is not visible.");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); release?.();
    await expect(page.getByRole("heading", { name: "Logins", exact: true })).toBeFocused(); await page.mouse.up();
    await expect(page).toHaveURL((url) => url.pathname === "/stms/logins" && url.searchParams.get("offset") === "25");
    await expect(page.locator("tbody tr")).toHaveCount(5);
  } finally { release?.(); await page.mouse.up(); }
});

test("when a search looks like JSON then it remains literal text through serialization, reload and detail navigation", async ({ page, context }) => {
  await addLogin(context, login("stmsMaster")); await page.goto(origin + "/stms/logins");
  await page.getByLabel("Search by name, email or username").fill('{"literal": 1}'); await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1); await expect(page.getByLabel("Search by name, email or username")).toHaveValue('{"literal": 1}');
  await page.reload(); await expect(page.locator("tbody tr")).toHaveCount(1); await page.locator("tbody tr").getByRole("link").click();
  await expect(page.locator("dl")).toContainText('{"literal": 1}'); await page.getByRole("link", { name: "Back to logins" }).click(); await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("when a listed login opens then its workspace and all summary fields appear and the search context survives the back link", async ({ page, context }, info) => {
  await addLogin(context, login("stmsMaster")); await page.goto(origin + "/stms/logins?query=" + encodeURIComponent(login("stmsListTarget").email));
  await page.locator("tbody tr").getByRole("link").click(); await expect(page.getByRole("heading", { name: "Manage login" })).toBeFocused();
  await expect(page.locator("dl")).toContainText("Browser workspace"); await expect(page.locator("dl")).toContainText(login("stmsListTarget").email);
  await expect(page.locator("dl")).toContainText(login("stmsListTarget").username); await expect(page.locator("dl")).toContainText("+12025550123");
  await expect(page.getByRole("heading", { name: "Reset password", exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); await page.screenshot({ path: info.outputPath("stms-detail.png"), fullPage: true });
  await page.getByRole("link", { name: "Back to logins" }).click(); await expect(page).toHaveURL((url) => url.pathname === "/stms/logins" && url.searchParams.get("query") === login("stmsListTarget").email);
});

for (const key of ["createOwner", "createAdmin", "createMember"]) test("when a workspace " + key + " opens a master page then no global login data is disclosed", async ({ page, context }) => {
  await addLogin(context, login(key)); await page.goto(detailURL("stmsListTarget"));
  await expect(page.getByRole("alert")).toContainText("Only xpro master users"); await expect(page.getByRole("heading", { name: "Reset password", exact: true })).toHaveCount(0);
  await expect(page.locator("dl")).toHaveCount(0); await page.goto(origin + "/stms/logins"); await expect(page.locator("tbody")).toHaveCount(0);
});

test("when authentication or the requested login is absent then the page asks for sign-in or shows a real not-found error", async ({ page, context }) => {
  await page.goto(origin + "/stms/logins"); await expect(page).toHaveURL(origin + "/sign-in");
  await addLogin(context, login("stmsMaster")); await page.goto(origin + "/stms/logins/" + crypto.randomUUID());
  await expect(page.getByRole("alert")).toContainText("This login could not be found."); await expect(page.locator("dl")).toHaveCount(0);
});

test("when suspension uses Other then confirmation and a nonblank comment are required before all devices lose access", async ({ page, context, browser }, info) => {
  await openDetail({ page, context }, "stmsSuspend"); await page.getByRole("button", { name: "Suspend login", exact: true }).click();
  const dialog = page.getByRole("alertdialog"); await expect(dialog).toContainText(login("stmsSuspend").email);
  await dialog.getByRole("button", { name: "Suspend login", exact: true }).click(); await expect(page.getByLabel("Suspension reason")).toBeFocused();
  await page.getByLabel("Suspension reason").selectOption("stms_other"); await page.getByLabel("Comment for Other").fill(" ");
  await dialog.getByRole("button", { name: "Suspend login", exact: true }).click(); await expect(page.locator("#status-comment-error")).toHaveText("Explain the reason when choosing Other.");
  await expect(page.getByLabel("Comment for Other")).toHaveValue(" "); await page.getByLabel("Comment for Other").fill("Requested follow-up.");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); await page.screenshot({ path: info.outputPath("stms-suspend.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Suspend login", exact: true }).click(); await expectStatus(page, "Suspended"); await expect(dialog).toHaveCount(0);
  expect(await sessionFor(browser, "stmsSuspend")).toBeNull(); expect(await sessionFor(browser, "stmsSuspendDevice")).toBeNull();
  expect((await attemptSignIn(browser, { key: "stmsSuspend" })).status).toBe(403);
  await page.getByRole("button", { name: "Reactivate login" }).click(); await expectStatus(page, "Active"); expect((await attemptSignIn(browser, { key: "stmsSuspend" })).status).toBe(200);
});

for (const reason of ["stms_unpaid", "stms_abuse_or_misuse", "stms_security_concern", "stms_at_persons_request"]) test("when suspension uses " + reason + " then a comment is optional", async ({ page, context }) => {
  await openDetail({ page, context }, "stmsOtherReason"); await suspend(page, reason); await expectStatus(page, "Suspended");
  await page.getByRole("button", { name: "Reactivate login" }).click(); await expectStatus(page, "Active");
});

test("when an active login is archived then it leaves search and its saved link restores it with the same details and password", async ({ page, context, browser }) => {
  await openDetail({ page, context }, "stmsArchiveActive"); const url = page.url(), details = await page.locator("dl").textContent();
  await archive(page); await expectStatus(page, "Archived"); expect((await attemptSignIn(browser, { key: "stmsArchiveActive" })).status).toBe(403);
  await page.goto(origin + "/stms/logins?query=" + encodeURIComponent(login("stmsArchiveActive").email)); await expect(page.getByText("No matching logins.")).toBeVisible();
  await page.goto(url); await page.getByRole("button", { name: "Restore login" }).click(); await expectStatus(page, "Active");
  await expect(page.locator("dl")).toHaveText(details ?? ""); expect((await attemptSignIn(browser, { key: "stmsArchiveActive" })).status).toBe(200);
});

test("when a suspended login is archived and restored then suspension survives until explicit reactivation", async ({ page, context, browser }) => {
  await openDetail({ page, context }, "stmsArchiveSuspended"); await suspend(page, "stms_unpaid"); await expectStatus(page, "Suspended"); await archive(page); await expectStatus(page, "Archived");
  await page.getByRole("button", { name: "Restore login" }).click(); await expectStatus(page, "Suspended"); expect((await attemptSignIn(browser, { key: "stmsArchiveSuspended" })).status).toBe(403);
  await page.getByRole("button", { name: "Reactivate login" }).click(); await expectStatus(page, "Active"); expect((await attemptSignIn(browser, { key: "stmsArchiveSuspended" })).status).toBe(200);
});

test("when email changes then invalid and duplicate entries keep comments, successful normalization revokes devices and another dirty card stays intact", async ({ page, context, browser }) => {
  await openDetail({ page, context }, "stmsEmail"); const editor = page.getByRole("region", { name: "Change email", exact: true });
  await editor.getByLabel("Email", { exact: true }).fill("invalid"); await editor.getByRole("button", { name: "Save email" }).click(); await expect(editor.getByLabel("Email", { exact: true })).toBeFocused();
  await editor.getByLabel("Email", { exact: true }).fill(login("stmsOtherTarget").email); await editor.getByLabel("Comment (optional)").fill("Keep this comment.");
  await editor.getByRole("button", { name: "Save email" }).click(); await expect(editor.getByRole("alert")).toContainText("This email is already in use.");
  await expect(editor.getByLabel("Comment (optional)")).toHaveValue("Keep this comment.");
  await page.locator("#change-username").fill("draftusr"); await page.locator("#reset-password").fill("Retained-password123!");
  const email = "stms-" + crypto.randomUUID() + "@example.test"; await editor.getByLabel("Email", { exact: true }).fill(" " + email.toUpperCase() + " ");
  await editor.getByRole("button", { name: "Save email" }).click(); await expect(editor.getByText("Email saved.", { exact: true })).toBeVisible();
  await expect(page.locator("dl")).toContainText(email); await expect(editor.getByLabel("Email", { exact: true })).toHaveValue(email);
  await expect(page.locator("#change-username")).toHaveValue("draftusr"); await expect(page.locator("#reset-password")).toHaveValue("Retained-password123!");
  expect(await sessionFor(browser, "stmsEmailDevice")).toBeNull(); expect((await attemptSignIn(browser, { key: "stmsEmail" })).status).toBe(401);
  expect((await attemptSignIn(browser, { key: "stmsEmail", email })).status).toBe(200);
});

test("when username changes then uniqueness and the reserved old name remain enforced and native sign-in accepts only the new username", async ({ page, context, browser }) => {
  await openDetail({ page, context }, "stmsUsername"); const editor = page.getByRole("region", { name: "Change username", exact: true });
  await editor.getByLabel("Username", { exact: true }).fill("BAD"); await editor.getByRole("button", { name: "Save username" }).click(); await expect(editor.getByRole("alert")).toContainText("Use a valid 4–8 character username");
  await editor.getByLabel("Username", { exact: true }).fill(login("stmsOtherTarget").username); await editor.getByRole("button", { name: "Save username" }).click();
  await expect(editor.getByRole("alert")).toContainText("This username is already in use.");
  const username = "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7); await editor.getByLabel("Username", { exact: true }).fill(username);
  await editor.getByRole("button", { name: "Save username" }).click(); await expect(editor.getByText("Username saved.", { exact: true })).toBeVisible();
  expect(await sessionFor(browser, "stmsUsernameDevice")).toBeNull(); expect((await attemptSignIn(browser, { key: "stmsUsername", username: login("stmsUsername").username })).status).toBe(401);
  expect((await attemptSignIn(browser, { key: "stmsUsername", username })).status).toBe(200);
  await page.goto(detailURL("stmsOtherTarget")); await page.locator("#change-username").fill(login("stmsUsername").username); await page.getByRole("button", { name: "Save username" }).click();
  await expect(page.getByRole("alert")).toContainText("This username is reserved.");
});

test("when the integrated reset control saves then the target's devices end and the exact new password works", async ({ page, context, browser }) => {
  await openDetail({ page, context }, "stmsReset"); await page.getByLabel("New password").fill(nextPassword);
  await page.getByRole("button", { name: "Reset password", exact: true }).click(); await expect(page.getByRole("heading", { name: "Password reset", exact: true })).toBeFocused();
  expect(await sessionFor(browser, "stmsResetDevice")).toBeNull(); expect((await attemptSignIn(browser, { key: "stmsReset", password: nextPassword })).status).toBe(200);
});

test("when a master opens their own login then self-suspension and self-archiving are disabled", async ({ page, context }) => {
  await openDetail({ page, context }, "stmsMaster"); await expect(page.getByRole("button", { name: "Suspend login", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Archive login", exact: true })).toBeDisabled(); await expect(page.getByText("You cannot suspend or archive your own login.")).toBeVisible();
});

test("when a master's email is unchanged then the no-op keeps their actual session and never asks them to sign in again", async ({ page, context }) => {
  await openDetail({ page, context }, "stmsMaster");
  const before = await page.evaluate(async () => await (await fetch("/api/auth/get-session")).json());
  await page.getByRole("button", { name: "Save email" }).click(); await expect(page.getByText("Email saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await page.evaluate(async () => await (await fetch("/api/auth/get-session")).json())).toEqual(before);
});

test("when confirmation is cancelled then status and sessions remain intact and leaving needs no draft warning", async ({ page, context, browser }) => {
  await openDetail({ page, context }, "stmsCancel"); let writes = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/_serverFn/")) writes++; });
  await page.getByRole("button", { name: "Archive login", exact: true }).click(); await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Suspend login", exact: true }).click(); await page.getByLabel("Suspension reason").selectOption("stms_other");
  await page.getByLabel("Comment for Other").fill("Discard this draft."); await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectStatus(page, "Active"); expect(await sessionFor(browser, "stmsCancel")).toMatchObject({ user: { id: login("stmsCancel").loginId } }); expect(writes).toBe(0);
  await page.getByRole("link", { name: "Back to logins" }).click(); await expect(page).toHaveURL(origin + "/stms/logins");
});

for (const field of ["email", "username"] as const) test("when a master changes their own " + field + " then a confirmed save precedes reauthentication and the same master can resume", async ({ page, context }) => {
  const key = field === "email" ? "stmsSelfEmail" : "stmsSelfUsername"; await openDetail({ page, context }, key, key);
  const value = field === "email" ? "self-" + crypto.randomUUID() + "@example.test" : "s" + crypto.randomUUID().replaceAll("-", "").slice(0, 7);
  await page.locator("#change-" + field).fill(value); await page.getByRole("button", { name: field === "email" ? "Save email" : "Save username" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Your change was saved."); await expect(page.getByRole("alertdialog")).toContainText("Your session has ended.");
  await expect(page.locator("#change-" + field)).toHaveValue(value);
  expect((await nativeSignIn(page, { key, ...(field === "email" ? { email: value } : { username: value }) })).status).toBe(200);
  await page.getByRole("button", { name: "Check access and continue" }).click(); await expect(page.getByRole("alertdialog")).toHaveCount(0); await expect(page.locator("dl")).toContainText(value);
});

test("when a master resets their own password then the page records success before access ends and can resume without replay", async ({ page, context }) => {
  await openDetail({ page, context }, "stmsSelfReset", "stmsSelfReset"); await page.getByLabel("New password").fill(nextPassword);
  await page.getByRole("button", { name: "Reset password", exact: true }).click(); await expect(page.getByRole("alertdialog")).toContainText("Your change was saved.");
  expect((await nativeSignIn(page, { key: "stmsSelfReset", password: nextPassword })).status).toBe(200);
  await page.getByRole("button", { name: "Check access and continue" }).click(); await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Password reset", exact: true })).toBeVisible();
});

test("when a committed self-reset reply is lost then the host keeps the entered secret with the native uncertainty message and never retries", async ({ page, context, browser }) => {
  await openDetail({ page, context }, "stmsResetLostSelf", "stmsResetLostSelf"); await page.getByLabel("New password").fill(nextPassword);
  let writes = 0; await page.route("**/_serverFn/**", async (route) => { writes++; expect((await forward(route)).status()).toBe(200); await route.abort("connectionreset"); });
  await page.getByRole("button", { name: "Reset password", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("This may already have ended your sessions.");
  await expect(page.getByLabel("New password")).toHaveValue(nextPassword); await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect((await attemptSignIn(browser, { key: "stmsResetLostSelf", password: nextPassword })).status).toBe(200); expect(writes).toBe(1);
});

test("when a confirmation is busy then dismissal, duplicate writes and the other editors are disabled", async ({ page, context }) => {
  await openDetail({ page, context }, "stmsBusy"); await page.getByRole("button", { name: "Suspend login", exact: true }).click(); await page.getByLabel("Suspension reason").selectOption("stms_unpaid");
  let release: (() => void) | undefined, writes = 0; const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_serverFn/**", async (route) => { if (route.request().postData()?.includes("confirmed")) { writes++; await held; } await route.fulfill({ response: await forward(route) }); });
  try {
    await page.getByRole("alertdialog").getByRole("button", { name: "Suspend login", exact: true }).click();
    await expect(page.locator("#reset-password")).toBeDisabled(); await expect(page.locator("#change-email")).toBeDisabled(); await page.keyboard.press("Escape"); await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.keyboard.press("Enter"); expect(writes).toBe(1);
  } finally { release?.(); }
  await expectStatus(page, "Suspended"); expect(writes).toBe(1);
});

test("when a committed lifecycle reply is lost then a read confirms current state and no transition is replayed", async ({ page, context }) => {
  await openDetail({ page, context }, "stmsLostStatus"); let writes = 0;
  await page.route("**/_serverFn/**", async (route) => {
    const response = await forward(route);
    if (route.request().postData()?.includes("confirmed")) { writes++; expect(response.status()).toBe(200); await route.abort("connectionreset"); }
    else await route.fulfill({ response });
  });
  await suspend(page, "stms_unpaid"); await expect(page.getByRole("alert")).toContainText("It may have completed.");
  await page.getByRole("button", { name: "Check saved details" }).click(); await expect(page.getByRole("alertdialog")).toContainText("Current status: Suspended");
  await expect(page.getByRole("alertdialog").getByRole("button", { name: "Suspend login", exact: true })).toBeDisabled(); expect(writes).toBe(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expectStatus(page, "Suspended");
});

test("when a committed email reply is lost then readback preserves the entered values and does not repeat the change", async ({ page, context, browser }) => {
  await openDetail({ page, context }, "stmsLostEmail"); const email = "lost-" + crypto.randomUUID() + "@example.test"; let writes = 0;
  await page.locator("#change-email").fill(email); await page.locator("#change-email-comment").fill("Keep this context.");
  await page.route("**/_serverFn/**", async (route) => {
    const response = await forward(route); if (route.request().postData()?.includes(email)) { writes++; expect(response.status()).toBe(200); await route.abort("connectionreset"); }
    else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Save email" }).click(); await expect(page.getByRole("alert")).toContainText("It may have completed.");
  await page.getByRole("button", { name: "Check saved details" }).click(); await expect(page.locator("dl")).toContainText(email);
  await expect(page.locator("#change-email")).toHaveValue(email); await expect(page.locator("#change-email-comment")).toHaveValue("Keep this context.");
  expect((await attemptSignIn(browser, { key: "stmsLostEmail", email })).status).toBe(200); expect(writes).toBe(1);
});

test("when suspension loses authentication then reason and comment survive reauthentication as the original master", async ({ page, context }) => {
  await openDetail({ page, context }, "stmsExpired", "stmsExpiredMaster"); await page.getByRole("button", { name: "Suspend login", exact: true }).click();
  await page.getByLabel("Suspension reason").selectOption("stms_other"); await page.getByLabel("Comment for Other").fill("Retain this reason.");
  await page.evaluate(async () => { await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); });
  await page.getByRole("alertdialog").getByRole("button", { name: "Suspend login", exact: true }).click(); await expect(page.getByRole("alertdialog")).toContainText("Your session has ended.");
  expect((await nativeSignIn(page, { key: "stmsExpiredMaster" })).status).toBe(200); await page.getByRole("button", { name: "Check access and continue" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0); await page.getByRole("button", { name: "Suspend login", exact: true }).click();
  await expect(page.getByLabel("Suspension reason")).toHaveValue("stms_other"); await expect(page.getByLabel("Comment for Other")).toHaveValue("Retain this reason.");
  await page.getByRole("alertdialog").getByRole("button", { name: "Suspend login", exact: true }).click(); await expectStatus(page, "Suspended");
});

test("when the signed-in master changes then an old page cannot write and its draft stays blocked", async ({ page, context }) => {
  await openDetail({ page, context }, "stmsChanged"); await page.locator("#change-email").fill("kept@example.test"); await context.clearCookies(); await addLogin(context, login("stmsOtherMaster"));
  await page.getByRole("button", { name: "Save email" }).click(); await expect(page.getByRole("alertdialog")).toContainText("Your sign-in has changed.");
  await expect(page.locator("#stms-detail-content")).toHaveAttribute("inert"); await expect(page.locator("#change-email")).toHaveValue("kept@example.test");
  await page.getByRole("button", { name: "Check access and continue" }).click(); await expect(page.getByRole("alertdialog")).toBeVisible();
});

test("when translations expand on a narrow RTL screen then the table, detail and confirmation stay accessible", async ({ page, context }, info) => {
  await addLogin(context, login("stmsLocaleMaster")); await context.addCookies([{ name: "PARAGLIDE_LOCALE", value: "en-XA", url: origin }]);
  await page.setViewportSize({ width: 320, height: 800 }); await page.emulateMedia({ colorScheme: "dark" }); await page.goto(origin + "/stms/logins?query=Directory%20case");
  await expect(page.getByLabel(/Sëárch/)).toBeEnabled(); await expect(page.getByRole("heading", { level: 1 })).toContainText("⟦");
  await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto(detailURL("stmsLocale")); await expect(page.locator("#change-email")).toBeEnabled(); await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl"));
  await page.getByRole("button").filter({ hasText: "Süspënd" }).click(); await page.locator("#status-reason").selectOption("stms_other");
  await page.getByRole("alertdialog").getByRole("button").filter({ hasText: "Süspënd" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.getByRole("alertdialog").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("stms-rtl-dark.png"), fullPage: true });
  await page.getByRole("button").filter({ hasText: "Cáncël" }).click();
  await page.evaluate(async () => { await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); });
  await page.getByRole("button").filter({ hasText: "Sávë ëmáïl" }).click(); await expect(page.getByRole("alertdialog")).toContainText("sëssïön");
  expect(await page.getByRole("alertdialog").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

function login(key: string): Login { const value = fixtures.logins[key]; if (!value) throw new Error("Missing STMS fixture: " + key); return value; }
function detailURL(key: string): string { return origin + "/stms/logins/" + login(key).loginId; }
async function addLogin(context: BrowserContext, value: Login): Promise<void> {
  await context.addCookies(value.cookie.split("; ").map((cookie) => { const index = cookie.indexOf("="); return { name: cookie.slice(0, index), value: cookie.slice(index + 1), url: origin, httpOnly: true, secure: true, sameSite: "Lax" as const }; }));
}
async function openDetail({ page, context }: { page: Page; context: BrowserContext }, target: string, actor = "stmsMaster"): Promise<void> {
  await addLogin(context, login(actor)); await page.goto(detailURL(target)); await expect(page.getByRole("heading", { name: "Manage login", exact: true })).toBeVisible();
  await expect(page.locator("#change-email")).toBeEnabled();
}
async function expectStatus(page: Page, value: string): Promise<void> { await expect(page.locator("#login-status-value")).toHaveText(value); }
async function suspend(page: Page, reason: string): Promise<void> {
  await page.getByRole("button", { name: "Suspend login", exact: true }).click(); await page.getByLabel("Suspension reason").selectOption(reason);
  await page.getByRole("alertdialog").getByRole("button", { name: "Suspend login", exact: true }).click();
}
async function archive(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Archive login", exact: true }).click(); await expect(page.getByRole("alertdialog")).toContainText("Keep this page’s link");
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive login", exact: true }).click();
}
async function forward(route: Route): Promise<APIResponse> { return await route.fetch({ url: route.request().url().replace(origin, "https://127.0.0.1:3001"), headers: { ...await route.request().allHeaders(), host: "hub.localhost:3001" } }); }
async function readResponse(page: Page, path: string): Promise<{ status: number; headers: Record<string, string> }> {
  return await page.evaluate(async (url) => { const response = await fetch(url, { cache: "no-store" }); await response.arrayBuffer(); return { status: response.status, headers: Object.fromEntries(response.headers) }; }, path);
}
async function nativeSignIn(page: Page, input: { key: string; password?: string; email?: string; username?: string }): Promise<{ status: number }> {
  const body = input.username ? { username: input.username, password: input.password ?? password } : { email: input.email ?? login(input.key).email, password: input.password ?? password };
  const result = await page.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-captcha-response": "XXXX.DUMMY.TOKEN.XXXX" }, body: JSON.stringify(body) });
    const received: unknown = await response.json();
    return { status: response.status, isMfaRequired: Boolean(received && typeof received === "object" && "twoFactorRedirect" in received && received.twoFactorRedirect === true) };
  }, { path: input.username ? "/api/auth/sign-in/username" : "/api/auth/sign-in/email", body });
  if (result.isMfaRequired) await verifyBrowserMfa(page, login(input.key).loginId);
  return { status: result.status };
}

async function attemptSignIn(browser: Browser, input: { key: string; password?: string; email?: string; username?: string }): Promise<{ status: number }> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try { const page = await context.newPage(); await page.goto(origin + "/sign-in"); return await nativeSignIn(page, input); } finally { await context.close(); }
}
async function sessionFor(browser: Browser, key: string): Promise<unknown> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try { await addLogin(context, login(key)); const page = await context.newPage(); await page.goto(origin + "/sign-in"); return await page.evaluate(async () => await (await fetch("/api/auth/get-session")).json()); }
  finally { await context.close(); }
}
