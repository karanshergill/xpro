import { createAuthClient } from "better-auth/client";
import { readDirectDestination } from "./destination";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

export async function continueAfterProfile(): Promise<"navigating" | "invalid" | "failed"> {
  const query = new URLSearchParams(window.location.search);
  // Only a native signed continuation reaches the provider. Display-only search
  // parameters cannot turn a fixed Hub destination into an OAuth request.
  if (!query.has("sig") && !query.has("ba_param")) {
    const destination = readDirectDestination(window.location.search);
    if (!destination) return "invalid";
    window.location.assign(destination);
    return "navigating";
  }
  // Keep the provider's signed-query extraction and verification. Disable only
  // its automatic navigation so the form is already clean before leaving.
  const auth = createAuthClient({ plugins: [oauthProviderClient()], disableDefaultFetchPlugins: true });
  const result = await auth.oauth2.continue({ postLogin: true });
  if (result.error) return result.error.status >= 500 ? "failed" : "invalid";
  if (!result.data?.redirect || typeof result.data.url !== "string") return "failed";
  const target = new URL(result.data.url, window.location.origin);
  if (target.protocol !== "https:" || target.username || target.password) return "invalid";
  window.location.assign(target.href);
  return "navigating";
}
