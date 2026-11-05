import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SessionExpiry } from "#auth/session-expiry";
import { loadWorkspacePage } from "#auth/session.data";
import { WorkspacePageError, WorkspacePagePending } from "#auth/workspace-page";
import { m } from "#paraglide/messages.js";
import { getLocale, getTextDirection } from "#paraglide/runtime.js";
import appCss from "#styles.css?url";

export const Route = createRootRoute({
  loader: async ({ abortController }) => await loadWorkspacePage(abortController.signal),
  // Keep the initial page identity stable; actual requests still check live access.
  staleTime: Infinity,
  gcTime: Infinity,
  shouldReload: false,
  head: () => ({ meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { title: m.core_app_name() }],
    links: [{ rel: "stylesheet", href: appCss }] }),
  pendingComponent: WorkspacePagePending,
  errorComponent: () => <WorkspacePageError />,
  component: WorkspaceShell,
  shellComponent: RootDocument,
});

function WorkspaceShell(): React.JSX.Element {
  const page = Route.useLoaderData();
  return page.status === "error" ? <WorkspacePageError failure={page.error} />
    : <SessionExpiry loginId={page.loginId}><Outlet /></SessionExpiry>;
}

function RootDocument({ children }: { children: ReactNode }): React.JSX.Element {
  return <html lang={getLocale()} dir={getTextDirection()}>
    <head><HeadContent /></head>
    <body>{children}<Scripts /></body>
  </html>;
}
