import { useState } from "react";
import { Button } from "@xpro/ui/button";
import { Input } from "#components/ui/input";
import { m } from "#paraglide/messages.js";

export function PrivateCodes({ codes, disabled = false, continueLabel = m.core_continue(), onContinue }: { codes: string[]; disabled?: boolean; continueLabel?: string; onContinue(): Promise<void> }): React.JSX.Element {
  const [notice, setNotice] = useState("");
  return <div className="space-y-5">
    <p className="text-sm leading-6">{m.accounts_mfa_backups_help()}</p>
    <label className="sr-only" htmlFor="mfa-backup-codes">{m.accounts_mfa_backups_title()}</label>
    <textarea data-mfa-private id="mfa-backup-codes" readOnly value={codes.join("\n")} rows={codes.length} spellCheck={false} autoComplete="off"
      className="w-full rounded-lg border border-input bg-background p-3 font-mono text-sm" dir="ltr" />
    <div className="flex flex-wrap gap-3">
      <Button type="button" variant="outline" disabled={disabled} onClick={async () => {
        try { await navigator.clipboard.writeText(codes.join("\n")); setNotice(m.accounts_mfa_copied()); }
        catch { setNotice(m.accounts_mfa_copy_failed()); }
      }}>{m.accounts_mfa_copy_codes()}</Button>
      <Button type="button" variant="outline" disabled={disabled} onClick={() => {
        let url: string | undefined;
        try {
          url = URL.createObjectURL(new Blob([codes.join("\n") + "\n"], { type: "text/plain;charset=utf-8" }));
          const link = document.createElement("a"); link.href = url; link.download = "xpro-backup-codes.txt"; link.click();
          setNotice(m.accounts_mfa_download_started());
        } catch { setNotice(m.accounts_mfa_download_failed()); }
        finally { if (url) URL.revokeObjectURL(url); }
      }}>{m.accounts_mfa_download_codes()}</Button>
      <Button type="button" disabled={disabled} onClick={onContinue}>{continueLabel}</Button>
    </div>
    <p role="status" className="text-sm">{notice}</p>
  </div>;
}

export function SetupKey({ setupKey }: { setupKey: string }): React.JSX.Element {
  const [notice, setNotice] = useState("");
  return <div className="space-y-2">
    <label htmlFor="mfa-setup-key" className="text-sm font-medium">{m.accounts_mfa_key()}</label>
    <Input data-mfa-private id="mfa-setup-key" readOnly value={setupKey} autoComplete="off" spellCheck={false} className="font-mono" dir="ltr" />
    <Button type="button" variant="outline" onClick={async () => {
      try { await navigator.clipboard.writeText(setupKey); setNotice(m.accounts_mfa_copied()); }
      catch { setNotice(m.accounts_mfa_copy_failed()); }
    }}>{m.accounts_mfa_copy_key()}</Button>
    <p role="status" className="text-sm">{notice}</p>
  </div>;
}
