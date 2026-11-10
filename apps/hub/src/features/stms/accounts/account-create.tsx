import { useEffect, useRef, useState } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { useHydrated } from "@tanstack/react-router";
import { safeParse } from "valibot";
import { defaultLoginPageSize, maximumLoginSearchLength, type LoginPage, type LoginSummary } from "@xpro/stms";
import { Button } from "@xpro/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "#components/ui/field";
import { Input } from "#components/ui/input";
import { m } from "#paraglide/messages.js";
import { getLocale } from "#paraglide/runtime.js";
import { StmsShell } from "#features/stms/management-ui";
import { useUnsavedChanges } from "#features/stms/management-form";
import { getStatusLabel, type LoginSearch, type ManagementFailure } from "#features/stms/management";
import { accountDetailHref, checkHolderAccess, createSchema, loadAccount, loadHolders } from "./accounts.data";
import { AccountAccess, AccountFailure, AccountOutcome, accountAccessFailure, useAccountCommand } from "./account-form";

type HolderReadAction = "search" | "clear" | "retry" | "previous" | "next";

export function AccountCreate(props: { initial: LoginPage; pageLoginId: string }): React.JSX.Element {
  return <CreateScreen key={props.pageLoginId} {...props} />;
}
function CreateScreen({ initial, pageLoginId }: { initial: LoginPage; pageLoginId: string }): React.JSX.Element {
  const hydrated = useHydrated(), heading = useRef<HTMLHeadingElement>(null), nameInput = useRef<HTMLInputElement>(null), holderLegend = useRef<HTMLLegendElement>(null);
  const [name, setName] = useState(""), [selected, setSelected] = useState<LoginSummary>();
  const [errors, setErrors] = useState<{ name?: string; holder?: string }>({});
  const [holders, setHolders] = useState(initial), [query, setQuery] = useState(""), [search, setSearch] = useState<LoginSearch>({ query: "", offset: 0 });
  const [failure, setFailure] = useState<ManagementFailure>(), [access, setAccess] = useState<ManagementFailure>();
  const [refreshFailure, setRefreshFailure] = useState<ManagementFailure>();
  const [readingAction, setReadingAction] = useState<HolderReadAction | "access">(), readingRef = useRef(false), [destination, setDestination] = useState<string>();
  const reading = readingAction !== undefined;
  const pending = useRef<AbortController | null>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); return () => pending.current?.abort(); }, []);
  function show(error: ManagementFailure): void { setFailure(error); if (accountAccessFailure(error)) setAccess(error); }
  const operation = useAccountCommand({ pageLoginId, onAccess: setAccess,
    onRefresh: async () => await checkAccess(),
    onSaved: async (receipt) => {
      setRefreshFailure(undefined);
      const page = await loadAccount(receipt.accountId, { pageLoginId });
      if (page.status === "error") { setRefreshFailure(page.error); if (accountAccessFailure(page.error)) setAccess(page.error); return false; }
      setDestination(accountDetailHref(receipt.accountId)); return true;
    },
  });
  useUnsavedChanges(Boolean((name || selected) && !operation.confirmed && !destination));
  useEffect(() => { if (destination) location.assign(destination); }, [destination]);
  const disabled = !hydrated || operation.locked || reading || Boolean(access) || Boolean(destination);
  async function readHolders(next: LoginSearch, action: HolderReadAction = "search"): Promise<void> {
    if (readingRef.current || operation.locked || access) return;
    readingRef.current = true; setReadingAction(action); setFailure(undefined);
    const controller = new AbortController(); pending.current = controller;
    try {
      const page = await loadHolders(next, { pageLoginId, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (page.status === "error") show(page.error); else { setHolders(page.value); setSearch(next); }
    } catch { if (!controller.signal.aborted) show({ code: "core_unexpected_error" }); }
    finally { readingRef.current = false; if (!controller.signal.aborted) setReadingAction(undefined); }
  }
  async function checkAccess(): Promise<boolean> {
    if (readingRef.current) return false;
    readingRef.current = true; setReadingAction("access");
    try {
      // Read the original actor, not the possibly unavailable selected holder.
      const error = await checkHolderAccess(pageLoginId, pageLoginId);
      if (error) { setAccess(error); return false; }
      setAccess(undefined); setFailure(undefined); setRefreshFailure(undefined); return true;
    } catch { setAccess({ code: "core_unexpected_error" }); return false; }
    finally { readingRef.current = false; setReadingAction(undefined); }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (disabled) return;
    const parsed = safeParse(createSchema, { operationId: crypto.randomUUID(), name, holderLoginId: selected?.loginId ?? "" });
    if (!parsed.success) {
      const next = { ...(!name.trim() ? { name: m.stms_accounts_name_required() } : {}), ...(!selected ? { holder: m.stms_accounts_holder_required() } : {}) };
      setErrors(next); requestAnimationFrame(() => { if (next.name) nameInput.current?.focus(); else holderLegend.current?.focus(); }); return;
    }
    setErrors({}); setFailure(undefined); await operation.send({ kind: "create", data: parsed.output });
  }
  return <StmsShell><AccountAccess failure={access} confirmed={Boolean(operation.confirmed)} busy={reading || operation.busy} onCheck={async () => { await checkAccess(); }}>
    <a href="/stms/accounts" className="inline-flex min-h-11 items-center underline underline-offset-4">{m.stms_accounts_back()}</a>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.stms_accounts_create_title()}</h1>
    <p className="text-sm text-muted-foreground">{m.stms_accounts_create_help()}</p>
    <form id="create-account-form" method="post" noValidate aria-busy={operation.busy} onSubmit={(event) => { void submit(event); }} className="space-y-5">
      {errors.name || errors.holder ? <div role="alert" tabIndex={-1} className="rounded-lg border border-destructive p-4"><p>{m.stms_accounts_errors()}</p><ul className="list-disc ps-5">
        {errors.name ? <li><a href="#account-name" className="underline">{errors.name}</a></li> : null}{errors.holder ? <li><a href="#holder-legend" className="underline">{errors.holder}</a></li> : null}</ul></div> : null}
      <Field><FieldLabel htmlFor="account-name">{m.stms_accounts_name()}</FieldLabel><Input ref={nameInput} id="account-name" name="name" required autoComplete="off" value={name} disabled={disabled}
        aria-invalid={Boolean(errors.name)} aria-describedby="account-name-help account-name-error" onChange={(event) => { setName(event.target.value); setErrors((old) => ({ ...old, name: undefined })); }} />
        <FieldDescription id="account-name-help">{m.stms_accounts_name_help()}</FieldDescription><FieldError id="account-name-error">{errors.name}</FieldError></Field>
    </form>
    <section aria-labelledby="holder-title" className="space-y-4 rounded-xl border border-border bg-card p-5 sm:p-6">
      <h2 id="holder-title" className="text-xl font-semibold">{m.stms_accounts_holder()}</h2><p className="text-sm text-muted-foreground">{m.stms_accounts_holder_help()}</p>
      {selected ? <div className="space-y-1 [overflow-wrap:anywhere]" role="status"><p>{m.stms_accounts_selected_holder()}</p><HolderIdentity login={selected} /></div> : null}
      <form method="post" className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); if (!disabled) void readHolders({ query: query.trim(), offset: 0 }); }}>
        <Field className="min-w-0 flex-1"><FieldLabel htmlFor="holder-search">{m.stms_accounts_holder_search()}</FieldLabel><Input id="holder-search" name="query" type="search" value={query} maxLength={maximumLoginSearchLength} autoComplete="off" disabled={disabled} onChange={(event) => setQuery(event.target.value)} /></Field>
        <Button type="submit" disabled={disabled}>{readingAction === "search" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}{readingAction === "search" ? m.core_loading() : m.stms_logins_search_submit()}</Button>
        {search.query ? <Button type="button" variant="outline" disabled={disabled} onClick={() => { setQuery(""); void readHolders({ query: "", offset: 0 }, "clear"); }}>{readingAction === "clear" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}{m.stms_logins_clear_search()}</Button> : null}
      </form>
      {failure || readingAction === "retry" ? <div role={failure ? "alert" : "status"}>{failure ? <AccountFailure error={failure} /> : null}<Button type="button" variant="outline" disabled={disabled} onClick={() => { void readHolders(search, "retry"); }}>{readingAction === "retry" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}{readingAction === "retry" ? m.core_loading() : m.core_retry()}</Button></div> : null}
      <fieldset disabled={disabled} aria-describedby="holder-help holder-error" className="min-w-0 space-y-3" aria-busy={reading}>
        <legend ref={holderLegend} id="holder-legend" tabIndex={-1} className="mb-3 font-medium outline-none">{m.stms_accounts_choose_holder()}</legend>
        <p id="holder-help" className="text-sm text-muted-foreground">{m.stms_accounts_eligibility_hint()}</p>
        {holders.logins.length ? holders.logins.map((login) => <label key={login.loginId} className="flex min-h-11 items-start gap-3 rounded-lg border border-border p-3 [overflow-wrap:anywhere]">
          <input type="radio" name="holderLoginId" form="create-account-form" value={login.loginId} checked={selected?.loginId === login.loginId} disabled={disabled || login.status !== "active"} className="mt-1 size-4 shrink-0"
            onChange={() => { setSelected(login); setErrors((old) => ({ ...old, holder: undefined })); }} />
          <span className="min-w-0 flex-1"><HolderIdentity login={login} /><span className="block text-sm text-muted-foreground">{getStatusLabel(login.status)}</span></span>
        </label>) : <p role="status">{search.query ? m.stms_accounts_holder_no_matches() : m.stms_accounts_holder_empty()}</p>}
        <FieldError id="holder-error">{errors.holder}</FieldError>
      </fieldset>
      <nav aria-label={m.stms_accounts_holder_pages()} className="flex flex-wrap items-center gap-3">
        {search.offset ? <Button type="button" variant="outline" disabled={disabled} onClick={() => { void readHolders({ ...search, offset: Math.max(0, search.offset - defaultLoginPageSize) }, "previous"); }}>{readingAction === "previous" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}{m.stms_logins_previous()}</Button> : null}
        <span className="text-sm">{m.stms_logins_page({ page: new Intl.NumberFormat(getLocale()).format(Math.floor(search.offset / defaultLoginPageSize) + 1) })}</span>
        {holders.nextOffset !== null ? <Button type="button" variant="outline" disabled={disabled} onClick={() => { if (holders.nextOffset !== null) void readHolders({ ...search, offset: holders.nextOffset }, "next"); }}>{readingAction === "next" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}{m.stms_logins_next()}</Button> : null}
      </nav>
    </section>
    <Button form="create-account-form" type="submit" disabled={disabled}>{operation.pendingAction === "save" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}{operation.pendingAction === "save" ? m.stms_logins_saving() : m.stms_accounts_create_submit()}</Button>
    <AccountOutcome operation={operation} />
    {refreshFailure ? <div role="alert"><AccountFailure error={refreshFailure} /></div> : null}
  </AccountAccess></StmsShell>;
}
function HolderIdentity({ login }: { login: LoginSummary }): React.JSX.Element {
  return <span className="block"><bdi className="block">{login.name || m.stms_logins_not_set()}</bdi><bdi className="block">{login.email}</bdi>
    <span className="block text-sm"><bdi>{login.username ?? m.stms_logins_not_set()}</bdi></span><span className="block break-all text-sm"><bdi>{login.loginId}</bdi></span></span>;
}
