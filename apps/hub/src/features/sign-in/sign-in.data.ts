import { createAuthClient } from "better-auth/client";
import { twoFactorClient, usernameClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { object, pipe, safeParse, string, minLength } from "valibot";
import { getSignInPage } from "#functions/sign-in-page.functions.ts";
import { getCredentialMethod, readSignInDestination, readSignInFailure, type SignInPage, type SignInResult, type SignInValues } from "./sign-in";

export async function loadSignInPage(signal?: AbortSignal): Promise<SignInPage> {
  const response = await getSignInPage({ data: {}, signal });
  if (!response.ok) return { status: "error", error: readSignInFailure(await response.json()) };
  const parsed = safeParse(object({ siteKey: pipe(string(), minLength(1)) }), await response.json());
  if (!parsed.success) throw new Error("The sign-in page returned an invalid result.");
  return { status: "ready", siteKey: parsed.output.siteKey };
}

export async function submitSignIn(values: SignInValues, token: string): Promise<SignInResult> {
  // The native client extracts only the provider's signed query parameters.
  // Navigation is explicit so the form can clear credentials before leaving.
  const auth = createAuthClient({ plugins: [usernameClient(), twoFactorClient(), oauthProviderClient()], disableDefaultFetchPlugins: true });
  const identifier = getCredentialMethod(values.identifier);
  const options = { password: values.password, callbackURL: "/auth/destination",
    fetchOptions: { headers: { "x-captcha-response": token }, retry: 0 },
  };
  const result = "email" in identifier
    ? await auth.signIn.email({ ...identifier, ...options })
    : await auth.signIn.username({ ...identifier, ...options });
  if (result.error) return { status: "error", error: readSignInFailure(result.error) };
  if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect === true) return { status: "mfa-pending" };
  const destination = readSignInDestination(result.data, { origin: window.location.origin, search: window.location.search });
  return destination ? { status: "signed-in", destination } : { status: "error", error: { code: "core_sign_in_invalid" } };
}
