import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { createAccessRequest, createRequestContext, createWorkspaceDatabase, save, saveHub,
  type AccessActor, type AccessRequest, type CoreError, type HubAccessBinding, type RequestContext } from "@xpro/core/server";
import { ok, type Result } from "true-myth/result";
import { http, HttpResponse } from "msw";
import { handleHubAuthRequest, type HubRequestSettings } from "../../apps/hub/src/auth/oidc.server";
import { startSignIn, finishSignIn } from "../../apps/web/src/auth/oidc.server";
import { receiveHubSignOut } from "../../apps/web/src/auth/sign-out.server";
import { createHubIdentities, type HubIdentities, type CreatedLogin, type SignedInLogin } from "./hub-identities";
import { network } from "./network";
import { createHubAuth } from "../../apps/hub/src/auth/auth.server";
import { createEnrolledMaster, currentMfaCode, mfaCookie, type MasterProfile, type MfaFixture } from "./master-mfa";

export const hubOrigin = "https://hub.example.test";
export const signInPassword = "Access-fixture123!";
export type { HubRequestSettings };
export type HubRequestHandler = (request: Request, settings: HubRequestSettings) => Promise<Response>;
export type Destination = { kind: "workspace"; workspaceId: string } | { kind: "account" | "stms" | "unassigned" };
export type DestinationServices = { database: D1Database; access: AccessRequest; context: RequestContext };
export type DestinationAction = (input: unknown, services: DestinationServices) => Promise<Result<Destination, CoreError>>;
export type WorkspaceFixture = {
  id: string; origin: string; clientId: string; clientSecret: string; secret: string;
  stub: ReturnType<typeof env.WORKSPACES.getByName>;
};
export type WorkspaceServices = {
  workspaceId: string; origin: string; issuer: string; clientId: string; clientSecret: string; secret: string;
  hub: { fetch(request: Request): Promise<Response> }; hubAccess: HubAccessBinding;
  storage: DurableObjectStorage; context: RequestContext;
};
export type WorkspaceHandler = (request: Request, services: WorkspaceServices) => Promise<Response>;
export type CurrentUserAction = (request: Request, services: WorkspaceServices) => Promise<Result<AccessActor, CoreError>>;
export type SignInFixture = {
  identities: HubIdentities; settings: HubRequestSettings;
  prepareWorkspace(input?: { loginId?: string; kind?: "internal" | "external"; origin?: string; aliases?: string[]; backchannel?: boolean }): Promise<WorkspaceFixture>;
  signIn(login: CreatedLogin, handle: HubRequestHandler): Promise<SignedInLogin>;
  signInMaster(input?: MasterProfile): Promise<SignedInLogin>;
};

