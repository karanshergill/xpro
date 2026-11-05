import { pageLoginIdHeader } from "@xpro/core";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { array, object, nullable, minLength, optional, picklist, pipe, safeParse, string, uuid } from "valibot";
import { callHubFunction } from "#functions/call";
import { getMfaPage } from "#functions/mfa-page.functions.ts";
import { replaceMfaAuthenticator, startMfaSetup, replaceMfaBackupCodes } from "#functions/mfa.functions.ts";
import { readSignInDestination } from "#features/sign-in/sign-in";
import { readSetup, type MfaFailure, type MfaPage, type MfaResult, type BackupsResult } from "./mfa";

const pageSchema = object({ loginId: pipe(string(), uuid()), step: picklist(["setup", "pending", "verify", "complete"]), setupId: nullable(pipe(string(), minLength(1))), management: picklist(["unavailable", "ready", "recent_required"]) });
const setupSchema = object({ setupId: pipe(string(), minLength(1)), totpURI: string(), backupCodes: array(string()) });
const errorSchema = object({ code: string(), requestId: optional(pipe(string(), uuid())) });

export async function loadMfaPage(options: { loginId?: string; signal?: AbortSignal } = {}): Promise<MfaPage> {
  const response = await callHubFunction((fetch) => getMfaPage({ data: {}, fetch, signal: options.signal,
    headers: options.loginId ? { [pageLoginIdHeader]: options.loginId } : undefined }));
  if (!response.ok) return { status: "error", error: readFailure(await response.json()) };
  const page = safeParse(pageSchema, await response.json());
  if (!page.success) throw new Error("The MFA page returned an invalid result.");
  if (options.loginId && page.output.loginId !== options.loginId) return { status: "error", error: { code: "core_identity_changed" } };
  return { status: "ready", ...page.output };
}

export async function beginSetup(password: string, loginId: string): Promise<MfaResult> {
  return await readMaterial(await callHubFunction((fetch) => startMfaSetup({ data: { password }, headers: { [pageLoginIdHeader]: loginId }, fetch })));
}

export async function restartSetup(password: string, loginId: string): Promise<MfaResult> {
  return await readMaterial(await callHubFunction((fetch) => replaceMfaAuthenticator({ data: { password }, headers: { [pageLoginIdHeader]: loginId }, fetch })));
}

export async function generateBackups(password: string, loginId: string): Promise<BackupsResult> {
  const response = await callHubFunction((fetch) => replaceMfaBackupCodes({ data: { password }, headers: { [pageLoginIdHeader]: loginId }, fetch }));
  if (!response.ok) return { status: "error", error: readFailure(await response.json()) };
  const parsed = safeParse(object({ backupCodes: pipe(array(pipe(string(), minLength(1))), minLength(1)) }), await response.json());
  return parsed.success ? { status: "backups", backupCodes: parsed.output.backupCodes } : { status: "error", error: { code: "core_unexpected_error" } };
}

export async function verifyEnrollment(code: string, loginId: string): Promise<MfaResult> {
  // Enrollment keeps new backups visible until Continue; OAuth is resumed then.
  const auth = createAuthClient({ plugins: [twoFactorClient()], disableDefaultFetchPlugins: true });
  const result = await auth.twoFactor.verifyTotp({ code, fetchOptions: { headers: { [pageLoginIdHeader]: loginId }, retry: 0 } });
  return result.error ? { status: "error", error: readFailure(result.error) } : { status: "verified" };
}

export async function verifySignIn(input: { code: string; method: "totp" | "backup" }, loginId: string): Promise<MfaResult> {
  const auth = createAuthClient({ plugins: [twoFactorClient(), oauthProviderClient()], disableDefaultFetchPlugins: true });
  const options = { code: input.code, fetchOptions: { headers: { [pageLoginIdHeader]: loginId }, retry: 0 } };
  const result = input.method === "totp" ? await auth.twoFactor.verifyTotp(options) : await auth.twoFactor.verifyBackupCode(options);
  if (result.error) return { status: "error", error: readFailure(result.error) };
  const destination = readSignInDestination(result.data, { origin: window.location.origin, search: window.location.search });
  return destination ? { status: "verified", destination } : { status: "error", error: { code: "core_sign_in_invalid" } };
}

export async function signOutMfa(): Promise<void> {
  const auth = createAuthClient({ disableDefaultFetchPlugins: true });
  const result = await auth.signOut({ fetchOptions: { retry: 0 } });
  if (result.error) throw new Error("MFA sign-out did not succeed.");
  window.location.assign("/sign-in");
}

async function readMaterial(response: Response): Promise<MfaResult> {
  if (!response.ok) return { status: "error", error: readFailure(await response.json()) };
  const parsed = safeParse(setupSchema, await response.json()), material = parsed.success ? readSetup(parsed.output) : null;
  return material ? { status: "setup", material } : { status: "error", error: { code: "core_unexpected_error" } };
}

function readFailure(input: unknown): MfaFailure {
  const parsed = safeParse(errorSchema, input);
  return parsed.success ? parsed.output : { code: "core_unexpected_error" };
}
