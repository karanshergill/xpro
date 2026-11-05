import { describe, expect, it } from "vitest";
import { parse, safeParse } from "valibot";
import { maximumPictureBytes } from "./input";
import { picturePolicySchema } from "./policy";

describe("picture upload policy validation", () => {
  it.each([1, 1_048_576, maximumPictureBytes])("when the limit is %s bytes then both upload states are valid", (maximumBytes) => {
    for (const canUpload of [false, true]) {
      expect(parse(picturePolicySchema, { canUpload, maximumBytes })).toEqual({ canUpload, maximumBytes });
    }
  });

  it("when future configuration fields are present then only the supported policy is returned", () => {
    const input = { canUpload: true, maximumBytes: maximumPictureBytes, future: { secret: "private-provider-value" } };
    expect(parse(picturePolicySchema, input)).toEqual({ canUpload: true, maximumBytes: maximumPictureBytes });
    expect(input.future).toEqual({ secret: "private-provider-value" });
  });

  it.each([null, undefined, false, 42, "policy", [], [{ canUpload: true, maximumBytes: 1 }], {}].map((input) => ({ input })))(
    "when the policy has an invalid shape ($input) then it is refused", ({ input }) => {
      expect(safeParse(picturePolicySchema, input).success).toBe(false);
    },
  );

  it.each([undefined, null, 0, 1, "true", "false", {}, []].map((canUpload) => ({ canUpload })))(
    "when upload availability is not a boolean ($canUpload) then it is refused", ({ canUpload }) => {
      expect(safeParse(picturePolicySchema, { canUpload, maximumBytes: 1 }).success).toBe(false);
    },
  );

  it.each([undefined, null, 0, -1, 0.5, 1.5, maximumPictureBytes + 1, Number.MAX_SAFE_INTEGER,
    Infinity, -Infinity, NaN, "1024", true, {}, []].map((maximumBytes) => ({ maximumBytes })))(
    "when the limit is unsafe, outside the bounds or not an integer ($maximumBytes) then it is refused", ({ maximumBytes }) => {
      expect(safeParse(picturePolicySchema, { canUpload: true, maximumBytes }).success).toBe(false);
    },
  );
});
