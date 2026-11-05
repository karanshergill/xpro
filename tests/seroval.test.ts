import { compileJSON, fromJSON, serialize, toJSON, toJSONAsync } from "seroval";
import { describe, expect, it } from "vitest";

describe("server-function serializer security in Workers", () => {
  it("round-trips a real server-function envelope without evaluating generated code", async () => {
    const value = { data: { query: "Éclair", limit: 25 }, bytes: new Uint8Array([1, 2]), date: new Date("2026-10-29T00:00:00Z") };
    expect(fromJSON(await toJSONAsync(value))).toEqual(value);
  });

  it.each([
    { name: "array", value: [1] },
    { name: "set", value: new Set([1]) },
  ])("rejects a $name node whose element list is only a declared length", ({ value }) => {
    const json = toJSON(value);
    // Zero keeps this regression bounded even if a vulnerable version is installed.
    Object.defineProperty(json.t, "a", { value: { length: 0 } });
    expect(() => fromJSON(json)).toThrow();
  });

  it("escapes RegExp sources that could close an HTML script element", () => {
    const value = /[</script><script>probe()//]/;
    for (const output of [serialize(value), compileJSON(toJSON(value))]) {
      expect(output).not.toContain("<");
    }
    const restored = fromJSON<RegExp>(toJSON(value));
    expect(restored.source).toBe(value.source);
    expect(restored.flags).toBe(value.flags);
  });

  it("uses the real typed-array constructor when an own constructor is spoofed", () => {
    const value = new Uint8Array([7, 8, 9]);
    Object.defineProperty(value, "constructor", { value: { name: "untrustedConstructor()" } });
    for (const output of [serialize(value), compileJSON(toJSON(value))]) {
      expect(output).toContain("new Uint8Array(");
      expect(output).not.toContain("untrustedConstructor");
    }
    expect(fromJSON(toJSON(value))).toEqual(new Uint8Array([7, 8, 9]));
  });
});
