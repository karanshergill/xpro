import { describe, expect, it } from "vitest";
import { readPreflightOptions } from "../../apps/hub/scripts/account-workspace-preflight.ts";

describe("retained-data preflight command options", () => {
  it.each([
    { args: ["--env", "local"], expected: { environment: "local", remote: false } },
    { args: ["--env", "test"], expected: { environment: "test", remote: false } },
    { args: ["--env", "test", "--remote"], expected: { environment: "test", remote: true } },
  ])("when approved options are $args then the exact target is selected", ({ args, expected }) => {
    expect(readPreflightOptions(args)).toEqual(expected);
  });

  it.each([
    [],
    ["--env", "production"],
    ["--env", "local", "--remote"],
    ["--env", "local", "--env", "test"],
    ["--env", "test", "--remote", "--remote"],
    ["--env", "test", "--account", "another-account"],
    ["--env", "local", "unexpected"],
  ])("when unsupported or ambiguous options are %j then they are refused", (...args) => {
    expect(() => readPreflightOptions(args)).toThrow();
  });
});
