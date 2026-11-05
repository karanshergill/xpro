import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maximumPictureBytes, pausedPicturePolicy, type PicturePolicy } from "@xpro/accounts";
import { createRequestContext } from "@xpro/core/server";
import { readPicturePolicy } from "./picture-policy.server";

let reports: string[];
beforeEach(() => {
  reports = [];
  vi.spyOn(console, "error").mockImplementation((line: unknown) => { reports.push(String(line)); });
});
afterEach(() => vi.restoreAllMocks());

// Controlled values and failures replace only Flagship's outside boundary.
// The missing-flag case below uses the native local binding.
describe("Hub picture policy reader", () => {
  it("when the optional binding is absent then uploads stay paused without an error report", async () => {
    expect(await readPicturePolicy({ loginId: crypto.randomUUID(), context: createRequestContext() }))
      .toEqual({ canUpload: false, maximumBytes: maximumPictureBytes });
    expect(reports).toEqual([]);
  });

  it("when the native local flag is missing then its fallback is a valid paused policy", async () => {
    expect(await readPicturePolicy({ flags: env.FLAGS, loginId: crypto.randomUUID(), context: createRequestContext() }))
      .toEqual({ canUpload: false, maximumBytes: maximumPictureBytes });
    expect(reports).toEqual([]);
  });

  it.each([
    { canUpload: true, maximumBytes: maximumPictureBytes },
    { canUpload: false, maximumBytes: maximumPictureBytes },
    { canUpload: true, maximumBytes: 1_048_576 },
    { canUpload: true, maximumBytes: 1 },
  ])("when Flagship returns a valid policy (%j) then one evaluation uses only the login targeting key", async (value) => {
    const loginId = crypto.randomUUID(), context = createRequestContext();
    const calls: Parameters<Flagship["getObjectValue"]>[] = [];
    const flags: Pick<Flagship, "getObjectValue"> = {
      async getObjectValue<T extends object>(key: string, fallback: T, targeting?: FlagshipEvaluationContext): Promise<T> {
        calls.push([key, fallback, targeting]);
        return value as T;
      },
    };
    expect(await readPicturePolicy({ flags, loginId, context })).toEqual(value);
    expect(calls).toEqual([["accounts_picture_policy", { canUpload: false, maximumBytes: maximumPictureBytes }, { targetingKey: loginId }]]);
    expect(reports).toEqual([]);
  });

  it("when a provider returns extra fields then they do not escape the reader", async () => {
    const flags: Pick<Flagship, "getObjectValue"> = {
      async getObjectValue<T extends object>(): Promise<T> {
        return { canUpload: true, maximumBytes: 1, secret: "private-provider-value" } as T;
      },
    };
    expect(await readPicturePolicy({ flags, loginId: crypto.randomUUID(), context: createRequestContext() }))
      .toEqual({ canUpload: true, maximumBytes: 1 });
    expect(reports).toEqual([]);
  });

  it("when a known provider failure supplies the code fallback then uploads pause without an extra diagnostic", async () => {
    const flags: Pick<Flagship, "getObjectValue"> = {
      async getObjectValue<T extends object>(_key: string, fallback: T): Promise<T> { return fallback; },
    };
    expect(await readPicturePolicy({ flags, loginId: crypto.randomUUID(), context: createRequestContext() }))
      .toEqual({ canUpload: false, maximumBytes: maximumPictureBytes });
    expect(reports).toEqual([]);
  });

  it.each([
    [], { canUpload: "private-provider-value", maximumBytes: 1 },
    { canUpload: true, maximumBytes: maximumPictureBytes + 1 },
  ].map((value) => ({ value })))("when configuration is malformed ($value) then uploads pause and only four safe diagnostic fields are reported", async ({ value }) => {
    const context = { ...createRequestContext(), secret: "private-context-value" };
    const flags: Pick<Flagship, "getObjectValue"> = {
      async getObjectValue<T extends object>(): Promise<T> { return value as T; },
    };
    expect(await readPicturePolicy({ flags, loginId: "private-targeting-value", context }))
      .toEqual({ canUpload: false, maximumBytes: maximumPictureBytes });
    expect(reports).toEqual([JSON.stringify({ event: "core_unexpected_error", requestId: context.requestId,
      app: "hub", operation: "accounts_picture_policy" })]);
  });

  it("when evaluation rejects then the provider's error text is excluded from the paused result and diagnostic", async () => {
    const context = createRequestContext();
    const flags: Pick<Flagship, "getObjectValue"> = {
      async getObjectValue(): Promise<never> { throw new Error("private-provider-value"); },
    };
    expect(await readPicturePolicy({ flags, loginId: "private-targeting-value", context }))
      .toEqual({ canUpload: false, maximumBytes: maximumPictureBytes });
    expect(reports).toEqual([JSON.stringify({ event: "core_unexpected_error", requestId: context.requestId,
      app: "hub", operation: "accounts_picture_policy" })]);
  });

  it("when a fallback consumer tries to change its policy then later requests still receive paused defaults", async () => {
    const fallback = await readPicturePolicy({ loginId: crypto.randomUUID(), context: createRequestContext() });
    Reflect.set(fallback, "canUpload", true);
    Reflect.set(fallback, "maximumBytes", Number.MAX_SAFE_INTEGER);
    expect(await readPicturePolicy({ loginId: crypto.randomUUID(), context: createRequestContext() }))
      .toEqual({ canUpload: false, maximumBytes: maximumPictureBytes });
    expect(pausedPicturePolicy).toEqual({ canUpload: false, maximumBytes: maximumPictureBytes });
  });

  it("when the same login makes a later request then it observes a fresh policy evaluation", async () => {
    const loginId = crypto.randomUUID();
    let evaluations = 0;
    const flags: Pick<Flagship, "getObjectValue"> = {
      async getObjectValue<T extends object>(): Promise<T> {
        return { canUpload: evaluations++ === 0, maximumBytes: maximumPictureBytes } as T;
      },
    };
    const first = await readPicturePolicy({ flags, loginId, context: createRequestContext() });
    const second = await readPicturePolicy({ flags, loginId, context: createRequestContext() });
    expect([first, second]).toEqual([{ canUpload: true, maximumBytes: maximumPictureBytes }, { canUpload: false, maximumBytes: maximumPictureBytes }]);
    expect(evaluations).toBe(2);
  });

  it("when two evaluations overlap then their targeting and failure reports remain independent", async () => {
    const firstLogin = crypto.randomUUID(), secondLogin = crypto.randomUUID();
    const firstContext = createRequestContext(), secondContext = createRequestContext();
    let rejectFirst: ((reason: unknown) => void) | undefined;
    const firstValue = new Promise<PicturePolicy>((_resolve, reject) => { rejectFirst = reject; });
    const calls: Parameters<Flagship["getObjectValue"]>[] = [];
    const flags: Pick<Flagship, "getObjectValue"> = {
      async getObjectValue<T extends object>(key: string, fallback: T, targeting?: FlagshipEvaluationContext): Promise<T> {
        calls.push([key, fallback, targeting]);
        const value = targeting?.targetingKey === firstLogin ? await firstValue : { canUpload: true, maximumBytes: 1_048_576 };
        return value as T;
      },
    };
    const first = readPicturePolicy({ flags, loginId: firstLogin, context: firstContext });
    const second = await readPicturePolicy({ flags, loginId: secondLogin, context: secondContext });
    if (!rejectFirst) throw new Error("The first evaluation must be pending.");
    rejectFirst(new Error("private-first-provider-value"));
    expect(await first).toEqual({ canUpload: false, maximumBytes: maximumPictureBytes });
    expect(second).toEqual({ canUpload: true, maximumBytes: 1_048_576 });
    expect(calls).toEqual([
      ["accounts_picture_policy", { canUpload: false, maximumBytes: maximumPictureBytes }, { targetingKey: firstLogin }],
      ["accounts_picture_policy", { canUpload: false, maximumBytes: maximumPictureBytes }, { targetingKey: secondLogin }],
    ]);
    expect(reports).toEqual([JSON.stringify({ event: "core_unexpected_error", requestId: firstContext.requestId,
      app: "hub", operation: "accounts_picture_policy" })]);
  });
});
