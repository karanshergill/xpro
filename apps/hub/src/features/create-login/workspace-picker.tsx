import { useEffect, useRef, useState } from "react";
import { LoaderCircleIcon } from "lucide-react";
import type { WorkspaceChoice, WorkspaceChoicePage } from "@xpro/stms";
import { Button } from "@xpro/ui/button";
import { NativeSelect } from "#components/ui/native-select";
import { Field, FieldDescription, FieldLabel } from "#components/ui/field";
import { m } from "#paraglide/messages.js";
import { getLocale } from "#paraglide/runtime.js";
import { loadCreationWorkspaces } from "./creation.data";
import type { CreationFailure } from "./creation";

type Props = { creatorLoginId: string; selected: WorkspaceChoice | null; disabled: boolean;
  invalid: boolean; onChange(value: WorkspaceChoice | null): void; onFailure(value: CreationFailure): void };

export function WorkspacePicker({ creatorLoginId, selected, disabled, invalid, onChange, onFailure }: Props): React.JSX.Element {
  const [page, setPage] = useState<WorkspaceChoicePage>({ workspaces: [], nextCursor: null });
  const [history, setHistory] = useState<(string | null)[]>([null]), [isLoading, setIsLoading] = useState(true);
  const [failure, setFailure] = useState<CreationFailure>();
  const pending = useRef<AbortController | undefined>(undefined);
  const locale = getLocale();

  async function load(cursors: (string | null)[]): Promise<void> {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setIsLoading(true); setFailure(undefined);
    try {
      const result = await loadCreationWorkspaces({ creatorLoginId, cursor: cursors.at(-1) ?? null, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.status === "error") { setFailure(result.error); onFailure(result.error); return; }
      setPage(result.data); setHistory(cursors);
    } catch { if (!controller.signal.aborted) { const failure = { code: "core_unexpected_error" }; setFailure(failure); onFailure(failure); } }
    finally { if (pending.current === controller) { pending.current = undefined; setIsLoading(false); } }
  }
  useEffect(() => { void load([null]); return () => pending.current?.abort(); }, []);
  const choices = selected && !page.workspaces.some((item) => item.workspaceId === selected.workspaceId)
    ? [selected, ...page.workspaces] : page.workspaces;
  return <div className="space-y-3" aria-busy={isLoading}>
    <Field>
      <FieldLabel htmlFor="workspaceId">{m.accounts_create_login_workspace()}</FieldLabel>
      <NativeSelect id="workspaceId" name="workspaceId" value={selected?.workspaceId ?? ""} disabled={disabled || isLoading}
        required aria-invalid={invalid} aria-describedby="workspace-help workspaceId-error"
        onChange={(event) => onChange(choices.find((item) => item.workspaceId === event.target.value) ?? null)}>
        <option value="">{m.accounts_create_login_workspace_placeholder()}</option>
        {choices.map((item) => <option key={item.workspaceId} value={item.workspaceId}>{m.accounts_create_login_workspace_option({ name: item.name, origin: item.origin })}</option>)}
      </NativeSelect>
      <FieldDescription id="workspace-help">{m.accounts_create_login_workspace_help()}</FieldDescription>
    </Field>
    {failure ? <div role="alert" className="text-sm text-destructive"><p>{m.accounts_create_login_workspaces_failed()}</p>
      {failure.requestId ? <p>{m.core_request_id({ requestId: failure.requestId })}</p> : null}</div> : null}
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" disabled={disabled || isLoading || history.length < 2} onClick={async () => { await load(history.slice(0, -1)); }}>{m.accounts_create_login_previous()}</Button>
      <Button type="button" variant="outline" disabled={disabled || isLoading || page.nextCursor === null} onClick={async () => { if (page.nextCursor) await load([...history, page.nextCursor]); }}>{m.accounts_create_login_next()}</Button>
      {failure ? <Button type="button" variant="outline" disabled={disabled || isLoading} onClick={async () => { await load(history); }}>{m.core_retry()}</Button> : null}
      <span role="status" className="inline-flex items-center gap-2 text-sm">
        {isLoading ? <><LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />{m.core_loading()}</>
          : m.accounts_create_login_page({ page: new Intl.NumberFormat(locale).format(history.length) })}
      </span>
    </div>
  </div>;
}
