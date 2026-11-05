import { describe, expect, it } from "vitest";
import { formatDateTime, parseUtcTimestamp } from "./dates";

it("when a timestamp crosses calendar days by time zone then formatting uses the caller's explicit zone and locale", () => {
  const value = "2026-01-01T00:00:00Z";
  expect(formatDateTime(value, { locale: "en-GB", timeZone: "UTC" })).toBe("1 Jan 2026, 00:00");
  expect(formatDateTime(value, { locale: "en-GB", timeZone: "Asia/Kolkata" })).toBe("1 Jan 2026, 05:30");
  expect(formatDateTime(value, { locale: "en-GB", timeZone: "America/New_York" })).toBe("31 Dec 2025, 19:00");
});

describe("fixed UTC timestamps", () => {
  it("when a stored timestamp uses fixed milliseconds and UTC then it returns the actual instant", () => {
    expect(parseUtcTimestamp("2026-10-31T10:00:00.000Z")).toBe(Date.UTC(2026, 9, 31, 10));
  });

  it.each(["", "not a time", "2026-10-31", "2026-10-31T10:00:00Z", "2026-10-31T10:00:00.000+00:00",
    "2026-10-31T10:00:00.0000Z", "2026-02-30T10:00:00.000Z"])("when stored time is not a real fixed UTC instant (%s) then it is refused", (value) => {
    expect(parseUtcTimestamp(value)).toBeNull();
  });
});
