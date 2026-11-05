import { getCountries, parsePhoneNumberFromString } from "libphonenumber-js/max";
import { check, is, minLength, picklist, pipe, safeParse, strictObject, string, trim } from "valibot";
import type { ProfileField } from "@xpro/core/server";

export const nameSchema = pipe(string(), trim(), minLength(1));
const phoneInputSchema = strictObject({ country: picklist(getCountries()), number: pipe(string(), trim(), minLength(1)) });
export const phoneSchema = pipe(phoneInputSchema, check((value) => normalizePhone(value) !== null));

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
  return /^[a-z][a-z0-9._-]{3,7}$/.test(value);
}

export function normalizePhone(input: unknown): string | null {
  const parsed = safeParse(phoneInputSchema, input);
  if (!parsed.success) return null;
  const phone = parsePhoneNumberFromString(parsed.output.number, { defaultCountry: parsed.output.country, extract: false });
  if (!phone || !phone.isValid() || phone.ext !== undefined) return null;
  return phone.number;
}

export function getMissingProfileFields(profile: { username: string | null; name: string; phone: string | null }): ProfileField[] {
  const fields: ProfileField[] = [];
  if (profile.username === null || !isValidUsername(profile.username)) fields.push("username");
  if (!is(nameSchema, profile.name)) fields.push("name");
  if (!isValidPhone(profile.phone)) fields.push("phone");
  return fields;
}

function isValidPhone(value: string | null): boolean {
  const maximumPhoneLength = 16;
  if (value === null || value.length > maximumPhoneLength) return false;
  const phone = parsePhoneNumberFromString(value, { extract: false });
  return phone !== undefined && phone.isValid() && phone.number === value;
}
