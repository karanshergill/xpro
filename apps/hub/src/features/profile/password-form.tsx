import { useForm, useStore } from "@tanstack/react-form";
import { useHydrated } from "@tanstack/react-router";
import { useRef, useState, type FocusEvent } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { Button, buttonVariants } from "@xpro/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "#components/ui/field";
import { Input } from "#components/ui/input";
import { m } from "#paraglide/messages.js";
import { isAccessFailure, validatePassword, type ProfileFailure } from "./profile";
import { savePassword } from "./profile.data";
import { ProfileNotice, useUnsavedProfile, type FormActions } from "./profile-form";

export function PasswordForm(actions: FormActions): React.JSX.Element {
  const isHydrated = useHydrated(), element = useRef<HTMLFormElement>(null), summary = useRef<HTMLDivElement>(null), isPointerDown = useRef(false);
  const [failure, setFailure] = useState<ProfileFailure>(), [isSaved, setIsSaved] = useState(false);
  const [serverErrors, setServerErrors] = useState<{ currentPassword?: string; newPassword?: string }>({});
  const form = useForm({ defaultValues: { currentPassword: "", newPassword: "" }, onSubmitInvalid: () => requestAnimationFrame(focusFirstError),
    onSubmit: async ({ value }) => {
      actions.onBusy(true); setFailure(undefined); setServerErrors({}); setIsSaved(false);
      try {
        const result = await savePassword(value, actions.loginId);
        if (result.status === "saved") { form.reset(); setIsSaved(true); return; }
        showFailure(result.error);
      } catch { showFailure({ code: "core_unexpected_error" }); }
      finally { actions.onBusy(false); }
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting), isDirty = useStore(form.store, (state) => !state.isDefaultValue);
  const meta = useStore(form.store, (state) => state.fieldMeta);
  const errors = { currentPassword: [...new Set(meta.currentPassword?.errors ?? [])].join(" ") || serverErrors.currentPassword,
    newPassword: [...new Set(meta.newPassword?.errors ?? [])].join(" ") || serverErrors.newPassword };
  const hasErrors = Boolean(errors.currentPassword || errors.newPassword), isDisabled = !isHydrated || actions.disabled || isSubmitting;
  const isUncertain = failure && !isAccessFailure(failure) && !["core_invalid_input", "core_request_too_large", "accounts_current_password_invalid"].includes(failure.code);
  useUnsavedProfile(isDirty);
  function focusFirstError(): void { (element.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)') ?? summary.current)?.focus(); }
  function isActivatingButton(event: Pick<FocusEvent, "relatedTarget">): boolean {
    return isPointerDown.current && event.relatedTarget instanceof HTMLButtonElement && event.relatedTarget.form === element.current;
  }
  function showFailure(error: ProfileFailure): void {
    setFailure(error); actions.onFailure(error);
    if (error.code === "accounts_current_password_invalid") setServerErrors({ currentPassword: m.accounts_profile_current_invalid() });
    if (error.code === "core_invalid_input") setServerErrors(Object.fromEntries((error.fields ?? []).filter((field) => field === "currentPassword" || field === "newPassword")
      .map((field) => [field, field === "currentPassword" ? m.accounts_profile_current_required() : m.accounts_profile_password_invalid()])));
    requestAnimationFrame(focusFirstError);
  }
  const fields = [{ name: "currentPassword", label: m.accounts_profile_current_password(), autocomplete: "current-password" },
    { name: "newPassword", label: m.accounts_profile_new_password(), autocomplete: "new-password" }] as const;
  return <section className="rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="password-title">
    <h2 id="password-title" className="text-xl font-semibold">{m.accounts_profile_password()}</h2>
    <p className="mb-5 mt-2 text-sm text-muted-foreground">{m.accounts_profile_password_sessions()}</p>
    <form ref={element} method="post" noValidate aria-busy={!isHydrated || isSubmitting}
      onPointerDownCapture={() => { isPointerDown.current = true; }} onPointerUpCapture={() => { isPointerDown.current = false; }}
      onPointerCancelCapture={() => { isPointerDown.current = false; }} onKeyDownCapture={() => { isPointerDown.current = false; }}
      onSubmit={async (event) => {
        event.preventDefault(); if (isDisabled || form.state.isSubmitting) return;
        const values = new FormData(event.currentTarget); for (const field of fields) form.setFieldValue(field.name, String(values.get(field.name) ?? ""));
        setServerErrors({}); setIsSaved(false); await form.handleSubmit();
      }}>
      <FieldGroup>
        {hasErrors || failure ? <div ref={summary} role="alert" tabIndex={-1} className="rounded-lg border border-destructive p-4 outline-none">
          <ProfileNotice failure={failure}>{hasErrors ? m.accounts_profile_errors() : isUncertain ? m.accounts_profile_password_unknown() : undefined}</ProfileNotice>
          {hasErrors ? <ul className="mt-2 list-disc ps-5 text-sm">{fields.filter((field) => errors[field.name]).map((field) =>
            <li key={field.name}><a href={"#profile-" + field.name} className="underline">{errors[field.name]}</a></li>)}</ul> : null}
          {isUncertain ? <a className={buttonVariants({ variant: "outline" })} href="/sign-in" target="_blank" rel="noopener noreferrer">{m.accounts_profile_sign_in_tab()}</a> : null}
        </div> : null}
        <fieldset disabled={isDisabled} className="min-w-0 space-y-5">
          {fields.map((definition) => <form.Field key={definition.name} name={definition.name} validators={{
            onBlur: () => validatePassword(form.state.values)[definition.name], onSubmit: () => validatePassword(form.state.values)[definition.name],
          }}>{(field) => <Field><FieldLabel htmlFor={"profile-" + definition.name}>{definition.label}</FieldLabel>
            <Input id={"profile-" + definition.name} name={definition.name} type="password" autoComplete={definition.autocomplete} required value={field.state.value}
              aria-invalid={Boolean(errors[definition.name])} aria-describedby={(definition.name === "newPassword" ? "profile-password-help " : "") + "profile-" + definition.name + "-error"}
              onChange={(event) => { field.handleChange(event.target.value); setIsSaved(false); }} onBlur={(event) => {
                field.handleChange(event.currentTarget.value); if (!isActivatingButton(event)) { setServerErrors((value) => ({ ...value, [definition.name]: undefined })); field.handleBlur(); }
              }} />
            {definition.name === "newPassword" ? <FieldDescription id="profile-password-help">{m.accounts_profile_password_help()}</FieldDescription> : null}
            <FieldError id={"profile-" + definition.name + "-error"}>{errors[definition.name]}</FieldError></Field>}</form.Field>)}
        </fieldset>
        <Button type="submit" disabled={isDisabled}>{isSubmitting ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}
          {isSubmitting ? m.accounts_profile_saving() : m.accounts_profile_password_save()}</Button>
        <p role="status">{isSaved ? m.accounts_profile_password_saved() : ""}</p>
      </FieldGroup>
    </form>
  </section>;
}
