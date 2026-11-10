import { useEffect, useRef } from "react";
import { Button } from "@xpro/ui/button";
import { defaultAccountPageSize, defaultLoginPageSize } from "@xpro/stms";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "#components/ui/table";
import { m } from "#paraglide/messages.js";
import { StmsShell } from "#features/stms/management-ui";
import type { ManagementFailure } from "#features/stms/management";
import { AccountFailure } from "./account-form";

export function AccountError({ error }: { error?: ManagementFailure }): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null); useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <StmsShell><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.stms_accounts_page_error()}</h1>
    <div role="alert" className="mt-4"><AccountFailure error={error ?? { code: "core_unexpected_error" }} /></div>
    <Button type="button" className="mt-5" onClick={() => location.reload()}>{m.core_retry()}</Button></StmsShell>;
}
const accountPlaceholderRows = Array.from({ length: defaultAccountPageSize }, (_, index) => index);
const holderPlaceholderRows = Array.from({ length: defaultLoginPageSize }, (_, index) => index);
const detailPlaceholderLabels = [m.stms_accounts_name, m.stms_accounts_id, m.stms_accounts_status, m.stms_accounts_revision,
  m.stms_accounts_holder, m.stms_accounts_holder_id, m.stms_logins_email, m.stms_logins_username,
  m.stms_accounts_created, m.stms_accounts_updated, m.stms_accounts_workspace, m.stms_accounts_workspace_id];

export function AccountListPending(): React.JSX.Element {
  return <StmsShell><div aria-busy="true">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{m.stms_accounts_title()}</h1><LoadingShape className="h-11 w-40" /></div>
    <p className="mt-3 text-sm text-muted-foreground">{m.stms_accounts_intro()}</p>
    <div aria-hidden="true" className="my-6 flex items-end gap-3"><div className="min-w-0 flex-1 space-y-2"><p className="text-sm font-medium">{m.stms_accounts_search()}</p><LoadingShape className="h-11 w-full" /></div><LoadingShape className="h-11 w-24" /></div>
    <div aria-hidden="true" className="max-w-full overflow-hidden rounded-xl border border-border">
      <Table><TableCaption>{m.stms_accounts_table_caption()}</TableCaption><TableHeader><TableRow>
        <TableHead scope="col">{m.stms_accounts_name()}</TableHead><TableHead scope="col">{m.stms_accounts_holder()}</TableHead><TableHead scope="col">{m.stms_accounts_status()}</TableHead>
        <TableHead scope="col">{m.stms_accounts_created()} <span aria-hidden="true">↓</span></TableHead>
      </TableRow></TableHeader><TableBody>{accountPlaceholderRows.map((row) => <TableRow key={row}>
        <TableHead scope="row" className="max-w-80 whitespace-normal"><LoadingShape className="h-11 w-48" /><LoadingShape className="h-4 w-64" /></TableHead>
        <TableCell className="max-w-80 whitespace-normal"><LoadingShape className="h-5 w-32" /><LoadingShape className="h-5 w-56" /><LoadingShape className="h-4 w-28" /></TableCell>
        <TableCell><LoadingShape className="h-5 w-16" /></TableCell><TableCell><LoadingShape className="h-5 w-48" /></TableCell>
      </TableRow>)}</TableBody></Table>
    </div><LoadingShape className="mt-5 h-11 w-28" /><p role="status" className="sr-only">{m.core_loading()}</p>
  </div></StmsShell>;
}
export function AccountCreatePending(): React.JSX.Element {
  return <StmsShell><div aria-busy="true" className="space-y-6">
    <LoadingShape className="h-11 w-32" /><h1 className="text-2xl font-semibold">{m.stms_accounts_create_title()}</h1><p className="text-sm text-muted-foreground">{m.stms_accounts_create_help()}</p>
    <div aria-hidden="true" className="space-y-2"><p className="text-sm font-medium">{m.stms_accounts_name()}</p><LoadingShape className="h-11 w-full" /><p className="text-sm text-muted-foreground">{m.stms_accounts_name_help()}</p></div>
    <section aria-hidden="true" className="space-y-4 rounded-xl border border-border bg-card p-5 sm:p-6">
      <h2 className="text-xl font-semibold">{m.stms_accounts_holder()}</h2><p className="text-sm text-muted-foreground">{m.stms_accounts_holder_help()}</p>
      <div className="flex items-end gap-3"><div className="min-w-0 flex-1 space-y-2"><p className="text-sm font-medium">{m.stms_accounts_holder_search()}</p><LoadingShape className="h-11 w-full" /></div><LoadingShape className="h-11 w-24" /></div>
      <p className="font-medium">{m.stms_accounts_choose_holder()}</p><p className="text-sm text-muted-foreground">{m.stms_accounts_eligibility_hint()}</p>
      {holderPlaceholderRows.map((row) => <div key={row} className="flex gap-3 rounded-lg border border-border p-3"><LoadingShape className="mt-1 size-4" /><div className="min-w-0 flex-1"><LoadingShape className="h-6 w-40" /><LoadingShape className="h-6 w-4/5" /><LoadingShape className="h-5 w-24" /><LoadingShape className="h-5 w-2/3" /><LoadingShape className="h-5 w-16" /></div></div>)}
      <LoadingShape className="h-11 w-28" />
    </section><LoadingShape className="h-11 w-40" /><p role="status" className="sr-only">{m.core_loading()}</p>
  </div></StmsShell>;
}
export function AccountDetailPending(): React.JSX.Element {
  return <StmsShell><div aria-busy="true" className="space-y-6">
    <LoadingShape className="h-11 w-32" /><h1 className="text-2xl font-semibold">{m.stms_accounts_detail_title()}</h1>
    <dl aria-hidden="true" className="grid gap-x-8 gap-y-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2 sm:p-6">{detailPlaceholderLabels.map((label, index) => <div key={index} className="min-w-0"><dt className="text-sm text-muted-foreground">{label()}</dt><dd className="mt-1"><LoadingShape className="h-6 w-4/5" /></dd></div>)}</dl>
    <section aria-hidden="true" className="space-y-4 rounded-xl border border-border bg-card p-5 sm:p-6"><h2 className="text-xl font-semibold">{m.stms_accounts_rename_title()}</h2><p className="text-sm text-muted-foreground">{m.stms_accounts_rename_help()}</p><div className="space-y-5"><div className="space-y-2"><p className="text-sm font-medium">{m.stms_accounts_name()}</p><LoadingShape className="h-11 w-full" /><p className="text-sm text-muted-foreground">{m.stms_accounts_name_help()}</p></div><LoadingShape className="h-11 w-40" /></div></section>
    <p role="status" className="sr-only">{m.core_loading()}</p>
  </div></StmsShell>;
}
function LoadingShape({ className }: { className: string }): React.JSX.Element {
  return <div aria-hidden="true" className={"max-w-full shrink-0 rounded-md bg-muted motion-safe:animate-pulse " + className} />;
}
