import { parseCookie, serializeCookie } from "cookie-es";
import { number, object, safeParse, unknown } from "valibot";

type CookieSettings = { name: string; secret: string; audience: string; maxAge: number };
const envelopeSchema = object({ expiresAt: number(), value: unknown() });
const ivBytes = 12;
const minimumSecretLength = 32;
const maximumCookieLength = 3800;

export async function createPrivateCookie(value: unknown, settings: CookieSettings): Promise<string> {
  const key = await createKey(settings.secret);
  const iv = crypto.getRandomValues(new Uint8Array(ivBytes));
  const data = new TextEncoder().encode(JSON.stringify({ expiresAt: Date.now() + settings.maxAge * 1000, value }));
  if (data.byteLength > maximumCookieLength) throw new Error("Private cookie exceeds its size limit.");
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv,
    additionalData: cookieAudience(settings) }, key, data);
  const packed = new Uint8Array(iv.length + encrypted.byteLength);
  packed.set(iv);
  packed.set(new Uint8Array(encrypted), iv.length);
  const encoded = btoa(String.fromCharCode(...packed)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  if (encoded.length > maximumCookieLength) throw new Error("Private cookie exceeds its size limit.");
  return serializeCookie(settings.name, encoded, cookieOptions(settings.maxAge));
}

export async function readPrivateCookie(request: Request, settings: CookieSettings): Promise<unknown | null> {
  const encoded = parseCookie(request.headers.get("cookie") ?? "", { allowMultiple: true })[settings.name];
  if (typeof encoded !== "string" || encoded.length > maximumCookieLength || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  const key = await createKey(settings.secret);
  try {
    const packed = Uint8Array.from(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")), (character) => character.charCodeAt(0));
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, ivBytes),
      additionalData: cookieAudience(settings) }, key, packed.slice(ivBytes));
    const parsed = safeParse(envelopeSchema, JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(decrypted)));
    return parsed.success && Number.isFinite(parsed.output.expiresAt) && parsed.output.expiresAt > Date.now() ? parsed.output.value : null;
  } catch (error) {
    if (error instanceof DOMException || error instanceof SyntaxError || error instanceof TypeError) return null;
    throw error;
  }
}

export function clearPrivateCookie(name: string): string {
  return serializeCookie(name, "", cookieOptions(0));
}

async function createKey(secret: string): Promise<CryptoKey> {
  if (secret.length < minimumSecretLength) throw new Error("Private cookies require a supplied secret of at least 32 characters.");
  const key = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function cookieAudience(settings: Pick<CookieSettings, "name" | "audience">): ArrayBuffer {
  return new Uint8Array(new TextEncoder().encode(JSON.stringify([settings.name, settings.audience]))).buffer;
}

function cookieOptions(maxAge: number) {
  return { secure: true, httpOnly: true, sameSite: "lax" as const, path: "/", maxAge };
}
