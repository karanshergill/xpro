import { is, pipe, string, uuid } from "valibot";

export function getPictureRevision(input: { loginId: string; key: string | null }): string | null {
  if (input.key === null) return null;
  const prefix = "profiles/" + input.loginId + "/", extension = ".png";
  const revision = input.key.slice(prefix.length, -extension.length);
  if (!input.key.startsWith(prefix) || !input.key.endsWith(extension) || !is(pipe(string(), uuid()), revision)) {
    throw new Error("The stored picture key is invalid.");
  }
  return revision;
}
