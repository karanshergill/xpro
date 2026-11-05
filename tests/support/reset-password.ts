import { env } from "cloudflare:workers";
import { createAccessRequest, createRequestContext, type AccessRequest, type RequestContext } from "@xpro/core/server";
import type { CreatedLogin, SignedInLogin } from "./hub-identities";
import { startSignIn, finishSignIn } from "../../apps/web/src/auth/oidc.server";
import { handleHubAuthRequest } from "./sign-in-actions";
import { currentMfaCode, mfaCookie } from "./master-mfa";
import { createSignInFixture, hubRequest, readCookies, readHubState, readWorkspaceState, type SignInFixture,
  withWorkspace, workspaceServices, type WorkspaceFixture } from "./sign-in";

export type ResetPasswordServices = {
  database: D1Database; access: AccessRequest; context: RequestContext;
  hashPassword(password: string): Promise<string>;
};
export type ResetFixture = {
  signIn: SignInFixture; master: SignedInLogin; target: SignedInLogin; other: SignedInLogin;
  devices: [SignedInLogin, SignedInLogin]; workspace: WorkspaceFixture; otherWorkspace: WorkspaceFixture;
};
type ResetState = {
  hub: Awaited<ReturnType<typeof readHubState>>;
  workspace: Awaited<ReturnType<typeof readWorkspaceState>>;
  otherWorkspace: Awaited<ReturnType<typeof readWorkspaceState>>;
};

export async function createResetFixture(): Promise<ResetFixture> {
  const signIn = await createSignInFixture(env.DB);
  try {
    const master = await signIn.signInMaster();
    const target = await signIn.identities.signIn();
    const other = await signIn.identities.signIn();
    const workspace = await signIn.prepareWorkspace({ loginId: target.loginId });
    const otherWorkspace = await signIn.prepareWorkspace({ loginId: other.loginId, kind: "external" });
    const second = await signIn.identities.signInAgain(target);
    return { signIn, master, target, other, devices: [target, second], workspace, otherWorkspace };
  } catch (error) { await signIn.identities.db.destroy(); throw error; }
}

export async function prepareResetServices(input: {
  fixture: ResetFixture; actor: SignedInLogin | null; database?: D1Database;
}): Promise<ResetPasswordServices> {
  const context = createRequestContext();
  const access = await createAccessRequest({ app: "hub", session: input.actor, workspaceId: null, hub: env.HUB_ACCESS, context });
  const native = await input.fixture.signIn.identities.auth.$context;
  return { database: input.database ?? env.DB, access, context,
    async hashPassword(password) { return await native.password.hash(password); } };
}

export async function readResetState(fixture: ResetFixture): Promise<ResetState> {
  const [hub, workspace, otherWorkspace] = await Promise.all([
    readHubState(fixture.signIn.identities), readWorkspaceState(fixture.workspace), readWorkspaceState(fixture.otherWorkspace),
  ]);
  return { hub, workspace, otherWorkspace };
}

export async function signInAfterReset(input: { fixture: ResetFixture; login: CreatedLogin; password: string }): Promise<
  { response: Response; login: SignedInLogin | null }> {
  let response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", {
    email: input.login.email, password: input.password,
  }), input.fixture.signIn.settings);
  if (!response.ok) return { response, login: null };
  const body: unknown = await response.clone().json();
  if (body && typeof body === "object" && "twoFactorRedirect" in body && body.twoFactorRedirect === true) {
    const identities = input.fixture.signIn.identities;
    response = await handleHubAuthRequest(hubRequest("/api/auth/two-factor/verify-totp", {
      code: await currentMfaCode({ auth: identities.auth, identities }, input.login.loginId),
    }, mfaCookie(response)), input.fixture.signIn.settings);
    if (!response.ok) return { response, login: null };
  }
  const cookie = readCookies(response);
  const session = await input.fixture.signIn.identities.auth.api.getSession({ headers: { cookie }, query: { disableCookieCache: true } });
  if (!session || session.user.id !== input.login.loginId) throw new Error("Reset fixture sign-in returned the wrong native identity.");
  return { response, login: { loginId: session.user.id, email: session.user.email, hubSessionId: session.session.id, cookie } };
}

export async function signInWithResetToken(input: {
  fixture: Pick<ResetFixture, "signIn">; workspace: WorkspaceFixture; login: SignedInLogin;
}): Promise<{ cookie: string; accessToken: string }> {
  return await withWorkspace(input.workspace, async ({ storage }) => {
    const original = workspaceServices({ fixture: input.fixture.signIn, workspace: input.workspace, storage }, handleHubAuthRequest);
    const issued: { accessToken?: string } = {};
    const services = { ...original, hub: { async fetch(request: Request) {
      // Observe only the private HTTP transport; the real provider still issues the token.
      const response = await original.hub.fetch(request);
      if (new URL(request.url).pathname === "/api/auth/oauth2/token") {
        const body: unknown = await response.clone().json();
        if (body && typeof body === "object" && "access_token" in body && typeof body.access_token === "string") {
          issued.accessToken = body.access_token;
        }
      }
      return response;
    } } };
    const started = await startSignIn(new Request(input.workspace.origin + "/auth/start"), services);
    const authorization = started.headers.get("location");
    if (!authorization) throw new Error("Reset token fixture did not start authorization.");
    const authorized = await handleHubAuthRequest(new Request(authorization, { headers: { cookie: input.login.cookie } }), input.fixture.signIn.settings);
    const callback = authorized.headers.get("location");
    if (!callback) throw new Error("Reset token fixture received no native callback.");
    const response = await finishSignIn(new Request(callback, { headers: { cookie: readCookies(started) } }), services);
    if (response.headers.get("location") !== input.workspace.origin + "/" && response.headers.get("location") !== input.workspace.origin + "/portal") {
      throw new Error("Reset token fixture did not enter its workspace.");
    }
    if (!issued.accessToken) throw new Error("Reset token fixture received no native access token.");
    return { cookie: readCookies(response), accessToken: issued.accessToken };
  });
}
