import { describe, expect, it } from "vitest";
import type { ProfileField } from "@xpro/core/server";
import { createCompletionInput, emptyProfileValues, validateProfileValues, type ProfileValues } from "./complete-profile";
import { getFailureFields, getFailureMessage } from "./messages";
import { m } from "#paraglide/messages.js";
import { getLocale } from "#paraglide/runtime.js";
import { paraglideMiddleware } from "#paraglide/server.js";

const complete: ProfileValues = { username: "a-b.c_12", name: "  Person  ",
  phone: { country: "US", number: "(202) 555-0123" }, isUsernameConfirmed: true };
const combinations: ProfileField[][] = [
  ["username"], ["name"], ["phone"], ["username", "name"], ["username", "phone"],
  ["name", "phone"], ["username", "name", "phone"],
];

describe("profile completion form rules", () => {
  it.each(combinations)("when only %s is required then valid displayed values pass and only those fields are submitted", (...fields) => {
    expect(validateProfileValues(complete, { fields, locale: "en" })).toBeUndefined();
    expect(createCompletionInput(complete, fields)).toEqual({
      ...(fields.includes("username") ? { username: complete.username, isUsernameConfirmed: true } : {}),
      ...(fields.includes("name") ? { name: complete.name } : {}),
      ...(fields.includes("phone") ? { phone: complete.phone } : {}),
    });
  });

  it("when fields are already valid on the server then hidden empty values cannot demand replacements", () => {
    expect(validateProfileValues(emptyProfileValues, { fields: [], locale: "en" })).toBeUndefined();
    expect(createCompletionInput(emptyProfileValues, [])).toEqual({});
    expect(validateProfileValues({ ...complete, username: "", name: "" }, { fields: ["phone"], locale: "en" })).toBeUndefined();
  });

  it.each(["Abcd", "abcd ", "1abc", "abc", "abcdefghi", "ab💡c"])(
    "when a username is invalid (%s) then the existing username rules reject it", (username) => {
      expect(validateProfileValues({ ...complete, username }, { fields: ["username"], locale: "en" })).toEqual({
        fields: { username: m.accounts_complete_profile_username_invalid() },
      });
    },
  );

  it("when a chosen username is not confirmed then the required warning cannot be skipped", () => {
    expect(validateProfileValues({ ...complete, isUsernameConfirmed: false }, { fields: ["username"], locale: "en" })).toEqual({
      fields: { isUsernameConfirmed: m.accounts_complete_profile_confirmation_required() },
    });
  });

  it("when a required name is blank then the error belongs to that field", () => {
    expect(validateProfileValues({ ...complete, name: "  " }, { fields: ["name"], locale: "en" })).toEqual({
      fields: { name: m.accounts_complete_profile_name_required() },
    });
  });

  it.each([
    { country: "", number: "" }, { country: "ZZ", number: "2025550123" }, { country: "US", number: "" },
    { country: "US", number: "1234" }, { country: "US", number: "2025550123 ext 5" },
  ])("when phone details are invalid then the approved strict phone rules reject them", (phone) => {
    expect(validateProfileValues({ ...complete, phone }, { fields: ["phone"], locale: "en" })?.fields.phone).toBeTruthy();
  });

  it.each([
    ["accounts_username_taken", "username"], ["accounts_username_reserved", "username"],
    ["accounts_username_invalid", "username"], ["accounts_username_confirmation_required", "isUsernameConfirmed"],
  ] as const)("when the server refuses %s then the error is attached to %s", (code, field) => {
    expect(Object.keys(getFailureFields({ code }))).toEqual([field]);
  });

  it("when a server response names unknown fields or codes then those details never become visible messages", () => {
    expect(getFailureFields({ code: "core_invalid_input", fields: ["private-field", "name", "phone"] })).toEqual({
      name: m.accounts_complete_profile_name_required(), phone: m.accounts_complete_profile_phone_invalid(),
    });
    expect(getFailureFields({ code: "private-code" })).toEqual({});
    expect(getFailureMessage({ code: "private-code" })).toBe(m.core_error_message());
  });

  it("when multiple fields need correction then all their errors are returned together", () => {
    expect(validateProfileValues(emptyProfileValues, { fields: ["username", "name", "phone"], locale: "en" })).toEqual({
      fields: { username: m.accounts_complete_profile_username_invalid(),
        isUsernameConfirmed: m.accounts_complete_profile_confirmation_required(),
        name: m.accounts_complete_profile_name_required(), phone: m.accounts_complete_profile_country_required() },
    });
  });

  it("when the pseudo language is selected then validation comes from its translated messages", () => {
    const errors = validateProfileValues(emptyProfileValues, { fields: ["username", "name", "phone"], locale: "en-XA" });
    expect(errors).toBeDefined();
    for (const message of Object.values(errors?.fields ?? {})) expect(message).toMatch(/^⟦.*⟧$/);
    expect(m.accounts_complete_profile_username_warning()).toBe("Your username can't be changed later");
  });

  it("when two server requests use different languages then their async message context stays isolated", async () => {
    const locales = ["en", "en-XA"] as const;
    const responses = await Promise.all(locales.map(async (locale) => await paraglideMiddleware(
      new Request("https://hub.example.test/complete-profile", { headers: { cookie: "PARAGLIDE_LOCALE=" + locale } }),
      async () => {
        await Promise.resolve();
        return Response.json({ locale: getLocale(), title: m.accounts_complete_profile_title() });
      },
    )));
    expect(await responses[0]?.json()).toEqual({ locale: "en", title: "Complete your profile" });
    expect(await responses[1]?.json()).toEqual({ locale: "en-XA", title: m.accounts_complete_profile_title({}, { locale: "en-XA" }) });
    expect(getLocale()).toBe("en");
  });
});
