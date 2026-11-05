import { useForm, useStore } from "@tanstack/react-form";
import { useHydrated } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { Button } from "@xpro/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "#components/ui/field";
import { Input } from "#components/ui/input";
import { m } from "#paraglide/messages.js";
import { getSignInMessage, type SecurityCheck, type SignInFailure } from "./sign-in";
import { submitSignIn } from "./sign-in.data";
import { SecurityCheckWidget } from "./security-check";

export function SignInScreen({ siteKey }: { siteKey: string }): React.JSX.Element {
  const isHydrated = useHydrated(), element = useRef<HTMLFormElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const summary = useRef<HTMLDivElement>(null), isPointerDown = useRef(false);
  const [failure, setFailure] = useState<SignInFailure>();
  const [security, setSecurity] = useState<SecurityCheck>({ status: "loading", token: null });
  const [challenge, setChallenge] = useState(0);
  const form = useForm({
    defaultValues: { identifier: "", password: "" },
    onSubmitInvalid: () => requestAnimationFrame(focusFirstError),
    onSubmit: async ({ value }) => {
      setFailure(undefined);
      if (security.status !== "ready") return;
      try {
        const result = await submitSignIn(value, security.token);
        if (result.status === "mfa-pending") {
          form.reset();
          window.location.assign("/mfa" + window.location.search);
          return;
        }
        if (result.status === "signed-in") {
          form.reset();
          window.location.assign(result.destination);
          return;
        }
        setFailure(result.error);
      } catch { setFailure({ code: "core_unexpected_error" }); }
      setSecurity({ status: "loading", token: null });
      setChallenge((previous) => previous + 1);
      requestAnimationFrame(() => summary.current?.focus());
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const hasSubmitted = useStore(form.store, (state) => state.submissionAttempts > 0);
  const fieldMeta = useStore(form.store, (state) => state.fieldMeta);
  const errors = { identifier: [...new Set(fieldMeta.identifier?.errors)].join(" "), password: [...new Set(fieldMeta.password?.errors)].join(" ") };
  const hasErrors = Boolean(errors.identifier || errors.password);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  function focusFirstError(): void { element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }
  function isActivatingButton(event: FocusEvent<HTMLElement>): boolean {
    return isPointerDown.current && event.relatedTarget instanceof HTMLButtonElement && event.relatedTarget.form === element.current;
  }
  function handleSecurityRetry(): void {
    setSecurity({ status: "loading", token: null });
    setChallenge((previous) => previous + 1);
  }
  return <SignInShell>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">{m.accounts_sign_in_title()}</h1>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">{m.accounts_sign_in_intro()}</p>
    <form ref={element} method="post" noValidate className="mt-7" aria-busy={!isHydrated || isSubmitting}
      onPointerDownCapture={() => { isPointerDown.current = true; }} onPointerUpCapture={() => { isPointerDown.current = false; }}
      onPointerCancelCapture={() => { isPointerDown.current = false; }} onKeyDownCapture={() => { isPointerDown.current = false; }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!isHydrated || isSubmitting) return;
        // Password managers may fill inputs without emitting React change events.
        const values = new FormData(event.currentTarget);
        form.setFieldValue("identifier", String(values.get("username") ?? ""));
        form.setFieldValue("password", String(values.get("password") ?? ""));
        await form.handleSubmit();
      }}>
      <FieldGroup>
        {(hasSubmitted && hasErrors) || failure ? <div ref={summary} role="alert" tabIndex={-1} className="rounded-lg border border-destructive p-4 outline-none">
          <p className="font-medium">{hasErrors ? m.accounts_sign_in_errors_title() : getSignInMessage(failure ?? { code: "core_unexpected_error" })}</p>
          {hasErrors ? <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
            {Object.entries(errors).filter(([, message]) => message).map(([field, message]) =>
              <li key={field}><a className="underline underline-offset-4" href={"#" + field}>{message}</a></li>)}
          </ul> : null}
          {failure?.requestId ? <p className="mt-2 break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
          {failure?.code === "core_sign_in_invalid" ? <a href="/auth/destination" className="mt-2 inline-flex min-h-6 items-center underline">{m.accounts_sign_in_start_again()}</a> : null}
        </div> : null}
        <form.Field name="identifier" validators={{
          onBlur: ({ value }) => value.trim() ? undefined : m.accounts_sign_in_identifier_required(),
          onSubmit: ({ value }) => value.trim() ? undefined : m.accounts_sign_in_identifier_required(),
        }}>
          {(field) => <Field>
            <FieldLabel htmlFor="identifier">{m.accounts_sign_in_identifier()}</FieldLabel>
            <Input id="identifier" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
              defaultValue={field.state.value} required disabled={!isHydrated || isSubmitting} aria-invalid={Boolean(errors.identifier)}
              aria-describedby="identifier-error" onChange={(event) => field.handleChange(event.target.value)}
              onBlur={(event) => { if (!isActivatingButton(event)) field.handleBlur(); }} />
            <FieldError id="identifier-error">{errors.identifier}</FieldError>
          </Field>}
        </form.Field>
        <form.Field name="password" validators={{
          onBlur: ({ value }) => value ? undefined : m.accounts_sign_in_password_required(),
          onSubmit: ({ value }) => value ? undefined : m.accounts_sign_in_password_required(),
        }}>
          {(field) => <Field>
            <FieldLabel htmlFor="password">{m.accounts_sign_in_password()}</FieldLabel>
            <Input id="password" name="password" type="password" autoComplete="current-password"
              defaultValue={field.state.value} required disabled={!isHydrated || isSubmitting} aria-invalid={Boolean(errors.password)}
              aria-describedby="password-error" onChange={(event) => field.handleChange(event.target.value)}
              onBlur={(event) => { if (!isActivatingButton(event)) field.handleBlur(); }} />
            <FieldError id="password-error">{errors.password}</FieldError>
          </Field>}
        </form.Field>
        <div>
          {isHydrated ? <SecurityCheckWidget key={challenge} siteKey={siteKey} onChange={setSecurity} /> : null}
          <p role={security.status === "failed" ? "alert" : "status"} className="mt-2 text-sm leading-6 text-muted-foreground">
            {security.status === "loading" ? m.accounts_sign_in_security_loading() : security.status === "ready"
              ? m.accounts_sign_in_security_ready() : m.accounts_sign_in_security_failed()}
          </p>
          {security.status === "failed" ? <Button className="mt-3" type="button" variant="outline" disabled={isSubmitting} onClick={handleSecurityRetry}>{m.accounts_sign_in_security_retry()}</Button> : null}
        </div>
        <Button type="submit" disabled={!isHydrated || isSubmitting || security.status !== "ready"}>
          {isSubmitting ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}
          {isSubmitting ? m.accounts_sign_in_submitting() : m.accounts_sign_in_submit()}
        </Button>
        <p role="status" className="sr-only">{isSubmitting ? m.accounts_sign_in_submitting() : ""}</p>
      </FieldGroup>
    </form>
    <p className="mt-6 text-sm leading-6 text-muted-foreground">{m.accounts_sign_in_password_help()}</p>
  </SignInShell>;
}

export function SignInPending(): React.JSX.Element {
  return <SignInShell><h1 className="text-2xl font-semibold">{m.accounts_sign_in_title()}</h1>
    <div role="status" className="mt-6 space-y-6">
      <span className="sr-only">{m.core_loading()}</span>
      {[0, 1].map((row) => <div key={row} aria-hidden="true" className="space-y-2">
        <div className="h-4 w-1/3 rounded bg-muted" /><div className="h-11 rounded-lg bg-muted" />
      </div>)}
      <div aria-hidden="true" className="h-36 w-36 rounded bg-muted" />
      <Button disabled>{m.accounts_sign_in_submit()}</Button>
    </div></SignInShell>;
}

export function SignInError({ failure }: { failure?: SignInFailure }): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <SignInShell><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.core_error_title()}</h1>
    <p role="alert" className="mt-4 text-sm leading-6">{m.core_error_message()}</p>
    {failure?.requestId ? <p className="mt-3 break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
    <Button className="mt-6" variant="outline" onClick={() => window.location.reload()}>{m.core_retry()}</Button>
  </SignInShell>;
}

export function UnassignedScreen(): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <SignInShell><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.accounts_sign_in_unassigned_title()}</h1>
    <p className="mt-4 text-sm leading-6">{m.accounts_sign_in_unassigned()}</p>
  </SignInShell>;
}

function SignInShell({ children }: { children: ReactNode }): React.JSX.Element {
  return <main className="mx-auto w-full max-w-lg px-4 py-8 sm:py-14">
    <p className="mb-6 text-lg font-semibold tracking-tight">{m.core_app_name()}</p>
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">{children}</section>
  </main>;
}
