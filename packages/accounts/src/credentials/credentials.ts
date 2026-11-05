import { email, maxLength, minLength, pipe, regex, string, toLowerCase, trim } from "valibot";

export const emailSchema = pipe(string(), trim(), toLowerCase(), email());

export const passwordSchema = pipe(
  string(),
  minLength(12),
  maxLength(64),
  regex(/\p{Lu}/u),
  regex(/\p{Nd}/u),
  regex(/[\p{P}\p{S}]/u),
);
