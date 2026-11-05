import { literal, optional, picklist, pipe, string, uuid } from "valibot";

export const suspensionReasons = ["stms_unpaid", "stms_abuse_or_misuse", "stms_security_concern",
  "stms_at_persons_request", "stms_other"] as const;
export type SuspensionReason = typeof suspensionReasons[number];
export const suspendLoginEntries = {
  loginId: pipe(string(), uuid()), reason: picklist(suspensionReasons), confirmed: literal(true), comment: optional(string()),
};
