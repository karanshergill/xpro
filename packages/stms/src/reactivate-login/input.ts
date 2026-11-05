import { pipe, string, uuid } from "valibot";

export const reactivateLoginEntries = { loginId: pipe(string(), uuid()) };
