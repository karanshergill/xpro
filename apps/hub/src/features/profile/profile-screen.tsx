import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@xpro/ui/alert-dialog";
import { Button, buttonVariants } from "@xpro/ui/button";
import { m } from "#paraglide/messages.js";
import { clearMfaPrivateForms } from "#features/mfa/private-state";
import { MfaManagement } from "./mfa-management";
import { DetailsForm } from "./details-form";
import { PasswordForm } from "./password-form";
import { PictureEditor } from "./picture-editor";
import { loadProfile } from "./profile.data";
import { getFailureMessage, isAccessFailure, type Profile, type ProfileFailure } from "./profile";

export function ProfileScreen({ initial }: { initial: Profile }): React.JSX.Element {
  return <ProfileJourney key={initial.loginId} initial={initial} />;
}

function ProfileJourney({ initial }: { initial: Profile }): React.JSX.Element {
  const loginId = useRef(initial.loginId), heading = useRef<HTMLHeadingElement>(null), dialogHeading = useRef<HTMLHeadingElement>(null);
  const pending = useRef<AbortController | null>(null), [profile, setProfile] = useState(initial), [isBusy, setIsBusy] = useState(false);
  const [failure, setFailure] = useState<ProfileFailure>(), [isChecking, setIsChecking] = useState(false);
  const isMutating = useRef(false), shouldCheck = useRef(false), isVerifying = useRef(false);
  useEffect(() => { setProfile(initial); }, [initial]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); return () => pending.current?.abort(); }, []);
  useEffect(() => {
    const handleFocus = (): void => {
      if (document.visibilityState !== "visible" || isVerifying.current) return;
      if (isMutating.current) { shouldCheck.current = true; return; }
      void refresh();
    };
    window.addEventListener("focus", handleFocus); document.addEventListener("visibilitychange", handleFocus);
    return () => { window.removeEventListener("focus", handleFocus); document.removeEventListener("visibilitychange", handleFocus); };
  }, []);
  function handleFailure(error: ProfileFailure): void {
    if (error.code === "core_mfa_recent_verification_required") { setProfile((previous) => ({ ...previous, mfa: "recent_required" })); return; }
    if (isAccessFailure(error)) showFailure(error);
  }
  function beginVerification(): void { isVerifying.current = true; }
  function showFailure(error: ProfileFailure): void { clearMfaPrivateForms(); setFailure(error); }
  function handleBusy(isWorking: boolean): void {
    isMutating.current = isWorking; setIsBusy(isWorking);
    if (isWorking) { pending.current?.abort(); pending.current = null; setIsChecking(false); }
    else if (shouldCheck.current) { shouldCheck.current = false; void refresh(); }
  }
  async function refresh(): Promise<Profile | null> {
    shouldCheck.current = false; isVerifying.current = false;
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller; setIsChecking(true);
    try {
      const result = await loadProfile({ loginId: loginId.current, signal: controller.signal });
      if (controller.signal.aborted || pending.current !== controller) return null;
      if (result.status === "error") { showFailure(result.error); return null; }
      setProfile(result.profile); setFailure(undefined); return result.profile;
    } catch { if (!controller.signal.aborted) showFailure({ code: "core_unexpected_error" }); return null; }
    finally { if (pending.current === controller) { pending.current = null; setIsChecking(false); } }
  }
  const actions = { loginId: loginId.current, disabled: isBusy || isChecking || Boolean(failure), onBusy: handleBusy, onFailure: handleFailure };
  const canSignIn = failure?.code === "core_unauthenticated" || failure?.code === "core_profile_incomplete" || failure?.code === "core_mfa_required";
  return <ProfileShell>
    <div id="profile-content" inert={Boolean(failure)} aria-hidden={failure ? true : undefined} className={failure ? "invisible" : "space-y-6"}>
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.accounts_profile_title()}</h1>
      <DetailsForm profile={profile} {...actions} onSaved={(value) => setProfile((previous) => ({ ...previous, ...value }))} />
      <PictureEditor profile={profile} {...actions} onRefresh={async () => Boolean(await refresh())} />
      <PasswordForm {...actions} />
      {profile.mfa !== "unavailable" && !failure ? <MfaManagement profile={profile} {...actions} isChecking={isChecking} onSignIn={beginVerification} onRefresh={refresh} /> : null}
    </div>
    <AlertDialog open={Boolean(failure)}><AlertDialogContent initialFocus={dialogHeading}>
      <AlertDialogTitle ref={dialogHeading} tabIndex={-1}>{m.accounts_profile_access_title()}</AlertDialogTitle>
      <AlertDialogDescription>{getFailureMessage(failure ?? { code: "core_unexpected_error" })}</AlertDialogDescription>
      {failure?.requestId ? <p className="break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
      <p className="text-sm">{m.accounts_profile_draft_kept()}</p>
      <div className="flex flex-wrap gap-3">
        {canSignIn ? <a className={buttonVariants()} href="/sign-in" onClick={beginVerification} target="_blank" rel="noopener noreferrer">{m.accounts_profile_sign_in_tab()}</a> : null}
        <Button type="button" variant="outline" disabled={isChecking || isBusy} onClick={refresh}>{isChecking ? m.core_loading() : m.accounts_profile_access_check()}</Button>
        {failure?.code === "core_identity_changed" || failure?.code === "core_login_inactive" || failure?.code === "core_forbidden"
          ? <Button type="button" variant="outline" onClick={() => location.reload()}>{m.accounts_profile_reload()}</Button> : null}
      </div>
    </AlertDialogContent></AlertDialog>
  </ProfileShell>;
}

export function ProfileError({ failure }: { failure?: ProfileFailure }): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null); useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <ProfileShell><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.accounts_profile_page_error()}</h1>
    <p role="alert" className="mt-4">{getFailureMessage(failure ?? { code: "core_unexpected_error" })}</p>
    {failure?.requestId ? <p className="mt-3 break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
    <Button type="button" className="mt-5" onClick={() => location.reload()}>{m.core_retry()}</Button></ProfileShell>;
}

export function ProfilePending(): React.JSX.Element {
  return <ProfileShell><h1 className="text-2xl font-semibold">{m.accounts_profile_title()}</h1>
    <div className="mt-6 animate-pulse space-y-6" aria-hidden="true">{[1, 2, 3].map((key) => <div key={key} className="h-96 rounded-xl bg-muted" />)}</div>
    <p role="status" className="sr-only">{m.core_loading()}</p></ProfileShell>;
}

function ProfileShell({ children }: { children: ReactNode }): React.JSX.Element {
  return <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">{children}</main>;
}
