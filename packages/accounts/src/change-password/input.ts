import { maxLength, minLength, pipe, string } from "valibot";
import { passwordSchema } from "#credentials/credentials.ts";

export const changePasswordEntries = {
  currentPassword: pipe(string(), minLength(1), maxLength(64)),
  newPassword: passwordSchema,
};
