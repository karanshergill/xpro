import { env } from "cloudflare:workers";
import { pausedPicturePolicy } from "@xpro/accounts";
import { createMfaFixture, createEnrolledMaster, type MfaFixture } from "#test/master-mfa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleProfilePage, validateProfilePage } from "./profile-page.server";

let fixture: MfaFixture;
beforeEach(async () => { fixture = await createMfaFixture(env.DB); });
afterEach(async () => { vi.useRealTimers(); await fixture.identities.db.destroy(); });

describe("profile MFA presentation", () => {
  it.each([0, 300_000, 300_001, "ordinary"] as const)("when current verification age is %s then profile exposes only safe management readiness without changing authentication", async (age) => {
    const login = age === "ordinary" ? await fixture.identities.signIn() : await createEnrolledMaster(fixture);
    if (age !== "ordinary") {
      const session = await fixture.identities.db.selectFrom("session").select("mfaVerifiedAt").where("id", "=", login.hubSessionId).executeTakeFirstOrThrow();
      if (!session.mfaVerifiedAt) throw new Error("Missing actual completed MFA.");
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(session.mfaVerifiedAt) + age);
    }
    const before = await state(), own = await fixture.identities.db.selectFrom("user").selectAll().where("id", "=", login.loginId).executeTakeFirstOrThrow();
    for (const method of ["GET", "POST", "GET"]) {
      const response = await handleProfilePage(validateProfilePage({}), { request: new Request(fixture.origin + "/profile", { method,
        headers: { cookie: login.cookie, ...(method === "POST" ? { origin: fixture.origin } : {}) } }),
        settings: { database: env.DB, baseURL: fixture.origin, secret: fixture.auth.options.secret } });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ loginId: login.loginId, email: own.email, username: own.username, name: own.name, phone: own.phone,
        pictureRevision: null, picturePolicy: pausedPicturePolicy, mfa: age === "ordinary" ? "unavailable" : age > 300_000 ? "recent_required" : "ready" });
      expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(await state()).toEqual(before);
  });
});

async function state() {
  const db = fixture.identities.db;
  return { users: await db.selectFrom("user").selectAll().orderBy("id").execute(), sessions: await db.selectFrom("session").selectAll().orderBy("id").execute(),
    factors: await db.withoutPlugins().selectFrom("twoFactor").selectAll().orderBy("id").execute(),
    challenges: await db.selectFrom("verification").selectAll().orderBy("id").execute(), audits: await db.selectFrom("auditEntries").selectAll().orderBy("id").execute() };
}
