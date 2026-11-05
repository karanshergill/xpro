import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { getLocale, getTextDirection } from "#paraglide/runtime.js";
import appCss from "#styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "xpro" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <html lang={getLocale()} dir={getTextDirection()}>
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}
