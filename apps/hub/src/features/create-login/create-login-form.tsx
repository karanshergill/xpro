import { useForm, useStore } from "@tanstack/react-form";
import { useHydrated } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { getCountries, getCountryCallingCode } from "libphonenumber-js/max";
import { LoaderCircleIcon } from "lucide-react";
import { Button, buttonVariants } from "@xpro/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "#components/ui/field";
import { Input } from "#components/ui/input";
import { NativeSelect } from "#components/ui/native-select";
import { m } from "#paraglide/messages.js";
import { getLocale } from "#paraglide/runtime.js";
import { WorkspacePicker } from "./workspace-picker";
import { submitCreation } from "./creation.data";
import { canCorrectCreation, createAttempt, getCreationFailureFields, getCreationFailureMessage, initialCreationValues, isUncertainCreation,
  validateCreationValues, type CreatedLogin, type CreationAttempt, type CreationErrors, type CreationFailure,
  type CreationField, type CreationPageData, type SelectedWorkspace } from "./creation";

export function CreateLoginForm({ page }: { page: CreationPageData }): React.JSX.Element {
  const isHydrated = useHydrated(), element = useRef<HTMLFormElement>(null), summary = useRef<HTMLDivElement>(null);
  const isPointerDown = useRef(false), locale = getLocale();
  // shortcut: retry data belongs to this mounted form. Add creator-owned pending
  // request retrieval if recovery after closing or reloading becomes required.
  const [attempt, setAttempt] = useState<CreationAttempt | null>(null), [saved, setSaved] = useState<CreatedLogin>();
  const [failure, setFailure] = useState<CreationFailure>(), [serverErrors, setServerErrors] = useState<CreationErrors>({});
  const [selected, setSelected] = useState<SelectedWorkspace>(null);
  const form = useForm({
    defaultValues: initialCreationValues(page),
    onSubmitInvalid: () => requestAnimationFrame(focusFirstError),
    onSubmit: async ({ value }) => {
      const current = attempt ?? createAttempt(value, page);
      if (!current) { setFailure({ code: "core_invalid_input" }); return; }
      setAttempt(current); setFailure(undefined); setServerErrors({});
      let error: CreationFailure;
      try {
        const result = await submitCreation(current.data, page.creatorLoginId);
        if (result.status === "saved") {
          setSaved({ ...result.receipt, email: current.data.email, username: current.data.username });
          setAttempt(null); setFailure(undefined);
          form.reset({ ...initialCreationValues(page), target: value.target, workspaceId: value.workspaceId, kind: value.kind });
          return;
        }
        error = result.error;
      } catch { error = { code: "core_unexpected_error" }; }
      setFailure(error);
      if (canCorrectCreation(error, current)) {
        // Known input/identifier refusals permit correction. The next
        // deliberate submission starts a new request instead of changing saved intent.
        setAttempt(null); setServerErrors(getCreationFailureFields(error));
        requestAnimationFrame(focusFirstError);
      } else {
        setAttempt({ ...current, wasUncertain: current.wasUncertain || isUncertainCreation(error) });
        requestAnimationFrame(() => summary.current?.focus());
      }
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting), isDirty = useStore(form.store, (state) => !state.isDefaultValue);
  const hasSubmitted = useStore(form.store, (state) => state.submissionAttempts > 0);
  const fieldMeta = useStore(form.store, (state) => state.fieldMeta);
  const target = useStore(form.store, (state) => state.values.target);
  const errors: CreationErrors = { ...Object.fromEntries(Object.entries(fieldMeta).filter(([, meta]) => meta?.errors.length)
    .map(([key, meta]) => [key, [...new Set(meta?.errors)].join(" ")])), ...serverErrors };
  const hasErrors = Object.keys(errors).length > 0, isIdentityBlocked = failure?.code === "core_identity_changed";
  const isDisabled = !isHydrated || isSubmitting || Boolean(attempt) || isIdentityBlocked;
  const hasWorkspace = page.scope.kind === "workspace" || target === "workspace";
  const countries = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "region" }), collator = new Intl.Collator(locale);
    return getCountries().map((country) => ({ country, label: m.accounts_create_login_country_option({
      country: names.of(country) ?? country, dialCode: getCountryCallingCode(country) }) })).sort((a, b) => collator.compare(a.label, b.label));
  }, [locale]);
  useEffect(() => {
    if (!isDirty || saved) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, saved]);

  function focusFirstError(): void {
    const field = element.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)');
    (field ?? summary.current)?.focus();
  }
  function isActivatingButton(event: Pick<FocusEvent, "relatedTarget">): boolean {
    return isPointerDown.current && event.relatedTarget instanceof HTMLButtonElement && event.relatedTarget.form === element.current;
  }
  function validateField(field: CreationField): string | undefined { return validateCreationValues(form.state.values, page)[field]; }
  function clearServerError(field: CreationField): void {
    setServerErrors((previous) => { const next = { ...previous }; delete next[field]; return next; });
  }
  function handleWorkspaceFailure(error: CreationFailure): void {
    if (["core_unauthenticated", "core_identity_changed", "core_forbidden", "core_login_inactive", "core_profile_incomplete", "core_creation_incomplete"].includes(error.code)) {
      setFailure(error); requestAnimationFrame(() => summary.current?.focus());
    }
  }

  if (saved) return <CreationSuccess saved={saved} onAnother={() => { setSaved(undefined); requestAnimationFrame(() => element.current?.querySelector<HTMLElement>("#email")?.focus()); }} />;
  const fields = [
    { name: "email", label: m.accounts_create_login_email(), type: "email", autocomplete: "section-new-login email" },
    { name: "username", label: m.accounts_create_login_username(), type: "text", autocomplete: "section-new-login username" },
    { name: "name", label: m.accounts_create_login_name(), type: "text", autocomplete: "section-new-login name" },
    { name: "password", label: m.accounts_create_login_password(), type: "password", autocomplete: "section-new-login new-password" },
  ] as const;
  return <form ref={element} method="post" noValidate aria-busy={!isHydrated || isSubmitting}
    onPointerDownCapture={() => { isPointerDown.current = true; }} onPointerUpCapture={() => { isPointerDown.current = false; }}
    onPointerCancelCapture={() => { isPointerDown.current = false; }} onKeyDownCapture={() => { isPointerDown.current = false; }}
    onSubmit={async (event) => {
      event.preventDefault();
      if (!isHydrated || form.state.isSubmitting || isIdentityBlocked) return;
      if (!attempt) {
        // Silent password-manager fills may not emit React change events.
        const values = new FormData(event.currentTarget);
        for (const field of fields) form.setFieldValue(field.name, String(values.get(field.name) ?? ""));
        form.setFieldValue("phone", { country: String(values.get("country") ?? ""), number: String(values.get("phone") ?? "") });
        form.setFieldValue("target", page.scope.kind === "workspace" ? "workspace" : String(values.get("target") ?? ""));
        // Paging disables the select temporarily; retain its chosen workspace.
        form.setFieldValue("workspaceId", page.scope.kind === "workspace" ? page.scope.workspace.workspaceId
          : String(values.get("workspaceId") ?? selected?.workspaceId ?? ""));
        form.setFieldValue("kind", String(values.get("kind") ?? "internal"));
      }
      setServerErrors({}); await form.handleSubmit();
    }}>
    <FieldGroup>
      {(hasSubmitted && hasErrors) || failure ? <div ref={summary} role="alert" tabIndex={-1} className="rounded-lg border border-destructive p-4 outline-none">
        <p className="font-medium">{hasErrors ? m.accounts_create_login_errors_title() : getCreationFailureMessage(failure ?? { code: "core_invalid_input" })}</p>
        {hasErrors ? <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
          {Object.entries(errors).map(([field, message]) => <li key={field}><a className="underline underline-offset-4"
            href={"#" + (field === "phone" && !form.state.values.phone.country ? "phone-country" : field)}>{message}</a></li>)}
        </ul> : null}
        {failure?.requestId ? <p className="mt-2 break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
        {failure?.code === "core_unauthenticated" ? <a className={buttonVariants({ variant: "outline" })} href="/sign-in" target="_blank" rel="noopener noreferrer">{m.accounts_create_login_sign_in()}</a> : null}
        {isIdentityBlocked ? <Button type="button" variant="outline" onClick={() => location.reload()}>{m.accounts_create_login_reload()}</Button> : null}
      </div> : null}
      {attempt && !isSubmitting ? <div className="rounded-lg border border-border bg-muted p-4 text-sm">
        <p>{m.accounts_create_login_pending()}</p><p className="mt-2 break-all">{m.accounts_create_login_reference({ creationId: attempt.data.creationId })}</p>
      </div> : null}
      <fieldset disabled={isDisabled} className="min-w-0 space-y-5">
        {page.scope.kind === "workspace" ? <p className="text-sm">{m.accounts_create_login_own_workspace({ name: page.scope.workspace.name })}</p>
          : <form.Field name="target" validators={{ onBlur: () => validateField("target"), onSubmit: () => validateField("target") }}>
            {(field) => <Field><FieldLabel htmlFor="target">{m.accounts_create_login_target()}</FieldLabel>
              <NativeSelect id="target" name="target" value={field.state.value} aria-invalid={Boolean(errors.target)} aria-describedby="target-error"
                onChange={(event) => field.handleChange(event.target.value)} onBlur={(event) => { if (!isActivatingButton(event)) field.handleBlur(); }}>
                <option value="standalone">{m.accounts_create_login_standalone()}</option><option value="workspace">{m.accounts_create_login_workspace_target()}</option>
              </NativeSelect><FieldError id="target-error">{errors.target}</FieldError></Field>}
          </form.Field>}
        {hasWorkspace && page.scope.kind === "master" ? <form.Field name="workspaceId" validators={{ onSubmit: () => validateField("workspaceId") }}>
          {(field) => <div><WorkspacePicker creatorLoginId={page.creatorLoginId} selected={selected} disabled={isDisabled}
            invalid={Boolean(errors.workspaceId)} onChange={(value) => { setSelected(value); field.handleChange(value?.workspaceId ?? ""); clearServerError("workspaceId"); }}
            onFailure={handleWorkspaceFailure} /><FieldError id="workspaceId-error">{errors.workspaceId}</FieldError></div>}
        </form.Field> : null}
        {hasWorkspace ? <form.Field name="kind" validators={{ onBlur: () => validateField("kind"), onSubmit: () => validateField("kind") }}>
          {(field) => <Field><FieldLabel htmlFor="kind">{m.accounts_create_login_kind()}</FieldLabel>
            <NativeSelect id="kind" name="kind" value={field.state.value} aria-invalid={Boolean(errors.kind)} aria-describedby="kind-error"
              onChange={(event) => field.handleChange(event.target.value)} onBlur={(event) => { if (!isActivatingButton(event)) field.handleBlur(); }}>
              <option value="internal">{m.accounts_create_login_internal()}</option><option value="external">{m.accounts_create_login_external()}</option>
            </NativeSelect><FieldError id="kind-error">{errors.kind}</FieldError></Field>}
        </form.Field> : null}
        {fields.map((definition) => <form.Field key={definition.name} name={definition.name}
          validators={{ onBlur: () => validateField(definition.name), onSubmit: () => validateField(definition.name) }}>
          {(field) => <Field><FieldLabel htmlFor={definition.name}>{definition.label}</FieldLabel>
            <Input id={definition.name} name={definition.name} type={definition.type} value={field.state.value} autoComplete={definition.autocomplete}
              autoCapitalize={definition.name === "email" || definition.name === "username" ? "none" : undefined} spellCheck={false} required
              aria-invalid={Boolean(errors[definition.name])} aria-describedby={[
                definition.name === "username" || definition.name === "password" ? definition.name + "-help" : "",
                errors[definition.name] ? definition.name + "-error" : "",
              ].filter(Boolean).join(" ") || undefined}
              onChange={(event) => field.handleChange(event.target.value)} onBlur={(event) => {
                field.handleChange(event.currentTarget.value);
                if (!isActivatingButton(event)) { clearServerError(definition.name); field.handleBlur(); }
              }} />
            {definition.name === "username" ? <FieldDescription id="username-help">{m.accounts_create_login_username_help()}</FieldDescription> : null}
            {definition.name === "password" ? <FieldDescription id="password-help">{m.accounts_create_login_password_help()}</FieldDescription> : null}
            <FieldError id={definition.name + "-error"}>{errors[definition.name]}</FieldError></Field>}
        </form.Field>)}
        <form.Field name="phone" validators={{ onBlur: () => validateField("phone"), onSubmit: () => validateField("phone") }}>
          {(field) => <fieldset className="min-w-0 space-y-3" onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget) && !isActivatingButton(event)) { clearServerError("phone"); field.handleBlur(); }
          }}>
            <legend className="mb-3 text-sm font-medium">{m.accounts_create_login_phone()}</legend>
            <Field><FieldLabel htmlFor="phone-country">{m.accounts_create_login_country()}</FieldLabel>
              <NativeSelect id="phone-country" name="country" autoComplete="section-new-login country" value={field.state.value.country} required
                aria-invalid={Boolean(errors.phone) && !field.state.value.country} aria-describedby="phone-help phone-error"
                onChange={(event) => field.handleChange({ ...field.state.value, country: event.target.value })}>
                <option value="">{m.accounts_create_login_country_placeholder()}</option>
                {countries.map(({ country, label }) => <option key={country} value={country}>{label}</option>)}
              </NativeSelect></Field>
            <Field><FieldLabel htmlFor="phone">{m.accounts_create_login_number()}</FieldLabel>
              <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="section-new-login tel-national" value={field.state.value.number} required
                aria-invalid={Boolean(errors.phone) && Boolean(field.state.value.country)} aria-describedby="phone-help phone-error"
                onChange={(event) => field.handleChange({ ...field.state.value, number: event.target.value })} /></Field>
            <FieldDescription id="phone-help">{m.accounts_create_login_phone_help()}</FieldDescription><FieldError id="phone-error">{errors.phone}</FieldError>
          </fieldset>}
        </form.Field>
      </fieldset>
      <Button type="submit" disabled={!isHydrated || isSubmitting || isIdentityBlocked}>
        {isSubmitting ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}
        {isSubmitting ? m.accounts_create_login_submitting() : attempt ? m.accounts_create_login_retry() : m.accounts_create_login_submit()}
      </Button>
      <p role="status" className="sr-only">{!isHydrated ? m.core_loading() : isSubmitting ? m.accounts_create_login_submitting() : ""}</p>
    </FieldGroup>
  </form>;
}

function CreationSuccess({ saved, onAnother }: { saved: CreatedLogin; onAnother(): void }): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <div className="space-y-4">
    <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">{m.accounts_create_login_success()}</h2>
    <p>{m.accounts_create_login_success_details({ email: saved.email, username: saved.username })}</p>
    <p className="text-sm text-muted-foreground">{m.accounts_create_login_handover()}</p>
    <Button type="button" onClick={onAnother}>{m.accounts_create_login_another()}</Button>
  </div>;
}
