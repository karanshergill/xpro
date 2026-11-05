import { literal, optional, pipe, string, uuid } from "valibot";

export const archiveLoginEntries = {
  loginId: pipe(string(), uuid()), confirmed: literal(true), comment: optional(string()),
};
