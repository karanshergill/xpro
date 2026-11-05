import { passwordSchema } from "@xpro/accounts";
import { optional, pipe, string, uuid } from "valibot";

export const resetPasswordEntries = {
  loginId: pipe(string(), uuid()), newPassword: passwordSchema, comment: optional(string()),
};
