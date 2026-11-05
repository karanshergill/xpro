import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet, type JWTPayload } from "jose";
import { err, ok } from "true-myth/result";
import { beforeEach, describe, expect, it } from "vitest";
import { validateHubSignOutToken } from "./sign-out.server";

const issuer = "https://hub.example.test/api/auth";
const clientId = "workspace-client";
const event = "http://schemas.openid.net/event/backchannel-logout";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: JSONWebKeySet;
let claims: JWTPayload;
beforeEach(async () => {
  keys = await generateKeyPair("EdDSA");
  jwks = { keys: [{ ...await exportJWK(keys.publicKey), kid: "hub-key", alg: "EdDSA" }] };
  const now = Math.floor(Date.now() / 1000);
  claims = { iss: issuer, aud: clientId, iat: now, exp: now + 120, jti: crypto.randomUUID(),
    sub: crypto.randomUUID(), sid: crypto.randomUUID(), events: { [event]: {} } };
});

describe("signed Hub logout token boundary", () => {
  it("when a valid session logout token is signed by the configured Hub then its verified identity is returned", async () => {
    expect((await validateHubSignOutToken(await sign(claims), { issuer, clientId, jwks })).toJSON())
      .toEqual(ok({ hubSessionId: claims.sid, loginId: claims.sub }).toJSON());
  });

  it("when a session-scoped logout omits its optional subject then its verified session is returned", async () => {
    delete claims.sub;
    expect((await validateHubSignOutToken(await sign(claims), { issuer, clientId, jwks })).toJSON())
      .toEqual(ok({ hubSessionId: claims.sid, loginId: null }).toJSON());
  });

  it.each(["issuer", "audience", "expired", "future", "old", "event", "nonce", "session", "subject", "jti", "no expiry", "no issued time"])(
    "when a genuinely signed token has an invalid %s then it grants no logout authority", async (fault) => {
      if (fault === "issuer") claims.iss = "https://foreign.example.test/api/auth";
      if (fault === "audience") claims.aud = "another-workspace";
      if (fault === "expired") claims.exp = Math.floor(Date.now() / 1000) - 1;
      if (fault === "future") claims.iat = Math.floor(Date.now() / 1000) + 60;
      if (fault === "old") claims.iat = Math.floor(Date.now() / 1000) - 121;
      if (fault === "event") claims.events = { another: {} };
      if (fault === "nonce") claims.nonce = "not-a-logout-token";
      if (fault === "session") delete claims.sid;
      if (fault === "subject") claims.sub = "invalid";
      if (fault === "jti") delete claims.jti;
      if (fault === "no expiry") delete claims.exp;
      if (fault === "no issued time") delete claims.iat;
      expect((await validateHubSignOutToken(await sign(claims), { issuer, clientId, jwks })).toJSON())
        .toEqual(err({ code: "core_sign_in_invalid" }).toJSON());
    });

  it.each(["JWT", "at+jwt", ""])("when a token has type '%s' then it cannot substitute for a logout token", async (typ) => {
    const token = await new SignJWT(claims).setProtectedHeader({ alg: "EdDSA", kid: "hub-key", ...(typ ? { typ } : {}) }).sign(keys.privateKey);
    expect((await validateHubSignOutToken(token, { issuer, clientId, jwks })).toJSON()).toEqual(err({ code: "core_sign_in_invalid" }).toJSON());
  });

  it("when a token uses an attacker's signing key with the Hub's key ID then it is refused", async () => {
    const attacker = await generateKeyPair("EdDSA");
    const token = await new SignJWT(claims).setProtectedHeader({ alg: "EdDSA", kid: "hub-key", typ: "logout+jwt" }).sign(attacker.privateKey);
    expect((await validateHubSignOutToken(token, { issuer, clientId, jwks })).toJSON()).toEqual(err({ code: "core_sign_in_invalid" }).toJSON());
  });

  it.each(["not-a-jwt", "eyJhbGciOiJub25lIn0.e30."])("when a token is malformed or unsigned then it is refused (%s)", async (token) => {
    expect((await validateHubSignOutToken(token, { issuer, clientId, jwks })).toJSON()).toEqual(err({ code: "core_sign_in_invalid" }).toJSON());
  });
});

async function sign(payload: JWTPayload): Promise<string> {
  return await new SignJWT(payload).setProtectedHeader({ alg: "EdDSA", kid: "hub-key", typ: "logout+jwt" }).sign(keys.privateKey);
}
