import { err, ok, type Result } from "true-myth/result";
import { pipe, safeParse, strictObject, string, uuid } from "valibot";
import { v7 } from "uuid";
import type { AccessActor, AccessRequest, AccessSession, HubAccessBinding } from "#access/access.ts";
import { createAccessRequest } from "#access/access.server.ts";
import { createPrivateCookie, readPrivateCookie, clearPrivateCookie } from "#cookies/private-cookie.server.ts";
import { reportUnexpectedError, type CoreError } from "#server/errors.server.ts";
import type { RequestContext } from "#server/request.ts";
import { readWorkspaceSessionRow, saveWorkspaceSession, type WorkspaceSession } from "./sessions.db";

export type SessionServices = {
  workspaceId: string; origin: string; issuer: string; clientId: string; secret: string;
  storage: DurableObjectStorage; hubAccess: HubAccessBinding; context: RequestContext;
};
const sessionCookieName = "__Host-xpro-session";
const maximumSessionSeconds = 30 * 24 * 60 * 60;
const cookieSchema = strictObject({ sessionId: pipe(string(), uuid()), idToken: string() });

export async function createWorkspaceSession(input: AccessSession & { idToken: string; access: AccessRequest },
  services: SessionServices): Promise<Result<{ cookie: string; kind: "internal" | "external" }, CoreError>> {
  const actor = input.access.authorize({ kind: "protected", hasLocalPermission: true });
  if (actor.isErr) return err(actor.error);
  const expiresAt = Math.min(Date.parse(input.access.sessionExpiresAt ?? ""), Date.now() + maximumSessionSeconds * 1000);
  const maxAge = Math.floor((expiresAt - Date.now()) / 1000);
  if (!(maxAge > 0)) return err({ code: "core_unauthenticated" });
  const session: WorkspaceSession = { id: v7(), loginId: input.loginId, hubSessionId: input.hubSessionId,
    expiresAt: new Date(expiresAt).toISOString() };
  // Prepare encryption before the save; a cookie-size or crypto failure cannot leave a saved session.
  const cookie = await createPrivateCookie({ sessionId: session.id, idToken: input.idToken }, sessionCookie(services, maxAge));
  const saved = await saveWorkspaceSession(services.storage, { session, access: input.access });
  return saved.isErr ? err(saved.error) : ok({ cookie, kind: saved.value });
}

export async function getCurrentUser(request: Request, services: SessionServices): Promise<Result<AccessActor, CoreError>> {
  try {
    const access = await createWorkspaceAccessRequest(request, services);
    return access.authorize({ kind: "check_session" });
  } catch {
    reportUnexpectedError(services.context, { app: "workspace", operation: "core_current_user" });
    return err({ code: "core_unexpected_error" });
  }
}

// Prepare once per request and share this access object with its protected actions.
export async function createWorkspaceAccessRequest(request: Request, services: SessionServices): Promise<AccessRequest> {
  const local = await readWorkspaceSession(request, services);
  return await createAccessRequest({ app: "workspace", session: local?.session ?? null, workspaceId: services.workspaceId,
    hub: services.hubAccess, context: services.context });
}

export async function readWorkspaceSession(request: Request, services: SessionServices): Promise<{ session: WorkspaceSession; idToken: string } | null> {
  if (new URL(request.url).origin !== services.origin) return null;
  const parsed = safeParse(cookieSchema, await readPrivateCookie(request, sessionCookie(services, maximumSessionSeconds)));
  if (!parsed.success) return null;
  const session = await readWorkspaceSessionRow(services.storage, parsed.output.sessionId);
  return session && Date.parse(session.expiresAt) > Date.now() ? { session, idToken: parsed.output.idToken } : null;
}

export function clearWorkspaceSessionCookie(): string {
  return clearPrivateCookie(sessionCookieName);
}

function sessionCookie(services: SessionServices, maxAge: number) {
  return { name: sessionCookieName, secret: services.secret, maxAge,
    audience: JSON.stringify([services.workspaceId, services.origin, services.issuer, services.clientId]) };
}
