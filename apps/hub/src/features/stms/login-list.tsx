import { useEffect, useRef } from "react";
import { useHydrated } from "@tanstack/react-router";
import { formatDateTime } from "@xpro/core";
import { defaultLoginPageSize, maximumLoginSearchLength, type LoginPage } from "@xpro/stms";
import { Button, buttonVariants } from "@xpro/ui/button";
import { Input } from "#components/ui/input";
import { Field, FieldLabel } from "#components/ui/field";
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell, TableCaption } from "#components/ui/table";
import { m } from "#paraglide/messages.js";
import { getLocale } from "#paraglide/runtime.js";
import { getDetailHref, getListHref, getPreviousOffset, getStatusLabel, type LoginSearch } from "./management";
import { StmsShell } from "./management-ui";

export function LoginList({ page, search }: { page: LoginPage; search: LoginSearch }): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null), locale = getLocale(), isHydrated = useHydrated(); useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <StmsShell><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.stms_logins_title()}</h1>
    <p className="mt-3 text-sm text-muted-foreground">{m.stms_logins_intro()}</p>
    <form method="post" className="my-6 flex flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault(); if (!isHydrated) return;
      // Router search is JSON-aware; its serializer preserves literal text such as {"name": 1}.
      location.assign(getListHref({ query: String(new FormData(event.currentTarget).get("query") ?? "").trim(), offset: 0 }));
    }}>
      <Field className="min-w-0 flex-1"><FieldLabel htmlFor="login-search">{m.stms_logins_search()}</FieldLabel>
        <Input id="login-search" name="query" type="search" defaultValue={search.query} maxLength={maximumLoginSearchLength} autoComplete="off" disabled={!isHydrated} /></Field>
      <Button type="submit" disabled={!isHydrated}>{m.stms_logins_search_submit()}</Button>
      {search.query ? <a className={buttonVariants({ variant: "outline" })} href="/stms/logins">{m.stms_logins_clear_search()}</a> : null}
    </form>
    {page.logins.length ? <div className="max-w-full overflow-x-auto rounded-xl border border-border focus-visible:outline-2 focus-visible:outline-ring" role="region" tabIndex={0} aria-label={m.stms_logins_table_region()}>
      <Table><TableCaption>{m.stms_logins_table_caption()}</TableCaption><TableHeader><TableRow>
        <TableHead scope="col">{m.stms_logins_username()}</TableHead><TableHead scope="col">{m.stms_logins_name()}</TableHead>
        <TableHead scope="col">{m.stms_logins_email()}</TableHead><TableHead scope="col">{m.stms_logins_phone()}</TableHead>
        <TableHead scope="col" aria-sort="descending">{m.stms_logins_created()} <span aria-hidden="true">↓</span></TableHead><TableHead scope="col">{m.stms_logins_status()}</TableHead>
      </TableRow></TableHeader><TableBody>{page.logins.map((login) => <TableRow key={login.loginId}>
        <TableCell><a href={getDetailHref(login.loginId, search)} className="inline-flex min-h-6 items-center underline underline-offset-4"><bdi>{login.username ?? m.stms_logins_not_set()}</bdi>
          <span className="sr-only">{" " + m.stms_logins_open({ name: login.name || login.email })}</span></a></TableCell>
        <TableCell className="max-w-60 whitespace-normal [overflow-wrap:anywhere]"><bdi>{login.name || m.stms_logins_not_set()}</bdi></TableCell>
        <TableCell><bdi>{login.email}</bdi></TableCell><TableCell><bdi>{login.phone ?? m.stms_logins_not_set()}</bdi></TableCell>
        <TableCell><time dateTime={login.createdAt}>{formatDateTime(login.createdAt, { locale, timeZone: "UTC" })}</time></TableCell>
        <TableCell>{getStatusLabel(login.status)}</TableCell></TableRow>)}</TableBody></Table>
    </div> : <p role="status" className="rounded-xl border border-border p-6">{search.query ? m.stms_logins_no_matches() : m.stms_logins_empty()}</p>}
    <nav aria-label={m.stms_logins_pagination()} className="mt-5 flex flex-wrap items-center gap-4">
      {search.offset > 0 ? <a className={buttonVariants({ variant: "outline" })} href={getListHref({ ...search, offset: getPreviousOffset(search.offset) })}>{m.stms_logins_previous()}</a> : null}
      <span className="text-sm">{m.stms_logins_page({ page: new Intl.NumberFormat(locale).format(Math.floor(search.offset / defaultLoginPageSize) + 1) })}</span>
      {page.nextOffset !== null ? <a className={buttonVariants({ variant: "outline" })} href={getListHref({ ...search, offset: page.nextOffset })}>{m.stms_logins_next()}</a> : null}
    </nav></StmsShell>;
}
