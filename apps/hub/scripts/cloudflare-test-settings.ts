import { emailSchema, passwordSchema } from "@xpro/accounts";
import { literal, minLength, pipe, safeParse, strictObject, string, uuid, type InferOutput } from "valibot";

export const CLOUDFLARE_TEST_TARGET = {
  accountId: "35ff2b49c05d63c1ab9be216933c774a",
  databaseId: "28f995c1-9c2f-4dfa-b050-86ee0baf73bf",
  hubOrigin: "https://xpro-hub-test.karanshergill.workers.dev",
  workspaceOrigin: "https://xpro-router-test.karanshergill.workers.dev",
} as const;

const targetEntries = {
  accountId: literal(CLOUDFLARE_TEST_TARGET.accountId),
  databaseId: literal(CLOUDFLARE_TEST_TARGET.databaseId),
  hubOrigin: literal(CLOUDFLARE_TEST_TARGET.hubOrigin),
  workspaceOrigin: literal(CLOUDFLARE_TEST_TARGET.workspaceOrigin),
};
const secretSchema = pipe(string(), minLength(32));
const inputSchema = strictObject({
  ...targetEntries, email: emailSchema, password: passwordSchema,
  hubSecret: secretSchema, workspaceSessionSecret: secretSchema,
  turnstileSiteKey: pipe(string(), minLength(1)), turnstileSecretKey: pipe(string(), minLength(1)),
});
const receiptSchema = strictObject({
  ...targetEntries, loginId: pipe(string(), uuid()), workspaceId: pipe(string(), uuid()),
  clientId: pipe(string(), minLength(1)),
});

export type CloudflareTestInput = InferOutput<typeof inputSchema>;
export type CloudflareTestReceipt = InferOutput<typeof receiptSchema>;

export function parseCloudflareTestInput(input: unknown): CloudflareTestInput {
  const parsed = safeParse(inputSchema, input);
  if (!parsed.success) throw new Error("Invalid test setup input or target.");
  return parsed.output;
}

export function parseCloudflareTestReceipt(input: unknown): CloudflareTestReceipt {
  const parsed = safeParse(receiptSchema, input);
  if (!parsed.success) throw new Error("Invalid test setup receipt or target.");
  return parsed.output;
}
