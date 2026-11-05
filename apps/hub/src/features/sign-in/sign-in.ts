import { object, optional, pipe, safeParse, string, uuid } from "valibot";
import { m } from "#paraglide/messages.js";
import { readDirectDestination } from "#features/complete-profile/destination.ts";

export type SignInValues = { identifier: string; password: string };
export type SignInFailure = { code: string; requestId?: string };
export type SignInPage = { status: "ready"; siteKey: string } | { status: "error"; error: SignInFailure };
export type SignInResult = { status: "mfa-pending" } | { status: "signed-in"; destination: string } | { status: "error"; error: SignInFailure };
export type SecurityCheck = { status: "loading" | "failed"; token: null } | { status: "ready"; token: string };
const failureSchema = object({ code: string(), requestId: optional(pipe(string(), uuid())) });

export function readSignInFailure(input: unknown): SignInFailure {
  const parsed = safeParse(failureSchema, input);
  return parsed.success ? parsed.output : { code: "core_unexpected_error" };
}

export function getSignInMessage(failure: SignInFailure): string {
  switch (failure.code) {
    case "accounts_credentials_invalid":
    case "core_invalid_input": return m.accounts_sign_in_credentials_invalid();
    case "accounts_login_suspended": return m.accounts_sign_in_suspended();
    case "accounts_login_archived": return m.accounts_sign_in_archived();
    case "accounts_sign_in_limited": return m.accounts_sign_in_limited();
    case "accounts_bot_verification_failed": return m.accounts_sign_in_security_failed();
    case "core_creation_incomplete": return m.core_creation_incomplete();
    case "core_sign_in_invalid": return m.accounts_sign_in_link_invalid();
    default: return m.core_error_message();
  }
}

export function getCredentialMethod(identifier: string): { email: string } | { username: string } {
  const normalized = identifier.trim().toLowerCase();
  return normalized.includes("@") ? { email: normalized } : { username: normalized };
}

export function readSignInDestination(input: unknown, { origin, search = "" }: { origin: string; search?: string }): string | null {
  const parsed = safeParse(object({ url: optional(string()) }), input);
  if (!parsed.success) return null;
  if (parsed.output.url === undefined) {
    const query = new URLSearchParams(search);
    if (query.has("sig") || query.has("ba_param")) return origin + "/complete-profile" + search;
    const destination = readDirectDestination(search);
    return destination ? origin + destination : null;
  }
  try {
    const target = new URL(parsed.output.url, origin);
    return target.protocol === "https:" && !target.username && !target.password ? target.href : null;
  } catch { return null; }
}
