import type { Page } from "@playwright/test";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { createHubAuth } from "../../apps/hub/src/auth/auth.server";
import { createHubDatabase } from "../../apps/hub/src/db/hub.db";
import { currentMfaCode, enrollMaster, mfaCookie } from "../support/master-mfa";
import { browserOrigins } from "./addresses";

type FixtureHub = { auth: Awaited<ReturnType<typeof createHubAuth>>; db: Awaited<ReturnType<typeof createHubDatabase>>; masterCookie: string };

type BrowserLogin = { loginId: string; email: string; username: string; cookie: string };

// Trusted setup and read-back only. Browser authentication and actions use the actual apps.
export async function withBrowserHub<Value>(run: (hub: FixtureHub) => Promise<Value>): Promise<Value> {
  const root = process.env.XPRO_BROWSER_ROOT, base = process.env.XPRO_BROWSER_TEMP;
  if (!root || !base || !basename(base).startsWith("xpro-browser-") || dirname(await realpath(root)) !== base
    || JSON.parse(await readFile(join(base, "guard.json"), "utf8")).root !== root) throw new Error("Use the isolated browser runner.");
  const fixtures: { logins: { master: { cookie: string } } } = JSON.parse(await readFile(join(base, "fixtures.json"), "utf8"));
  const proxy = await getPlatformProxy<{ DB: D1Database; BETTER_AUTH_URL: string; BETTER_AUTH_SECRET: string; SIGN_IN_RATE_LIMITER: RateLimit }>({
    configPath: join(root, "apps/hub/wrangler.jsonc"), environment: "local",
    persist: { path: join(root, "apps/hub/.wrangler/state/v3") }, remoteBindings: false,
  });
  try {
    if (proxy.env.BETTER_AUTH_URL !== browserOrigins.hub) throw new Error("Browser fixtures require their local Hub.");
    const db = await createHubDatabase(proxy.env.DB);
    try {
      const auth = await createHubAuth({ database: proxy.env.DB, baseURL: proxy.env.BETTER_AUTH_URL,
        secret: proxy.env.BETTER_AUTH_SECRET, rateLimiter: proxy.env.SIGN_IN_RATE_LIMITER });
      const context = await auth.$context;
      // Native schema validation starts during initialization and needs the live proxy.
      await context.checkSchema?.();
      return await run({ db, masterCookie: fixtures.logins.master.cookie, auth });
    }
    finally { await db.destroy(); }
  } finally { await proxy.dispose(); }
}

export async function createMfaClockFixture(age: number): Promise<{
  login: BrowserLogin; deadline: number;
}> {
  return await withBrowserHub(async ({ auth, db }) => {
    return await withFixtureClock(age, async () => {
      const email = "mfa-clock-" + crypto.randomUUID() + "@example.test", username = "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7);
      const password = "Browser-fixture123!";
      const { user } = await auth.api.createUser({ body: { email, password, name: "Clock fixture", role: "admin", data: { username, phone: "+12025550123" } } });
      const credential = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
      if (!credential.ok) throw new Error("Native clock-fixture credentials failed.");
      const enrolled = await enrollMaster({ auth, identities: { db }, password }, { loginId: user.id, email, cookie: mfaCookie(credential) });
      const session = await db.selectFrom("session").select("mfaVerifiedAt").where("id", "=", enrolled.hubSessionId).executeTakeFirstOrThrow();
      if (!session.mfaVerifiedAt) throw new Error("Missing actual clock-fixture MFA time.");
      return { login: { loginId: user.id, email, username, cookie: enrolled.cookie }, deadline: Date.parse(session.mfaVerifiedAt) + 300_001 };
    });
  });
}

export async function readBrowserMfaCode(loginId: string): Promise<string> {
  return await withBrowserHub(async ({ auth, db }) => await currentMfaCode({ auth, identities: { db } }, loginId));
}

export async function readExpiredBrowserMfaCode(loginId: string): Promise<string> {
  return await withBrowserHub(async ({ auth, db }) => {
    const readCode = async (): Promise<string> => await currentMfaCode({ auth, identities: { db } }, loginId);
    const accepted = new Set<string>();
    for (const offset of [-30_000, 0, 30_000]) accepted.add(await withFixtureClock(offset, readCode));
    for (const age of [90_000, 120_000, 150_000]) {
      const code = await withFixtureClock(age, readCode);
      if (!accepted.has(code)) return code;
    }
    throw new Error("Could not prepare an authentic out-of-window code.");
  });
}

export async function createExpiredMfaChallenge(): Promise<BrowserLogin> {
  const age = 86_400_000, { login } = await createMfaClockFixture(age);
  return await withBrowserHub(async ({ auth, db }) => {
    const response = await withFixtureClock(age, async () => await auth.api.signInEmail({ body: { email: login.email, password: "Browser-fixture123!" }, asResponse: true }));
    const body: unknown = await response.json();
    if (!response.ok || !body || typeof body !== "object" || !("twoFactorRedirect" in body) || body.twoFactorRedirect !== true) throw new Error("Missing actual native challenge.");
    const challenge = await db.selectFrom("verification").select("expiresAt").where("value", "=", login.loginId).where("authRevision", "is not", null).executeTakeFirstOrThrow();
    if (Date.parse(challenge.expiresAt) > Date.now()) throw new Error("Fixture challenge has not expired.");
    return { ...login, cookie: mfaCookie(response) };
  });
}

async function withFixtureClock<Value>(age: number, run: () => Promise<Value>): Promise<Value> {
  const realDate = globalThis.Date;
  // Only native fixture preparation moves in time; app Workers keep their real
  // clocks. No session proof, challenge expiry or factor state is edited.
  globalThis.Date = new Proxy(realDate, {
    construct(target, argumentsList) { return Reflect.construct(target, argumentsList.length ? argumentsList : [target.now() - age]); },
    get(target, key, receiver) { return key === "now" ? () => target.now() - age : Reflect.get(target, key, receiver); },
  });
  try { return await run(); } finally { globalThis.Date = realDate; }
}

export async function verifyBrowserMfa(page: Page, loginId: string): Promise<void> {
  const code = await readBrowserMfaCode(loginId);
  const status = await page.evaluate(async (code) => (await fetch("/api/auth/two-factor/verify-totp", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }),
  })).status, code);
  if (status !== 200) throw new Error("Actual native MFA fixture verification failed: " + status);
}
