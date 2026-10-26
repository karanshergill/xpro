import { describe, expect, it } from "vitest";
import { assertTestEnvironment } from "./runtime";

describe("test environment guard", () => {
  it("when the environment is test then it permits setup", () => {
    expect(() => assertTestEnvironment("test")).not.toThrow();
  });

  it.each([undefined, "local", "live", "production", "", null])(
    "when the environment is %s then it refuses setup",
    (environment) => {
      expect(() => assertTestEnvironment(environment)).toThrow("Tests require the isolated test environment.");
    },
  );
});
