import { useForm, useStore } from "@tanstack/react-form";
import { useHydrated } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FocusEvent } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { Button } from "@xpro/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "#components/ui/field";
import { Input } from "#components/ui/input";
import { m } from "#paraglide/messages.js";
import { getMfaMessage, isMfaAccessFailure, validateCredential, type CredentialKind, type MfaFailure, type MfaResult, type BackupsResult, type MfaManagement } from "./mfa";

type Completed = Exclude<MfaResult | BackupsResult, { status: "error" }>;
type Props<Success extends Completed> = { kind: CredentialKind; label: string; submitLabel: string; disabled?: boolean; access?: MfaManagement;
  onSubmit(value: string): Promise<Success | Extract<MfaResult, { status: "error" }>>; onCompleted(result: Success): void | Promise<void>; onFailure(error: MfaFailure): void; onBusy(isBusy: boolean): void };

export function MfaForm<Success extends Completed>({ kind, label, submitLabel, disabled = false, access, onSubmit, onCompleted, onFailure, onBusy }: Props<Success>): React.JSX.Element {
  const isHydrated = useHydrated(), element = useRef<HTMLFormElement>(null), summary = useRef<HTMLDivElement>(null), isPointerDown = useRef(false);
  const generation = useRef(0);
  const isMounted = useRef(true), [failure, setFailure] = useState<MfaFailure>(), [serverError, setServerError] = useState<string>();
  useEffect(() => {
    isMounted.current = true;
    const handleLeave = (): void => { generation.current++; };
    window.addEventListener("pagehide", handleLeave);
    return () => { isMounted.current = false; generation.current++; window.removeEventListener("pagehide", handleLeave); };
  }, []);
  useEffect(() => { if (access === "ready" && failure?.code === "core_mfa_recent_verification_required") setFailure(undefined); }, [access, failure]);
  const form = useForm({ defaultValues: { credential: "" }, onSubmitInvalid: () => requestAnimationFrame(focusFirstError),
    onSubmit: async ({ value }) => {
      const submittedGeneration = generation.current;
      setFailure(undefined); setServerError(undefined); onBusy(true);
      try {
        const result = await onSubmit(value.credential);
        if (!isMounted.current || generation.current !== submittedGeneration) return;
        if (result.status !== "error") { form.reset(); await onCompleted(result); return; }
        showFailure(result.error);
      } catch { if (isMounted.current && generation.current === submittedGeneration) showFailure({ code: "core_unexpected_error" }); }
      finally { onBusy(false); }
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting), hasSubmitted = useStore(form.store, (state) => state.submissionAttempts > 0);
  const errors = useStore(form.store, (state) => state.fieldMeta.credential?.errors ?? []);
  const error = [...new Set(errors)].join(" ") || serverError, isDisabled = !isHydrated || isSubmitting || disabled;
  const id = "mfa-" + kind;
  function focusFirstError(): void { (element.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)') ?? summary.current)?.focus(); }
  function isActivatingButton(event: FocusEvent): boolean {
    return isPointerDown.current && event.relatedTarget instanceof HTMLButtonElement && event.relatedTarget.form === element.current;
  }
  function showFailure(value: MfaFailure): void {
    setFailure(value);
    if (["accounts_current_password_invalid", "accounts_mfa_invalid_code", "core_invalid_input"].includes(value.code)) {
      setServerError(kind === "password" ? m.accounts_profile_current_invalid() : m.accounts_mfa_code_invalid());
    }
    if (isMfaAccessFailure(value)) form.reset();
    onFailure(value);
    requestAnimationFrame(focusFirstError);
  }
  return <form ref={element} method="post" noValidate data-mfa-credentials aria-busy={!isHydrated || isSubmitting} onReset={() => form.reset()}
    onPointerDownCapture={() => { isPointerDown.current = true; }} onPointerUpCapture={() => { isPointerDown.current = false; }}
    onPointerCancelCapture={() => { isPointerDown.current = false; }} onKeyDownCapture={() => { isPointerDown.current = false; }}
    onSubmit={async (event) => {
      event.preventDefault(); if (isDisabled || form.state.isSubmitting) return;
      form.setFieldValue("credential", String(new FormData(event.currentTarget).get(kind === "password" ? "password" : "code") ?? ""));
      setServerError(undefined); await form.handleSubmit();
    }}><FieldGroup>
    {(hasSubmitted && error) || failure ? <div ref={summary} role="alert" tabIndex={-1} className="rounded-lg border border-destructive p-4 outline-none">
      <p>{failure ? getMfaMessage(failure) : m.accounts_sign_in_errors_title()}</p>
      {error ? <a href={"#" + id} className="mt-2 inline-flex min-h-6 items-center underline">{error}</a> : null}
      {failure?.requestId ? <p className="mt-2 break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
    </div> : null}
    <form.Field name="credential" validators={{ onBlur: ({ value }) => validateCredential(value, kind), onSubmit: ({ value }) => validateCredential(value, kind) }}>
      {(field) => <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input id={id} name={kind === "password" ? "password" : "code"} type={kind === "password" ? "password" : "text"}
          inputMode={kind === "totp" ? "numeric" : "text"} autoComplete={kind === "password" ? "current-password" : kind === "totp" ? "one-time-code" : "off"}
          autoCapitalize="none" spellCheck={false} value={field.state.value} required disabled={isDisabled}
          aria-invalid={Boolean(error)} aria-describedby={id + "-error"} onChange={(event) => field.handleChange(event.target.value)}
          onBlur={(event) => { field.handleChange(event.currentTarget.value); if (!isActivatingButton(event)) field.handleBlur(); }} />
        <FieldError id={id + "-error"}>{error}</FieldError>
      </Field>}
    </form.Field>
    <Button type="submit" disabled={isDisabled}>{isSubmitting ? <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" /> : null}
      {isSubmitting ? m.accounts_mfa_working() : submitLabel}</Button>
    <p role="status" className="sr-only">{isSubmitting ? m.accounts_mfa_working() : ""}</p>
  </FieldGroup></form>;
}
