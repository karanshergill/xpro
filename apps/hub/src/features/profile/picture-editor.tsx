import { useHydrated } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ReactCrop, centerCrop, makeAspectCrop, type PercentCrop } from "react-image-crop";
import { LoaderCircleIcon } from "lucide-react";
import { Button } from "@xpro/ui/button";
import { Field, FieldDescription, FieldLabel } from "#components/ui/field";
import { Input } from "#components/ui/input";
import { m } from "#paraglide/messages.js";
import { getLocale } from "#paraglide/runtime.js";
import { checkPicture, getInitials, type Profile, type ProfileFailure } from "./profile";
import { deletePicture, savePicture } from "./profile.data";
import { cropPicture } from "./crop";
import { ProfileNotice, useUnsavedProfile, type FormActions } from "./profile-form";

export function PictureEditor({ profile, onRefresh, ...actions }: FormActions & { profile: Profile; onRefresh(): Promise<boolean> }): React.JSX.Element {
  const isHydrated = useHydrated(), image = useRef<HTMLImageElement>(null), input = useRef<HTMLInputElement>(null), summary = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const operation = useRef(0), [source, setSource] = useState<string>(), [crop, setCrop] = useState<PercentCrop>();
  const [failure, setFailure] = useState<ProfileFailure>(), [isWorking, setIsWorking] = useState(false), [isSaved, setIsSaved] = useState(false);
  const isDisabled = !isHydrated || actions.disabled || isWorking;
  const isUploadDisabled = isDisabled || !profile.picturePolicy.canUpload;
  const maximumBytes = new Intl.NumberFormat(getLocale()).format(profile.picturePolicy.maximumBytes);
  const isPolicyFailure = failure?.code === "accounts_picture_uploads_unavailable" || failure?.code === "accounts_picture_too_large";
  useUnsavedProfile(Boolean(source));
  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);
  useEffect(() => () => { operation.current++; }, []);
  useEffect(() => { if (failure) summary.current?.focus(); }, [failure]);
  function discard(): void { operation.current++; setSource(undefined); setCrop(undefined); if (input.current) input.current.value = ""; }
  function focusEditor(): void {
    requestAnimationFrame(() => { if (input.current && !input.current.disabled) input.current.focus(); else heading.current?.focus(); });
  }
  function showFailure(error: ProfileFailure): void {
    setFailure(error); actions.onFailure(error);
  }
  async function handleFile(file: File | undefined): Promise<void> {
    const current = ++operation.current;
    setFailure(undefined); setIsSaved(false); setSource(undefined); setCrop(undefined);
    if (!file) return;
    try {
      const error = await checkPicture(file, profile.picturePolicy);
      if (current !== operation.current) return;
      if (error) { showFailure(error); return; }
      setSource(URL.createObjectURL(file));
    } catch { if (current === operation.current) showFailure({ code: "accounts_picture_invalid" }); }
  }
  async function handleSave(): Promise<void> {
    if (isUploadDisabled || !image.current || !crop) return;
    const current = ++operation.current;
    actions.onBusy(true); setIsWorking(true); setFailure(undefined); setIsSaved(false);
    try {
      const file = await cropPicture(image.current, crop);
      if (current !== operation.current) return;
      const error = await checkPicture(file, profile.picturePolicy);
      if (current !== operation.current) return;
      if (error) { showFailure(error); return; }
      const result = await savePicture(file, actions.loginId);
      if (current !== operation.current) return;
      if (result.status === "error") { showFailure(result.error); return; }
      discard();
      if (await onRefresh()) { setIsSaved(true); focusEditor(); }
    } catch { if (current === operation.current) showFailure({ code: "core_unexpected_error" }); }
    finally { actions.onBusy(false); setIsWorking(false); }
  }
  async function handleRemove(): Promise<void> {
    if (isDisabled) return;
    actions.onBusy(true); setIsWorking(true); setFailure(undefined); setIsSaved(false);
    try {
      const result = await deletePicture(actions.loginId);
      if (result.status === "error") { showFailure(result.error); return; }
      discard(); if (await onRefresh()) { setIsSaved(true); focusEditor(); }
    } catch { showFailure({ code: "core_unexpected_error" }); }
    finally { actions.onBusy(false); setIsWorking(false); }
  }
  const labels = { cropArea: m.accounts_profile_crop_area(), nwDragHandle: m.accounts_profile_crop_nw(), nDragHandle: m.accounts_profile_crop_n(),
    neDragHandle: m.accounts_profile_crop_ne(), eDragHandle: m.accounts_profile_crop_e(), seDragHandle: m.accounts_profile_crop_se(),
    sDragHandle: m.accounts_profile_crop_s(), swDragHandle: m.accounts_profile_crop_sw(), wDragHandle: m.accounts_profile_crop_w() };
  return <section className="space-y-5 rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="picture-title" aria-busy={isWorking}>
    <h2 ref={heading} id="picture-title" tabIndex={-1} className="text-xl font-semibold outline-none">{m.accounts_profile_picture()}</h2>
    <SavedPicture key={profile.pictureRevision} profile={profile} />
    {!profile.picturePolicy.canUpload ? <p id="picture-paused" role="status" className="text-sm">{m.accounts_profile_picture_paused()}</p> : null}
    {failure ? <div ref={summary} role="alert" tabIndex={-1} className="rounded-lg border border-destructive p-4 outline-none">
      <ProfileNotice failure={failure} />
      {failure.code === "core_unexpected_error" || failure.code === "accounts_picture_changed" || isPolicyFailure ? <>{failure.code === "core_unexpected_error" ? <p className="mt-2">{m.accounts_profile_picture_unknown()}</p> : null}
        <Button type="button" variant="outline" className="mt-3" disabled={isDisabled} onClick={async () => {
          if (await onRefresh()) { setFailure(undefined); focusEditor(); }
        }}>{isPolicyFailure ? m.accounts_profile_picture_options() : m.accounts_profile_picture_refresh()}</Button></> : null}
    </div> : null}
    <Field><FieldLabel htmlFor="profile-picture-file">{m.accounts_profile_picture_choose()}</FieldLabel>
      <Input ref={input} id="profile-picture-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={isUploadDisabled}
        aria-describedby={profile.picturePolicy.canUpload ? "picture-help" : "picture-help picture-paused"}
        onChange={async (event) => { await handleFile(event.target.files?.[0]); }} />
      <FieldDescription id="picture-help">{m.accounts_profile_picture_help({ maximumBytes })}</FieldDescription></Field>
    {source ? <div className="space-y-3">
      <p id="crop-help" className="text-sm">{m.accounts_profile_crop_help()}</p>
      <div className="max-w-full overflow-hidden"><ReactCrop crop={crop} aspect={1} minWidth={1} minHeight={1} keepSelection disabled={isUploadDisabled}
        ariaLabels={labels} onChange={(_pixel, percent) => { setCrop(percent); setIsSaved(false); }}>
        <img ref={image} src={source} alt={m.accounts_profile_crop_image()} className="max-h-96 max-w-full" aria-describedby="crop-help" onLoad={(event) => {
          const element = event.currentTarget;
          setCrop(centerCrop(makeAspectCrop({ unit: "%", width: 90 }, 1, element.naturalWidth, element.naturalHeight), element.naturalWidth, element.naturalHeight));
        }} onError={() => { discard(); showFailure({ code: "accounts_picture_invalid" }); }} />
      </ReactCrop></div>
      <div className="flex flex-wrap gap-3"><Button type="button" disabled={isUploadDisabled || !crop} onClick={handleSave}>
        {isWorking ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}{m.accounts_profile_picture_save()}</Button>
        <Button type="button" variant="outline" disabled={isDisabled} onClick={() => { discard(); setFailure(undefined); focusEditor(); }}>{m.accounts_profile_picture_discard()}</Button></div>
    </div> : null}
    {profile.pictureRevision ? <Button type="button" variant="outline" disabled={isDisabled} onClick={handleRemove}>{m.accounts_profile_picture_remove()}</Button> : null}
    <p role="status">{isWorking ? m.accounts_profile_saving() : isSaved ? m.accounts_profile_picture_saved() : ""}</p>
  </section>;
}

function SavedPicture({ profile }: { profile: Profile }): React.JSX.Element {
  const [hasFailed, setHasFailed] = useState(false);
  return <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-2xl font-medium" role="img" aria-label={m.accounts_profile_picture_current()}>
    {profile.pictureRevision && !hasFailed ? <img className="size-full object-cover" src={"/api/v1/profile-pictures/" + profile.pictureRevision} alt=""
      onError={() => setHasFailed(true)} /> : <span aria-hidden="true">{getInitials(profile.name, getLocale())}</span>}
  </div>;
}
