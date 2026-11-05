import { pipe, string, uuid } from "valibot";

export const restoreLoginEntries = { loginId: pipe(string(), uuid()) };
