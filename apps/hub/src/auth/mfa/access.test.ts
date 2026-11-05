import { describe, expect, it } from "vitest";
import { getMfaAccessState, type MfaAccessFacts } from "./access";

const now = Date.parse("2026-10-31T10:00:00.000Z");
const base: MfaAccessFacts = { isMaster: true, userAuthRevision: 0, sessionAuthRevision: 0, twoFactorEnabled: 0,
  factorId: null, factorVerified: null, mfaVerifiedAt: null, now };

describe("live MFA facts", () => {
  it("when no enrollment exists then a current master needs enrollment", () => {
    expect(getMfaAccessState(base)).toEqual({ status: "enrollment_required" });
  });

  it("when native enrollment is pending then a current master may continue enrollment", () => {
    expect(getMfaAccessState({ ...base, factorId: "native-factor", factorVerified: 0 })).toEqual({ status: "enrollment_required" });
  });

  it("when enrollment is verified but this session has no MFA completion then a fresh verification is required", () => {
    expect(getMfaAccessState({ ...base, twoFactorEnabled: 1, factorId: "native-factor", factorVerified: 1 }))
      .toEqual({ status: "sign_in_required" });
  });

  it("when live enrollment, revision and actual session time agree then the rule returns the unchanged MFA time", () => {
    const mfaVerifiedAt = "2026-10-31T09:59:00.000Z";
    expect(getMfaAccessState({ ...base, userAuthRevision: 7, sessionAuthRevision: 7,
      twoFactorEnabled: 1, factorId: "native-factor", factorVerified: 1, mfaVerifiedAt }))
      .toEqual({ status: "verified", verifiedAt: mfaVerifiedAt });
  });

  it.each([
    { userAuthRevision: 1 }, { sessionAuthRevision: 1 }, { userAuthRevision: -1, sessionAuthRevision: -1 },
    { userAuthRevision: 0.5, sessionAuthRevision: 0.5 },
    { userAuthRevision: Number.MAX_SAFE_INTEGER + 1, sessionAuthRevision: Number.MAX_SAFE_INTEGER + 1 },
    { userAuthRevision: Number.NaN },
  ])("when a revision is stale or invalid (%j) then both ordinary and master sessions are refused", (change) => {
    for (const isMaster of [false, true]) expect(getMfaAccessState({ ...base, ...change, isMaster })).toBeNull();
  });

  it.each([
    { twoFactorEnabled: null }, { twoFactorEnabled: 2 }, { twoFactorEnabled: 1 },
    { twoFactorEnabled: 1, factorId: "native-factor", factorVerified: 0 },
    { twoFactorEnabled: 1, factorId: "native-factor", factorVerified: null },
    { factorId: "native-factor", factorVerified: 1 }, { factorId: "native-factor", factorVerified: null },
    { factorId: null, factorVerified: 1 }, { mfaVerifiedAt: "2026-10-31T09:59:00.000Z" },
  ])("when enrollment facts contradict one another (%j) then a flag or time cannot grant master access", (change) => {
    expect(getMfaAccessState({ ...base, ...change })).toBeNull();
  });

  it.each(["not a time", "2026-10-31T10:00:00.001Z", "2026-10-31T09:00:00Z", "2026-10-31T09:00:00.000+00:00",
    "2026-02-30T09:00:00.000Z"])("when a verified enrollment has invalid/future session time %s then access is refused", (mfaVerifiedAt) => {
    expect(getMfaAccessState({ ...base, twoFactorEnabled: 1, factorId: "native-factor", factorVerified: 1, mfaVerifiedAt })).toBeNull();
  });

  it("when the current role is ordinary then no master-only MFA state is carried forward", () => {
    expect(getMfaAccessState({ ...base, isMaster: false })).toEqual({ status: "not_required" });
  });
});
