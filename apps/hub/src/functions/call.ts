import type { CustomFetch } from "@tanstack/react-start";

export async function callHubFunction(run: (fetch: CustomFetch) => Promise<Response>): Promise<Response> {
  let refusal: Response | undefined;
  const fetch: CustomFetch = async (url, options) => {
    const response = await globalThis.fetch(url, { ...options, cache: "no-store" });
    // Pre-Start refusals are plain JSON; retain their real HTTP failure first.
    if (!response.ok) refusal = response.clone();
    return response;
  };
  try { const response = await run(fetch); return refusal ?? response; }
  catch (error) { if (refusal) return refusal; throw error; }
}
