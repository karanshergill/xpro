import { boolean, optional, string } from "valibot";
import { nameSchema, phoneSchema } from "#profile/profile.ts";

export const firstSignInEntries = {
  username: optional(string()),
  name: optional(nameSchema),
  phone: optional(phoneSchema),
  isUsernameConfirmed: optional(boolean()),
};
