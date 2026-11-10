import { useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { Button, buttonVariants } from "@xpro/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@xpro/ui/alert-dialog";
import { m } from "#paraglide/messages.js";
import { isAccessFailure, type ManagementFailure } from "#features/stms/management";
import { useUnsavedChanges } from "#features/stms/management-form";
import { accountFailureMessage, readAccountOperation, receiptMatches, saveAccount, type AccountCommand, type AccountReceipt } from "./accounts.data";

export function accountAccessFailure(error: ManagementFailure): boolean { return isAccessFailure(error) || error.code === "core_mfa_required"; }
export function AccountFailure({ error }: { error: ManagementFailure }): React.JSX.Element {
  return <><p>{accountFailureMessage(error)}</p>{error.requestId ? <p className="mt-2 break-all text-sm">{m.core_request_id({ requestId: error.requestId })}</p> : null}</>;
}
export function AccountAccess({ failure, confirmed, busy, onCheck, children }: { failure?: ManagementFailure; confirmed: boolean; busy: boolean; onCheck(): Promise<void>; children: ReactNode }): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  const recoverable = failure && ["core_unauthenticated", "core_mfa_required", "core_profile_incomplete", "core_creation_incomplete"].includes(failure.code);
  const changed = failure?.code === "core_identity_changed";
  return <><div id="account-content" inert={Boolean(failure)} aria-hidden={failure ? true : undefined} className={failure ? "invisible" : "space-y-6"}>{children}</div>
    <AlertDialog open={Boolean(failure)}><AlertDialogContent initialFocus={heading}>
      <AlertDialogTitle ref={heading} tabIndex={-1}>{confirmed ? m.stms_accounts_saved_access_title() : m.stms_logins_access_title()}</AlertDialogTitle>
      {confirmed ? <p role="status">{m.stms_accounts_saved()}</p> : null}
      <AlertDialogDescription>{accountFailureMessage(failure ?? { code: "core_unexpected_error" })}</AlertDialogDescription>
      <p className="text-sm">{m.stms_accounts_draft_kept()}</p>
      {failure?.requestId ? <p className="break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
      <div className="flex flex-wrap gap-3">
        {recoverable ? <a className={buttonVariants()} href={failure?.code === "core_profile_incomplete" ? "/complete-profile" : "/sign-in"} target="_blank" rel="noopener noreferrer">{m.stms_logins_sign_in_tab()}</a> : null}
        {!changed ? <Button type="button" variant="outline" disabled={busy} onClick={() => { void onCheck(); }}>{busy ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}{busy ? m.core_loading() : m.stms_logins_access_check()}</Button> : null}
        <Button type="button" variant="outline" disabled={busy} onClick={() => location.reload()}>{m.stms_logins_reload()}</Button>
      </div>
    </AlertDialogContent></AlertDialog></>;
}
export type AccountCommandState = {
  frozen: AccountCommand | undefined; confirmed: AccountReceipt | undefined; failure: ManagementFailure | undefined;
  busy: boolean; pendingAction: "save" | "retry" | "status" | "refresh" | undefined; notRecorded: boolean; needsRefresh: boolean; locked: boolean;
  send(intent?: AccountCommand): Promise<void>; checkStatus(): Promise<void>; refresh(): Promise<void>;
};
export function useAccountCommand(options: { pageLoginId: string; onAccess(error: ManagementFailure): void; onSaved(receipt: AccountReceipt): Promise<boolean>; onRefresh(): Promise<boolean> }): AccountCommandState {
  const [frozen, setFrozen] = useState<AccountCommand>(), command = useRef<AccountCommand | undefined>(undefined);
  const [confirmed, setConfirmed] = useState<AccountReceipt>(), [failure, setFailure] = useState<ManagementFailure>();
  const [pendingAction, setPendingAction] = useState<AccountCommandState["pendingAction"]>();
  const busy = pendingAction !== undefined, working = useRef(false), uncertain = useRef(false);
  const [notRecorded, setNotRecorded] = useState(false), [needsRefresh, setNeedsRefresh] = useState(false);
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useUnsavedChanges(Boolean(frozen && !confirmed));
  function show(error: ManagementFailure): void { if (!alive.current) return; setFailure(error); if (accountAccessFailure(error)) options.onAccess(error); }
  async function finish(receipt: AccountReceipt): Promise<void> {
    if (!alive.current) return;
    setConfirmed(receipt); setFailure(undefined); setNotRecorded(false);
    // A failed refresh cannot turn an acknowledged commit into an unknown save.
    try { if (await options.onSaved(receipt) && alive.current) { command.current = undefined; setFrozen(undefined); uncertain.current = false; } }
    catch { show({ code: "core_unexpected_error" }); }
  }
  async function send(intent?: AccountCommand): Promise<void> {
    if (working.current || confirmed && frozen || needsRefresh) return;
    const original = command.current;
    const submitted = original ?? intent;
    if (!submitted || original && intent) return;
    working.current = true; setPendingAction(original ? "retry" : "save"); setFailure(undefined); setNotRecorded(false);
    if (!original) { command.current = submitted; setFrozen(submitted); setConfirmed(undefined); uncertain.current = false; }
    try {
      const result = await saveAccount(submitted, options.pageLoginId);
      if (!alive.current) return;
      if (result.status === "saved") { await finish(result.receipt); return; }
      const safeRefusal = !uncertain.current && ["core_invalid_input", "core_request_too_large", "stms_account_not_found", "stms_account_holder_unavailable", "stms_operation_conflict"].includes(result.error.code);
      if (safeRefusal) {
        command.current = undefined; setFrozen(undefined);
        if (result.error.code === "stms_operation_conflict") setNeedsRefresh(true);
      } else uncertain.current = true;
      show(result.error);
    } catch { uncertain.current = true; show({ code: "core_unexpected_error" }); }
    finally { working.current = false; if (alive.current) setPendingAction(undefined); }
  }
  async function checkStatus(): Promise<void> {
    if (working.current || !command.current || confirmed) return;
    working.current = true; setPendingAction("status"); setNotRecorded(false); setFailure(undefined);
    try {
      const result = await readAccountOperation(command.current, options.pageLoginId);
      if (!alive.current) return;
      if (result.status === "error") show(result.error);
      else if (result.status === "not_recorded") setNotRecorded(true);
      else if (receiptMatches(command.current, result.result)) await finish(result.result);
    } catch { show({ code: "core_unexpected_error" }); }
    finally { working.current = false; if (alive.current) setPendingAction(undefined); }
  }
  async function refresh(): Promise<void> {
    if (working.current) return;
    working.current = true; setPendingAction("refresh");
    try {
      if (confirmed) await finish(confirmed);
      else if (await options.onRefresh() && alive.current) { setNeedsRefresh(false); setFailure(undefined); }
    } catch { show({ code: "core_unexpected_error" }); }
    finally { working.current = false; if (alive.current) setPendingAction(undefined); }
  }
  return { frozen, confirmed, failure, busy, pendingAction, notRecorded, needsRefresh, locked: busy || Boolean(frozen) || needsRefresh, send, checkStatus, refresh };
}
export function AccountOutcome({ operation }: { operation: ReturnType<typeof useAccountCommand> }): React.JSX.Element {
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => { if (operation.failure || operation.frozen || operation.confirmed) heading.current?.focus({ preventScroll: true }); }, [operation.failure, operation.frozen, operation.confirmed]);
  return <div ref={heading} tabIndex={-1} className="space-y-3 outline-none" aria-live="polite">
    {operation.confirmed ? <><p role="status">{m.stms_accounts_saved()}</p>{operation.frozen ? <><p>{operation.busy ? m.core_loading() : m.stms_accounts_saved_refresh_failed()}</p><Button type="button" variant="outline" disabled={operation.busy} onClick={() => { void operation.refresh(); }}>{operation.pendingAction === "refresh" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}{m.stms_accounts_refresh_saved()}</Button></> : null}</> : null}
    {operation.failure ? <div role="alert"><AccountFailure error={operation.failure} /></div> : null}
    {operation.frozen && !operation.confirmed ? <div className="space-y-3 rounded-lg border border-border p-4">
      <p>{operation.pendingAction === "save" || operation.pendingAction === "retry" ? m.stms_logins_saving() : operation.busy ? m.core_loading() : m.stms_accounts_unknown()}</p>
      <p className="break-all text-sm">{m.stms_accounts_operation_id({ operationId: operation.frozen.data.operationId })}</p>
      {operation.notRecorded ? <p>{m.stms_accounts_not_recorded()}</p> : null}
      <div className="flex flex-wrap gap-3"><Button type="button" variant="outline" disabled={operation.busy} onClick={() => { void operation.checkStatus(); }}>{operation.pendingAction === "status" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}{m.stms_accounts_check_operation()}</Button>
        {operation.notRecorded || operation.pendingAction === "retry" ? <Button type="button" variant="outline" disabled={operation.busy} onClick={() => { void operation.send(); }}>{operation.pendingAction === "retry" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}{m.stms_accounts_retry_same()}</Button> : null}</div>
    </div> : null}
    {operation.needsRefresh ? <Button type="button" variant="outline" disabled={operation.busy} onClick={() => { void operation.refresh(); }}>{operation.pendingAction === "refresh" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}{m.stms_accounts_refresh_conflict()}</Button> : null}
  </div>;
}
