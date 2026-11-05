import { maximumPictureBytes, uploadPictureEntries } from "@xpro/accounts";
import type { PictureError } from "@xpro/accounts/server";
import { maxJsonBodyBytes, parseInput, type CoreError } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";

const maximumMultipartBytes = maximumPictureBytes + maxJsonBodyBytes;

export async function readPictureUpload(request: Request, maximumBytes: number): Promise<Result<{ file: File }, PictureError>> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "multipart/form-data") {
    return err({ code: "core_unsupported_media_type" });
  }
  const bytes = await readBoundedBytes(request.body, maximumMultipartBytes);
  if (bytes.isErr) return err(bytes.error);
  try {
    const form = await new Response(bytes.value, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    const entries = [...form.entries()];
    if (entries.some(([name]) => name !== "file")) return err({ code: "core_invalid_input", fields: [] });
    if (entries.length !== 1) return err({ code: "core_invalid_input", fields: ["file"] });
    const parsed = parseInput(Object.fromEntries(entries), uploadPictureEntries);
    if (parsed.isErr) return err(parsed.error);
    if (parsed.value.file.size > maximumPictureBytes || parsed.value.file.size > maximumBytes) return err({ code: "accounts_picture_too_large" });
    return ok(parsed.value);
  } catch { return err({ code: "core_invalid_input", fields: ["file"] }); }
}

export async function readBoundedBytes(
  stream: ReadableStream<Uint8Array> | null, maximumBytes: number,
): Promise<Result<Uint8Array<ArrayBuffer>, CoreError>> {
  if (!stream) return err({ code: "core_invalid_input", fields: ["file"] });
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let failure: CoreError = { code: "core_invalid_input", fields: ["file"] };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        failure = { code: "core_request_too_large" };
        await reader.cancel();
        return err(failure);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return ok(bytes);
  } catch { return err(failure); }
  finally { reader.releaseLock(); }
}
