import { useEffect, useRef, useState } from "react";
import type { LoginDetails } from "@xpro/stms";
import { formatDateTime } from "@xpro/core";
import { Button, buttonVariants } from "@xpro/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@xpro/ui/alert-dialog";
import { ResetPassword } from "#components/stms/reset-password";
import { m } from "#paraglide/messages.js";
import { getLocale } from "#paraglide/runtime.js";
import { getFailureMessage, getListHref, isAccessFailure, type LoginSearch, type ManagementFailure } from "./management";
import { loadLogin } from "./management.data";
import { StmsShell } from "./management-ui";
import { IdentifierEditor } from "./identifier-editor";
import { StatusEditor } from "./status-editor";

export function LoginDetail(props: { initial: LoginDetails; pageLoginId: string; search: LoginSearch }): React.JSX.Element {
  return <DetailScreen key={props.initial.loginId + "/" + props.pageLoginId} {...props} />;
}

function DetailScreen({ initial, pageLoginId, search }: { initial: LoginDetails; pageLoginId: string; search: LoginSearch }): React.JSX.Element {
  const [login, setLogin] = useState(initial), [isBusy, setIsBusy] = useState(false), [isChecking, setIsChecking] = useState(false);
  const [failure, setFailure] = useState<ManagementFailure>(), [hasSavedChange, setHasSavedChange] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), dialogHeading = useRef<HTMLHeadingElement>(null), pending = useRef<AbortController | null>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); return () => pending.current?.abort(); }, []);
  function handleFailure(error: ManagementFailure): void { if (isAccessFailure(error)) setFailure(error); }
  function handleBusy(value: boolean): void { if (value) setHasSavedChange(false); setIsBusy(value); }
  async function checkAccess(): Promise<boolean> {
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller; setIsChecking(true);
    try {
      const page = await loadLogin(initial.loginId, { pageLoginId, signal: controller.signal });
      if (controller.signal.aborted || pending.current !== controller) return false;
      if (page.status === "error") { setFailure(page.error); return false; }
      setLogin(page.value); setFailure(undefined); setHasSavedChange(false); return true;
    } catch { if (!controller.signal.aborted) setFailure({ code: "core_unexpected_error" }); return false; }
    finally { if (pending.current === controller) { pending.current = null; setIsChecking(false); } }
  }
  async function refreshAfterSave(): Promise<boolean> { setHasSavedChange(true); return await checkAccess(); }
  const actions = { pageLoginId, disabled: isBusy || isChecking || Boolean(failure), onBusy: handleBusy, onFailure: handleFailure, onSaved: refreshAfterSave, onRefresh: checkAccess };
  const canSignIn = failure?.code === "core_unauthenticated" || failure?.code === "core_profile_incomplete";
  const rows = [
    [m.stms_logins_name(), login.name || m.stms_logins_not_set()], [m.stms_logins_username(), login.username ?? m.stms_logins_not_set()],
    [m.stms_logins_email(), login.email], [m.stms_logins_phone(), login.phone ?? m.stms_logins_not_set()],
    [m.stms_logins_created(), formatDateTime(login.createdAt, { locale: getLocale(), timeZone: "UTC" })],
    [m.stms_logins_workspace(), login.workspace?.name ?? m.stms_logins_no_workspace()],
  ];
  return <StmsShell>
    <div id="stms-detail-content" inert={Boolean(failure)} aria-hidden={failure ? true : undefined} className={failure ? "invisible" : "space-y-6"}>
      <a href={getListHref(search)} className="inline-flex min-h-6 items-center text-sm underline underline-offset-4">{m.stms_logins_back()}</a>
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.stms_logins_detail_title()}</h1>
      <dl className="grid gap-x-8 gap-y-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2 sm:p-6">{rows.map(([label, value]) =>
        <div key={label} className="min-w-0"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 [overflow-wrap:anywhere]"><bdi>{value}</bdi></dd></div>)}</dl>
      <StatusEditor login={login} {...actions} />
      <div className="grid items-start gap-6 lg:grid-cols-2"><IdentifierEditor login={login} field="email" {...actions} /><IdentifierEditor login={login} field="username" {...actions} /></div>
      <div className="rounded-xl border border-border bg-card p-5 sm:p-6"><ResetPassword login={login} pageLoginId={pageLoginId} disabled={actions.disabled}
        onBusy={handleBusy} onFailure={handleFailure} onSaved={() => { if (login.loginId === pageLoginId) void refreshAfterSave(); }} /></div>
    </div>
    <AlertDialog open={Boolean(failure)}><AlertDialogContent initialFocus={dialogHeading}>
      <AlertDialogTitle ref={dialogHeading} tabIndex={-1}>{hasSavedChange ? m.stms_logins_saved_access_title() : m.stms_logins_access_title()}</AlertDialogTitle>
      {hasSavedChange ? <p>{m.stms_logins_confirmed_saved()}</p> : null}
      <AlertDialogDescription>{getFailureMessage(failure ?? { code: "core_unexpected_error" })}</AlertDialogDescription>
      <p className="text-sm">{m.stms_logins_draft_kept()}</p>
      {failure?.requestId ? <p className="break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
      <div className="flex flex-wrap gap-3">
        {canSignIn ? <a className={buttonVariants()} href="/sign-in" target="_blank" rel="noopener noreferrer">{m.stms_logins_sign_in_tab()}</a> : null}
        <Button type="button" variant="outline" disabled={isChecking || isBusy} onClick={async () => { await checkAccess(); }}>{isChecking ? m.core_loading() : m.stms_logins_access_check()}</Button>
        {failure?.code === "core_identity_changed" || failure?.code === "core_forbidden" || failure?.code === "core_login_inactive" ? <Button type="button" variant="outline" onClick={() => location.reload()}>{m.stms_logins_reload()}</Button> : null}
      </div>
    </AlertDialogContent></AlertDialog>
  </StmsShell>;
}
