import { isValidUsername, nameSchema, normalizePhone } from "@xpro/accounts";
import type { ProfileField } from "@xpro/core/server";
import { is } from "valibot";
import { m } from "#paraglide/messages.js";
import type { Locale } from "#paraglide/runtime.js";

export type CompletionFailure = { code: string; requestId?: string; fields?: string[] };
export type CompletionResult = { status: "saved" } | { status: "error"; error: CompletionFailure };
export type CompletionPage = { status: "ready"; fields: ProfileField[] } | { status: "error"; error: CompletionFailure };


export type ProfileValues = { username: string; name: string; phone: { country: string; number: string }; isUsernameConfirmed: boolean };
export type FormField = keyof ProfileValues;
export type FieldErrors = Partial<Record<FormField, string>>;
export const emptyProfileValues: ProfileValues = { username: "", name: "", phone: { country: "", number: "" }, isUsernameConfirmed: false };

export function validateProfileValues(values: ProfileValues, options: { fields: ProfileField[]; locale: Locale }): { fields: FieldErrors } | undefined {
  const errors: FieldErrors = {}, language = { locale: options.locale };
  for (const field of options.fields) {
    switch (field) {
      case "username":
        if (!isValidUsername(values.username)) errors.username = m.accounts_complete_profile_username_invalid({}, language);
        if (!values.isUsernameConfirmed) errors.isUsernameConfirmed = m.accounts_complete_profile_confirmation_required({}, language);
        break;
      case "name":
        if (!is(nameSchema, values.name)) errors.name = m.accounts_complete_profile_name_required({}, language);
        break;
      case "phone":
        if (!values.phone.country) errors.phone = m.accounts_complete_profile_country_required({}, language);
        else if (!values.phone.number.trim()) errors.phone = m.accounts_complete_profile_number_required({}, language);
        else if (normalizePhone(values.phone) === null) errors.phone = m.accounts_complete_profile_phone_invalid({}, language);
        break;
    }
  }
  return Object.keys(errors).length ? { fields: errors } : undefined;
}

export function createCompletionInput(values: ProfileValues, fields: ProfileField[]): Record<string, unknown> {
  return Object.fromEntries([
    ...fields.map((field) => [field, values[field]]),
    ...(fields.includes("username") ? [["isUsernameConfirmed", values.isUsernameConfirmed]] : []),
  ]);
}
