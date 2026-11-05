import { createAccessRequest, createErrorResponse, createPrivateCookie, readPrivateCookie, clearPrivateCookie,
  createWorkspaceSession, reportUnexpectedError, requestIdHeader, type SessionServices,
  type AccessSession, type CoreError, type RequestContext } from "@xpro/core/server";
import * as oauth from "oauth4webapi";
import { err, ok, type Result } from "true-myth/result";
import { nullable, pipe, safeParse, strictObject, string, uuid } from "valibot";

export type SignInServices = {
  workspaceId: string; origin: string; issuer: string; clientId: string; clientSecret: string; secret: string;
  hub: { fetch(request: Request): Promise<Response> }; context: RequestContext;
};
export type VerifiedSignIn = AccessSession & { idToken: string; returnTo: string | null };
type Provider = { server: oauth.AuthorizationServer; client: oauth.Client;
  options: { [oauth.customFetch]: (url: string, init: RequestInit) => Promise<Response> } };
const pendingCookieName = "__Host-xpro-sign-in";
const transactionLifetimeSeconds = 10 * 60;
const hubRequestTimeoutMs = 10_000;
const maximumReturnPathLength = 1024;
const pendingSchema = strictObject({ state: string(), nonce: string(), verifier: string(), returnTo: nullable(string()) });
const identitySchema = strictObject({ loginId: pipe(string(), uuid()), hubSessionId: pipe(string(), uuid()), idToken: string(), returnTo: nullable(string()) });

export async function finishSignIn(request: Request, services: SignInServices & SessionServices): Promise<Response> {
  let response: Response;
  try { response = await finishCallback(request, services); }
  catch { response = reportUnexpectedError(services.context, { app: "workspace", operation: "accounts_finish_sign_in" }); }
  response.headers.append("set-cookie", clearPrivateCookie(pendingCookieName));
  return response;
}

async function finishCallback(request: Request, services: SignInServices & SessionServices): Promise<Response> {
  const verified = await validateSignInCallback(request, services);
  if (verified.isErr) return createErrorResponse(verified.error, services.context);
  const access = await createAccessRequest({ app: "workspace", session: verified.value, workspaceId: services.workspaceId,
    hub: services.hubAccess, context: services.context });
  const identity = access.authorize({ kind: "check_session" });
  if (identity.isErr) return createErrorResponse(identity.error, services.context);
  if (!identity.value.isMaster && identity.value.membershipRole === null) {
    return signInRedirect(new URL(services.issuer).origin + "/", services.context);
  }
  const session = await createWorkspaceSession({ ...verified.value, access }, services);
  if (session.isErr) return createErrorResponse(session.error, services.context);
  const destination = verified.value.returnTo ?? (session.value.kind === "external" ? "/portal" : "/");
  const response = signInRedirect(services.origin + destination, services.context);
  response.headers.append("set-cookie", session.value.cookie);
  return response;
}

function signInRedirect(location: string, context: RequestContext): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store", [requestIdHeader]: context.requestId } });
}

export async function startSignIn(request: Request, services: SignInServices): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== services.origin || url.pathname !== "/auth/start") {
      return createErrorResponse({ code: "core_sign_in_invalid" }, services.context);
    }
    const { server } = await discoverProvider(services);
    if (!server.authorization_endpoint || !server.code_challenge_methods_supported?.includes("S256")) {
      return createErrorResponse({ code: "core_sign_in_invalid" }, services.context);
    }
    const pending = { state: oauth.generateRandomState(), nonce: oauth.generateRandomNonce(),
      verifier: oauth.generateRandomCodeVerifier(), returnTo: safeReturnPath(url.searchParams.get("returnTo"), services.origin) };
    const destination = new URL(server.authorization_endpoint);
    assertHubEndpoint(destination, services.issuer);
    destination.search = new URLSearchParams({ client_id: services.clientId, redirect_uri: services.origin + "/auth/callback",
      response_type: "code", scope: "openid profile email", state: pending.state, nonce: pending.nonce,
      code_challenge_method: "S256", code_challenge: await oauth.calculatePKCECodeChallenge(pending.verifier) }).toString();
    // shortcut: one pending flow per browser/workspace; use separate transaction
    // cookies if simultaneous sign-in flows in multiple tabs become required.
    return new Response(null, { status: 302, headers: { location: destination.href,
      "set-cookie": await createPrivateCookie(pending, transactionCookie(services)),
      "cache-control": "no-store", [requestIdHeader]: services.context.requestId } });
  } catch { return reportUnexpectedError(services.context, { app: "workspace", operation: "accounts_start_sign_in" }); }
}

