import { useEffect, useRef, useState } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { useHydrated } from "@tanstack/react-router";
import { safeParse } from "valibot";
import { formatDateTime } from "@xpro/core";
import type { AccountDetails } from "@xpro/stms";
import { Button } from "@xpro/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "#components/ui/field";
import { Input } from "#components/ui/input";
import { m } from "#paraglide/messages.js";
import { getLocale } from "#paraglide/runtime.js";
import { StmsShell } from "#features/stms/management-ui";
import { useUnsavedChanges } from "#features/stms/management-form";
import type { LoginSearch, ManagementFailure } from "#features/stms/management";
import { accountListHref, loadAccount, renameSchema } from "./accounts.data";
import { AccountAccess, AccountOutcome, useAccountCommand } from "./account-form";

export function AccountDetail(props: { initial: AccountDetails; pageLoginId: string; search: LoginSearch }): React.JSX.Element {
  return <DetailScreen key={props.initial.accountId + "/" + props.pageLoginId} {...props} />;
}
function DetailScreen({ initial, pageLoginId, search }: { initial: AccountDetails; pageLoginId: string; search: LoginSearch }): React.JSX.Element {
  const hydrated = useHydrated(), heading = useRef<HTMLHeadingElement>(null), input = useRef<HTMLInputElement>(null);
  const [account, setAccount] = useState(initial), [name, setName] = useState(initial.name ?? ""), [baseline, setBaseline] = useState(initial.name ?? "");
  const [nameError, setNameError] = useState<string>(), [access, setAccess] = useState<ManagementFailure>();
  const [reading, setReading] = useState(false), readingRef = useRef(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); return () => pending.current?.abort(); }, []);
  async function readCurrentAccount(): Promise<AccountDetails | undefined> {
    if (readingRef.current) return;
    readingRef.current = true; setReading(true); const controller = new AbortController(); pending.current = controller;
    try {
      const page = await loadAccount(initial.accountId, { pageLoginId, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (page.status === "error") { setAccess(page.error); return; }
      setAccount(page.value); setBaseline(page.value.name ?? ""); setAccess(undefined);
      return page.value;
    } catch { if (!controller.signal.aborted) setAccess({ code: "core_unexpected_error" }); return; }
    finally { readingRef.current = false; if (!controller.signal.aborted) setReading(false); }
  }
  async function refresh(): Promise<boolean> {
    const current = await readCurrentAccount();
    if (!current) return false;
    // Rebase clean fields; keep actual edits against the newly read baseline.
    setName((draft) => draft === baseline ? current.name ?? "" : draft);
    return true;
  }
  async function refreshAfterSave(): Promise<boolean> {
    const current = await readCurrentAccount();
    if (!current) return false;
    setName(current.name ?? "");
    return true;
  }
  const operation = useAccountCommand({ pageLoginId, onAccess: setAccess, onSaved: refreshAfterSave, onRefresh: refresh });
  useUnsavedChanges(name !== baseline && !(operation.confirmed && operation.frozen));
  const disabled = !hydrated || operation.locked || reading || Boolean(access);
  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (disabled) return;
    const parsed = safeParse(renameSchema, { operationId: crypto.randomUUID(), accountId: account.accountId, expectedRevision: account.revision, name });
    if (!parsed.success) { setNameError(m.stms_accounts_name_required()); requestAnimationFrame(() => input.current?.focus()); return; }
    setNameError(undefined); await operation.send({ kind: "rename", data: parsed.output });
  }
  const rows = [
    [m.stms_accounts_name(), account.name ?? m.stms_accounts_unnamed()], [m.stms_accounts_id(), account.accountId],
    [m.stms_accounts_status(), account.status === "stms_active" ? m.stms_accounts_active() : m.stms_accounts_suspended()],
    [m.stms_accounts_revision(), new Intl.NumberFormat(getLocale()).format(account.revision)],
    [m.stms_accounts_holder(), account.holder.name || m.stms_logins_not_set()], [m.stms_accounts_holder_id(), account.holder.loginId],
    [m.stms_logins_email(), account.holder.email], [m.stms_logins_username(), account.holder.username ?? m.stms_logins_not_set()],
    [m.stms_accounts_created(), formatDateTime(account.createdAt, { locale: getLocale(), timeZone: "UTC" })],
    [m.stms_accounts_updated(), formatDateTime(account.updatedAt, { locale: getLocale(), timeZone: "UTC" })],
    [m.stms_accounts_workspace(), account.workspace?.name ?? m.stms_accounts_no_workspace()],
    ...(account.workspace ? [[m.stms_accounts_workspace_id(), account.workspace.workspaceId]] : []),
  ];
  return <StmsShell><AccountAccess failure={access} confirmed={Boolean(operation.confirmed)} busy={reading || operation.busy} onCheck={async () => { await refresh(); }}>
    <a href={accountListHref(search)} className="inline-flex min-h-11 items-center underline underline-offset-4">{m.stms_accounts_back()}</a>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.stms_accounts_detail_title()}</h1>
    <dl className="grid gap-x-8 gap-y-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2 sm:p-6">{rows.map(([label, value]) =>
      <div key={label} className="min-w-0"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 [overflow-wrap:anywhere]"><bdi>{value}</bdi></dd></div>)}</dl>
    <section aria-labelledby="rename-account-title" className="space-y-4 rounded-xl border border-border bg-card p-5 sm:p-6">
      <h2 id="rename-account-title" className="text-xl font-semibold">{m.stms_accounts_rename_title()}</h2><p className="text-sm text-muted-foreground">{m.stms_accounts_rename_help()}</p>
      <form method="post" noValidate onSubmit={(event) => { void submit(event); }} aria-busy={operation.busy} className="space-y-5">
        {nameError ? <div role="alert" tabIndex={-1}><a href="#account-name" className="underline">{nameError}</a></div> : null}
        <Field><FieldLabel htmlFor="account-name">{m.stms_accounts_name()}</FieldLabel><Input ref={input} id="account-name" name="name" required autoComplete="off" value={name} disabled={disabled}
          aria-invalid={Boolean(nameError)} aria-describedby="account-name-help account-name-error" onChange={(event) => { setName(event.target.value); setNameError(undefined); }} />
          <FieldDescription id="account-name-help">{m.stms_accounts_name_help()}</FieldDescription><FieldError id="account-name-error">{nameError}</FieldError></Field>
        <Button type="submit" disabled={disabled}>{operation.pendingAction === "save" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}{operation.pendingAction === "save" ? m.stms_logins_saving() : m.stms_accounts_rename_submit()}</Button>
      </form>
      <AccountOutcome operation={operation} />
    </section>
  </AccountAccess></StmsShell>;
}
