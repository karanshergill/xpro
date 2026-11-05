import { describe, expect, it } from "vitest";
import { isSessionFailure, readSessionFailure, readWorkspacePageResult } from "./session";

describe("workspace session browser contracts", () => {
  it("when a fresh page returns an identity then only its validated login ID is used", () => {
    const loginId = crypto.randomUUID();
    expect(readWorkspacePageResult({ loginId, privateValue: "not-exposed" })).toBe(loginId);
  });
  it.each([null, {}, { loginId: "invalid" }, { loginId: 42 }])("when identity data is malformed then it cannot resume a page", (value) => {
    expect(readWorkspacePageResult(value)).toBeNull();
  });
  it("when an error contains untrusted text then only its code and safe request ID survive", () => {
    const requestId = crypto.randomUUID();
    expect(readSessionFailure({ code: "core_unauthenticated", requestId, message: "private-message", cookie: "private-cookie" }))
      .toEqual({ code: "core_unauthenticated", requestId });
  });
  it.each([null, {}, { code: "core_unauthenticated", requestId: "private-value" }])(
    "when a failure is malformed then it becomes the safe generic error", (value) => {
      expect(readSessionFailure(value)).toEqual({ code: "core_unexpected_error" });
    },
  );
  it.each(["core_unauthenticated", "core_identity_changed", "core_forbidden", "core_login_inactive", "core_creation_incomplete", "core_profile_incomplete"])(
    "when the boundary reports %s then session UI can block the page", (code) => { expect(isSessionFailure(code)).toBe(true); },
  );
  it.each(["core_unexpected_error", "core_invalid_input", "private-code"])(
    "when the failure is %s then it is not classified as ended access", (code) => { expect(isSessionFailure(code)).toBe(false); },
  );
});
