import { reportUnexpectedError, type RequestContext } from "@xpro/core/server";
import { v7 as uuid } from "uuid";
import { changePicture, readPicture } from "./picture.db";

type Services = { database: D1Database; pictures: R2Bucket; context: RequestContext };
type PreviousPicture = { loginId: string; previousKey: string | null };

export async function storePicture(services: Services, input: PreviousPicture & { picture: Blob }): Promise<boolean> {
  requireOwnedKey(input);
  const key = "profiles/" + input.loginId + "/" + uuid() + ".png";
  let isSavingKey = false;
  try {
    await services.pictures.put(key, input.picture.stream(), { httpMetadata: { contentType: "image/png" } });
    isSavingKey = true;
    const isSaved = await changePicture(services.database, {
      loginId: input.loginId, previousKey: input.previousKey, nextKey: key, updatedAt: new Date().toISOString(),
    });
    if (isSaved) {
      await discardPreviousPicture(services, input.previousKey);
      return true;
    }
  } catch (error) {
    if (isSavingKey) {
      let current: Awaited<ReturnType<typeof readPicture>>;
      try { current = await readPicture(services.database, input.loginId); }
      catch (confirmationError) {
        // An unconfirmed commit may reference the new object; keep both private files.
        throw new AggregateError([error, confirmationError], "Picture save could not be confirmed.");
      }
      if (current?.key === key) {
        await discardPreviousPicture(services, input.previousKey);
        return true;
      }
    }
    try { await services.pictures.delete(key); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Staged picture cleanup failed."); }
    throw error;
  }
  await services.pictures.delete(key);
  return false;
}

export async function clearPicture(services: Services, input: PreviousPicture): Promise<boolean> {
  requireOwnedKey(input);
  let isSaved: boolean;
  try {
    isSaved = await changePicture(services.database, { ...input, nextKey: null, updatedAt: new Date().toISOString() });
  } catch (error) {
    const current = await readPicture(services.database, input.loginId);
    if (current?.key !== null) throw error;
    isSaved = true;
  }
  if (isSaved) await discardPreviousPicture(services, input.previousKey);
  return isSaved;
}

async function discardPreviousPicture(services: Services, key: string | null): Promise<void> {
  if (key === null) return;
  try { await services.pictures.delete(key); }
  catch {
    // shortcut: an old private object can remain after cleanup fails; add a cleanup
    // job when storage usage or a strict deletion/retention requirement warrants it.
    reportUnexpectedError(services.context, { app: "hub", operation: "accounts_discard_previous_picture" });
  }
}

function requireOwnedKey(input: PreviousPicture): void {
  if (input.previousKey !== null && !input.previousKey.startsWith("profiles/" + input.loginId + "/")) {
    throw new Error("The stored picture key does not belong to this login.");
  }
}
