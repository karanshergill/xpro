import { describe, expect, it } from "vitest";
import { getMfaMessage, readReplacementIntent, readSetup, validateCredential } from "./mfa";
import { m } from "#paraglide/messages.js";

describe("private native MFA material", () => {
  it("when native setup succeeds then QR and manual setup retain the same native URI, key and settings without navigation", () => {
    expect(readSetup({ setupId: "native-factor-id", totpURI: "otpauth://totp/xpro:master%2Btest%40example.test?secret=ABC234&issuer=xpro&digits=6&period=30", backupCodes: ["native-code"] }))
      .toEqual({ setupId: "native-factor-id", totpUri: "otpauth://totp/xpro:master%2Btest%40example.test?secret=ABC234&issuer=xpro&digits=6&period=30", key: "ABC234", account: "xpro:master+test@example.test", digits: 6, period: 30, backupCodes: ["native-code"] });
  });
  it.each(["https://other.test/?secret=ABC234&digits=6&period=30", "otpauth://hotp/x?secret=ABC234&digits=6&period=30",
    "otpauth://totp/x?secret=bad-value&digits=6&period=30", "otpauth://totp/x?secret=ABC234&digits=8&period=30",
    "otpauth://totp/x?secret=ABC234&digits=6&period=60", "otpauth://totp/%zz?secret=ABC234&digits=6&period=30"]) (
    "when setup material is unsupported then neither QR nor manual setup material is returned", (totpURI) => {
      expect(readSetup({ setupId: "native-factor-id", totpURI, backupCodes: ["private-code"] })).toBeNull();
    });
  it("when a code begins with zero then validation keeps all six characters and rejects incomplete or formatted input", () => {
    expect(validateCredential("012345", "totp")).toBeUndefined();
    for (const value of ["12345", "1234567", "012 345", " 012345", "12e345"]) expect(validateCredential(value, "totp")).toBe(m.accounts_mfa_code_format());
    expect(validateCredential("", "password")).toBe(m.accounts_profile_current_required());
    expect(validateCredential("", "backup")).toBe(m.accounts_mfa_backup_required());
  });
  it("when a refusal contains an unrecognized code then only the safe translated recovery message is shown", () => {
    expect(getMfaMessage({ code: "private-server-message" })).toBe(m.accounts_mfa_uncertain());
  });
});

describe("MFA replacement presentation", () => {
  it.each(["?intent=replace", "?intent=replace&display=ignored", "?sig=signed&ba_param=client_id&intent=replace"])("when replacement intent is explicitly present once then it selects only a presentation", (search) => { expect(readReplacementIntent(search)).toBe(true); });
  it.each(["", "?intent=other", "?returnURL=https://untrusted.test", "?intent=replace&intent=replace", "?intent=replace&intent=other"])("when intent is absent, unsupported or repeated then replacement is not selected", (search) => { expect(readReplacementIntent(search)).toBe(false); });
});
