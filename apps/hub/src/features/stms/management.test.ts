import { describe, expect, it } from "vitest";
import { getDetailHref, getListHref, getPreviousOffset, isUncertainFailure, normalizeIdentifier, readLoginSearch, validateIdentifier } from "./management";

describe("STMS list navigation", () => {
  it("when URL search has a numeric-looking query then the literal query survives and invalid offsets safely start at zero", () => {
    expect(readLoginSearch({ query: 123, offset: "25" })).toEqual({ query: "123", offset: 25 });
    expect(readLoginSearch({ query: "  Élodie  ", offset: -1 })).toEqual({ query: "Élodie", offset: 0 });
    expect(readLoginSearch({ query: {}, offset: Infinity })).toEqual({ query: "", offset: 0 });
  });
  it("when a search includes URL delimiters then paging and detail links retain one literal filter without introducing a return address", () => {
    const search = { query: "name+mail&x=#value", offset: 25 }, list = new URL(getListHref(search), "https://hub.example.test");
    expect([...list.searchParams]).toEqual([["query", search.query], ["offset", "25"]]);
    const id = crypto.randomUUID(), detail = new URL(getDetailHref(id, search), list.origin);
    expect(detail.pathname).toBe("/stms/logins/" + id); expect(detail.search).toBe(list.search); expect(detail.hash).toBe("");
    expect(getPreviousOffset(25)).toBe(0); expect(getPreviousOffset(1)).toBe(0);
  });
});

describe("STMS identifier entry", () => {
  it("when email contains outer spaces and mixed case then the existing Accounts rule supplies the saved value", () => {
    expect(normalizeIdentifier("email", " New.Person@Example.TEST ")).toBe("new.person@example.test");
    expect(validateIdentifier("email", "invalid")).toEqual(expect.any(String));
  });
  it("when a username violates the existing rule then the screen refuses it without trimming or changing the intended value", () => {
    expect(validateIdentifier("username", "validusr")).toBeUndefined();
    for (const value of ["BAD", " validusr ", "123first", "morethan8"]) expect(validateIdentifier("username", value)).toEqual(expect.any(String));
  });
  it.each(["core_invalid_input", "core_unauthenticated", "core_identity_changed", "stms_login_state_conflict", "accounts_username_reserved"])(
    "when the result is a known %s refusal then it is not described as an uncertain save", (code) => {
      expect(isUncertainFailure({ code })).toBe(false);
    });
  it("when transport or processing fails without a confirmed outcome then explicit readback is appropriate", () => {
    expect(isUncertainFailure({ code: "core_unexpected_error" })).toBe(true);
  });
});
