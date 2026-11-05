import { captcha } from "better-auth/plugins/captcha";

export type SignInProtectionSettings = { turnstileSecret: string; rateLimiter: RateLimit };

export function createSignInCaptcha(settings: {
  baseURL: string; turnstileSecret: string;
}): ReturnType<typeof captcha> {
  if (!settings.turnstileSecret.trim()) throw new Error("Hub sign-in requires a Turnstile secret.");
  return captcha({
    provider: "cloudflare-turnstile",
    secretKey: settings.turnstileSecret,
    endpoints: ["/sign-in/email", "/sign-in/username"],
    expectedAction: "sign-in",
    allowedHostnames: [new URL(settings.baseURL).hostname],
  });
}

export async function canAttemptSignIn(input: {
  method: "email" | "username"; identifier: string;
}, rateLimiter: RateLimit): Promise<boolean> {
  // shortcut: counters are approximate per location. Strengthen them if abuse
  // bypasses these protections or a customer requires stricter limits.
  const key = `sign-in:${input.method}:${input.identifier.trim().toLowerCase()}`;
  return (await rateLimiter.limit({ key })).success;
}
