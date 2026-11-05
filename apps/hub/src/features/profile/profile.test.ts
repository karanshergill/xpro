import { describe, expect, it } from "vitest";
import { safeParse } from "valibot";
import { maximumPictureBytes, pausedPicturePolicy } from "@xpro/accounts";
import { pictureFile } from "#test/picture-fixtures";
import { checkPicture, getFailureMessage, getInitialDetails, getInitials, isAccessFailure, normalizeDetails, profileSchema, validateDetails, validatePassword, type Profile } from "./profile";

const policy = { canUpload: true, maximumBytes: maximumPictureBytes };
const profile: Profile = { loginId: crypto.randomUUID(), email: "person@example.test", username: "person", name: "Existing name", phone: "+442079460018", pictureRevision: null, mfa: "unavailable", picturePolicy: policy };
describe("Own-profile entry", () => {
  it("when a stored phone has a known region then the selector and national number match it", () => {
    expect(getInitialDetails(profile)).toEqual({ name: "Existing name", phone: { country: "GB", number: "2079460018" } });
  });
  it("when a stored phone is non-geographic then no country is invented and the full number is retained", () => {
    expect(getInitialDetails({ ...profile, phone: "+80012345678" }).phone).toEqual({ country: "", number: "+80012345678" });
  });
  it("when name and phone are saved then the screen uses the same normalization as Accounts", () => {
    expect(normalizeDetails({ name: "  Updated name  ", phone: { country: "GB", number: "020 7946 0018" } })).toEqual({ name: "Updated name", phone: "+442079460018" });
    expect(validateDetails({ name: " ", phone: { country: "GB", number: "not a phone" } })).toEqual({ name: expect.any(String), phone: expect.any(String) });
  });
  it("when a password includes spaces then those exact characters remain valid and untrimmed", () => {
    expect(validatePassword({ currentPassword: " ", newPassword: " A-new-password123! " })).toEqual({ currentPassword: undefined, newPassword: undefined });
    expect(validatePassword({ currentPassword: "", newPassword: "short" })).toEqual({ currentPassword: expect.any(String), newPassword: expect.any(String) });
  });
  it.each([["Ada Lovelace", "AL"], ["  Single  ", "S"], ["e\u0301clair Person", "E\u0301P"], ["👩‍💻 Developer", "👩‍💻D"], ["", ""]])(
    "when initials are made for %s then whole graphemes from the first and last words survive", (name, initials) => {
      expect(getInitials(name, "en")).toBe(initials);
    });
});

describe("Original picture checks", () => {
  it("when an original exceeds 2 MiB then resizing cannot disguise its size", async () => {
    expect(await checkPicture(new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }), policy)).toEqual({ code: "accounts_picture_too_large" });
  });
  it.each(["<svg></svg>", "GIF89a", "not an image"])("when the bytes are %s then a supported extension or MIME cannot grant acceptance", async (bytes) => {
    expect(await checkPicture(new File([bytes], "renamed.png", { type: "image/png" }), policy)).toEqual({ code: "accounts_picture_type_invalid" });
  });
  it("when an empty image is selected then it is refused before decoding", async () => {
    expect(await checkPicture(new File([], "empty.png"), policy)).toEqual({ code: "accounts_picture_invalid" });
  });
});

describe("Profile picture policy contract", () => {
  it("when an older profile response omits the policy then uploads default to paused", () => {
    const { picturePolicy: _policy, ...older } = profile;
    const result = safeParse(profileSchema, older);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Older profile responses must remain readable.");
    expect(result.output).toEqual({ ...older, picturePolicy: pausedPicturePolicy });
  });

  it("when a valid policy includes provider metadata then only the effective upload controls survive", () => {
    const result = safeParse(profileSchema, { ...profile, picturePolicy: { canUpload: true, maximumBytes: 1_048_576, targetingKey: "private", rule: "private" } });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Valid profile controls must be readable.");
    expect(result.output).toEqual({ ...profile, picturePolicy: { canUpload: true, maximumBytes: 1_048_576 } });
  });

  it.each([{ value: null }, { value: { canUpload: "true", maximumBytes: 1 } }, { value: { canUpload: true, maximumBytes: 0 } },
    { value: { canUpload: true, maximumBytes: maximumPictureBytes + 1 } }])(
    "when a profile policy is invalid ($value) then the client cannot enable uploads from it", ({ value }) => {
      expect(safeParse(profileSchema, { ...profile, picturePolicy: value }).success).toBe(false);
    },
  );

  it.each([1_048_576, 1_048_577])("when a selected or cropped file has %s bytes then the current inclusive limit applies", async (size) => {
    const bytes = new Uint8Array(size); bytes.set(new Uint8Array(await pictureFile("jpeg").arrayBuffer()));
    expect(await checkPicture(new File([bytes], "portrait.jpg"), { canUpload: true, maximumBytes: 1_048_576 }))
      .toEqual(size === 1_048_576 ? null : { code: "accounts_picture_too_large" });
  });

  it("when uploads are paused then selection cannot grant permission and the refusal remains local to the picture", async () => {
    const failure = { code: "accounts_picture_uploads_unavailable" };
    expect(await checkPicture(pictureFile("png"), pausedPicturePolicy)).toEqual(failure);
    expect(isAccessFailure(failure)).toBe(false);
    expect(getFailureMessage(failure)).toBe("Picture uploads are temporarily unavailable. You can still remove your current picture.");
  });

  it("when an internal caller supplies an excessive limit then the client still retains the absolute ceiling", async () => {
    expect(await checkPicture(new File([new Uint8Array(maximumPictureBytes + 1)], "large.png"),
      { canUpload: true, maximumBytes: Number.MAX_SAFE_INTEGER })).toEqual({ code: "accounts_picture_too_large" });
  });
});
