import { useHydrated } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, buttonVariants } from "@xpro/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@xpro/ui/alert-dialog";
import { readPageSearch } from "#page-search";
import { m } from "#paraglide/messages.js";
import { MfaAccessCheck } from "./access-check";
import { clearMfaPrivateForms, useClearMfaOnLeave } from "./private-state";
import { MfaForm } from "./mfa-form";
import { PrivateCodes, SetupKey } from "./private-codes";
import { beginSetup, loadMfaPage, restartSetup, signOutMfa, verifyEnrollment, verifySignIn } from "./mfa.data";
import { getMfaMessage, isMfaAccessFailure, readReplacementIntent, type MfaFailure, type MfaPage, type MfaResult, type SetupMaterial } from "./mfa";

type Ready = Extract<MfaPage, { status: "ready" }>;
const setupQrSize = 224, setupQrQuietZoneModules = 4;

export function MfaScreen({ page }: { page: Ready }): React.JSX.Element {
  // Session cookies rotate during native verification. Only a login change
  // replaces this private display; same-login route revalidation preserves it.
  return <MfaJourney key={page.loginId} page={page} />;
}

function MfaJourney({ page }: { page: Ready }): React.JSX.Element {
  const isHydrated = useHydrated(), search = readPageSearch();
  const [material, setMaterial] = useState<SetupMaterial>(), [hasVerified, setHasVerified] = useState(false);
  const [method, setMethod] = useState<"totp" | "backup">("totp"), [confirmation, setConfirmation] = useState<"replace" | "restart" | null>(null);
  const [isBusy, setIsBusy] = useState(false), [isChecking, setIsChecking] = useState(false), [failure, setFailure] = useState<MfaFailure>();
  const [management, setManagement] = useState(page.management);
  const [liveStep, setLiveStep] = useState(page.step), heading = useRef<HTMLHeadingElement>(null), dialogHeading = useRef<HTMLHeadingElement>(null);
  const isVerifying = useRef(false);
  const hasContinued = useRef(false), pending = useRef<AbortController | null>(null);
  const currentMaterial = useRef<SetupMaterial | undefined>(undefined), isMutating = useRef(false), shouldCheck = useRef(false), requestCheck = useRef(() => {});
  const step = material ? "pending" : hasVerified ? "complete" : liveStep, hasCodes = hasVerified && Boolean(material);
  const isReplacement = readReplacementIntent(search) && liveStep === "complete" && management !== "unavailable" && !material && !hasVerified;
  useClearMfaOnLeave(clearPrivate);
  useEffect(() => { applyPage(page); }, [page.step, page.setupId, page.management]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step, hasCodes, method]);
  useEffect(() => {
    async function checkAccess(): Promise<void> {
      if (document.visibilityState !== "visible") return;
      if (isMutating.current) { shouldCheck.current = true; return; }
      pending.current?.abort(); const controller = new AbortController(); pending.current = controller; setIsChecking(true);
      try {
        const result = await loadMfaPage({ loginId: page.loginId, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.status === "error") { clearPrivate(); setFailure(result.error); }
        else applyPage(result);
      } catch { if (!controller.signal.aborted) { clearPrivate(); setFailure({ code: "core_unexpected_error" }); } }
      finally { if (!controller.signal.aborted) setIsChecking(false); }
    }
    const handleFocus = (): void => { if (!isVerifying.current) void checkAccess(); };
    requestCheck.current = () => { isVerifying.current = false; void checkAccess(); };
    window.addEventListener("focus", handleFocus); document.addEventListener("visibilitychange", handleFocus);
    return () => { pending.current?.abort(); requestCheck.current = () => {}; window.removeEventListener("focus", handleFocus); document.removeEventListener("visibilitychange", handleFocus); };
  }, [page.loginId]);
  useEffect(() => {
    if (liveStep === "complete" && !material && !hasVerified && !failure && !isReplacement && !hasContinued.current) {
      hasContinued.current = true; window.location.assign("/complete-profile" + search);
    }
  }, [liveStep, material, hasVerified, failure, search, isReplacement]);
  function clearPrivate(): void {
    currentMaterial.current = undefined; setMaterial(undefined); setConfirmation(null); clearMfaPrivateForms();
  }
  function applyPage(result: Ready): void {
    if (currentMaterial.current && currentMaterial.current.setupId !== result.setupId) {
      clearPrivate(); setFailure({ code: "accounts_mfa_setup_changed" }); return;
    }
    setLiveStep(result.step); setManagement(result.management);
    if (currentMaterial.current && result.step === "complete") setHasVerified(true);
  }
  function handleBusy(isWorking: boolean): void {
    isMutating.current = isWorking; setIsBusy(isWorking);
    if (isWorking) { pending.current?.abort(); setIsChecking(false); }
    else if (shouldCheck.current) { shouldCheck.current = false; requestCheck.current(); }
  }
  function handleFailure(error: MfaFailure): void {
    if (error.code === "core_mfa_recent_verification_required") { setManagement("recent_required"); return; }
    if (isMfaAccessFailure(error)) { clearPrivate(); setFailure(error); }
  }
  function handleCompleted(result: Exclude<MfaResult, { status: "error" }>): void {
    if (result.status === "setup") { currentMaterial.current = result.material; setMaterial(result.material); setHasVerified(false); setConfirmation(null); return; }
    setHasVerified(true);
    if (result.destination) { clearPrivate(); window.location.assign(result.destination); }
  }
  async function handleContinue(): Promise<void> {
    clearPrivate(); window.location.assign("/complete-profile" + search);
  }
  if (failure) return <MfaError failure={failure} />;
  const isDisabled = !isHydrated || isBusy || isChecking;
  return <MfaShell>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
      {hasCodes ? m.accounts_mfa_backups_title() : isReplacement ? m.accounts_mfa_replace() : step === "verify" ? m.accounts_mfa_verify_title() : step === "complete" ? m.accounts_mfa_complete_title() : m.accounts_mfa_setup_title()}
    </h1>
    <div className="mt-5 space-y-6">
      {hasCodes && material ? <PrivateCodes codes={material.backupCodes} disabled={isDisabled} onContinue={handleContinue} /> : isReplacement ? <>
        <p className="text-sm leading-6">{m.accounts_mfa_replace_warning()}</p>
        {management === "recent_required" && !confirmation ? <MfaAccessCheck onSignIn={() => { isVerifying.current = true; }} isChecking={isChecking} onCheck={() => requestCheck.current()} /> : null}
        <Button type="button" disabled={isDisabled || management !== "ready"} onClick={() => setConfirmation("replace")}>{m.accounts_mfa_replace()}</Button>
        <a className={buttonVariants({ variant: "outline" })} href="/profile">{m.accounts_profile_title()}</a>
      </> : step === "setup" ? <>
        <p className="text-sm leading-6">{m.accounts_mfa_setup_intro()}</p>
        <MfaForm key="setup" kind="password" label={m.accounts_profile_current_password()} submitLabel={m.accounts_mfa_begin()}
          disabled={isDisabled} onBusy={handleBusy} onSubmit={async (password) => await beginSetup(password, page.loginId)} onCompleted={handleCompleted} onFailure={handleFailure} />
      </> : step === "pending" ? <>
        {material ? <>
          <p className="text-sm leading-6">{m.accounts_mfa_scan_intro()}</p>
          <QRCodeSVG data-mfa-qr value={material.totpUri} size={setupQrSize} marginSize={setupQrQuietZoneModules}
            role="img" title={m.accounts_mfa_qr_title()} className="mx-auto h-auto max-w-full" />
          <dl className="space-y-2 text-sm [overflow-wrap:anywhere]"><div><dt className="font-medium">{m.accounts_mfa_account()}</dt><dd>{material.account}</dd></div>
            <div><dt className="font-medium">{m.accounts_mfa_settings()}</dt><dd>{m.accounts_mfa_settings_value({ digits: material.digits, period: material.period })}</dd></div></dl>
          <SetupKey setupKey={material.key} />
        </> : <p className="text-sm leading-6">{m.accounts_mfa_pending_intro()}</p>}
        <MfaForm key="enrollment" kind="totp" label={m.accounts_mfa_authenticator_code()} submitLabel={m.accounts_mfa_verify()}
          disabled={isDisabled} onBusy={handleBusy} onSubmit={async (code) => await verifyEnrollment(code, page.loginId)} onCompleted={handleCompleted} onFailure={handleFailure} />
        <Button type="button" variant="outline" disabled={isDisabled} onClick={() => setConfirmation("restart")}>{m.accounts_mfa_restart()}</Button>
      </> : step === "verify" ? <>
        <p className="text-sm leading-6">{method === "totp" ? m.accounts_mfa_authenticator_intro() : m.accounts_mfa_backup_intro()}</p>
        <MfaForm key={method} kind={method} label={method === "totp" ? m.accounts_mfa_authenticator_code() : m.accounts_mfa_backup_code()} submitLabel={m.accounts_mfa_verify()}
          disabled={isDisabled} onBusy={handleBusy} onSubmit={async (code) => await verifySignIn({ code, method }, page.loginId)} onCompleted={handleCompleted} onFailure={handleFailure} />
        <Button type="button" variant="outline" disabled={isDisabled} onClick={() => setMethod(method === "totp" ? "backup" : "totp")}>
          {method === "totp" ? m.accounts_mfa_use_backup() : m.accounts_mfa_use_authenticator()}</Button>
      </> : hasVerified ? <>
        <p role="status" className="text-sm leading-6">{m.accounts_mfa_lost_codes()}</p>
        <div className="flex flex-wrap gap-3"><a className={buttonVariants({ variant: "outline" })} href="/profile" target="_blank" rel="noopener noreferrer">{m.accounts_mfa_profile_tab()}</a>
          <Button type="button" disabled={isDisabled} onClick={handleContinue}>{m.core_continue()}</Button></div>
      </> : <p role="status">{m.accounts_complete_profile_continuing()}</p>}
      {step === "verify" ? <a className={buttonVariants({ variant: "outline" })} href={"/sign-in" + search} onClick={clearPrivate}>{m.accounts_sign_in_start_again()}</a>
        : step !== "complete" ? <Button type="button" variant="outline" disabled={isDisabled} onClick={async () => {
          clearPrivate(); handleBusy(true);
          try { await signOutMfa(); } catch { setFailure({ code: "core_unexpected_error" }); }
          finally { handleBusy(false); }
        }}>{m.accounts_mfa_sign_out()}</Button> : null}
      <p role="status" className="sr-only">{isChecking ? m.core_loading() : ""}</p>
    </div>
    <AlertDialog open={confirmation !== null} onOpenChange={(open) => { if (!open && !isBusy) setConfirmation(null); }}>
      <AlertDialogContent initialFocus={dialogHeading} finalFocus={heading}>
        <AlertDialogTitle ref={dialogHeading} tabIndex={-1}>{confirmation === "replace" ? m.accounts_mfa_replace() : m.accounts_mfa_restart()}</AlertDialogTitle>
        <AlertDialogDescription>{confirmation === "replace" ? m.accounts_mfa_replace_warning() : m.accounts_mfa_restart_warning()}</AlertDialogDescription>
        {confirmation === "replace" && management === "recent_required" ? <MfaAccessCheck onSignIn={() => { isVerifying.current = true; }} isChecking={isChecking} onCheck={() => requestCheck.current()} /> : null}
        {confirmation ? <MfaForm key={confirmation} kind="password" label={m.accounts_profile_current_password()} submitLabel={confirmation === "replace" ? m.accounts_mfa_replace_confirm() : m.accounts_mfa_restart_confirm()} access={management}
          disabled={isDisabled || confirmation === "replace" && management !== "ready"} onBusy={handleBusy} onSubmit={async (password) => await restartSetup(password, page.loginId)} onCompleted={handleCompleted} onFailure={handleFailure} /> : null}
        <Button type="button" variant="outline" disabled={isBusy} onClick={() => setConfirmation(null)}>{m.accounts_mfa_cancel()}</Button>
      </AlertDialogContent>
    </AlertDialog>
  </MfaShell>;
}

