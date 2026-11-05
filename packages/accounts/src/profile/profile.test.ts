import { describe, expect, it } from "vitest";
import { is, parse } from "valibot";
import { getMissingProfileFields, isValidUsername, nameSchema, normalizePhone } from "./profile";

describe("shared profile validity", () => {
  it("when a name has surrounding spaces then validation returns the non-empty name", () => {
    expect(parse(nameSchema, " Person ")).toBe("Person");
  });

  it.each(["", " \n", null])("when a name is empty or missing (%j) then it is invalid", (name) => {
    expect(is(nameSchema, name)).toBe(false);
  });

  it.each([
    { country: "US", number: "(202) 555-0123", expected: "+12025550123" },
    { country: "GB", number: "020 7946 0123", expected: "+442079460123" },
    { country: "IN", number: "+12025550123", expected: "+12025550123" },
  ])("when a phone is valid ($country, $number) then it is normalized to international format", ({ country, number, expected }) => {
    const input = { country, number };
    expect(normalizePhone(input)).toBe(expected);
    expect(input).toEqual({ country, number });
  });

  it.each([null, [], { country: "ZZ", number: "2025550123" }, { country: "US", number: "1111111111" },
    { country: "US", number: "Call (202) 555-0123" }, { country: "US", number: "2025550123 ext. 12" },
    { country: "US", number: "" }, { country: "US", number: 2025550123 },
    { country: "US", number: "2025550123", extra: true },
  ])("when phone input is invalid or would lose information (%j) then normalization refuses it", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it.each(["abcd", "a-b.c_12", "z1234567"])("when the username %s follows the approved format then it is valid", (username) => {
    expect(isValidUsername(username)).toBe(true);
  });

  it.each(["abc", "abcdefghi", "1abc", "Abcd", "a bcd", "ábcd", " abcd", "abcd\n"])("when the username %s breaks the approved format then it is invalid", (username) => {
    expect(isValidUsername(username)).toBe(false);
  });

  it.each(["+1 202 555 0123", "2025550123", "Call +12025550123", "+11111111111", "", null])(
    "when a stored phone is invalid or not canonical (%s) then completion is required", (phone) => {
      expect(getMissingProfileFields({ username: "abcd", name: "Person", phone })).toEqual(["phone"]);
    },
  );

  it("when all fields are valid then completion is unnecessary", () => {
    expect(getMissingProfileFields({ username: "a-bc", name: " Person ", phone: "+12025550123" })).toEqual([]);
  });

  it("when multiple fields are invalid then all field names are returned in form order", () => {
    expect(getMissingProfileFields({ username: null, name: " \n", phone: null })).toEqual(["username", "name", "phone"]);
  });
});