export async function createSignInFixture(database: D1Database): Promise<SignInFixture> {
  const identities = await createHubIdentities(database);
  const secret = identities.auth.options.secret;
  if (typeof secret !== "string") throw new Error("The native fixture's secret is required.");
  const settings: HubRequestSettings = {
    database, baseURL: hubOrigin, secret, turnstileSecret: "fixture-turnstile-secret",
    // Only the outside platform response is a stand-in; no auth or counting logic is replaced.
    rateLimiter: { async limit() { return { success: true }; } },
  };
  network.use(http.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", () =>
    HttpResponse.json({ success: true, hostname: "hub.example.test", action: "sign-in" })));
  // The provider's native end-session code fetches its own public JWKS through HTTP.
  // Bridge that transport to the real Hub handler; no authentication is substituted.
  network.use(http.get(hubOrigin + "/api/auth/jwks", async ({ request }) =>
    await handleHubAuthRequest(new Request(request.url, { headers: request.headers }), settings)));
  let setupMaster: Promise<SignedInLogin> | undefined;
  async function prepareMfa(): Promise<MfaFixture> {
    const auth = await createHubAuth({ database, baseURL: hubOrigin, secret, rateLimiter: settings.rateLimiter });
    await auth.$context;
    return { identities, auth, password: signInPassword, origin: hubOrigin, rateLimiter: settings.rateLimiter };
  }
  async function signInMaster(input: MasterProfile = {}): Promise<SignedInLogin> {
    return await createEnrolledMaster(await prepareMfa(), input);
  }
  return {
    identities, settings, signInMaster,
    async prepareWorkspace(input = {}) {
      setupMaster ??= signInMaster();
      const master = await setupMaster;
      const owner = await identities.createLogin();
      const organization = await identities.auth.api.createOrganization({ body: {
        name: "Prepared workspace", slug: `sign-in-${crypto.randomUUID()}`, userId: owner.loginId,
      } });
      if (!organization) throw new Error("The native API did not create the prepared workspace.");
      const origin = input.origin ?? `https://w-${organization.id}.example.test`;
      const client = await identities.auth.api.adminCreateOAuthClient({ headers: { cookie: master.cookie }, body: {
        client_name: "Prepared workspace", redirect_uris: [origin, ...(input.aliases ?? [])].map((address) => address + "/auth/callback"),
        token_endpoint_auth_method: "client_secret_basic", grant_types: ["authorization_code"], response_types: ["code"],
        scope: "openid profile email", require_pkce: true, skip_consent: true,
        // The native provider emits sid only when end-session support is enabled.
        enable_end_session: true, client_secret_expires_at: 0,
        ...(input.backchannel ? { backchannel_logout_uri: origin + "/auth/back-channel-sign-out", backchannel_logout_session_required: true } : {}),
      } });
      if (typeof client.client_secret !== "string") throw new Error("The native API did not issue a confidential client secret.");
      const workspace: WorkspaceFixture = { id: organization.id, origin,
        clientId: client.client_id, clientSecret: client.client_secret, secret: `workspace-fixture-${crypto.randomUUID()}`,
        stub: env.WORKSPACES.getByName(organization.id) };
      const loginId = input.loginId;
      if (loginId) {
        await identities.auth.api.addMember({ body: { userId: loginId, organizationId: workspace.id, role: "member" } });
        await withWorkspace(workspace, async ({ db, storage }) => {
          await save(storage, async () => {
            await db.insertInto("workspaceUsers").values({ id: crypto.randomUUID(), loginId,
              kind: input.kind ?? "internal", createdAt: new Date().toISOString(), archivedAt: null }).execute();
            return ok(workspace.id);
          });
        });
      }
      return workspace;
    },
    async signIn(login, handle) {
      let response = await handle(hubRequest("/api/auth/sign-in/email", { email: login.email, password: signInPassword }), settings);
      if (response.status !== 200) throw new Error(`Application sign-in was refused (${response.status}).`);
      let cookie = mfaCookie(response);
      let session = await identities.auth.api.getSession({ headers: { cookie }, query: { disableCookieCache: true } });
      const body: unknown = await response.clone().json();
      const hasChallenge = body && typeof body === "object" && "twoFactorRedirect" in body && body.twoFactorRedirect === true;
      const needsEnrollment = session?.user.role?.split(",").includes("admin") && !session.user.twoFactorEnabled;
      if (hasChallenge || needsEnrollment) {
        const mfa = await prepareMfa();
        if (needsEnrollment) {
          const setup = await mfa.auth.api.enableTwoFactor({ headers: { cookie }, body: { password: signInPassword }, asResponse: true });
          if (!setup.ok) throw new Error("Application fixture enrollment was refused.");
        }
        response = await handle(hubRequest("/api/auth/two-factor/verify-totp", { code: await currentMfaCode(mfa, login.loginId) }, cookie), settings);
        if (!response.ok) throw new Error(`Application MFA was refused (${response.status}).`);
        cookie = mfaCookie(response);
        session = await identities.auth.api.getSession({ headers: { cookie }, query: { disableCookieCache: true } });
      }
      if (!session || session.user.id !== login.loginId) throw new Error("Application sign-in did not issue the correct native session.");
      return { ...login, cookie, hubSessionId: session.session.id };
    },
  };
}

export function hubRequest(path: string, body: unknown, cookie?: string): Request {
  return new Request(hubOrigin + path, { method: "POST", headers: {
    origin: hubOrigin, "content-type": "application/json", "x-captcha-response": `fixture-turnstile-${crypto.randomUUID()}`,
    ...(cookie ? { cookie } : {}),
  }, body: JSON.stringify(body) });
}

