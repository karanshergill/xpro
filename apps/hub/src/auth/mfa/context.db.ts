import {
  defineRequestState, getCurrentAuthEndpointContext, getCurrentRequestState, hasRequestState, tryGetCurrentAuthEndpointContext,
} from "@better-auth/core/context";
import { APIError, type getAuthoritativeSessionFromCtx } from "better-auth/api";
import { readLoginByIdentifier } from "#auth/sign-in.db.ts";
import type { MfaOperation } from "./phases.db";

export const MFA_SETUP_ID_HEADER = "x-mfa-setup-id";

export type AuthSource =
  | { kind: "credential"; loginId: string; revision: number }
  | { kind: "mfa"; operation: MfaOperation };

// Native calls can share request state; each endpoint still owns its own source.
const sources = defineRequestState(() => new WeakMap<object, AuthSource>());

export async function captureAuthSource(ctx: Parameters<typeof getAuthoritativeSessionFromCtx>[0], database: D1Database): Promise<void> {
  const key = getCurrentAuthEndpointContext().context, entries = await readSources();
  entries.delete(key);
  if (ctx.path === "/sign-in/email" || ctx.path === "/sign-in/username") {
    const field = ctx.path === "/sign-in/email" ? "email" : "username";
    const identifier = ctx.body?.[field];
    if (typeof identifier !== "string") return;
    const user = await readLoginByIdentifier(database, { method: field, identifier: identifier.trim().toLowerCase() });
    if (user && isRevision(user.authRevision)) {
      entries.set(key, { kind: "credential", loginId: user.id, revision: user.authRevision });
    }
  }
}

export async function readAuthSource(): Promise<AuthSource | null> {
  const ctx = tryGetCurrentAuthEndpointContext();
  return ctx && await hasRequestState() ? (await readSources()).get(ctx.context) ?? null : null;
}

export async function setMfaOperation(operation: MfaOperation): Promise<void> {
  (await readSources()).set(getCurrentAuthEndpointContext().context, { kind: "mfa", operation });
}

export async function readMfaOperation(): Promise<MfaOperation | null> {
  const source = await readAuthSource();
  return source?.kind === "mfa" ? source.operation : null;
}

export function refuseMfaWrite(): never {
  throw new APIError("CONFLICT", { code: "core_unauthenticated", message: "Start sign-in again." });
}

async function readSources(): Promise<WeakMap<object, AuthSource>> {
  const state = await getCurrentRequestState();
  // Native lazy initialization awaits before publishing its value. Publish this
  // map synchronously so concurrent endpoints sharing state cannot replace it.
  if (!state.has(sources.ref)) state.set(sources.ref, new WeakMap<object, AuthSource>());
  return await sources.get();
}

function isRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
