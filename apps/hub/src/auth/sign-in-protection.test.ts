import { env } from "cloudflare:workers";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { network } from "#test/network";
import {
  createSignInFixture, hubRequest, readCookies, readHubState, signInPassword,
  type SignInFixture,
} from "#test/sign-in";
import { handleHubAuthRequest } from "./oidc.server";

const siteverify = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const acceptedVerification = { success: true, hostname: "hub.example.test", action: "sign-in" };
const botFailure = { code: "accounts_bot_verification_failed", message: "Security check failed. Please try again." };
const limitFailure = { code: "accounts_sign_in_limited", message: "Too many attempts. Please try again shortly." };
let fixture: SignInFixture;
let identifiers: { email: string; username: string };

beforeEach(async () => {
  fixture = await createSignInFixture(env.DB);
  const login = await fixture.identities.createLogin();
  const user = await fixture.identities.db.selectFrom("user").select("username")
    .where("id", "=", login.loginId).executeTakeFirstOrThrow();
  if (!user.username) throw new Error("The prepared login needs a username.");
  identifiers = { email: login.email, username: user.username };
  await fixture.identities.createLogin();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.identities.db.destroy();
});

describe("Hub sign-in protection", () => {
  it.each(["email", "username"] as const)("when a %s sign-in passes both checks then native credentials issue the session", async (method) => {
    const outgoing: unknown[] = [];
    network.use(http.post(siteverify, async ({ request }) => {
      outgoing.push(await request.json());
      return HttpResponse.json(acceptedVerification);
    }));
    const request = signInRequest(method);
    request.headers.set("x-captcha-response", "x".repeat(2_048));
    const token = request.headers.get("x-captcha-response");
    const response = await handleHubAuthRequest(request, fixture.settings);
    expect(response.status).toBe(200);
    const session = await fixture.identities.auth.api.getSession({ headers: { cookie: readCookies(response) } });
    expect(session?.user.email).toBe(identifiers.email);
    expect(outgoing).toEqual([{ secret: fixture.settings.turnstileSecret, response: token }]);
  });

  it.each(["email", "username"] as const)("when equivalent %s spellings are limited then they use one normalized platform key", async (method) => {
    const keys: string[] = [];
    let verificationCount = 0;
    network.use(http.post(siteverify, () => {
      verificationCount += 1;
      return HttpResponse.json(acceptedVerification);
    }));
    const settings = { ...fixture.settings, rateLimiter: {
      async limit(input: { key: string }) { keys.push(input.key); return { success: false }; },
    } };
    for (const identifier of [identifiers[method], `  ${identifiers[method].toUpperCase()}  `]) {
      const before = await readHubState(fixture.identities);
      const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/" + method, {
        [method]: identifier, password: signInPassword,
      }), settings);
      await expectRefusal(response, { before, failure: limitFailure, status: 429 });
    }
    expect(keys).toEqual(Array(2).fill(`sign-in:${method}:${identifiers[method]}`));
    expect(verificationCount).toBe(0);
  });

  it.each(["email", "username"] as const)("when the %s request omits its bot token then sign-in is refused without issuing a session", async (method) => {
    const before = await readHubState(fixture.identities);
    const request = signInRequest(method);
    request.headers.delete("x-captcha-response");
    await expectRefusal(await handleHubAuthRequest(request, fixture.settings), { before, failure: botFailure, status: 403 });
  });

  it.each(["email", "username"] as const)("when the %s token exceeds Turnstile's size limit then it is refused before an outside call", async (method) => {
    let verificationCount = 0;
    network.use(http.post(siteverify, () => {
      verificationCount += 1;
      return HttpResponse.json(acceptedVerification);
    }));
    const before = await readHubState(fixture.identities);
    const request = signInRequest(method);
    request.headers.set("x-captcha-response", "x".repeat(2_049));
    await expectRefusal(await handleHubAuthRequest(request, fixture.settings), { before, failure: botFailure, status: 403 });
    expect(verificationCount).toBe(0);
  });

  for (const method of ["email", "username"] as const) {
    it.each([
      { name: "rejected", response: { success: false, "error-codes": ["invalid-input-response"] } },
      { name: "expired or reused", response: { success: false, "error-codes": ["timeout-or-duplicate"] } },
      { name: "from another hostname", response: { ...acceptedVerification, hostname: "other.example.test" } },
      { name: "from another action", response: { ...acceptedVerification, action: "other-action" } },
      { name: "missing its hostname", response: { success: true, action: "sign-in" } },
      { name: "missing its action", response: { success: true, hostname: "hub.example.test" } },
    ])(`when a ${method} token is $name then even correct credentials cannot sign in`, async ({ response: verification }) => {
      network.use(http.post(siteverify, () => HttpResponse.json(verification)));
      const before = await readHubState(fixture.identities);
      await expectRefusal(await handleHubAuthRequest(signInRequest(method), fixture.settings), { before, failure: botFailure, status: 403 });
    });

    it(`when Turnstile returns malformed JSON during ${method} sign-in then the token is refused`, async () => {
      network.use(http.post(siteverify, () => new HttpResponse("invalid-json", { headers: { "content-type": "application/json" } })));
      const before = await readHubState(fixture.identities);
      await expectRefusal(await handleHubAuthRequest(signInRequest(method), fixture.settings), { before, failure: botFailure, status: 403 });
    });

    it.each(["unavailable", "network error"] as const)(
      `when Turnstile has an %s result during ${method} sign-in then it fails closed with one safe error`, async (outcome) => {
        network.use(http.post(siteverify, () => {
          if (outcome === "unavailable") return new HttpResponse("Private provider failure", { status: 503 });
          return HttpResponse.error();
        }));
        const before = await readHubState(fixture.identities);
        await expectUnexpected(await handleWithErrorLog(signInRequest(method)), before);
      },
    );
  }

  it("when Turnstile stalls then native verification times out without issuing a session", async () => {
    network.use(http.post(siteverify, async () => {
      await delay(10_100);
      return HttpResponse.json(acceptedVerification);
    }));
    const before = await readHubState(fixture.identities);
    await expectUnexpected(await handleWithErrorLog(signInRequest("email")), before);
  }, 15_000);

  it("when the platform limiter fails then sign-in stops and logs no identifier or credentials", async () => {
    const before = await readHubState(fixture.identities);
    await expectUnexpected(await handleWithErrorLog(signInRequest("email"), {
      ...fixture.settings, rateLimiter: { async limit() { throw new Error("Private platform failure"); } },
    }), before);
  });

  it.each(["", "   "])("when public sign-in has no usable Turnstile secret (%j) then it never uses the trusted setup configuration", async (turnstileSecret) => {
    const before = await readHubState(fixture.identities);
    await expectUnexpected(await handleWithErrorLog(signInRequest("email"), { ...fixture.settings, turnstileSecret }), before);
  });

  for (const method of ["email", "username"] as const) {
    it.each([
      `/api/auth/sign-in/${method}/`,
      `/api/auth//sign-in/${method}`,
      `/api/auth/sign-in/%${method.charCodeAt(0).toString(16)}${method.slice(1)}`,
      `/api/auth/sign-in/${method.toUpperCase()}`,
    ])("when a caller tries the alternate path %s then it cannot bypass the public checks", async (path) => {
      const before = await readHubState(fixture.identities);
      const response = await handleHubAuthRequest(hubRequest(path, {
        [method]: identifiers[method], password: signInPassword,
      }), fixture.settings);
      expect(response.status).toBe(404);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await readHubState(fixture.identities)).toEqual(before);
    });
  }

  it("when the real local binding exhausts its configured identifier limit then the Hub returns the approved refusal", async () => {
    // This proves local binding integration, not an exact counter across Cloudflare locations.
    const key = `sign-in:email:${identifiers.email}`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(await env.SIGN_IN_RATE_LIMITER.limit({ key })).toEqual({ success: true });
    }
    const before = await readHubState(fixture.identities);
    const response = await handleHubAuthRequest(signInRequest("email"), {
      ...fixture.settings, rateLimiter: env.SIGN_IN_RATE_LIMITER,
    });
    await expectRefusal(response, { before, failure: limitFailure, status: 429 });
  });

  it("when a signed-in person signs out then bot checks and identifier limits cannot prevent it", async () => {
    const response = await handleHubAuthRequest(signInRequest("email"), fixture.settings);
    const cookie = readCookies(response);
    const session = await fixture.identities.auth.api.getSession({ headers: { cookie } });
    if (!session) throw new Error("Native sign-in must issue a session.");
    const before = await readHubState(fixture.identities);
    const request = hubRequest("/api/auth/sign-out", {}, cookie);
    request.headers.delete("x-captcha-response");
    const signedOut = await handleHubAuthRequest(request, { ...fixture.settings, rateLimiter: {
      async limit() { throw new Error("Sign-out must not consume a sign-in limit."); },
    } });
    expect(signedOut.status).toBe(200);
    expect(await fixture.identities.auth.api.getSession({ headers: { cookie } })).toBeNull();
    expect(await readHubState(fixture.identities)).toEqual({
      ...before, sessions: before.sessions.filter((row) => row.id !== session.session.id),
    });
  });
});

