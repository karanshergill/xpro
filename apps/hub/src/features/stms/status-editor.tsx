import { useForm, useStore } from "@tanstack/react-form";
import { useHydrated } from "@tanstack/react-router";
import { useRef, useState, type FocusEvent } from "react";
import { suspendLoginEntries, suspensionReasons, type LoginDetails } from "@xpro/stms";
import { is } from "valibot";
import { Button } from "@xpro/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@xpro/ui/alert-dialog";
import { LoaderCircleIcon } from "lucide-react";
import { Field, FieldError, FieldGroup, FieldLabel } from "#components/ui/field";
import { Input } from "#components/ui/input";
import { NativeSelect } from "#components/ui/native-select";
import { m } from "#paraglide/messages.js";
import { getReasonLabel, getStatusLabel, isAccessFailure, type ManagementFailure, type StatusAction } from "./management";
import { submitStatus } from "./management.data";
import { CheckSavedChange, useUnsavedChanges, type ManagementActions } from "./management-form";
import { FailureMessage } from "./management-ui";

export function StatusEditor({ login, ...actions }: ManagementActions & { login: LoginDetails }): React.JSX.Element {
  const isHydrated = useHydrated(), element = useRef<HTMLFormElement>(null), summary = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const dialogHeading = useRef<HTMLHeadingElement>(null), isPointerDown = useRef(false);
  const [action, setAction] = useState<StatusAction>("suspend"), [isOpen, setIsOpen] = useState(false), [isWorking, setIsWorking] = useState(false);
  const [failure, setFailure] = useState<ManagementFailure>(), [saved, setSaved] = useState<StatusAction>();
  const [serverErrors, setServerErrors] = useState<{ reason?: string; comment?: string }>({});
  const form = useForm({ defaultValues: { reason: "", comment: "" }, onSubmitInvalid: () => requestAnimationFrame(focusFirstError),
    onSubmit: async () => { await applyAction(action); } });
  const isDirty = useStore(form.store, (state) => !state.isDefaultValue), meta = useStore(form.store, (state) => state.fieldMeta);
  const reason = useStore(form.store, (state) => state.values.reason);
  const reasonError = [...new Set(meta.reason?.errors ?? [])].join(" ") || serverErrors.reason;
  const commentError = [...new Set(meta.comment?.errors ?? [])].join(" ") || serverErrors.comment;
  const hasErrors = Boolean(reasonError || commentError), isDisabled = !isHydrated || isWorking || actions.disabled;
  const isSelf = actions.pageLoginId === login.loginId;
  const canConfirm = !isSelf && (action === "suspend" ? login.status === "active" : login.status !== "archived");
  useUnsavedChanges(isDirty || isWorking);
  function focusFirstError(): void { (element.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)') ?? summary.current)?.focus(); }
  function isActivatingButton(event: Pick<FocusEvent, "relatedTarget">): boolean {
    return isPointerDown.current && event.relatedTarget instanceof HTMLButtonElement && event.relatedTarget.form === element.current;
  }
  function openConfirmation(value: "suspend" | "archive"): void {
    if (value !== action) form.reset(); setAction(value); setFailure(undefined); setServerErrors({}); setSaved(undefined); setIsOpen(true);
  }
  function cancel(): void { form.reset(); setIsOpen(false); setFailure(undefined); setServerErrors({}); }
  async function refreshCurrent(): Promise<boolean> {
    const isReady = await actions.onRefresh(); if (!isReady) setIsOpen(false); return isReady;
  }
  async function applyAction(value: StatusAction): Promise<void> {
    setAction(value); setIsWorking(true); actions.onBusy(true); setFailure(undefined); setSaved(undefined); setServerErrors({});
    try {
      const result = await submitStatus({ action: value, loginId: login.loginId, ...form.state.values }, actions.pageLoginId);
      if (result.status === "saved") { form.reset(); setIsOpen(false); setSaved(value); await actions.onSaved(); heading.current?.focus(); return; }
      const error = result.error; setFailure(error); actions.onFailure(error);
      if (isAccessFailure(error)) setIsOpen(false);
      if (error.code === "core_invalid_input") setServerErrors({ reason: error.fields?.includes("reason") ? m.stms_logins_reason_required() : undefined,
        comment: error.fields?.includes("comment") ? m.stms_logins_other_comment_required() : undefined });
      if (error.code === "core_request_too_large") setServerErrors({ comment: m.stms_logins_too_long() });
      requestAnimationFrame(focusFirstError);
    } catch { const error = { code: "core_unexpected_error" }; setFailure(error); actions.onFailure(error); requestAnimationFrame(focusFirstError); }
    finally { setIsWorking(false); actions.onBusy(false); }
  }
  const notice = failure ? <><FailureMessage error={failure} /><CheckSavedChange error={failure} disabled={isDisabled} onRefresh={refreshCurrent} />
    <p className="mt-3 text-sm">{m.stms_logins_current_status({ status: getStatusLabel(login.status) })}</p></> : null;
  return <section className="space-y-4 rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="login-status-title" aria-busy={isWorking}>
    <h2 ref={heading} id="login-status-title" tabIndex={-1} className="text-xl font-semibold outline-none">{m.stms_logins_status()}</h2>
    <p id="login-status-value">{getStatusLabel(login.status)}</p>
    {isSelf && login.status !== "archived" ? <p className="text-sm text-muted-foreground">{m.stms_logins_self_protected()}</p> : null}
    {failure && !isOpen && !isAccessFailure(failure) ? <div ref={summary} role="alert" tabIndex={-1} className="rounded-lg border border-destructive p-4 outline-none">{notice}</div> : null}
    <div className="flex flex-wrap gap-3">
      {login.status === "active" ? <Button type="button" variant="outline" disabled={isDisabled || isSelf} onClick={() => openConfirmation("suspend")}>{m.stms_logins_suspend()}</Button> : null}
      {login.status === "suspended" ? <Button type="button" variant="outline" disabled={isDisabled} onClick={async () => { await applyAction("reactivate"); }}>{m.stms_logins_reactivate()}</Button> : null}
      {login.status !== "archived" ? <Button type="button" variant="outline" disabled={isDisabled || isSelf} onClick={() => openConfirmation("archive")}>{m.stms_logins_archive()}</Button>
        : <Button type="button" variant="outline" disabled={isDisabled} onClick={async () => { await applyAction("restore"); }}>{m.stms_logins_restore()}</Button>}
    </div>
    <p role="status">{isWorking ? m.stms_logins_saving() : saved ? getSavedMessage(saved) : ""}</p>
    <AlertDialog open={isOpen} onOpenChange={(open) => { if (!open && !isWorking) cancel(); }}>
      <AlertDialogContent initialFocus={dialogHeading} finalFocus={heading}>
        <AlertDialogTitle ref={dialogHeading} tabIndex={-1}>{action === "suspend" ? m.stms_logins_confirm_suspend() : m.stms_logins_confirm_archive()}</AlertDialogTitle>
        <AlertDialogDescription><span className="[overflow-wrap:anywhere]">{action === "suspend" ? m.stms_logins_suspend_warning({ email: login.email }) : m.stms_logins_archive_warning({ email: login.email })}</span></AlertDialogDescription>
        <form ref={element} method="post" noValidate aria-busy={isWorking}
          onPointerDownCapture={() => { isPointerDown.current = true; }} onPointerUpCapture={() => { isPointerDown.current = false; }}
          onPointerCancelCapture={() => { isPointerDown.current = false; }} onKeyDownCapture={() => { isPointerDown.current = false; }}
          onSubmit={async (event) => {
            event.preventDefault(); if (isDisabled || !canConfirm || form.state.isSubmitting) return;
            const values = new FormData(event.currentTarget); form.setFieldValue("reason", String(values.get("reason") ?? ""));
            form.setFieldValue("comment", String(values.get("comment") ?? "")); setServerErrors({}); await form.handleSubmit();
          }}><FieldGroup>
          {hasErrors || failure ? <div ref={summary} role="alert" tabIndex={-1} className="rounded-lg border border-destructive p-4 outline-none">
            {hasErrors ? <><p>{m.stms_logins_errors()}</p><ul className="mt-2 list-disc ps-5 text-sm">
              {reasonError ? <li><a href="#status-reason" className="underline">{reasonError}</a></li> : null}{commentError ? <li><a href="#status-comment" className="underline">{commentError}</a></li> : null}</ul></> : notice}
            {hasErrors && failure?.requestId ? <p className="mt-2 break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
          </div> : null}
          <fieldset disabled={isDisabled} className="min-w-0 space-y-5">
            {action === "suspend" ? <form.Field name="reason" validators={{
              onBlur: ({ value }) => is(suspendLoginEntries.reason, value) ? undefined : m.stms_logins_reason_required(),
              onSubmit: ({ value }) => is(suspendLoginEntries.reason, value) ? undefined : m.stms_logins_reason_required(),
            }}>{(field) => <Field><FieldLabel htmlFor="status-reason">{m.stms_logins_reason()}</FieldLabel>
              <NativeSelect id="status-reason" name="reason" required value={field.state.value} aria-invalid={Boolean(reasonError)} aria-describedby="status-reason-error"
                onChange={(event) => field.handleChange(event.target.value)} onBlur={(event) => { if (!isActivatingButton(event)) { setServerErrors((value) => ({ ...value, reason: undefined })); field.handleBlur(); } }}>
                <option value="">{m.stms_logins_reason_placeholder()}</option>{suspensionReasons.map((value) => <option key={value} value={value}>{getReasonLabel(value)}</option>)}
              </NativeSelect><FieldError id="status-reason-error">{reasonError}</FieldError></Field>}</form.Field> : null}
            <form.Field name="comment" validators={{
              onBlur: ({ value }) => action === "suspend" && form.state.values.reason === "stms_other" && !value.trim() ? m.stms_logins_other_comment_required() : undefined,
              onSubmit: ({ value }) => action === "suspend" && form.state.values.reason === "stms_other" && !value.trim() ? m.stms_logins_other_comment_required() : undefined,
            }}>{(field) => <Field><FieldLabel htmlFor="status-comment">{action === "suspend" && reason === "stms_other" ? m.stms_logins_other_comment() : m.stms_logins_comment()}</FieldLabel>
              <Input id="status-comment" name="comment" autoComplete="off" required={action === "suspend" && reason === "stms_other"} value={field.state.value}
                aria-invalid={Boolean(commentError)} aria-describedby="status-comment-error" onChange={(event) => field.handleChange(event.target.value)} onBlur={(event) => {
                  field.handleChange(event.currentTarget.value); if (!isActivatingButton(event)) { setServerErrors((value) => ({ ...value, comment: undefined })); field.handleBlur(); }
                }} /><FieldError id="status-comment-error">{commentError}</FieldError></Field>}</form.Field>
          </fieldset>
          <div className="flex flex-wrap gap-3"><Button type="submit" disabled={isDisabled || !canConfirm}>{isWorking ? <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" /> : null}
            {isWorking ? m.stms_logins_saving() : action === "suspend" ? m.stms_logins_suspend() : m.stms_logins_archive()}</Button>
            <Button type="button" variant="outline" disabled={isWorking} onClick={cancel}>{m.stms_logins_cancel()}</Button></div>
        </FieldGroup></form>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}

function getSavedMessage(action: StatusAction): string {
  switch (action) {
    case "suspend": return m.stms_logins_suspended_saved();
    case "reactivate": return m.stms_logins_reactivated_saved();
    case "archive": return m.stms_logins_archived_saved();
    case "restore": return m.stms_logins_restored_saved();
  }
}
