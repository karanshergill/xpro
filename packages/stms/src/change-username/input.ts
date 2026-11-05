import { optional, pipe, string, uuid } from "valibot";

export const changeUsernameEntries = { loginId: pipe(string(), uuid()), username: string(), comment: optional(string()) };
