import { createHubAuth } from "../../apps/hub/src/auth/auth.server.ts";
import { createHubDatabase, createHubMigrator } from "../../apps/hub/src/db/hub.db.ts";
import { signInAtHub } from "./hub-auth";

type HubAuth = Awaited<ReturnType<typeof createHubAuth>>;
type HubDatabase = Awaited<ReturnType<typeof createHubDatabase>>;
type LoginInput = { role?: "user" | "admin"; username?: string | null; name?: string; phone?: string | null };
export type CreatedLogin = { loginId: string; email: string };
export type SignedInLogin = CreatedLogin & { hubSessionId: string; cookie: string };
export type HubIdentities = {
  auth: HubAuth;
  db: HubDatabase;
  createLogin(input?: LoginInput): Promise<CreatedLogin>;
  signIn(input?: LoginInput): Promise<SignedInLogin>;
  signInAgain(login: CreatedLogin): Promise<SignedInLogin>;
};

export async function createHubIdentities(database: D1Database): Promise<HubIdentities> {
  const db = await createHubDatabase(database);
  try {
    const migration = await createHubMigrator(db).migrateToLatest();
    if (migration.error) throw migration.error;
    const origin = "https://hub.example.test";
    const password = "Access-fixture123!";
    const auth = await createHubAuth({ database, baseURL: origin, secret: `access-fixture-${crypto.randomUUID()}` });
    // Finish native startup I/O before a test can reset its database.
    const authContext = await auth.$context;
    await authContext.checkSchema?.();
    async function signInExisting(login: CreatedLogin): Promise<SignedInLogin> {
      const cookie = await signInAtHub({ handle: auth.handler, origin, email: login.email, password });
      const signedIn = await auth.api.getSession({ headers: { cookie } });
      if (!signedIn || signedIn.user.id !== login.loginId) throw new Error("The access fixture did not sign in its created login.");
      return { loginId: login.loginId, email: login.email, hubSessionId: signedIn.session.id, cookie };
    }
    async function createLogin(input: LoginInput = {}): Promise<CreatedLogin> {
      const email = `access-${crypto.randomUUID()}@example.test`;
      const username = input.username === undefined ? `u${crypto.randomUUID().replaceAll("-", "").slice(0, 7)}` : input.username;
      const { user } = await auth.api.createUser({ body: {
        email, password, name: input.name ?? "Access fixture", role: input.role ?? "user",
        data: { username, phone: input.phone === undefined ? "+12025550123" : input.phone },
      } });
      return { loginId: user.id, email };
    }
    return {
      auth, db, createLogin,
      signInAgain: signInExisting,
      async signIn(input = {}) { return await signInExisting(await createLogin(input)); },
    };
  } catch (error) {
    await db.destroy();
    throw error;
  }
}
