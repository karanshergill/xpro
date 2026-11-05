import { array, object, optional, pipe, safeParse, string, uuid } from "valibot";
import { pageLoginIdHeader } from "@xpro/core";
import { callHubFunction } from "#functions/call";
import { getProfilePage } from "#functions/profile-page.functions";
import { changePassword, updateProfile } from "#functions/profile.functions";
import { removePicture } from "#functions/picture.functions";
import { profileSchema, type Details, type ProfileFailure, type ProfilePage, type SaveResult } from "./profile";

const idSchema = pipe(string(), uuid());
const savedSchema = object({ loginId: idSchema });
const errorSchema = object({ code: string(), requestId: idSchema, fields: optional(array(string())) });

export async function loadProfile(options: { loginId?: string; signal?: AbortSignal } = {}): Promise<ProfilePage> {
  const response = await callHubFunction((fetch) => getProfilePage({ data: {}, fetch, signal: options.signal,
    headers: options.loginId ? { [pageLoginIdHeader]: options.loginId } : undefined }));
  if (!response.ok) return { status: "error", error: await readFailure(response) };
  const parsed = safeParse(profileSchema, await response.json());
  if (!parsed.success) throw new Error("The profile read returned an invalid result.");
  if (options.loginId && parsed.output.loginId !== options.loginId) return { status: "error", error: { code: "core_identity_changed" } };
  return { status: "ready", profile: parsed.output };
}

export async function saveDetails(value: Details, loginId: string): Promise<SaveResult> {
  return await readSave(await callHubFunction((fetch) => updateProfile({ data: value, headers: { [pageLoginIdHeader]: loginId }, fetch })), loginId);
}

export async function savePassword(value: { currentPassword: string; newPassword: string }, loginId: string): Promise<SaveResult> {
  return await readSave(await callHubFunction((fetch) => changePassword({ data: value, headers: { [pageLoginIdHeader]: loginId }, fetch })), loginId);
}

export async function savePicture(file: File, loginId: string): Promise<SaveResult> {
  const body = new FormData(); body.set("file", file);
  return await readSave(await fetch("/api/v1/profile-pictures", { method: "POST", body, headers: { [pageLoginIdHeader]: loginId }, cache: "no-store" }), loginId);
}

export async function deletePicture(loginId: string): Promise<SaveResult> {
  return await readSave(await callHubFunction((fetch) => removePicture({ data: {}, headers: { [pageLoginIdHeader]: loginId }, fetch })), loginId);
}

async function readSave(response: Response, loginId: string): Promise<SaveResult> {
  if (!response.ok) return { status: "error", error: await readFailure(response) };
  const parsed = safeParse(savedSchema, await response.json());
  if (!parsed.success || parsed.output.loginId !== loginId) throw new Error("The profile save returned an invalid result.");
  return { status: "saved" };
}

async function readFailure(response: Response): Promise<ProfileFailure> {
  const parsed = safeParse(errorSchema, await response.json());
  return parsed.success ? parsed.output : { code: "core_unexpected_error" };
}
