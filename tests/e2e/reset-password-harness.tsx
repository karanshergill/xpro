import { useState, type ComponentType } from "react";
import { email, object, optional, parse, pipe, string, uuid, type InferOutput } from "valibot";

const id = pipe(string(), uuid()), address = pipe(string(), email());
const searchSchema = object({ loginId: id, email: address, pageLoginId: id,
  nextLoginId: optional(id), nextEmail: optional(address), nextPageLoginId: optional(id) });
type Search = InferOutput<typeof searchSchema>;

export function readResetHarnessSearch(value: unknown): Search { return parse(searchSchema, value); }

// Only the guarded browser copy exposes this prop fixture. IDs/emails come from
// native seeded records; the real reset handler still authenticates every write.
export function ResetPasswordHarness({ initial, control: Control }: { initial: Search;
  control: ComponentType<{ login: { loginId: string; email: string }; pageLoginId: string }> }): React.JSX.Element {
  const [login, setLogin] = useState({ loginId: initial.loginId, email: initial.email });
  const [pageLoginId, setPageLoginId] = useState(initial.pageLoginId);
  return <main className="mx-auto w-full max-w-xl space-y-6 px-4 py-8">
    <h1 className="text-xl font-semibold">Password reset control fixture</h1>
    {initial.nextLoginId && initial.nextEmail ? <button type="button" onClick={() => {
      if (initial.nextLoginId && initial.nextEmail) setLogin({ loginId: initial.nextLoginId, email: initial.nextEmail });
    }}>Change displayed login</button> : null}
    {initial.nextPageLoginId ? <button type="button" onClick={() => {
      if (initial.nextPageLoginId) setPageLoginId(initial.nextPageLoginId);
    }}>Change page login</button> : null}
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-8"><Control login={login} pageLoginId={pageLoginId} /></div>
  </main>;
}
