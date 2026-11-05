import { useEffect, useRef } from "react";
import { getLocale } from "#paraglide/runtime.js";
import type { SecurityCheck } from "./sign-in";

type Turnstile = {
  render(element: HTMLElement, options: {
    sitekey: string; action: string; size: "compact"; language: string; theme: "auto" | "dark";
    "response-field": false; retry: "never"; "refresh-expired": "manual";
    callback(token: string): void; "error-callback"(): void; "expired-callback"(): void; "timeout-callback"(): void;
  }): string | undefined;
  remove(widgetId: string): void;
};
declare global { interface Window { turnstile?: Turnstile } }
const scriptURL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const scriptTimeoutMs = 15_000;

export function SecurityCheckWidget({ siteKey, onChange }: {
  siteKey: string; onChange(value: SecurityCheck): void;
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let isCurrent = true, hasFailed = false, widgetId: string | undefined;
    const existing = document.querySelector<HTMLScriptElement>('script[src="' + scriptURL + '"]');
    if (existing?.dataset.failed) existing.remove();
    const script = existing?.dataset.failed ? document.createElement("script") : existing ?? document.createElement("script");
    const timer = window.setTimeout(handleScriptFailure, scriptTimeoutMs);
    function handleFailure(): void {
      if (!isCurrent) return;
      hasFailed = true;
      window.clearTimeout(timer);
      onChange({ status: "failed", token: null });
    }
    function handleScriptFailure(): void { script.dataset.failed = "true"; handleFailure(); }
    function renderWidget(): void {
      if (!isCurrent || hasFailed || !container.current) return;
      window.clearTimeout(timer);
      const api = window.turnstile;
      if (!api) { handleScriptFailure(); return; }
      try {
        widgetId = api.render(container.current, { sitekey: siteKey, action: "sign-in", size: "compact",
          language: getLocale().split("-")[0] ?? "en",
          theme: document.documentElement.classList.contains("dark") ? "dark" : "auto",
          "response-field": false, retry: "never", "refresh-expired": "manual",
          callback(token) { if (isCurrent && !hasFailed) onChange(token ? { status: "ready", token } : { status: "failed", token: null }); },
          "error-callback": handleFailure, "expired-callback": handleFailure, "timeout-callback": handleFailure,
        });
        if (widgetId === undefined) handleFailure();
      } catch { handleFailure(); }
    }
    if (window.turnstile) renderWidget();
    else {
      script.addEventListener("load", renderWidget);
      script.addEventListener("error", handleScriptFailure);
      if (!script.isConnected) { script.src = scriptURL; script.async = true; document.head.appendChild(script); }
    }
    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
      script.removeEventListener("load", renderWidget);
      script.removeEventListener("error", handleScriptFailure);
      if (widgetId !== undefined) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, onChange]);
  return <div ref={container} className="min-h-36" />;
}
