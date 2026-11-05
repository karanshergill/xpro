import { parseInput, reportUnexpectedError, type AccessRequest, type CoreError, type RequestContext } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { hasSupportedPictureContent, maximumPictureBytes, removePictureEntries, uploadPictureEntries } from "./input";
import { readPicture } from "./picture.db";
import { clearPicture, storePicture } from "./picture-storage.server";
import type { PicturePolicy } from "./policy";

export type PictureProcessingError = { code: "accounts_picture_invalid" | "accounts_picture_type_invalid" };
export type PictureError = CoreError | PictureProcessingError | { code: "accounts_picture_too_large" | "accounts_picture_changed" | "accounts_picture_uploads_unavailable" };
export type PictureServices = {
  database: D1Database; access: AccessRequest; context: RequestContext; pictures: R2Bucket; policy: PicturePolicy;
  processPicture(file: File): Promise<Result<Blob, PictureProcessingError>>;
};
type RemovalServices = Omit<PictureServices, "processPicture" | "policy">;

export async function uploadPicture(input: unknown, services: PictureServices): Promise<Result<{ loginId: string }, PictureError>> {
  const actor = services.access.authorize({ kind: "protected", hasLocalPermission: true });
  if (actor.isErr) return err(actor.error);
  if (!services.policy.canUpload) return err({ code: "accounts_picture_uploads_unavailable" });
  const parsed = parseInput(input, uploadPictureEntries);
  if (parsed.isErr) return err(parsed.error);
  const file = parsed.value.file;
  if (file.size > maximumPictureBytes || file.size > services.policy.maximumBytes) return err({ code: "accounts_picture_too_large" });
  if (file.size === 0) return err({ code: "accounts_picture_invalid" });
  try {
    if (!hasSupportedPictureContent(new Uint8Array(await file.slice(0, 12).arrayBuffer()))) return err({ code: "accounts_picture_type_invalid" });
    const loginId = actor.value.loginId;
    const previous = await readPicture(services.database, loginId);
    if (!previous) return err({ code: "core_unauthenticated" });
    const processed = await services.processPicture(file);
    if (processed.isErr) return err(processed.error);
    const isSaved = await storePicture(services, { loginId, previousKey: previous.key, picture: processed.value });
    return isSaved ? ok({ loginId }) : err({ code: "accounts_picture_changed" });
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation: "accounts_upload_picture" });
    return err({ code: "core_unexpected_error" });
  }
}

export async function removePicture(input: unknown, services: RemovalServices): Promise<Result<{ loginId: string }, PictureError>> {
  const actor = services.access.authorize({ kind: "protected", hasLocalPermission: true });
  if (actor.isErr) return err(actor.error);
  const parsed = parseInput(input, removePictureEntries);
  if (parsed.isErr) return err(parsed.error);
  try {
    const loginId = actor.value.loginId;
    const previous = await readPicture(services.database, loginId);
    if (!previous) return err({ code: "core_unauthenticated" });
    if (previous.key === null) return ok({ loginId });
    const isSaved = await clearPicture(services, { loginId, previousKey: previous.key });
    return isSaved ? ok({ loginId }) : err({ code: "accounts_picture_changed" });
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation: "accounts_remove_picture" });
    return err({ code: "core_unexpected_error" });
  }
}

