import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getWorkspacePage } from "../../apps/web/src/functions/workspace-page.functions";

// A mounted draft fixture, not an authentication or data substitute. The runner
// exposes it only in its guarded disposable copy; production has no fixture route.
export function WorkspaceDraftHarness(): React.JSX.Element {
  const [isReady, setIsReady] = useState(false), [note, setNote] = useState(""), [amount, setAmount] = useState("");
  const [category, setCategory] = useState("draft"), [isConfirmed, setIsConfirmed] = useState(false);
  const [status, setStatus] = useState("Ready");
  useEffect(() => { setIsReady(true); }, []);
  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus("Checking");
    try {
      const response = await getWorkspacePage({ data: {} });
      setStatus(response?.ok ? "Checked" : "Refused");
    } catch { setStatus("Connection failed"); }
  }
  return <main className="mx-auto max-w-xl space-y-6 px-4 py-8">
    <h1 tabIndex={-1}>Unsaved draft fixture</h1>
    <form method="post" onSubmit={handleSubmit} className="space-y-4">
      <fieldset disabled={!isReady} className="grid gap-4">
        <label>Notes<textarea name="notes" value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <label>Amount<input name="amount" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>Category<select name="category" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="draft">Draft</option><option value="review">Review</option>
        </select></label>
        <label><input name="confirmed" type="checkbox" checked={isConfirmed} onChange={(event) => setIsConfirmed(event.target.checked)} />Confirmed</label>
        <button type="submit">Check access</button>
      </fieldset>
    </form>
    <p role="status">{status}</p>
    <Link to="/session-return" preload={false}>Another workspace page</Link>
    <div style={{ height: "120vh" }} aria-hidden="true" />
    <a href="#draft-end">Draft end</a><p id="draft-end">End of draft</p>
  </main>;
}