function signInRequest(method: "email" | "username"): Request {
  return hubRequest("/api/auth/sign-in/" + method, { [method]: identifiers[method], password: signInPassword });
}

async function expectRefusal(
  response: Response, input: {
    before: Awaited<ReturnType<typeof readHubState>>; failure: { code: string; message: string }; status: number;
  },
): Promise<void> {
  const { before, failure, status } = input;
  const requestId = response.headers.get("x-request-id");
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(await response.json()).toEqual({ ...failure, requestId });
  expect(await readHubState(fixture.identities)).toEqual({ ...before, audits: [
    ...before.audits, { id: expect.any(String), action: "accounts_sign_in", outcome: "refused",
      actorLoginId: null, affectedLoginId: null, reason: failure.code, comment: null,
      requestId, createdAt: expect.any(String) },
  ] });
}

async function handleWithErrorLog(
  request: Request, settings = fixture.settings,
): Promise<{ response: Response; logs: unknown[][] }> {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const response = await handleHubAuthRequest(request, settings);
  return { response, logs: log.mock.calls };
}

async function expectUnexpected(
  outcome: Awaited<ReturnType<typeof handleWithErrorLog>>, before: Awaited<ReturnType<typeof readHubState>>,
): Promise<void> {
  const requestId = outcome.response.headers.get("x-request-id");
  expect(outcome.response.status).toBe(500);
  expect(outcome.response.headers.get("cache-control")).toBe("no-store");
  expect(outcome.response.headers.getSetCookie()).toEqual([]);
  expect(await outcome.response.json()).toEqual({
    code: "core_unexpected_error", message: "Something went wrong. Please try again.", requestId,
  });
  expect(outcome.logs).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId, app: "hub", operation: "accounts_hub_auth_request" })]]);
  expect(await readHubState(fixture.identities)).toEqual(before);
}
