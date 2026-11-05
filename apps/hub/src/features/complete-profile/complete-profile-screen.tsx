import type { ProfileField } from "@xpro/core/server";
import { useRouter } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@xpro/ui/button";
import { m } from "#paraglide/messages.js";
import { CompleteProfileForm } from "./complete-profile-form";
import { continueAfterProfile } from "./continuation";
import { getFailureMessage } from "./messages";
import type { CompletionFailure } from "./complete-profile";

export function CompletionScreen({ initialFields }: { initialFields: ProfileField[] }): React.JSX.Element {
  const [fields, setFields] = useState(initialFields);
  const [continuation, setContinuation] = useState<"working" | "failed" | "invalid">("working");
  const hasContinued = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [fields.length === 0]);
  async function handleContinue(): Promise<void> {
    setContinuation("working");
    try {
      const result = await continueAfterProfile();
      if (result !== "navigating") setContinuation(result);
    } catch { setContinuation("failed"); }
  }
  useEffect(() => {
    if (!fields.length && !hasContinued.current) {
      hasContinued.current = true;
      void handleContinue();
    }
  }, [fields]);

  return <CompletionShell>
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">{fields.length ? m.accounts_complete_profile_title() : m.accounts_complete_profile_saved()}</h1>
    {fields.length ? <>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{m.accounts_complete_profile_intro()} {m.accounts_complete_profile_required()}</p>
      <div className="mt-7"><CompleteProfileForm fields={fields} onFieldsChange={setFields} /></div>
    </> : <div className="mt-6 space-y-4">
      <p role={continuation === "working" ? "status" : "alert"} className="text-sm leading-6">
        {continuation === "working" ? m.accounts_complete_profile_continuing() : continuation === "invalid"
          ? m.accounts_complete_profile_continuation_invalid() : m.accounts_complete_profile_continuation_failed()}
      </p>
      {continuation === "invalid" ? <a className="inline-flex min-h-11 items-center underline underline-offset-4" href={"/sign-in" + window.location.search}>{m.core_sign_in()}</a>
        : <Button disabled={continuation === "working"} onClick={handleContinue}>
          {continuation === "working" ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}{m.core_continue()}
        </Button>}
    </div>}
  </CompletionShell>;
}

export function CompletionPending(): React.JSX.Element {
  return <CompletionShell>
    <h1 className="text-2xl font-semibold tracking-tight">{m.accounts_complete_profile_title()}</h1>
    <div role="status" className="mt-6 space-y-6">
      <span className="sr-only">{m.core_loading()}</span>
      {[0, 1, 2].map((row) => <div key={row} aria-hidden="true" className="space-y-2">
        <div className="h-4 w-1/3 rounded bg-muted" /><div className="h-11 rounded-lg bg-muted" />
      </div>)}
      <Button disabled>{m.core_loading()}</Button>
    </div>
  </CompletionShell>;
}

export function CompletionError({ failure }: { failure?: CompletionFailure }): React.JSX.Element {
  const router = useRouter(), [isWorking, setIsWorking] = useState(false);
  const [hasRetryFailed, setHasRetryFailed] = useState(false);
  async function handleRetry(): Promise<void> {
    setIsWorking(true);
    try { await router.invalidate(); }
    catch { setHasRetryFailed(true); }
    finally { setIsWorking(false); }
  }
  return <CompletionShell>
    <h1 className="text-2xl font-semibold tracking-tight">{m.core_error_title()}</h1>
    <p role="alert" className="mt-4 text-sm leading-6">{hasRetryFailed ? m.core_error_message() : getFailureMessage(failure)}</p>
    {failure?.requestId ? <p className="mt-3 break-all text-sm text-muted-foreground">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
    <div className="mt-6"><Button variant="outline" disabled={isWorking} onClick={handleRetry}>
      {isWorking ? <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" /> : null}{m.core_retry()}
    </Button></div>
  </CompletionShell>;
}

function CompletionShell({ children }: { children: ReactNode }): React.JSX.Element {
  return <main className="mx-auto w-full max-w-lg px-4 py-8 sm:py-14">
    <p className="mb-6 text-lg font-semibold tracking-tight">{m.core_app_name()}</p>
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">{children}</section>
  </main>;
}
