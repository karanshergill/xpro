import { test, expect, type APIResponse, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.XPRO_BROWSER_TEMP;
if (!base) throw new Error("Use the isolated browser runner.");
type Login = { loginId: string; email: string; username: string; cookie: string };
const fixtures: { logins: Record<string, Login> } = JSON.parse(await readFile(join(base, "fixtures.json"), "utf8"));
const origin = "https://hub.localhost:3001", oldPassword = "Browser-fixture123!", newPassword = " New-profile-password456! ";
let pageErrors: string[] = [];
test.beforeEach(({ page }) => { pageErrors = []; page.on("pageerror", (error) => pageErrors.push(error.message)); });
test.afterEach(() => expect(pageErrors).toEqual([]));

test("when the private profile opens then identifiers are read-only and current details, initials and accessible forms are present", async ({ page, context }, info) => {
  await openProfile({ page, context }, "profileView");
  await expect(page.getByRole("heading", { name: "Your profile", exact: true })).toBeFocused();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(login("profileView").email);
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("readonly");
  await expect(page.getByLabel("Username", { exact: true })).toHaveAttribute("readonly");
  await expect(page.getByLabel("Full name")).toHaveValue("Existing name");
  await expect(page.getByLabel("Country or region")).toHaveValue("US");
  await expect(page.getByLabel("Number", { exact: true })).toHaveValue("2025550123");
  await expect(page.getByRole("img", { name: "Current profile picture", exact: true })).toHaveText("EN");
  const response = await getResponse(page, "/profile");
  expect(response.headers["cache-control"]).toBe("private, no-store"); expect(response.headers.vary).toContain("cookie");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("profile.png"), fullPage: true });
});

