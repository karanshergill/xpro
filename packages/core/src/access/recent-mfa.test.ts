import { describe, expect, it } from "vitest";
import { isMfaRecent } from "./access-policy";
import type { MfaAccessState } from "./access";

const now = Date.parse("2026-10-31T10:00:00.000Z");
describe("shared recent MFA window", () => {
  it.each([0, 300_000, 300_001, -1])("when verification age is %s then only a nonfuture proof within five minutes is recent", (age) => {
    expect(isMfaRecent({ status: "verified", verifiedAt: new Date(now - age).toISOString() }, now)).toBe(age >= 0 && age <= 300_000);
  });
  it.each<MfaAccessState>([{ status: "not_required" }, { status: "enrollment_required" }, { status: "sign_in_required" }, { status: "verified", verifiedAt: "invalid" }])(
    "when MFA is incomplete or its timestamp is invalid then it is never recent", (mfa) => { expect(isMfaRecent(mfa, now)).toBe(false); },
  );
});
