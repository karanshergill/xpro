import { check, optional, picklist, pipe, string, uuid } from "valibot";
import { emailSchema, passwordSchema } from "#credentials/credentials.ts";
import { isValidUsername, nameSchema, phoneSchema } from "#profile/profile.ts";

export const createLoginEntries = {
  creationId: pipe(string(), uuid()),
  email: emailSchema,
  username: pipe(string(), check(isValidUsername)),
  name: nameSchema,
  phone: phoneSchema,
  password: passwordSchema,
  workspaceId: optional(pipe(string(), uuid())),
  kind: optional(picklist(["internal", "external"])),
};