for (const actor of ["profileSave", "profileMaster"]) test("when " + actor + " saves name and phone then their own normalized details persist and another dirty card stays intact", async ({ page, context, browser }) => {
  await openProfile({ page, context }, actor);
  await page.getByLabel("New password", { exact: true }).fill("Keep-this-draft123!");
  await page.getByLabel("Full name").fill("  Updated person  "); await page.getByLabel("Country or region").selectOption("GB");
  await page.getByLabel("Number", { exact: true }).fill("020 7946 0018"); await page.getByRole("button", { name: "Save details", exact: true }).click();
  await expect(page.getByText("Your details have been saved.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveValue("Updated person"); await expect(page.getByLabel("New password", { exact: true })).toHaveValue("Keep-this-draft123!");
  const saved = await profileInNewContext(browser, actor); expect(saved).toEqual({ name: "Updated person", country: "GB", number: "2079460018" });
  expect(await profileInNewContext(browser, "profileOther")).toEqual({ name: "Existing name", country: "US", number: "2025550123" });
});

test("when required details fail then one pointer activation shows field errors without losing input", async ({ page, context }) => {
  await openProfile({ page, context }, "profileValidation");
  await page.getByLabel("Full name").fill(""); await page.getByRole("button", { name: "Save details", exact: true }).click();
  await expect(page.locator("#profile-name-error")).toHaveText("Enter your name."); await expect(page.getByLabel("Full name")).toBeFocused();
  await page.getByLabel("Full name").fill("Retained name"); await page.getByLabel("Number", { exact: true }).fill("invalid number");
  await page.getByRole("button", { name: "Save details", exact: true }).click();
  await expect(page.locator("#profile-phone-error")).toContainText("Enter a valid phone number");
  await expect(page.getByLabel("Full name")).toHaveValue("Retained name"); await expect(page.getByLabel("Number", { exact: true })).toBeFocused();
});

test("when a password manager silently fills details then native field values are submitted", async ({ page, context }) => {
  await openProfile({ page, context }, "profileAutofill");
  await page.evaluate(() => {
    const name = document.querySelector<HTMLInputElement>("#profile-name"), phone = document.querySelector<HTMLInputElement>("#profile-phone");
    if (!name || !phone) throw new Error("Missing profile controls."); name.value = "Autofilled name"; phone.value = "2025550199";
  });
  await page.getByRole("button", { name: "Save details", exact: true }).click(); await expect(page.getByText("Your details have been saved.")).toBeVisible();
  await page.reload(); await expect(page.getByLabel("Full name")).toHaveValue("Autofilled name");
});

test("when a profile save is in flight then the other cards cannot race it and no duplicate save is sent", async ({ page, context }) => {
  await openProfile({ page, context }, "profileBusy"); await page.getByLabel("Full name").fill("Busy person");
  let release: (() => void) | undefined, count = 0; const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/_serverFn/**", async (route) => { count++; await held; await route.fulfill({ response: await forward(route) }); });
  try {
    await page.getByRole("button", { name: "Save details", exact: true }).click(); await expect(page.getByLabel("New password", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Choose a picture", { exact: true })).toBeDisabled(); await page.keyboard.press("Enter"); expect(count).toBe(1);
  } finally { release?.(); }
  await expect(page.getByText("Your details have been saved.")).toBeVisible(); expect(count).toBe(1);
});

test("when a session ends then the mounted drafts survive and only a fresh read as the original person allows continuation", async ({ page, context }) => {
  await openProfile({ page, context }, "profileExpired"); await page.getByLabel("Full name").fill("Unsaved profile");
  await page.getByLabel("New password", { exact: true }).fill("Unsaved-password123!");
  await page.evaluate(async () => { await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); });
  await page.getByRole("button", { name: "Save details", exact: true }).click(); await expect(page.getByRole("alertdialog")).toContainText("Your session has ended.");
  await expect(page.locator("#profile-content")).toHaveAttribute("inert");
  expect((await nativeSignIn(page, "profileExpired", oldPassword)).status).toBe(200);
  await page.getByRole("button", { name: "Check access and continue" }).click(); await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByLabel("Full name")).toHaveValue("Unsaved profile"); await expect(page.getByLabel("New password", { exact: true })).toHaveValue("Unsaved-password123!");
  await page.getByRole("button", { name: "Save details", exact: true }).click(); await expect(page.getByText("Your details have been saved.")).toBeVisible();
});

test("when the browser switches identities then an old form cannot save to the new person's profile", async ({ page, context, browser }) => {
  await openProfile({ page, context }, "profileChanged"); await page.getByLabel("Full name").fill("Must not cross identities");
  await context.clearCookies(); await addLogin(context, login("profileOther"));
  await page.getByRole("button", { name: "Save details", exact: true }).click(); await expect(page.getByRole("alertdialog")).toContainText("Your sign-in has changed.");
  await page.getByRole("button", { name: "Check access and continue" }).click(); await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.locator("#profile-name")).toHaveValue("Must not cross identities");
  expect((await profileInNewContext(browser, "profileOther")).name).toBe("Existing name");
});

test("when silent autofill supplies the correct password then the native replacement cookie keeps this browser signed in and ends the other device", async ({ page, context, browser }) => {
  await openProfile({ page, context }, "profilePassword");
  await page.evaluate((values) => {
    for (const [key, value] of Object.entries(values)) {
      const field = document.querySelector<HTMLInputElement>("#profile-" + key); if (!field) throw new Error("Missing password field."); field.value = value;
    }
  }, { currentPassword: oldPassword, newPassword });
  await page.getByRole("button", { name: "Change password", exact: true }).click(); await expect(page.getByText("Your password has been changed. Your other sessions have ended.")).toBeVisible();
  await expect(page.getByLabel("Current password", { exact: true })).toHaveValue(""); await expect(page.getByLabel("New password", { exact: true })).toHaveValue("");
  const session = await page.evaluate(async () => await (await fetch("/api/auth/get-session")).json()); expect(session).toMatchObject({ user: { id: login("profilePassword").loginId } });
  expect(await sessionInNewContext(browser, "profilePasswordDevice")).toBeNull();
  expect((await signInInNewContext(browser, "profilePassword", oldPassword)).status).toBe(401);
  expect((await signInInNewContext(browser, "profilePassword", newPassword)).status).toBe(200);
  await page.reload(); await expect(page.getByRole("heading", { name: "Your profile", exact: true })).toBeVisible();
});

test("when password entry or the current password is invalid then errors are accessible and values remain", async ({ page, context }) => {
  await openProfile({ page, context }, "profilePasswordInvalid");
  await page.getByRole("button", { name: "Change password", exact: true }).click(); await expect(page.getByLabel("Current password", { exact: true })).toBeFocused();
  await fillPassword(page, { currentPassword: "Wrong-password123!", newPassword }); await page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(page.locator("#profile-currentPassword-error")).toHaveText("The current password is incorrect.");
  await expect(page.getByLabel("Current password", { exact: true })).toHaveValue("Wrong-password123!"); await expect(page.getByLabel("New password", { exact: true })).toHaveValue(newPassword);
});

test("when a committed password response is lost then the result stays uncertain with both entries retained and no automatic replay", async ({ page, context, browser }) => {
  await openProfile({ page, context }, "profilePasswordLost"); await fillPassword(page, { currentPassword: oldPassword, newPassword });
  let count = 0; await page.route("**/_serverFn/**", async (route) => { count++; expect((await forward(route)).status()).toBe(200); await route.abort("connectionreset"); });
  await page.getByRole("button", { name: "Change password", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("Your new password may already be saved");
  await expect(page.getByRole("link", { name: "Sign in in a new tab" })).toHaveAttribute("target", "_blank");
  await expect(page.getByLabel("Current password", { exact: true })).toHaveValue(oldPassword); await expect(page.getByLabel("New password", { exact: true })).toHaveValue(newPassword);
  expect((await signInInNewContext(browser, "profilePasswordLost", newPassword)).status).toBe(200); expect(count).toBe(1);
});

test("when a square picture is saved then the private PNG is circularly displayed, survives reload and removal restores initials", async ({ page, context }) => {
  await openProfile({ page, context }, "profilePicture"); await choosePalette(page, { width: 960, height: 640 });
  await page.getByRole("button", { name: "Save picture", exact: true }).click(); await expect(page.getByText("Your picture has been updated.")).toBeVisible();
  const image = page.locator('[aria-label="Current profile picture"] img'); await expect(image).toBeVisible();
  const url = await image.getAttribute("src"); if (!url) throw new Error("Missing saved picture URL.");
  const response = await getResponse(page, url); expect(response.status).toBe(200); expect(response.headers["content-type"]).toBe("image/png");
  expect(response.headers["cache-control"]).toBe("private, no-store"); expect(response.headers.vary).toBe("cookie");
  expect(await page.locator('[aria-label="Current profile picture"]').evaluate((element) => parseFloat(getComputedStyle(element).borderRadius) >= element.clientWidth / 2)).toBe(true);
  const dimensions = await image.evaluate((element) => ({ width: (element as HTMLImageElement).naturalWidth, height: (element as HTMLImageElement).naturalHeight }));
  expect(dimensions.width).toBeGreaterThan(0); expect(dimensions.width).toBe(dimensions.height); expect(dimensions.width).toBeLessThanOrEqual(512);
  await page.reload(); await expect(image).toBeVisible(); await page.getByRole("button", { name: "Remove saved picture" }).click(); await expect(image).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Current profile picture", exact: true })).toHaveText("EN"); expect((await getResponse(page, url)).status).toBe(404);
});

test("when the crop square moves with the keyboard then the saved pixels use that chosen region", async ({ page, context }) => {
  await openProfile({ page, context }, "profilePictureOffset"); await choosePalette(page, { width: 160, height: 80 });
  const crop = page.getByRole("group", { name: "Move the crop square" }); await crop.focus();
  for (let index = 0; index < 45; index++) await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Save picture", exact: true }).click(); await expect(page.getByText("Your picture has been updated.")).toBeVisible();
  const color = await savedPixel(page); expect(color[2]).toBeGreaterThan(220); expect(color[0]).toBeLessThan(30);
});

test("when JPEG, WebP and an EXIF-rotated JPEG are selected then actual browser decoding and the native processor save square PNGs", async ({ page, context }) => {
  await openProfile({ page, context }, "profilePictureTypes");
  for (const format of ["image/jpeg", "image/webp", "exif"] as const) {
    await choosePalette(page, { width: 120, height: 80, format }); await page.getByRole("button", { name: "Save picture", exact: true }).click();
    await expect(page.getByText("Your picture has been updated.")).toBeVisible();
    const image = page.locator('[aria-label="Current profile picture"] img'); await expect(image).toBeVisible();
    expect(await image.evaluate((element) => (element as HTMLImageElement).naturalWidth === (element as HTMLImageElement).naturalHeight)).toBe(true);
    if (format === "exif") {
      const top = await savedPixel(page, { x: 0.5, y: 0.25 }), bottom = await savedPixel(page, { x: 0.5, y: 0.75 });
      expect(top[0]).toBeGreaterThan(220); expect(top[2]).toBeLessThan(30);
      expect(bottom[2]).toBeGreaterThan(220); expect(bottom[0]).toBeLessThan(30);
    }
  }
});

test("when an original is too large or unsupported then no crop upload occurs, even if its extension looks valid", async ({ page, context }) => {
  await openProfile({ page, context }, "profilePictureLarge"); let uploads = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url() === origin + "/api/v1/profile-pictures") uploads++; });
  await page.getByLabel("Choose a picture", { exact: true }).setInputFiles({ name: "too-large.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
  await expect(page.getByRole("alert")).toContainText("Choose a picture within the upload limit shown below.");
  await page.getByLabel("Choose a picture", { exact: true }).setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("<svg></svg>") });
  await expect(page.getByRole("alert")).toContainText("Choose a JPG, PNG or WebP picture.");
  await page.getByLabel("Choose a picture", { exact: true }).setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from([137,80,78,71,13,10,26,10]) });
  await expect(page.getByRole("alert")).toContainText("This picture could not be read."); expect(uploads).toBe(0);
});

test("when the browser identity changes then an old picture URL and selected upload cannot cross to the other person", async ({ page, context }) => {
  await openProfile({ page, context }, "profilePictureChanged"); await choosePalette(page, {}); await page.getByRole("button", { name: "Save picture", exact: true }).click();
  await expect(page.getByText("Your picture has been updated.")).toBeVisible();
  const url = await page.locator('[aria-label="Current profile picture"] img').getAttribute("src"); if (!url) throw new Error("Missing picture URL.");
  await choosePalette(page, {}); await context.clearCookies(); await addLogin(context, login("profileOther"));
  expect((await getResponse(page, url)).status).toBe(404); await page.getByRole("button", { name: "Save picture", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Your sign-in has changed.");
});

test("when a picture reply is lost then an explicit read confirms the saved picture without replaying the upload or clearing another draft", async ({ page, context }) => {
  await openProfile({ page, context }, "profilePictureLost"); await page.getByLabel("Full name").fill("Keep other draft"); await choosePalette(page, {});
  let count = 0; await page.route(origin + "/api/v1/profile-pictures", async (route) => { count++; expect((await forward(route)).status()).toBe(200); await route.abort("connectionreset"); });
  await page.getByRole("button", { name: "Save picture", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("The picture may have been saved.");
  await page.getByRole("button", { name: "Check saved picture" }).click(); await expect(page.locator('[aria-label="Current profile picture"] img')).toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveValue("Keep other draft"); expect(count).toBe(1);
  await page.getByRole("button", { name: "Discard selected picture" }).click(); await expect(page.locator(".ReactCrop")).toHaveCount(0);
});

test("when translations expand on a narrow RTL screen then all cards and the keyboard crop remain accessible", async ({ page, context }, info) => {
  await context.addCookies([{ name: "PARAGLIDE_LOCALE", value: "en-XA", url: origin }]); await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ colorScheme: "dark" }); await openProfile({ page, context }, "profileLocale");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("⟦"); await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl"));
  const buffer = await palette(page, { width: 640, height: 480 }); await page.locator('input[type="file"]').setInputFiles({ name: "picture.png", mimeType: "image/png", buffer });
  await expect(page.locator(".ReactCrop__crop-selection")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); await page.screenshot({ path: info.outputPath("profile-rtl-dark-crop.png"), fullPage: true });
});

test("when another card has an invalid draft then one pointer press still saves a picture, and discarding releases selected files", async ({ page, context }) => {
  await openProfile({ page, context }, "profileValidation"); await choosePalette(page, {});
  await page.getByLabel("Full name").fill(""); await page.getByRole("button", { name: "Save picture", exact: true }).click();
  await expect(page.getByText("Your picture has been updated.")).toBeVisible(); await expect(page.getByLabel("Full name")).toHaveValue("");
  await choosePalette(page, {}); const oldURL = await page.locator(".ReactCrop img").getAttribute("src");
  if (!oldURL) throw new Error("Missing selected picture URL.");
  await page.getByRole("button", { name: "Discard selected picture" }).click();
  await expect(page.locator(".ReactCrop")).toHaveCount(0);
  expect(await page.evaluate(async (url) => await new Promise<boolean>((resolve) => { const image = new Image(); image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = url; }), oldURL)).toBe(false);
  await choosePalette(page, {}); await expect(page.getByRole("button", { name: "Save picture", exact: true })).toBeEnabled();
});

test("when native policy pauses uploads then the existing picture remains private and keyboard removal preserves other drafts", async ({ page, context }, info) => {
  await openProfile({ page, context }, "profilePicturePaused");
  const picture = page.locator('[aria-label="Current profile picture"] img'); await expect(picture).toBeVisible();
  const url = await picture.getAttribute("src"); if (!url) throw new Error("Missing pre-pause picture.");
  await page.getByLabel("Full name").fill("Keep paused draft"); await page.getByLabel("New password", { exact: true }).fill("Keep-paused-password123!");
  await expect(page.locator("#picture-paused")).toHaveText("Picture uploads are temporarily unavailable. You can still remove your current picture.");
  await expect(page.getByLabel("Choose a picture", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save picture", exact: true })).toHaveCount(0);
  expect((await getResponse(page, url)).status).toBe(200);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath("profile-policy-paused-" + width + ".png"), fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" }); await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("profile-policy-paused-dark-rtl.png"), fullPage: true });
  const remove = page.getByRole("button", { name: "Remove saved picture", exact: true }); await expect(remove).toBeEnabled();
  await remove.focus(); await page.keyboard.press("Enter"); await expect(picture).toHaveCount(0);
  await expect(page.locator("#picture-title")).toBeFocused(); await expect(page.getByLabel("Choose a picture", { exact: true })).toBeDisabled();
  await expect(page.getByRole("img", { name: "Current profile picture", exact: true })).toHaveText("EN");
  await expect(page.getByLabel("Full name")).toHaveValue("Keep paused draft"); await expect(page.getByLabel("New password", { exact: true })).toHaveValue("Keep-paused-password123!");
  await expect(page.getByRole("alertdialog")).toHaveCount(0); expect((await getResponse(page, url)).status).toBe(404);
});

test("when native policy reduces the limit then the screen displays it and checks the exact original boundary before a real save", async ({ page, context }, info) => {
  await openProfile({ page, context }, "profilePictureReduced"); await page.getByLabel("Full name").fill("Keep reduced draft");
  await expect(page.locator("#picture-help")).toHaveText("Choose a JPG, PNG or WebP file, up to 1,048,576 bytes. Crop it to a square before saving.");
  let uploads = 0; page.on("request", (request) => { if (request.method() === "POST" && request.url() === origin + "/api/v1/profile-pictures") uploads++; });
  const jpeg = await palette(page, { format: "image/jpeg" }), tooLarge = Buffer.alloc(1_048_577); jpeg.copy(tooLarge);
  await page.getByLabel("Choose a picture", { exact: true }).setInputFiles({ name: "portrait.jpg", mimeType: "image/jpeg", buffer: tooLarge });
  await expect(page.getByRole("alert")).toContainText("Choose a picture within the upload limit shown below.");
  await expect(page.getByRole("alert")).toBeFocused(); expect(uploads).toBe(0); await expect(page.locator(".ReactCrop")).toHaveCount(0);
  const boundary = tooLarge.subarray(0, 1_048_576);
  await page.getByLabel("Choose a picture", { exact: true }).setInputFiles({ name: "portrait.jpg", mimeType: "image/jpeg", buffer: boundary });
  await expect(page.getByRole("group", { name: "Move the crop square" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("profile-policy-reduced.png"), fullPage: true });
  await page.getByRole("button", { name: "Save picture", exact: true }).click(); await expect(page.getByText("Your picture has been updated.")).toBeVisible();
  await expect(page.locator('[aria-label="Current profile picture"] img')).toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveValue("Keep reduced draft"); expect(uploads).toBe(1);
});

test("when a small JPEG grows beyond the native limit after cropping then no upload is sent and other drafts remain", async ({ page, context }) => {
  await openProfile({ page, context }, "profilePictureCropLimit"); await page.getByLabel("Full name").fill("Keep cropped draft");
  await expect(page.locator("#picture-help")).toContainText("65,536 bytes");
  let uploads = 0; page.on("request", (request) => { if (request.method() === "POST" && request.url() === origin + "/api/v1/profile-pictures") uploads++; });
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Missing browser canvas.");
    const pixels = context.createImageData(canvas.width, canvas.height); let random = 73;
    for (let index = 0; index < pixels.data.length; index += 4) {
      for (let channel = 0; channel < 3; channel++) { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; pixels.data[index + channel] = random >>> 24; }
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0); return canvas.toDataURL("image/jpeg", 0.1).split(",")[1] ?? "";
  });
  const buffer = Buffer.from(encoded, "base64"); expect(buffer.byteLength).toBeLessThanOrEqual(65_536);
  await page.getByLabel("Choose a picture", { exact: true }).setInputFiles({ name: "compressed.jpg", mimeType: "image/jpeg", buffer });
  await expect(page.getByRole("group", { name: "Move the crop square" })).toBeVisible();
  await page.getByRole("button", { name: "Save picture", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Choose a picture within the upload limit shown below."); await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByLabel("Full name")).toHaveValue("Keep cropped draft"); await expect(page.getByRole("alertdialog")).toHaveCount(0); expect(uploads).toBe(0);
  await page.getByRole("button", { name: "Refresh picture options" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0); await expect(page.locator(".ReactCrop")).toBeVisible(); expect(uploads).toBe(0);
});

test("when a stale mounted screen permits an upload during a native pause then the real refusal stays in the picture card and refresh preserves drafts", async ({ page, context }, info) => {
  await addLogin(context, login("profilePictureStale")); await page.goto(origin + "/profile-policy-check");
  await expect(page.getByLabel("Choose a picture", { exact: true })).toBeEnabled();
  await page.getByLabel("Full name").fill("Keep stale draft"); await page.getByLabel("New password", { exact: true }).fill("Keep-stale-password123!");
  const picture = page.locator('[aria-label="Current profile picture"] img'); await expect(picture).toBeVisible();
  const url = await picture.getAttribute("src"); if (!url) throw new Error("Missing stale-screen saved picture.");
  await choosePalette(page, {});
  let uploads = 0; page.on("request", (request) => { if (request.method() === "POST" && request.url() === origin + "/api/v1/profile-pictures") uploads++; });
  const refused = page.waitForResponse((response) => response.url() === origin + "/api/v1/profile-pictures" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save picture", exact: true }).click(); const response = await refused;
  expect(response.status()).toBe(503); expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({ code: "accounts_picture_uploads_unavailable", message: "Picture uploads are temporarily unavailable. You can still remove your current picture.",
    requestId: response.headers()["x-request-id"] });
  await expect(page.getByRole("alert")).toContainText("Picture uploads are temporarily unavailable."); await expect(page.getByRole("alert")).toContainText(response.headers()["x-request-id"] ?? "missing");
  await expect(page.getByRole("alert")).toBeFocused(); await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("profile-policy-stale-refusal.png"), fullPage: true });
  expect((await getResponse(page, url)).status).toBe(200); expect(uploads).toBe(1);
  await page.getByRole("button", { name: "Refresh picture options" }).click();
  await expect(page.locator("#picture-paused")).toBeVisible(); await expect(page.getByLabel("Choose a picture", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save picture", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove saved picture", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Full name")).toHaveValue("Keep stale draft"); await expect(page.getByLabel("New password", { exact: true })).toHaveValue("Keep-stale-password123!"); expect(uploads).toBe(1);
  const discard = page.getByRole("button", { name: "Discard selected picture", exact: true }); await discard.focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".ReactCrop")).toHaveCount(0); await expect(page.locator("#picture-title")).toBeFocused();
});

function login(key: string): Login { const value = fixtures.logins[key]; if (!value) throw new Error("Missing profile fixture: " + key); return value; }
async function getResponse(page: Page, path: string): Promise<{ status: number; headers: Record<string, string> }> {
  return await page.evaluate(async (url) => { const response = await fetch(url, { cache: "no-store" }); await response.arrayBuffer(); return { status: response.status, headers: Object.fromEntries(response.headers) }; }, path);
}
async function addLogin(context: BrowserContext, value: Login): Promise<void> {
  await context.addCookies(value.cookie.split("; ").map((cookie) => { const index = cookie.indexOf("="); return { name: cookie.slice(0, index), value: cookie.slice(index + 1), url: origin, httpOnly: true, secure: true, sameSite: "Lax" as const }; }));
}
async function openProfile({ page, context }: { page: Page; context: BrowserContext }, key: string): Promise<void> {
  await addLogin(context, login(key)); await page.goto(origin + "/profile"); await expect(page.locator('#profile-content button[type="submit"]').first()).toBeEnabled();
}
async function profileInNewContext(browser: Browser, key: string): Promise<{ name: string; country: string; number: string }> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try { const page = await context.newPage(); await openProfile({ page, context }, key); return { name: await page.getByLabel("Full name").inputValue(), country: await page.getByLabel("Country or region").inputValue(), number: await page.getByLabel("Number", { exact: true }).inputValue() }; }
  finally { await context.close(); }
}
async function sessionInNewContext(browser: Browser, key: string): Promise<unknown> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try { await addLogin(context, login(key)); const page = await context.newPage(); await page.goto(origin + "/sign-in"); return await page.evaluate(async () => await (await fetch("/api/auth/get-session")).json()); }
  finally { await context.close(); }
}
async function nativeSignIn(page: Page, key: string, password: string): Promise<{ status: number }> {
  return await page.evaluate(async ({ email, password }) => { const response = await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json", "x-captcha-response": "XXXX.DUMMY.TOKEN.XXXX" }, body: JSON.stringify({ email, password }) }); return { status: response.status }; }, { email: login(key).email, password });
}
async function signInInNewContext(browser: Browser, key: string, password: string): Promise<{ status: number }> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try { const page = await context.newPage(); await page.goto(origin + "/sign-in"); return await nativeSignIn(page, key, password); }
  finally { await context.close(); }
}
async function fillPassword(page: Page, values: { currentPassword: string; newPassword: string }): Promise<void> {
  await page.getByLabel("Current password", { exact: true }).fill(values.currentPassword); await page.getByLabel("New password", { exact: true }).fill(values.newPassword);
}
async function forward(route: Route): Promise<APIResponse> { return await route.fetch({ url: route.request().url().replace(origin, "https://127.0.0.1:3001"), headers: { ...await route.request().allHeaders(), host: "hub.localhost:3001" } }); }
type PaletteOptions = { width?: number; height?: number; format?: "image/jpeg" | "image/webp" | "exif" };
async function palette(page: Page, options: PaletteOptions): Promise<Buffer> {
  const encoded = await page.evaluate(({ width = 160, height = 80, format = "image/png" }) => {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const context = canvas.getContext("2d");
    if (!context) throw new Error("Missing browser canvas."); context.fillStyle = "red"; context.fillRect(0, 0, width / 2, height); context.fillStyle = "blue"; context.fillRect(width / 2, 0, width / 2, height);
    return canvas.toDataURL(format === "exif" ? "image/jpeg" : format).split(",")[1] ?? "";
  }, options);
  const bytes = Buffer.from(encoded, "base64");
  if (options.format !== "exif") return bytes;
  const exif = Buffer.from([0xff,0xe1,0,34,69,120,105,102,0,0,77,77,0,42,0,0,0,8,0,1,1,18,0,3,0,0,0,1,0,6,0,0,0,0,0,0]);
  return Buffer.concat([bytes.subarray(0, 2), exif, bytes.subarray(2)]);
}
async function choosePalette(page: Page, options: PaletteOptions): Promise<void> {
  const buffer = await palette(page, options); await page.getByLabel("Choose a picture", { exact: true }).setInputFiles({ name: "picture." + (options.format === "image/webp" ? "webp" : options.format ? "jpg" : "png"), mimeType: options.format === "exif" ? "image/jpeg" : options.format ?? "image/png", buffer });
  await expect(page.getByRole("group", { name: "Move the crop square" })).toBeVisible();
}
async function savedPixel(page: Page, position: { x: number; y: number } = { x: 0.5, y: 0.5 }): Promise<number[]> {
  return await page.locator('[aria-label="Current profile picture"] img').evaluate(async (element, point) => {
    const image = element as HTMLImageElement; await image.decode(); const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Missing browser canvas."); context.drawImage(image, 0, 0); return [...context.getImageData(Math.floor(canvas.width * point.x), Math.floor(canvas.height * point.y), 1, 1).data];
  }, position);
}
