import { useEffect, useRef, useState } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { useHydrated } from "@tanstack/react-router";
import { formatDateTime } from "@xpro/core";
import { defaultAccountPageSize, maximumAccountSearchLength, type AccountPage } from "@xpro/stms";
import { Button, buttonVariants } from "@xpro/ui/button";
import { Field, FieldLabel } from "#components/ui/field";
import { Input } from "#components/ui/input";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "#components/ui/table";
import { m } from "#paraglide/messages.js";
import { getLocale } from "#paraglide/runtime.js";
import { StmsShell } from "#features/stms/management-ui";
import type { LoginSearch } from "#features/stms/management";
import { accountDetailHref, accountListHref } from "./accounts.data";

export function AccountList({ page, search }: { page: AccountPage; search: LoginSearch }): React.JSX.Element {
  const hydrated = useHydrated(), heading = useRef<HTMLHeadingElement>(null), locale = getLocale();
  const [isSearching, setIsSearching] = useState(false);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const resume = (): void => setIsSearching(false);
    window.addEventListener("pageshow", resume);
    return () => window.removeEventListener("pageshow", resume);
  }, []);
  return <StmsShell>
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.stms_accounts_title()}</h1>
      <a href="/stms/accounts/new" className={buttonVariants()}>{m.stms_accounts_create_title()}</a></div>
    <p className="mt-3 text-sm text-muted-foreground">{m.stms_accounts_intro()}</p>
    <form method="post" aria-busy={isSearching} className="my-6 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); if (!hydrated || isSearching) return;
      const query = String(new FormData(event.currentTarget).get("query") ?? "").trim();
      setIsSearching(true); location.assign(accountListHref({ query, offset: 0 })); }}>
      <Field className="min-w-0 flex-1"><FieldLabel htmlFor="account-search">{m.stms_accounts_search()}</FieldLabel><Input id="account-search" name="query" type="search" maxLength={maximumAccountSearchLength} defaultValue={search.query} autoComplete="off" disabled={!hydrated || isSearching} /></Field>
      <Button type="submit" disabled={!hydrated || isSearching}>{isSearching ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}{m.stms_logins_search_submit()}</Button>{search.query ? <a href="/stms/accounts" className={buttonVariants({ variant: "outline" })}>{m.stms_logins_clear_search()}</a> : null}
    </form><p role="status" className="sr-only">{isSearching ? m.core_loading() : ""}</p>
    {page.accounts.length ? <div role="region" aria-label={m.stms_accounts_table_region()} tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border border-border focus-visible:outline-2 focus-visible:outline-ring">
      <Table><TableCaption>{m.stms_accounts_table_caption()}</TableCaption><TableHeader><TableRow>
        <TableHead scope="col">{m.stms_accounts_name()}</TableHead><TableHead scope="col">{m.stms_accounts_holder()}</TableHead><TableHead scope="col">{m.stms_accounts_status()}</TableHead>
        <TableHead scope="col" aria-sort="descending">{m.stms_accounts_created()} <span aria-hidden="true">↓</span></TableHead>
      </TableRow></TableHeader><TableBody>{page.accounts.map((account) => <TableRow key={account.accountId}>
        <TableHead scope="row" className="max-w-80 whitespace-normal [overflow-wrap:anywhere]"><a href={accountDetailHref(account.accountId, search)} className="inline-flex min-h-11 items-center underline underline-offset-4"><bdi>{account.name ?? m.stms_accounts_unnamed()}</bdi><span className="sr-only">{" " + m.stms_accounts_open({ accountId: account.accountId })}</span></a>
          <bdi className="block text-xs font-normal text-muted-foreground">{account.accountId}</bdi></TableHead>
        <TableCell className="max-w-80 whitespace-normal [overflow-wrap:anywhere]"><bdi className="block">{account.holder.name || m.stms_logins_not_set()}</bdi><bdi className="block">{account.holder.email}</bdi><bdi className="block text-xs text-muted-foreground">{account.holder.username ?? m.stms_logins_not_set()}</bdi></TableCell>
        <TableCell>{account.status === "stms_active" ? m.stms_accounts_active() : m.stms_accounts_suspended()}</TableCell>
        <TableCell><time dateTime={account.createdAt}>{formatDateTime(account.createdAt, { locale, timeZone: "UTC" })}</time></TableCell>
      </TableRow>)}</TableBody></Table>
    </div> : <p role="status" className="rounded-xl border border-border p-6">{search.query ? m.stms_accounts_no_matches() : m.stms_accounts_empty()}</p>}
    <nav aria-label={m.stms_accounts_pages()} className="mt-5 flex flex-wrap items-center gap-4">
      {search.offset ? <a className={buttonVariants({ variant: "outline" })} href={accountListHref({ ...search, offset: Math.max(0, search.offset - defaultAccountPageSize) })}>{m.stms_logins_previous()}</a> : null}
      <span className="text-sm">{m.stms_logins_page({ page: new Intl.NumberFormat(locale).format(Math.floor(search.offset / defaultAccountPageSize) + 1) })}</span>
      {page.nextOffset !== null ? <a className={buttonVariants({ variant: "outline" })} href={accountListHref({ ...search, offset: page.nextOffset })}>{m.stms_logins_next()}</a> : null}
    </nav>
  </StmsShell>;
}
