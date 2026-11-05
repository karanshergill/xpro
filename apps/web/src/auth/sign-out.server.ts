import { clearWorkspaceSessionCookie, createErrorResponse, endWorkspaceSessions, readFormInput, readWorkspaceSession,
  reportUnexpectedError, requestIdHeader, type SessionServices } from "@xpro/core/server";
import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet } from "jose";
import * as oauth from "oauth4webapi";
import { err, ok, type Result } from "true-myth/result";
import { array, looseObject, maxLength, minLength, object, optional, pipe, safeParse, strictObject, string, uuid } from "valibot";
import { discoverProvider, type SignInServices } from "./oidc.server";

type SignOutServices = SignInServices & SessionServices;
const hubRequestTimeoutMs = 10_000;
const logoutTokenMaximumAgeSeconds = 120;
const logoutEvent = "http://schemas.openid.net/event/backchannel-logout";
const logoutSchema = object({ sid: pipe(string(), uuid()), sub: optional(pipe(string(), uuid())),
  jti: pipe(string(), minLength(1), maxLength(128)), events: object({ [logoutEvent]: strictObject({}) }) });
const jwksSchema = object({ keys: array(looseObject({ kty: string() })) });

export async function signOut(request: Request, services: SignOutServices): Promise<Response> {
  const current = new URL(request.url);
  if (request.method !== "POST" || current.origin + current.pathname !== services.origin + "/auth/sign-out"
    || request.headers.get("origin") !== services.origin) return createErrorResponse({ code: "core_forbidden" }, services.context);
  try {
    const local = await readWorkspaceSession(request, services);
    if (local) {
      const { server } = await discoverProvider(services);
      if (!server.end_session_endpoint) throw new Error("The Hub does not support end-session.");
      const endpoint = new URL(server.end_session_endpoint);
      if (endpoint.href !== services.issuer + "/oauth2/end-session") throw new Error("The Hub end-session endpoint changed.");
      const response = await services.hub.fetch(new Request(endpoint, { method: "POST", redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ client_id: services.clientId, id_token_hint: local.idToken }),
        signal: AbortSignal.timeout(hubRequestTimeoutMs) }));
      if (!response.ok) throw new Error("The Hub did not complete sign-out.");
      await endWorkspaceSessions(services.storage, { hubSessionId: local.session.hubSessionId, loginId: local.session.loginId });
    }
    return new Response(null, { status: 200, headers: { "set-cookie": clearWorkspaceSessionCookie(),
      "cache-control": "no-store", [requestIdHeader]: services.context.requestId } });
  } catch { return reportUnexpectedError(services.context, { app: "workspace", operation: "accounts_sign_out" }); }
}

export async function receiveHubSignOut(request: Request, services: SignOutServices): Promise<Response> {
  const current = new URL(request.url);
  if (request.method !== "POST" || current.origin + current.pathname !== services.origin + "/auth/back-channel-sign-out") {
    return createErrorResponse({ code: "core_forbidden" }, services.context);
  }
  const form = await readFormInput(request, { logout_token: pipe(string(), minLength(1)) });
  if (form.isErr) return createErrorResponse(form.error, services.context);
  try {
    const { server, options } = await discoverProvider(services);
    if (!server.jwks_uri) throw new Error("The Hub has no signing-key endpoint.");
    const response = await options[oauth.customFetch](server.jwks_uri, { method: "GET", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("The Hub did not return its signing keys.");
    const jwks = safeParse(jwksSchema, await response.json());
    if (!jwks.success) throw new Error("The Hub returned invalid signing keys.");
    const logout = await validateHubSignOutToken(form.value.logout_token, { issuer: services.issuer, clientId: services.clientId, jwks: jwks.output });
    if (logout.isErr) return createErrorResponse(logout.error, services.context);
    await endWorkspaceSessions(services.storage, logout.value);
    // Repeats remove the same ended session set; no replay table or extra audit is needed.
    return new Response(null, { status: 200, headers: { "cache-control": "no-store", [requestIdHeader]: services.context.requestId } });
  } catch { return reportUnexpectedError(services.context, { app: "workspace", operation: "accounts_receive_hub_sign_out" }); }
}

export async function validateHubSignOutToken(token: string,
  settings: { issuer: string; clientId: string; jwks: JSONWebKeySet }): Promise<Result<
    { hubSessionId: string; loginId: string | null }, { code: "core_sign_in_invalid" }>> {
  try {
    const { payload } = await jwtVerify(token, createLocalJWKSet(settings.jwks), {
      issuer: settings.issuer, audience: settings.clientId, algorithms: ["EdDSA"], typ: "logout+jwt",
      requiredClaims: ["exp", "iat", "jti", "sid", "events"], maxTokenAge: logoutTokenMaximumAgeSeconds,
    });
    const logout = safeParse(logoutSchema, payload);
    return logout.success && !("nonce" in payload)
      ? ok({ hubSessionId: logout.output.sid, loginId: logout.output.sub ?? null }) : err({ code: "core_sign_in_invalid" });
  } catch (error) {
    if (error instanceof errors.JOSEError) return err({ code: "core_sign_in_invalid" });
    throw error;
  }
}