export function readCookies(response: Response): string {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

export async function prepareDestination(login: SignedInLogin | null): Promise<DestinationServices> {
  const context = createRequestContext();
  const access = await createAccessRequest({ app: "hub", session: login, workspaceId: null, context, hub: env.HUB_ACCESS });
  return { database: env.DB, access, context };
}

type WorkspaceDatabase = ReturnType<typeof createWorkspaceDatabase>;
export async function withWorkspace<Value>(
  workspace: WorkspaceFixture, run: (context: { db: WorkspaceDatabase; storage: DurableObjectStorage }) => Promise<Value>,
): Promise<Value> {
  return await runInDurableObject(workspace.stub, async (_instance, state) => {
    const db = createWorkspaceDatabase(state.storage.sql);
    try { return await run({ db, storage: state.storage }); }
    finally { await db.destroy(); }
  });
}

export function workspaceServices(
  input: { fixture: SignInFixture; workspace: WorkspaceFixture; storage: DurableObjectStorage },
  handle: HubRequestHandler,
): WorkspaceServices {
  const { fixture, workspace, storage } = input;
  return { workspaceId: workspace.id, origin: workspace.origin, issuer: hubOrigin + "/api/auth",
    clientId: workspace.clientId, clientSecret: workspace.clientSecret, secret: workspace.secret,
    hub: { async fetch(request) { return await handle(request, fixture.settings); } },
    hubAccess: env.HUB_ACCESS, storage, context: createRequestContext() };
}

export async function readHubState(identities: HubIdentities) {
  return {
    users: await identities.db.selectFrom("user").selectAll().orderBy("id").execute(),
    credentials: await identities.db.selectFrom("account").selectAll().orderBy("id").execute(),
    sessions: await identities.db.selectFrom("session").selectAll().orderBy("id").execute(),
    accounts: await identities.db.selectFrom("accounts").selectAll().orderBy("id").execute(),
    workspaces: await identities.db.selectFrom("organization").selectAll().orderBy("id").execute(),
    members: await identities.db.selectFrom("member").selectAll().orderBy("id").execute(),
    reservations: await identities.db.selectFrom("reservedUsernames").selectAll().orderBy("id").execute(),
    creations: await identities.db.selectFrom("loginCreations").selectAll().orderBy("id").execute(),
    audits: await identities.db.selectFrom("auditEntries").selectAll().orderBy("id").execute(),
  };
}

export async function readWorkspaceState(workspace: WorkspaceFixture) {
  return await withWorkspace(workspace, async ({ db }) => ({
    users: await db.selectFrom("workspaceUsers").selectAll().orderBy("id").execute(),
    sessions: await db.selectFrom("sessions").selectAll().orderBy("id").execute(),
    audits: await db.selectFrom("auditEntries").selectAll().orderBy("id").execute(),
  }));
}

export async function removeMembership(input: { identities: HubIdentities; loginId: string; workspaceId: string }): Promise<void> {
  // Prepared membership changes use the real shared save path.
  await saveHub(env.DB, [input.identities.db.withoutPlugins().deleteFrom("member").where("userId", "=", input.loginId)
    .where("organizationId", "=", input.workspaceId).compile()]);
}

export async function signInAtWorkspace(input: { fixture: SignInFixture; workspace: WorkspaceFixture; login: SignedInLogin }): Promise<
  { response: Response; cookie: string; callback: Request }> {
  return await withWorkspace(input.workspace, async ({ storage }) => {
    const services = workspaceServices({ ...input, storage }, handleHubAuthRequest);
    const started = await startSignIn(new Request(input.workspace.origin + "/auth/start"), services);
    const authorization = started.headers.get("location");
    if (!authorization) throw new Error("The workspace did not start authorization.");
    const authorized = await handleHubAuthRequest(new Request(authorization, { headers: { cookie: input.login.cookie } }), input.fixture.settings);
    const callback = authorized.headers.get("location");
    if (!callback) throw new Error("The Hub did not return the workspace callback.");
    const request = new Request(callback, { headers: { cookie: readCookies(started) } });
    const response = await finishSignIn(request, services);
    return { response, cookie: readCookies(response), callback: request };
  });
}

export async function deliverWorkspaceLogout(input: {
  fixture: SignInFixture; workspace: WorkspaceFixture;
  message: { url: string; method: string; headers: [string, string][]; body: string };
}): Promise<Response> {
  return await withWorkspace(input.workspace, async ({ storage }) => await receiveHubSignOut(new Request(input.message.url, {
    method: input.message.method, headers: input.message.headers, body: input.message.body,
  }), workspaceServices({ ...input, storage }, handleHubAuthRequest)));
}
