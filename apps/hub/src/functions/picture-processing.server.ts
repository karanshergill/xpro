import { maximumPictureBytes, maximumPictureSide } from "@xpro/accounts";
import type { PictureProcessingError } from "@xpro/accounts/server";
import { err, ok, type Result } from "true-myth/result";
import { readBoundedBytes } from "./picture-input.server";

type ImageService = Pick<ImagesBinding, "info" | "input">;
const processingTimeoutMilliseconds = 10_000;

export async function processPicture(file: File, images: ImageService): Promise<Result<Blob, PictureProcessingError>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Late image work has no database/storage effects; the caller saves only the returned result.
    return await Promise.race([
      transformPicture(file, images),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Picture processing timed out.")), processingTimeoutMilliseconds);
      }),
    ]);
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error) {
      if (error.code === 9412 || error.code === 9413) return err({ code: "accounts_picture_invalid" });
      if (error.code === 9520) return err({ code: "accounts_picture_type_invalid" });
    }
    throw error;
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

async function transformPicture(file: File, images: ImageService): Promise<Result<Blob, PictureProcessingError>> {
  const info = await images.info(file.stream());
  const formats = ["image/jpeg", "image/png", "image/webp"];
  if (!("width" in info) || !formats.includes(info.format)) return err({ code: "accounts_picture_type_invalid" });
  if (!Number.isInteger(info.width) || !Number.isInteger(info.height) || info.width <= 0 || info.height <= 0) {
    return err({ code: "accounts_picture_invalid" });
  }
  const side = Math.min(info.width, info.height, maximumPictureSide);
  const output = await images.input(file.stream()).transform({ width: side, height: side, fit: "cover" })
    .output({ format: "image/png", anim: false });
  const response = output.response();
  if (response.headers.get("content-type") !== "image/png") throw new Error("Picture processor returned an unexpected format.");
  const bytes = await readBoundedBytes(response.body, maximumPictureBytes);
  if (bytes.isErr || bytes.value.byteLength === 0) throw new Error("Picture processor returned an invalid output.");
  // Cloudflare discards metadata for PNG output; no original image bytes are stored.
  return ok(new Blob([bytes.value], { type: "image/png" }));
}
