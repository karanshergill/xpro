import { useForm, useStore } from "@tanstack/react-form";
import { useHydrated } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FocusEvent } from "react";
import type { LoginDetails } from "@xpro/stms";
import { Button } from "@xpro/ui/button";
import { LoaderCircleIcon } from "lucide-react";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "#components/ui/field";
import { Input } from "#components/ui/input";
import { m } from "#paraglide/messages.js";
import { normalizeIdentifier, validateIdentifier, type IdentifierField, type ManagementFailure } from "./management";
import { submitIdentifier } from "./management.data";
import { CheckSavedChange, useUnsavedChanges, type ManagementActions } from "./management-form";
import { FailureMessage } from "./management-ui";

export function IdentifierEditor({ login, field: identifier, ...actions }: ManagementActions & { login: LoginDetails; field: IdentifierField }): React.JSX.Element {
  const isHydrated = useHydrated(), element = useRef<HTMLFormElement>(null), summary = useRef<HTMLDivElement>(null), isPointerDown = useRef(false);
  const [initial, setInitial] = useState({ value: login[identifier] ?? "", comment: "" });
  const [failure, setFailure] = useState<ManagementFailure>(), [serverErrors, setServerErrors] = useState<{ value?: string; comment?: string }>({}), [isSaved, setIsSaved] = useState(false);
  const form = useForm({ defaultValues: initial, onSubmitInvalid: () => requestAnimationFrame(focusFirstError),
    onSubmit: async ({ value }) => {
      actions.onBusy(true); setFailure(undefined); setServerErrors({}); setIsSaved(false);
      try {
        const result = await submitIdentifier({ field: identifier, loginId: login.loginId, ...value }, actions.pageLoginId);
        if (result.status === "saved") {
          const next = { value: normalizeIdentifier(identifier, value.value), comment: "" };
          setInitial(next); form.reset(next); setIsSaved(true); await actions.onSaved(); return;
        }
        showFailure(result.error);
      } catch { showFailure({ code: "core_unexpected_error" }); }
      finally { actions.onBusy(false); }
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting), isDirty = useStore(form.store, (state) => !state.isDefaultValue);
  const meta = useStore(form.store, (state) => state.fieldMeta), valueError = [...new Set(meta.value?.errors ?? [])].join(" ") || serverErrors.value;
  const hasErrors = Boolean(valueError || serverErrors.comment), isDisabled = !isHydrated || isSubmitting || actions.disabled;
  const label = identifier === "email" ? m.stms_logins_email() : m.stms_logins_username(), fieldId = "change-" + identifier;
  useUnsavedChanges(isDirty);
  useEffect(() => {
    if (isDirty || isSubmitting || actions.disabled || initial.value === (login[identifier] ?? "")) return;
    const next = { value: login[identifier] ?? "", comment: "" };
    setInitial(next); form.reset(next); setIsSaved(false);
  }, [login[identifier], isDirty, isSubmitting, actions.disabled, initial.value]);
  function focusFirstError(): void { (element.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)') ?? summary.current)?.focus(); }
  function isActivatingButton(event: Pick<FocusEvent, "relatedTarget">): boolean {
    return isPointerDown.current && event.relatedTarget instanceof HTMLButtonElement && event.relatedTarget.form === element.current;
  }
  function showFailure(error: ManagementFailure): void {
    setFailure(error); actions.onFailure(error);
    if (["accounts_email_taken", "accounts_username_taken", "accounts_username_reserved", "accounts_username_invalid"].includes(error.code)) {
      setServerErrors({ value: error.code === "accounts_email_taken" ? m.stms_logins_email_taken() : error.code === "accounts_username_taken" ? m.stms_logins_username_taken()
        : error.code === "accounts_username_reserved" ? m.stms_logins_username_reserved() : m.stms_logins_username_invalid() });
    }
    if (error.code === "core_invalid_input" && error.fields?.includes(identifier)) setServerErrors({ value: identifier === "email" ? m.stms_logins_email_invalid() : m.stms_logins_username_invalid() });
    if (error.code === "core_request_too_large") setServerErrors({ comment: m.stms_logins_too_long() });
    requestAnimationFrame(focusFirstError);
  }
  return <section className="rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby={fieldId + "-title"}>
    <h2 id={fieldId + "-title"} className="text-xl font-semibold">{identifier === "email" ? m.stms_logins_change_email() : m.stms_logins_change_username()}</h2>
    <p className="mb-5 mt-2 text-sm text-muted-foreground">{identifier === "email" ? m.stms_logins_email_help() : m.stms_logins_username_help()}</p>
    <form ref={element} method="post" noValidate aria-busy={!isHydrated || isSubmitting}
      onPointerDownCapture={() => { isPointerDown.current = true; }} onPointerUpCapture={() => { isPointerDown.current = false; }}
      onPointerCancelCapture={() => { isPointerDown.current = false; }} onKeyDownCapture={() => { isPointerDown.current = false; }}
      onSubmit={async (event) => {
        event.preventDefault(); if (isDisabled || form.state.isSubmitting) return;
        const values = new FormData(event.currentTarget); form.setFieldValue("value", String(values.get(identifier) ?? ""));
        form.setFieldValue("comment", String(values.get("comment") ?? "")); setServerErrors({}); setIsSaved(false); await form.handleSubmit();
      }}>
      <FieldGroup>
        {hasErrors || failure ? <div ref={summary} role="alert" tabIndex={-1} className="rounded-lg border border-destructive p-4 outline-none">
          {hasErrors ? <p>{m.stms_logins_errors()}</p> : failure ? <FailureMessage error={failure} /> : null}
          {hasErrors ? <ul className="mt-2 list-disc ps-5 text-sm">{valueError ? <li><a href={"#" + fieldId} className="underline">{valueError}</a></li> : null}
            {serverErrors.comment ? <li><a href={"#" + fieldId + "-comment"} className="underline">{serverErrors.comment}</a></li> : null}</ul> : null}
          {failure && hasErrors && failure.requestId ? <p className="mt-2 break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
          {failure ? <CheckSavedChange error={failure} disabled={isDisabled} onRefresh={actions.onRefresh} /> : null}
        </div> : null}
        <fieldset disabled={isDisabled} className="min-w-0 space-y-5">
          <form.Field name="value" validators={{ onBlur: ({ value }) => validateIdentifier(identifier, value), onSubmit: ({ value }) => validateIdentifier(identifier, value) }}>
            {(field) => <Field><FieldLabel htmlFor={fieldId}>{label}</FieldLabel><Input id={fieldId} name={identifier} type={identifier === "email" ? "email" : "text"}
              autoComplete="off" autoCapitalize="none" spellCheck={false} required value={field.state.value} aria-invalid={Boolean(valueError)} aria-describedby={fieldId + "-error"}
              onChange={(event) => { field.handleChange(event.target.value); setIsSaved(false); }} onBlur={(event) => {
                field.handleChange(event.currentTarget.value); if (!isActivatingButton(event)) { setServerErrors((value) => ({ ...value, value: undefined })); field.handleBlur(); }
              }} /><FieldError id={fieldId + "-error"}>{valueError}</FieldError></Field>}
          </form.Field>
          <form.Field name="comment">{(field) => <Field><FieldLabel htmlFor={fieldId + "-comment"}>{m.stms_logins_comment()}</FieldLabel>
            <Input id={fieldId + "-comment"} name="comment" autoComplete="off" value={field.state.value} aria-invalid={Boolean(serverErrors.comment)} aria-describedby={fieldId + "-comment-error"}
              onChange={(event) => { field.handleChange(event.target.value); setIsSaved(false); }} onBlur={(event) => {
                field.handleChange(event.currentTarget.value); if (!isActivatingButton(event)) { setServerErrors((value) => ({ ...value, comment: undefined })); field.handleBlur(); }
              }} /><FieldDescription>{m.stms_logins_comment_help()}</FieldDescription><FieldError id={fieldId + "-comment-error"}>{serverErrors.comment}</FieldError></Field>}</form.Field>
        </fieldset>
        <Button type="submit" disabled={isDisabled}>{isSubmitting ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}
          {isSubmitting ? m.stms_logins_saving() : identifier === "email" ? m.stms_logins_save_email() : m.stms_logins_save_username()}</Button>
        <p role="status">{isSaved ? m.stms_logins_identifier_saved({ field: label }) : ""}</p>
      </FieldGroup>
    </form>
  </section>;
}
