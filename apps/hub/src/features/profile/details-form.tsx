import { useForm, useStore } from "@tanstack/react-form";
import { useHydrated } from "@tanstack/react-router";
import { getCountries, getCountryCallingCode } from "libphonenumber-js/max";
import { useMemo, useRef, useState, type FocusEvent } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { Button } from "@xpro/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "#components/ui/field";
import { Input } from "#components/ui/input";
import { NativeSelect } from "#components/ui/native-select";
import { m } from "#paraglide/messages.js";
import { getLocale } from "#paraglide/runtime.js";
import { getInitialDetails, normalizeDetails, validateDetails, type DetailsErrors, type Profile, type ProfileFailure } from "./profile";
import { saveDetails } from "./profile.data";
import { ProfileNotice, useUnsavedProfile, type FormActions } from "./profile-form";

export function DetailsForm({ profile, onSaved, ...actions }: FormActions & { profile: Profile; onSaved(value: Pick<Profile, "name" | "phone">): void }): React.JSX.Element {
  const isHydrated = useHydrated(), locale = getLocale(), element = useRef<HTMLFormElement>(null), summary = useRef<HTMLDivElement>(null);
  const isPointerDown = useRef(false), [initial, setInitial] = useState(() => getInitialDetails(profile));
  const [failure, setFailure] = useState<ProfileFailure>(), [serverErrors, setServerErrors] = useState<DetailsErrors>({}), [isSaved, setIsSaved] = useState(false);
  const form = useForm({ defaultValues: initial, onSubmitInvalid: () => requestAnimationFrame(focusFirstError),
    onSubmit: async ({ value }) => {
      actions.onBusy(true); setFailure(undefined); setServerErrors({}); setIsSaved(false);
      try {
        const result = await saveDetails(value, actions.loginId);
        if (result.status === "saved") {
          const saved = normalizeDetails(value), values = getInitialDetails({ ...profile, ...saved });
          setInitial(values); form.reset(values); onSaved(saved); setIsSaved(true); return;
        }
        showFailure(result.error);
      } catch { showFailure({ code: "core_unexpected_error" }); }
      finally { actions.onBusy(false); }
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting), isDirty = useStore(form.store, (state) => !state.isDefaultValue);
  const meta = useStore(form.store, (state) => state.fieldMeta);
  const errors: DetailsErrors = { name: [...new Set(meta.name?.errors ?? [])].join(" ") || serverErrors.name,
    phone: [...new Set(meta.phone?.errors ?? [])].join(" ") || serverErrors.phone };
  const hasErrors = Boolean(errors.name || errors.phone), isDisabled = !isHydrated || actions.disabled || isSubmitting;
  const countries = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "region" }), collator = new Intl.Collator(locale);
    return getCountries().map((country) => ({ country, label: m.accounts_profile_country_option({ country: names.of(country) ?? country,
      dialCode: getCountryCallingCode(country) }) })).sort((a, b) => collator.compare(a.label, b.label));
  }, [locale]);
  useUnsavedProfile(isDirty);
  function focusFirstError(): void { (element.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)') ?? summary.current)?.focus(); }
  function isActivatingButton(event: Pick<FocusEvent, "relatedTarget">): boolean {
    return isPointerDown.current && event.relatedTarget instanceof HTMLButtonElement && event.relatedTarget.form === element.current;
  }
  function showFailure(error: ProfileFailure): void {
    setFailure(error); actions.onFailure(error);
    if (error.code === "core_invalid_input") setServerErrors(Object.fromEntries((error.fields ?? []).filter((field) => field === "name" || field === "phone")
      .map((field) => [field, field === "name" ? m.accounts_profile_name_required() : m.accounts_profile_phone_invalid()])));
    requestAnimationFrame(focusFirstError);
  }
  return <section className="rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="details-title">
    <h2 id="details-title" className="mb-5 text-xl font-semibold">{m.accounts_profile_details()}</h2>
    <form ref={element} method="post" noValidate aria-busy={!isHydrated || isSubmitting}
      onPointerDownCapture={() => { isPointerDown.current = true; }} onPointerUpCapture={() => { isPointerDown.current = false; }}
      onPointerCancelCapture={() => { isPointerDown.current = false; }} onKeyDownCapture={() => { isPointerDown.current = false; }}
      onSubmit={async (event) => {
        event.preventDefault(); if (isDisabled || form.state.isSubmitting) return;
        const values = new FormData(event.currentTarget);
        form.setFieldValue("name", String(values.get("name") ?? ""));
        form.setFieldValue("phone", { country: String(values.get("country") ?? ""), number: String(values.get("phone") ?? "") });
        setServerErrors({}); setIsSaved(false); await form.handleSubmit();
      }}>
      <FieldGroup>
        {hasErrors || failure ? <div ref={summary} role="alert" tabIndex={-1} className="rounded-lg border border-destructive p-4 outline-none">
          <ProfileNotice failure={failure}>{hasErrors ? m.accounts_profile_errors() : undefined}</ProfileNotice>
          {hasErrors ? <ul className="mt-2 list-disc ps-5 text-sm">{Object.entries(errors).filter(([, error]) => error).map(([field, error]) =>
            <li key={field}><a className="underline" href={field === "phone" && !form.state.values.phone.country ? "#profile-country" : "#profile-" + field}>{error}</a></li>)}</ul> : null}
        </div> : null}
        <fieldset disabled={isDisabled} className="min-w-0 space-y-5">
          <Field><FieldLabel htmlFor="profile-email">{m.accounts_profile_email()}</FieldLabel><Input id="profile-email" value={profile.email} readOnly autoComplete="email" /></Field>
          <Field><FieldLabel htmlFor="profile-username">{m.accounts_profile_username()}</FieldLabel><Input id="profile-username" value={profile.username} readOnly autoComplete="username" />
            <FieldDescription>{m.accounts_profile_identifiers_help()}</FieldDescription></Field>
          <form.Field name="name" validators={{ onBlur: () => validateDetails(form.state.values).name, onSubmit: () => validateDetails(form.state.values).name }}>
            {(field) => <Field><FieldLabel htmlFor="profile-name">{m.accounts_profile_name()}</FieldLabel>
              <Input id="profile-name" name="name" autoComplete="name" required value={field.state.value} aria-invalid={Boolean(errors.name)} aria-describedby="profile-name-error"
                onChange={(event) => { field.handleChange(event.target.value); setIsSaved(false); }} onBlur={(event) => {
                  field.handleChange(event.currentTarget.value); if (!isActivatingButton(event)) { setServerErrors((value) => ({ ...value, name: undefined })); field.handleBlur(); }
                }} /><FieldError id="profile-name-error">{errors.name}</FieldError></Field>}
          </form.Field>
          <form.Field name="phone" validators={{ onBlur: () => validateDetails(form.state.values).phone, onSubmit: () => validateDetails(form.state.values).phone }}>
            {(field) => <fieldset className="min-w-0 space-y-3" onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget) && !isActivatingButton(event)) { setServerErrors((value) => ({ ...value, phone: undefined })); field.handleBlur(); }
            }}><legend className="mb-3 text-sm font-medium">{m.accounts_profile_phone()}</legend>
              <Field><FieldLabel htmlFor="profile-country">{m.accounts_profile_country()}</FieldLabel>
                <NativeSelect id="profile-country" name="country" autoComplete="country" required value={field.state.value.country}
                  aria-invalid={Boolean(errors.phone) && !field.state.value.country} aria-describedby="profile-phone-error"
                  onChange={(event) => { field.handleChange({ ...field.state.value, country: event.target.value }); setIsSaved(false); }}>
                  <option value="">{m.accounts_profile_country_placeholder()}</option>{countries.map(({ country, label }) => <option key={country} value={country}>{label}</option>)}
                </NativeSelect></Field>
              <Field><FieldLabel htmlFor="profile-phone">{m.accounts_profile_number()}</FieldLabel>
                <Input id="profile-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" required value={field.state.value.number}
                  aria-invalid={Boolean(errors.phone) && Boolean(field.state.value.country)} aria-describedby="profile-phone-error"
                  onChange={(event) => { field.handleChange({ ...field.state.value, number: event.target.value }); setIsSaved(false); }} /></Field>
              <FieldError id="profile-phone-error">{errors.phone}</FieldError>
            </fieldset>}
          </form.Field>
        </fieldset>
        <Button type="submit" disabled={isDisabled}>{isSubmitting ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}
          {isSubmitting ? m.accounts_profile_saving() : m.accounts_profile_save()}</Button>
        <p role="status">{isSaved ? m.accounts_profile_saved() : ""}</p>
      </FieldGroup>
    </form>
  </section>;
}
