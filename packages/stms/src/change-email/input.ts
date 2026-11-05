import { emailSchema } from "@xpro/accounts";
import { optional, pipe, string, uuid } from "valibot";

export const changeEmailEntries = { loginId: pipe(string(), uuid()), email: emailSchema, comment: optional(string()) };