export async function validateSignInCallback(request: Request, services: SignInServices): Promise<Result<VerifiedSignIn, CoreError>> {
  try {
    const current = new URL(request.url);
    const callbackURL = services.origin + "/auth/callback";
    const hasExactCallback = request.method === "GET" && current.origin + current.pathname === callbackURL && !current.hash;
    const hasSingleParameters = ["state", "code", "iss"].every((name) => current.searchParams.getAll(name).length === 1 && current.searchParams.get(name));
    if (!hasExactCallback || !hasSingleParameters) return err({ code: "core_sign_in_invalid" });
    const pending = safeParse(pendingSchema, await readPrivateCookie(request, transactionCookie(services)));
    if (!pending.success) return err({ code: "core_sign_in_invalid" });
    const { server, client, options } = await discoverProvider(services);
    const parameters = oauth.validateAuthResponse(server, client, current, pending.output.state);
    const response = await oauth.authorizationCodeGrantRequest(server, client, oauth.ClientSecretBasic(services.clientSecret),
      parameters, callbackURL, pending.output.verifier, options);
    // The token is received only through the fixed Hub binding. oauth4webapi
    // validates its issuer, audience, times and nonce; this TLS-equivalent trusted
    // transport does not require an extra JWKS request for the ID-token signature.
    const tokens = await oauth.processAuthorizationCodeResponse(server, client, response, {
      expectedNonce: pending.output.nonce, requireIdToken: true,
    });
    const claims = oauth.getValidatedIdTokenClaims(tokens);
    const identity = safeParse(identitySchema, { loginId: claims?.sub, hubSessionId: claims?.sid,
      idToken: tokens.id_token, returnTo: pending.output.returnTo });
    return identity.success ? ok(identity.output) : err({ code: "core_sign_in_invalid" });
  } catch (error) {
    if (isProtocolFailure(error)) return err({ code: "core_sign_in_invalid" });
    reportUnexpectedError(services.context, { app: "workspace", operation: "accounts_validate_sign_in_callback" });
    return err({ code: "core_unexpected_error" });
  }
}

export async function discoverProvider(services: SignInServices): Promise<Provider> {
  const issuer = new URL(services.issuer);
  if (issuer.protocol !== "https:" || new URL(services.origin).origin !== services.origin || !services.origin.startsWith("https://")) {
    throw new Error("OpenID Connect requires fixed HTTPS origins.");
  }
  const options = { [oauth.customFetch]: async (url: string, init: RequestInit): Promise<Response> => {
    assertHubEndpoint(new URL(url), services.issuer);
    // workerd supports manual redirect handling, not Request redirect: error.
    const response = await services.hub.fetch(new Request(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(hubRequestTimeoutMs) }));
    if (response.status >= 300 && response.status < 400) throw new Error("Hub protocol endpoints must not redirect.");
    return response;
  } };
  const discovery = await oauth.discoveryRequest(issuer, options);
  const server = await oauth.processDiscoveryResponse(issuer, discovery);
  const client: oauth.Client = { client_id: services.clientId };
  return { server, client, options };
}

function assertHubEndpoint(url: URL, issuer: string): void {
  const expected = new URL(issuer);
  if (url.origin !== expected.origin || !url.pathname.startsWith(expected.pathname + "/") || url.username || url.password || url.hash) {
    throw new Error("OpenID Connect endpoint is outside the configured Hub.");
  }
}

function transactionCookie(services: SignInServices) {
  return { name: pendingCookieName, secret: services.secret, maxAge: transactionLifetimeSeconds,
    audience: JSON.stringify([services.workspaceId, services.origin, services.issuer, services.clientId]) };
}

function safeReturnPath(path: string | null, origin: string): string | null {
  if (!path || path.length > maximumReturnPathLength || !path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]|%5c|%0[ad]/i.test(path)) return null;
  const url = new URL(path, origin);
  return url.origin === origin && !url.pathname.startsWith("/auth/") ? url.pathname + url.search + url.hash : null;
}

function isProtocolFailure(error: unknown): boolean {
  return error instanceof oauth.OperationProcessingError || error instanceof oauth.AuthorizationResponseError
    || error instanceof oauth.ResponseBodyError || error instanceof oauth.WWWAuthenticateChallengeError;
}
