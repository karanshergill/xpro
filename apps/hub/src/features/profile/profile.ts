import { is, nullable, object, optional, picklist, pipe, safeParse, string, uuid, type InferOutput } from "valibot";
import { hasSupportedPictureContent, maximumPictureBytes, nameSchema, normalizePhone, passwordSchema, pausedPicturePolicy, picturePolicySchema, type PicturePolicy } from "@xpro/accounts";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { m } from "#paraglide/messages.js";

export const profileSchema = object({ loginId: pipe(string(), uuid()), email: string(), username: string(), name: string(), phone: string(),
  pictureRevision: nullable(pipe(string(), uuid())), mfa: picklist(["unavailable", "ready", "recent_required"]),
  picturePolicy: optional(picturePolicySchema, pausedPicturePolicy) });
export type Profile = InferOutput<typeof profileSchema>;
export type ProfileFailure = { code: string; requestId?: string; fields?: string[] };
export type ProfilePage = { status: "ready"; profile: Profile } | { status: "error"; error: ProfileFailure };
export type SaveResult = { status: "saved" } | { status: "error"; error: ProfileFailure };
export type Details = { name: string; phone: { country: string; number: string } };
export type DetailsErrors = { name?: string; phone?: string };

export async function checkPicture(file: File, policy: PicturePolicy): Promise<ProfileFailure | null> {
  if (!policy.canUpload) return { code: "accounts_picture_uploads_unavailable" };
  if (file.size > maximumPictureBytes || file.size > policy.maximumBytes) return { code: "accounts_picture_too_large" };
  if (!file.size) return { code: "accounts_picture_invalid" };
  return hasSupportedPictureContent(new Uint8Array(await file.slice(0, 12).arrayBuffer())) ? null : { code: "accounts_picture_type_invalid" };
}

export function getInitialDetails(profile: Profile): Details {
  const phone = parsePhoneNumberFromString(profile.phone, { extract: false });
  return { name: profile.name, phone: { country: phone?.country ?? "", number: phone?.country ? String(phone.nationalNumber) : profile.phone } };
}

export function validateDetails(value: Details): DetailsErrors {
  const errors: DetailsErrors = {};
  if (!is(nameSchema, value.name)) errors.name = m.accounts_profile_name_required();
  if (!value.phone.country) errors.phone = m.accounts_profile_country_required();
  else if (!value.phone.number.trim()) errors.phone = m.accounts_profile_phone_required();
  else if (!normalizePhone(value.phone)) errors.phone = m.accounts_profile_phone_invalid();
  return errors;
}

export function normalizeDetails(value: Details): Pick<Profile, "name" | "phone"> {
  const name = safeParse(nameSchema, value.name), phone = normalizePhone(value.phone);
  if (!name.success || phone === null) throw new Error("Invalid profile details reached the save boundary.");
  return { name: name.output, phone };
}

export function validatePassword(value: { currentPassword: string; newPassword: string }): { currentPassword?: string; newPassword?: string } {
  return { currentPassword: value.currentPassword.length > 0 && value.currentPassword.length <= 64 ? undefined : m.accounts_profile_current_required(),
    newPassword: is(passwordSchema, value.newPassword) ? undefined : m.accounts_profile_password_invalid() };
}

export function getInitials(name: string, locale: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean), segmenter = new Intl.Segmenter(locale, { granularity: "grapheme" });
  const selected = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return selected.map((word) => [...segmenter.segment(word ?? "")][0]?.segment ?? "").join("").toLocaleUpperCase(locale);
}

export function isAccessFailure(error: ProfileFailure): boolean {
  return ["core_unauthenticated", "core_identity_changed", "core_forbidden", "core_login_inactive", "core_profile_incomplete", "core_creation_incomplete", "core_mfa_required"].includes(error.code);
}

export function getFailureMessage(error: ProfileFailure): string {
  switch (error.code) {
    case "core_mfa_required": return m.accounts_mfa_expired();
    case "core_unauthenticated": return m.core_session_ended();
    case "core_identity_changed": return m.accounts_profile_identity_changed();
    case "core_login_inactive": return m.core_login_inactive();
    case "core_creation_incomplete": return m.core_creation_incomplete();
    case "core_profile_incomplete": return m.accounts_profile_incomplete();
    case "core_forbidden": return m.accounts_profile_forbidden();
    case "core_invalid_input": return m.accounts_profile_errors();
    case "accounts_current_password_invalid": return m.accounts_profile_current_invalid();
    case "accounts_picture_too_large": return m.accounts_profile_picture_large();
    case "accounts_picture_uploads_unavailable": return m.accounts_profile_picture_paused();
    case "accounts_picture_type_invalid": return m.accounts_profile_picture_type();
    case "accounts_picture_invalid": return m.accounts_profile_picture_invalid();
    case "accounts_picture_changed": return m.accounts_profile_picture_changed();
    default: return m.core_error_message();
  }
}
