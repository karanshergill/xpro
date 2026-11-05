import { describe, expect, it } from "vitest";
import { getCredentialMethod, getSignInMessage, readSignInDestination, readSignInFailure } from "./sign-in";
import { m } from "#paraglide/messages.js";

describe("sign-in browser contracts", () => {
  it("when credentials or MFA finish without an OAuth redirect then the selected workspace survives profile completion", () => {
    const workspaceId = crypto.randomUUID(), search = "?requestedWorkspaceId=" + workspaceId;
    expect(readSignInDestination({ status: true }, { origin: "https://hub.example.test", search }))
      .toBe("https://hub.example.test/auth/destination" + search);
    expect(readSignInDestination({ status: true }, { origin: "https://hub.example.test", search: "?intent=replace" }))
      .toBe("https://hub.example.test/auth/destination");
  });
  it("when native completion leaves a signed continuation then only a fixed profile page receives its raw query", () => {
    const search = "?ba_param=client_id&ba_param=state&sig=signed%2Bbytes&state=kept";
    expect(readSignInDestination({ status: true }, { origin: "https://hub.example.test", search }))
      .toBe("https://hub.example.test/complete-profile" + search);
  });
  it.each(["?requestedWorkspaceId=bad", "?requestedWorkspaceId=" + crypto.randomUUID() + "&requestedWorkspaceId=" + crypto.randomUUID()])(
    "when a fixed destination selection is malformed or ambiguous then native completion cannot silently discard it", (search) => {
      expect(readSignInDestination({ status: true }, { origin: "https://hub.example.test", search })).toBeNull();
    },
  );
  it.each([
    [" Person@Example.test ", { email: "person@example.test" }],
    [" Abcd ", { username: "abcd" }],
    ["wrong-address@", { email: "wrong-address@" }],
  ])("when an identifier is %s then the native credential method receives its normalized value", (identifier, expected) => {
    expect(getCredentialMethod(identifier as string)).toEqual(expected);
  });

  it.each([
    ["accounts_credentials_invalid", "Incorrect email, username or password"],
    ["core_invalid_input", "Incorrect email, username or password"],
    ["accounts_login_suspended", "This account is suspended. Please contact support."],
    ["accounts_login_archived", "This account is no longer active. Please contact support."],
    ["accounts_sign_in_limited", "Too many attempts. Please try again shortly."],
    ["accounts_bot_verification_failed", "Security check failed. Please try again."],
  ])("when the native public boundary returns %s then only the approved translated message is shown", (code, expected) => {
    expect(getSignInMessage({ code })).toBe(expected);
  });

  it("when an auth error includes submitted values or an untrusted message then neither becomes visible", () => {
    const requestId = crypto.randomUUID();
    const failure = readSignInFailure({ code: "accounts_credentials_invalid", requestId, message: "private-password",
      password: "private-password", email: "private-email", status: 401 });
    expect(failure).toEqual({ code: "accounts_credentials_invalid", requestId });
    expect(getSignInMessage(failure)).not.toContain("private");
  });

  it.each([null, {}, { code: "accounts_credentials_invalid", requestId: "private-value" }])(
    "when an error is malformed then only the generic failure is available", (value) => {
      expect(readSignInFailure(value)).toEqual({ code: "core_unexpected_error" });
      expect(getSignInMessage(readSignInFailure(value))).toBe(m.core_error_message());
    },
  );

  it("when a server code is unknown then the translated generic error is used", () => {
    expect(getSignInMessage({ code: "private-server-code" })).toBe(m.core_error_message());
  });

  it.each([
    [{}, "https://hub.example.test/auth/destination"],
    [{ url: "/complete-profile?sig=signed" }, "https://hub.example.test/complete-profile?sig=signed"],
    [{ url: "https://workspace.example.test/auth/callback?code=one-time" }, "https://workspace.example.test/auth/callback?code=one-time"],
  ])("when the native provider supplies a safe destination then it is preserved", (body, destination) => {
    expect(readSignInDestination(body, { origin: "https://hub.example.test" })).toBe(destination);
  });

  it.each([null, { url: 42 }, { url: "javascript:alert(1)" }, { url: "http://other.test" },
    { url: "https://person:password@other.test" }, { url: "https://[" }])(
    "when a provider destination is invalid then it cannot be navigated to", (body) => {
      expect(readSignInDestination(body, { origin: "https://hub.example.test" })).toBeNull();
    },
  );
});
