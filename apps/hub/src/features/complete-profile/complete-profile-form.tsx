import { useForm, useStore } from "@tanstack/react-form";
import { useHydrated } from "@tanstack/react-router";
import type { ProfileField } from "@xpro/core/server";
import { getCountries, getCountryCallingCode } from "libphonenumber-js/max";
import { useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { Button } from "@xpro/ui/button";
import { Checkbox } from "#components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "#components/ui/field";
import { Input } from "#components/ui/input";
import { NativeSelect } from "#components/ui/native-select";
import { m } from "#paraglide/messages.js";
import { getLocale } from "#paraglide/runtime.js";
import { createCompletionInput, emptyProfileValues, validateProfileValues, type FieldErrors, type CompletionFailure } from "./complete-profile";
import { loadCompletionPage, saveCompletion } from "./complete-profile.data";
import { getFailureFields, getFailureMessage } from "./messages";

type Props = { fields: ProfileField[]; onFieldsChange(fields: ProfileField[]): void };

export function CompleteProfileForm({ fields, onFieldsChange }: Props): React.JSX.Element {
  const locale = getLocale(), element = useRef<HTMLFormElement>(null);
  const isPointerDown = useRef(false);
  // Keep early SSR interaction from losing input before handlers are attached.
  const isHydrated = useHydrated();
  const [failure, setFailure] = useState<CompletionFailure>();
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const form = useForm({
    defaultValues: emptyProfileValues,
    onSubmitInvalid: () => requestAnimationFrame(focusFirstError),
    onSubmit: async ({ value }) => {
      setFailure(undefined);
      setServerErrors({});
      try {
        const result = await saveCompletion(createCompletionInput(value, fields));
        if (result.status === "saved") { onFieldsChange([]); return; }
        if (result.error.code === "accounts_username_locked" || result.error.code === "core_profile_incomplete") {
          const refreshed = await loadCompletionPage();
          if (refreshed.status === "ready") {
            onFieldsChange(refreshed.fields);
            if (!refreshed.fields.length) return;
            setFailure({ code: "accounts_profile_changed" });
            return;
          }
        }
        setFailure(result.error);
        setServerErrors(getFailureFields(result.error));
        requestAnimationFrame(focusFirstError);
      } catch { setFailure({ code: "core_unexpected_error" }); }
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const isDirty = useStore(form.store, (state) => !state.isDefaultValue);
  const hasSubmitted = useStore(form.store, (state) => state.submissionAttempts > 0);
  const fieldMeta = useStore(form.store, (state) => state.fieldMeta);
  const countries = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "region" }), collator = new Intl.Collator(locale);
    return getCountries().map((country) => ({ country,
      label: m.accounts_complete_profile_country_option({ country: names.of(country) ?? country, dialCode: getCountryCallingCode(country) }),
    })).sort((a, b) => collator.compare(a.label, b.label));
  }, [locale]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const errors: FieldErrors = { ...Object.fromEntries(Object.entries(fieldMeta)
    .filter(([, meta]) => meta?.errors.length)
    .map(([field, meta]) => [field, meta?.errors.join(" ")])), ...serverErrors };
  const hasErrors = Object.keys(errors).length > 0;

  function validateUsername({ value }: { value: string }): string | undefined {
    return validateProfileValues({ ...form.state.values, username: value }, { fields: ["username"], locale })?.fields.username;
  }
  function validateName({ value }: { value: string }): string | undefined {
    return validateProfileValues({ ...form.state.values, name: value }, { fields: ["name"], locale })?.fields.name;
  }
  function validatePhone({ value }: { value: { country: string; number: string } }): string | undefined {
    return validateProfileValues({ ...form.state.values, phone: value }, { fields: ["phone"], locale })?.fields.phone;
  }
  function validateConfirmation({ value }: { value: boolean }): string | undefined {
    return value ? undefined : m.accounts_complete_profile_confirmation_required();
  }
  function isActivatingButton(event: FocusEvent<HTMLElement>): boolean {
    // Blur-driven layout changes must not swallow a pointer click. Keyboard
    // blur still validates immediately, and submission rechecks every field.
    const target = event.relatedTarget;
    return isPointerDown.current && target instanceof HTMLButtonElement && target.form === element.current;
  }
  function focusFirstError(): void {
    element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }
  function clearServerError(field: keyof FieldErrors): void {
    setServerErrors((previous) => { const next = { ...previous }; delete next[field]; return next; });
  }

  return <form ref={element} method="post" noValidate aria-busy={!isHydrated || isSubmitting}
    onPointerDownCapture={() => { isPointerDown.current = true; }} onPointerUpCapture={() => { isPointerDown.current = false; }}
    onPointerCancelCapture={() => { isPointerDown.current = false; }} onKeyDownCapture={() => { isPointerDown.current = false; }} onSubmit={async (event) => {
    event.preventDefault();
    if (isHydrated && !isSubmitting) await form.handleSubmit();
  }}>
    <FieldGroup>
      {(hasSubmitted && hasErrors) || failure ? <div role="alert" className="rounded-lg border border-destructive p-4">
        <p className="font-medium">{hasErrors ? m.accounts_complete_profile_errors_title() : getFailureMessage(failure)}</p>
        {hasErrors ? <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">
          {Object.entries(errors).map(([field, message]) => <li key={field}><a className="underline underline-offset-4" href={"#" + (field === "phone" && !form.state.values.phone.country ? "phone-country" : field)}>{message}</a></li>)}
        </ul> : null}
        {failure?.requestId ? <p className="mt-2 break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
        {failure?.code === "core_unauthenticated" ? <a className="mt-2 inline-flex min-h-6 items-center text-sm underline" href={"/sign-in" + window.location.search}>{m.core_sign_in()}</a> : null}
      </div> : null}

      {fields.includes("username") ? <>
        <form.Field name="username" validators={{ onBlur: validateUsername, onSubmit: validateUsername }}>
          {(field) => <Field>
            <FieldLabel htmlFor="username">{m.accounts_complete_profile_username()}</FieldLabel>
            <Input id="username" name="username" value={field.state.value} autoComplete="username" autoCapitalize="none" spellCheck={false}
              required disabled={!isHydrated || isSubmitting} aria-invalid={Boolean(errors.username)} aria-describedby="username-help username-error"
              onChange={(event) => { field.handleChange(event.target.value); form.setFieldValue("isUsernameConfirmed", false); }}
              onBlur={(event) => { if (!isActivatingButton(event)) { clearServerError("username"); field.handleBlur(); } }} />
            <FieldDescription id="username-help">{m.accounts_complete_profile_username_help()}</FieldDescription>
            <FieldError id="username-error">{errors.username}</FieldError>
          </Field>}
        </form.Field>
        <div className="rounded-lg border border-border bg-muted p-4">
          <p id="username-warning" className="text-sm font-medium">{m.accounts_complete_profile_username_warning()}</p>
          <form.Field name="isUsernameConfirmed" validators={{ onBlur: validateConfirmation, onSubmit: validateConfirmation }}>
            {(field) => <div className="mt-3">
              <Field orientation="horizontal">
                <Checkbox id="isUsernameConfirmed" name="isUsernameConfirmed" checked={field.state.value} required disabled={!isHydrated || isSubmitting}
                  aria-describedby="username-warning confirmation-error" aria-invalid={Boolean(errors.isUsernameConfirmed)}
                  onCheckedChange={field.handleChange} onBlur={(event) => { if (!isActivatingButton(event)) field.handleBlur(); }} />
                <FieldLabel htmlFor="isUsernameConfirmed">{m.accounts_complete_profile_confirm()}</FieldLabel>
              </Field>
              <FieldError id="confirmation-error">{errors.isUsernameConfirmed}</FieldError>
            </div>}
          </form.Field>
        </div>
      </> : null}

      {fields.includes("name") ? <form.Field name="name" validators={{ onBlur: validateName, onSubmit: validateName }}>
        {(field) => <Field>
          <FieldLabel htmlFor="name">{m.accounts_complete_profile_name()}</FieldLabel>
          <Input id="name" name="name" value={field.state.value} autoComplete="name" required disabled={!isHydrated || isSubmitting}
            aria-invalid={Boolean(errors.name)} aria-describedby="name-error" onChange={(event) => field.handleChange(event.target.value)}
            onBlur={(event) => { if (!isActivatingButton(event)) { clearServerError("name"); field.handleBlur(); } }} />
          <FieldError id="name-error">{errors.name}</FieldError>
        </Field>}
      </form.Field> : null}

      {fields.includes("phone") ? <form.Field name="phone" validators={{ onBlur: validatePhone, onSubmit: validatePhone }}>
        {(field) => <fieldset className="min-w-0 space-y-3" disabled={!isHydrated || isSubmitting} onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget) && !isActivatingButton(event)) { clearServerError("phone"); field.handleBlur(); }
        }}>
          <legend className="mb-3 text-sm font-medium">{m.accounts_complete_profile_phone()}</legend>
          <Field>
            <FieldLabel htmlFor="phone-country">{m.accounts_complete_profile_country()}</FieldLabel>
            <NativeSelect id="phone-country" name="country" autoComplete="country" value={field.state.value.country} required
              aria-invalid={Boolean(errors.phone) && !field.state.value.country} aria-describedby="phone-help phone-error"
              onChange={(event) => field.handleChange({ ...field.state.value, country: event.target.value })}>
              <option value="">{m.accounts_complete_profile_country_placeholder()}</option>
              {countries.map(({ country, label }) => <option key={country} value={country}>{label}</option>)}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="phone">{m.accounts_complete_profile_number()}</FieldLabel>
            <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" value={field.state.value.number}
              required aria-invalid={Boolean(errors.phone) && Boolean(field.state.value.country)} aria-describedby="phone-help phone-error"
              onChange={(event) => field.handleChange({ ...field.state.value, number: event.target.value })} />
          </Field>
          <FieldDescription id="phone-help">{m.accounts_complete_profile_phone_help()}</FieldDescription>
          <FieldError id="phone-error">{errors.phone}</FieldError>
        </fieldset>}
      </form.Field> : null}

      <Button type="submit" disabled={!isHydrated || isSubmitting}>
        {isSubmitting ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}
        {isSubmitting ? m.accounts_complete_profile_saving() : m.accounts_complete_profile_submit()}
      </Button>
      <p role="status" className="sr-only">{!isHydrated ? m.core_loading() : isSubmitting ? m.accounts_complete_profile_saving() : ""}</p>
    </FieldGroup>
  </form>;
}