export function MfaPending(): React.JSX.Element {
  return <MfaShell><h1 className="text-2xl font-semibold">{m.accounts_mfa_verify_title()}</h1>
    <div role="status" className="mt-6 space-y-5"><span className="sr-only">{m.core_loading()}</span>
      <div className="h-12 rounded-lg bg-muted" aria-hidden="true" /><div className="h-11 rounded-lg bg-muted" aria-hidden="true" />
      <Button disabled>{m.accounts_mfa_verify()}</Button></div></MfaShell>;
}

export function MfaError({ failure = { code: "core_unexpected_error" } }: { failure?: MfaFailure }): React.JSX.Element {
  const search = readPageSearch(), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <MfaShell><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.core_error_title()}</h1>
    <p role="alert" className="mt-4 text-sm leading-6">{getMfaMessage(failure)}</p>
    {failure.requestId ? <p className="mt-3 break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
    <div className="mt-6 flex flex-wrap gap-3"><a className={buttonVariants()} href={"/sign-in" + search}>{m.accounts_sign_in_start_again()}</a>
      <Button variant="outline" type="button" onClick={() => window.location.reload()}>{m.core_retry()}</Button></div>
  </MfaShell>;
}

function MfaShell({ children }: { children: ReactNode }): React.JSX.Element {
  return <main className="mx-auto w-full max-w-lg px-4 py-8 sm:py-14"><p className="mb-6 text-lg font-semibold tracking-tight">{m.core_app_name()}</p>
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">{children}</section></main>;
}
