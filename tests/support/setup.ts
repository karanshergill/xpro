import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import { network } from "./network";
import { assertTestEnvironment } from "./runtime";

assertTestEnvironment(env.XPRO_TEST_ENVIRONMENT);

let unexpectedRequestCount = 0;
network.configure({
  onUnhandledFrame: () => {
    unexpectedRequestCount += 1;
    throw new Error("Unexpected outbound request: declare an MSW handler in the test.");
  },
});

beforeAll(() => network.enable());
afterEach(async () => {
  try {
    // A handled network error must not hide an undeclared outside call.
    expect(unexpectedRequestCount, "Unexpected outbound requests must be declared in the test.").toBe(0);
  } finally {
    unexpectedRequestCount = 0;
    network.resetHandlers();
    await reset();
  }
});
afterAll(() => network.disable());
