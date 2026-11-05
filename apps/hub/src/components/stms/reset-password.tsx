import { useForm, useStore } from "@tanstack/react-form";
import { useHydrated } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FocusEvent } from "react";
import { is } from "valibot";
import { passwordSchema } from "@xpro/accounts";
import type { LoginSummary } from "@xpro/stms";
import { Button, buttonVariants } from "@xpro/ui/button";
import { LoaderCircleIcon } from "lucide-react";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "#components/ui/field";
import { Input } from "#components/ui/input";
import { m } from "#paraglide/messages.js";
import { submitPasswordReset, type ResetFailure } from "./reset-password.data";

type Props = { login: Pick<LoginSummary, "loginId" | "email">; pageLoginId: string; disabled?: boolean;
  onBusy?(isBusy: boolean): void; onFailure?(error: ResetFailure): void; onSaved?(): void };

export function ResetPassword(props: Props): React.JSX.Element {
  // A selected login or page actor change must discard this form's secret and
  // isolate any outstanding response from the newly displayed login.
  return <ResetPasswordForm key={props.login.loginId + "/" + props.pageLoginId} {...props} />;
}

function ResetPasswordForm({ login, pageLoginId, disabled = false, onBusy, onFailure, onSaved }: Props): React.JSX.Element {
  const isHydrated = useHydrated(), element = useRef<HTMLFormElement>(null), summary = useRef<HTMLDivElement>(null);
  const success = useRef<HTMLHeadingElement>(null), isPointerDown = useRef(false);
  const [isSaved, setIsSaved] = useState(false), [failure, setFailure] = useState<ResetFailure>();
  const [serverErrors, setServerErrors] = useState<{ newPassword?: string; comment?: string }>({});
  const form = useForm({
    defaultValues: { newPassword: "", comment: "" },
    onSubmitInvalid: () => requestAnimationFrame(focusFirstError),
    onSubmit: async ({ value }) => {
      onBusy?.(true);
      setFailure(undefined); setServerErrors({});
      let error: ResetFailure;
      try {
        const result = await submitPasswordReset({ loginId: login.loginId, ...value }, pageLoginId);
        if (result.status === "saved") { form.reset(); setIsSaved(true); onSaved?.(); return; }
        error = result.error;
      } catch { error = { code: "core_unexpected_error" }; }
      finally { onBusy?.(false); }
      setFailure(error); onFailure?.(error);
      if (error.code === "core_invalid_input" && error.fields?.includes("newPassword")) {
        setServerErrors({ newPassword: m.stms_reset_password_invalid() });
      }
      if (error.code === "core_request_too_large") setServerErrors({ comment: m.stms_reset_password_comment_long() });
      requestAnimationFrame(focusFirstError);
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting), isDirty = useStore(form.store, (state) => !state.isDefaultValue);
  const meta = useStore(form.store, (state) => state.fieldMeta);
  const passwordError = [...new Set(meta.newPassword?.errors ?? [])].join(" ") || serverErrors.newPassword;
  const commentError = serverErrors.comment, hasErrors = Boolean(passwordError || commentError);
  const notice = failure ? getFailureNotice(failure) : undefined, isSelfReset = pageLoginId === login.loginId;
  const isIdentityChanged = failure?.code === "core_identity_changed";
  useEffect(() => {
    if (isSaved) success.current?.focus();
  }, [isSaved]);
  useEffect(() => {
    if (!isDirty || isSaved) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, isSaved]);
  function focusFirstError(): void {
    (element.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)') ?? summary.current)?.focus();
  }
  function isActivatingButton(event: Pick<FocusEvent, "relatedTarget">): boolean {
    return isPointerDown.current && event.relatedTarget instanceof HTMLButtonElement && event.relatedTarget.form === element.current;
  }
  if (isSaved) return <section className="space-y-4">
    <h2 ref={success} tabIndex={-1} className="text-lg font-semibold outline-none">{m.stms_reset_password_success()}</h2>
    <p style={{ overflowWrap: "anywhere" }}>{m.stms_reset_password_saved_for({ email: login.email })}</p>
    <p className="text-sm text-muted-foreground">{m.stms_reset_password_handover()}</p>
    {isSelfReset ? <a className={buttonVariants()} href="/sign-in">{m.stms_reset_password_sign_in()}</a>
      : <Button type="button" variant="outline" onClick={() => { setIsSaved(false); requestAnimationFrame(() => element.current?.querySelector<HTMLElement>("#reset-password")?.focus()); }}>{m.stms_reset_password_another()}</Button>}
  </section>;
  return <section className="space-y-4">
    <h2 className="text-lg font-semibold">{m.stms_reset_password_title()}</h2>
    <p className="text-sm text-muted-foreground" style={{ overflowWrap: "anywhere" }}>{m.stms_reset_password_intro({ email: login.email })}</p>
    <form ref={element} method="post" noValidate aria-busy={!isHydrated || isSubmitting}
      onPointerDownCapture={() => { isPointerDown.current = true; }} onPointerUpCapture={() => { isPointerDown.current = false; }}
      onPointerCancelCapture={() => { isPointerDown.current = false; }} onKeyDownCapture={() => { isPointerDown.current = false; }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!isHydrated || form.state.isSubmitting || isIdentityChanged || disabled) return;
        const values = new FormData(event.currentTarget);
        form.setFieldValue("newPassword", String(values.get("newPassword") ?? ""));
        form.setFieldValue("comment", String(values.get("comment") ?? ""));
        setServerErrors({}); await form.handleSubmit();
      }}>
      <FieldGroup>
        {hasErrors || failure ? <div ref={summary} role="alert" tabIndex={-1} className="rounded-lg border border-destructive p-4 outline-none">
          <p>{hasErrors ? m.stms_reset_password_errors() : notice?.message}</p>
          {hasErrors ? <ul className="mt-2 list-disc ps-5 text-sm">
            {passwordError ? <li><a href="#reset-password" className="underline">{passwordError}</a></li> : null}
            {commentError ? <li><a href="#reset-comment" className="underline">{commentError}</a></li> : null}
          </ul> : null}
          {notice?.isUncertain && isSelfReset ? <p className="mt-2">{m.stms_reset_password_self_unknown()}</p> : null}
          {failure?.requestId ? <p className="mt-2 break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
          {failure?.code === "core_unauthenticated" || (notice?.isUncertain && isSelfReset) ? <a className={buttonVariants({ variant: "outline" })} href="/sign-in" target="_blank" rel="noopener noreferrer">{m.stms_reset_password_sign_in_tab()}</a> : null}
          {isIdentityChanged ? <Button type="button" variant="outline" onClick={() => location.reload()}>{m.stms_reset_password_reload()}</Button> : null}
        </div> : null}
        <fieldset disabled={!isHydrated || isSubmitting || isIdentityChanged || disabled} className="min-w-0 space-y-5">
          <form.Field name="newPassword" validators={{
            onBlur: ({ value }) => is(passwordSchema, value) ? undefined : m.stms_reset_password_invalid(),
            onSubmit: ({ value }) => is(passwordSchema, value) ? undefined : m.stms_reset_password_invalid(),
          }}>
            {(field) => <Field><FieldLabel htmlFor="reset-password">{m.stms_reset_password_new()}</FieldLabel>
              <Input id="reset-password" name="newPassword" type="password" autoComplete="new-password" required value={field.state.value}
                aria-invalid={Boolean(passwordError)} aria-describedby={passwordError ? "reset-password-help reset-password-error" : "reset-password-help"}
                onChange={(event) => field.handleChange(event.target.value)} onBlur={(event) => {
                  field.handleChange(event.currentTarget.value);
                  if (!isActivatingButton(event)) { setServerErrors((previous) => ({ ...previous, newPassword: undefined })); field.handleBlur(); }
                }} />
              <FieldDescription id="reset-password-help">{m.stms_reset_password_help()}</FieldDescription>
              <FieldError id="reset-password-error">{passwordError}</FieldError></Field>}
          </form.Field>
          <form.Field name="comment">{(field) => <Field><FieldLabel htmlFor="reset-comment">{m.stms_reset_password_comment()}</FieldLabel>
            <Input id="reset-comment" name="comment" autoComplete="off" value={field.state.value} aria-invalid={Boolean(commentError)}
              aria-describedby={commentError ? "reset-comment-error" : undefined} onChange={(event) => field.handleChange(event.target.value)}
              onBlur={(event) => {
                field.handleChange(event.currentTarget.value);
                if (!isActivatingButton(event)) { setServerErrors((previous) => ({ ...previous, comment: undefined })); field.handleBlur(); }
              }} />
            <FieldError id="reset-comment-error">{commentError}</FieldError></Field>}</form.Field>
        </fieldset>
        <Button type="submit" disabled={!isHydrated || isSubmitting || isIdentityChanged || disabled}>
          {isSubmitting ? <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" /> : null}
          {isSubmitting ? m.stms_reset_password_submitting() : notice?.isUncertain ? m.stms_reset_password_again() : m.stms_reset_password_submit()}
        </Button>
        <p role="status" className="sr-only">{!isHydrated ? m.core_loading() : isSubmitting ? m.stms_reset_password_submitting() : ""}</p>
      </FieldGroup>
    </form>
  </section>;
}

function getFailureNotice(error: ResetFailure): { message: string; isUncertain: boolean } {
  switch (error.code) {
    case "core_invalid_input": return { message: m.stms_reset_password_errors(), isUncertain: false };
    case "core_request_too_large": return { message: m.stms_reset_password_comment_long(), isUncertain: false };
    case "core_unauthenticated": return { message: m.stms_reset_password_session_ended(), isUncertain: false };
    case "core_identity_changed": return { message: m.stms_reset_password_identity_changed(), isUncertain: false };
    case "core_forbidden": case "core_login_inactive": return { message: m.stms_reset_password_forbidden(), isUncertain: false };
    case "core_profile_incomplete": return { message: m.stms_reset_password_profile_required(), isUncertain: false };
    case "core_creation_incomplete": return { message: m.stms_reset_password_not_ready(), isUncertain: false };
    case "stms_login_not_found": return { message: m.stms_reset_password_not_found(), isUncertain: false };
    default: return { message: m.stms_reset_password_unknown(), isUncertain: true };
  }
}
