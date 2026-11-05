import { err, ok } from "true-myth/result";
import { describe, expect, it } from "vitest";
import type { AccessAction, HubAccessResult, MfaAccessState } from "./access";
import { authorizeAccess, isMfaStateValid } from "./access-policy";

const now = Date.parse("2026-10-31T10:00:00.000Z");
const actor = { loginId: "master-policy-facts", isMaster: true, membershipRole: null };

// These unit tests exercise plain rules. Native completed-MFA integration uses the real guarded flow.
describe("MFA authorization rules", () => {
  it.each(["enrollment_required", "sign_in_required"] as const)("when a master needs %s then only the intended limited actions remain available", (status) => {
    const result = master({ status });
    for (const kind of ["check_session", "sign_out"] as const) expect(authorize(result, { kind })).toEqual(ok(actor).toJSON());
    for (const action of [{ kind: "complete_profile" }, { kind: "protected", hasLocalPermission: true }, { kind: "manage_mfa" }] as const) {
      expect(authorize(result, action)).toEqual(err({ code: "core_mfa_required" }).toJSON());
    }
    expect(authorize(result, { kind: "enroll_mfa" })).toEqual(status === "enrollment_required"
      ? ok(actor).toJSON() : err({ code: "core_forbidden" }).toJSON());
  });

  it("when master creation is incomplete then MFA enrollment and protected/profile actions remain blocked", () => {
    const result = { ...master({ status: "enrollment_required" }), isCreationComplete: false };
    for (const action of [{ kind: "enroll_mfa" }, { kind: "manage_mfa" }, { kind: "complete_profile" },
      { kind: "protected", hasLocalPermission: true }] as const) {
      expect(authorize(result, action)).toEqual(err({ code: "core_creation_incomplete" }).toJSON());
    }
    for (const kind of ["check_session", "sign_out"] as const) expect(authorize(result, { kind })).toEqual(ok(actor).toJSON());
  });

  it.each([0, 299_999, 300_000])("when MFA age is %s milliseconds then factor management remains allowed", (age) => {
    expect(authorize(master({ status: "verified", verifiedAt: timestamp(now - age) }), { kind: "manage_mfa" })).toEqual(ok(actor).toJSON());
  });

  it.each([300_001, 3_600_000])("when MFA age is %s milliseconds then only factor management requires a new verification", (age) => {
    const result = master({ status: "verified", verifiedAt: timestamp(now - age) });
    expect(authorize(result, { kind: "manage_mfa" })).toEqual(err({ code: "core_mfa_recent_verification_required" }).toJSON());
    expect(authorize(result, { kind: "protected", hasLocalPermission: false })).toEqual(ok(actor).toJSON());
    expect(authorize(result, { kind: "complete_profile" })).toEqual(ok(actor).toJSON());
    expect(authorize(result, { kind: "enroll_mfa" })).toEqual(err({ code: "core_forbidden" }).toJSON());
  });

  it("when a prepared request crosses five minutes then factor management is checked at the action time", () => {
    const result = master({ status: "verified", verifiedAt: timestamp(now - 300_000) });
    expect(authorize(result, { kind: "manage_mfa" })).toEqual(ok(actor).toJSON());
    expect(authorizeAccess({ result, workspaceId: null, action: { kind: "manage_mfa" }, now: now + 1 }).toJSON())
      .toEqual(err({ code: "core_mfa_recent_verification_required" }).toJSON());
  });

  it.each(["not a time", "2026-10-31", "2026-10-31T10:00:00Z", "2026-10-31T10:00:00.000+00:00",
    "2026-02-30T10:00:00.000Z", "2026-10-31T10:00:00.001Z"])("when MFA time is malformed or future (%s) then no action gains authority", (verifiedAt) => {
    const result = master({ status: "verified", verifiedAt });
    expect(isMfaStateValid({ isMaster: true, mfa: result.mfa, now })).toBe(false);
    for (const action of [{ kind: "check_session" }, { kind: "sign_out" }, { kind: "manage_mfa" },
      { kind: "protected", hasLocalPermission: true }] as const) expect(authorize(result, action)).toEqual(err({ code: "core_unauthenticated" }).toJSON());
  });

  it("when a master is marked not-required then its role and MFA state cannot grant access", () => {
    expect(authorize(master({ status: "not_required" }), { kind: "protected", hasLocalPermission: false }))
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
  });

  it.each(["enrollment_required", "sign_in_required", "verified"] as const)("when an ordinary login has master MFA state %s then the contradiction is refused", (status) => {
    const mfa: MfaAccessState = status === "verified" ? { status, verifiedAt: timestamp(now) } : { status };
    const result = { ...master(mfa), actor: { ...actor, isMaster: false } };
    expect(authorize(result, { kind: "protected", hasLocalPermission: true })).toEqual(err({ code: "core_unauthenticated" }).toJSON());
  });

  it("when an ordinary login is complete then local grants still govern access and master MFA actions are forbidden", () => {
    const result = { ...master({ status: "not_required" }), actor: { ...actor, isMaster: false } };
    expect(authorize(result, { kind: "protected", hasLocalPermission: true })).toEqual(ok(result.actor).toJSON());
    expect(authorize(result, { kind: "protected", hasLocalPermission: false })).toEqual(err({ code: "core_forbidden" }).toJSON());
    for (const kind of ["enroll_mfa", "manage_mfa"] as const) expect(authorize(result, { kind })).toEqual(err({ code: "core_forbidden" }).toJSON());
  });

  it("when a verified master's profile is incomplete then protected access still requires its missing fields", () => {
    const result = { ...master({ status: "verified", verifiedAt: timestamp(now) }), missingProfileFields: ["phone" as const] };
    expect(authorize(result, { kind: "protected", hasLocalPermission: false }))
      .toEqual(err({ code: "core_profile_incomplete", fields: ["phone"] }).toJSON());
    expect(authorize(result, { kind: "complete_profile" })).toEqual(ok(actor).toJSON());
  });
});

function master(mfa: MfaAccessState): Extract<HubAccessResult, { status: "valid" }> {
  return { status: "valid", actor, mfa, sessionExpiresAt: timestamp(now + 3_600_000), isCreationComplete: true, missingProfileFields: [] };
}

function authorize(result: HubAccessResult, action: AccessAction) {
  return authorizeAccess({ result, action, workspaceId: null, now }).toJSON();
}

function timestamp(value: number): string { return new Date(value).toISOString(); }
