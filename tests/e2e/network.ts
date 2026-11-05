import { FetchInterceptor } from "@mswjs/interceptors/fetch/web";

type Service = { fetch(request: Request): Promise<Response> };
let logoutDeliveries = 0;
export function readBrowserLogoutCount(): number { return logoutDeliveries; }

// The runner imports this only inside its guarded copy. Full MSW network
// coordination needs BroadcastChannel, which the standalone Worker lacks.
export function enableBrowserNetwork(services: { hub: Service; router: Service; hubOrigin: string; customerOrigin: string }): void {
  const interceptor = new FetchInterceptor();
  interceptor.on("request", async ({ request, controller }) => {
    // Bridge transport to actual local Workers; no issuer, signature or receiver is replaced.
    if (request.url === services.hubOrigin + "/api/auth/jwks" && request.method === "GET") {
      controller.respondWith(await services.hub.fetch(new Request(request, { redirect: "manual" }))); return;
    }
    if (request.url === services.customerOrigin + "/auth/back-channel-sign-out" && request.method === "POST") {
      const response = await services.router.fetch(new Request(request, { redirect: "manual" }));
      if (response.ok) logoutDeliveries++;
      controller.respondWith(response); return;
    }
    if (request.url !== "https://challenges.cloudflare.com/turnstile/v0/siteverify" || request.method !== "POST") {
      controller.errorWith(new Error("Unexpected outside request in isolated browser checks."));
      return;
    }
    const input: unknown = await request.json();
    if (!input || typeof input !== "object" || !("response" in input) || typeof input.response !== "string") {
      controller.errorWith(new Error("Invalid external verification request."));
      return;
    }
    const success = input.response === "XXXX.DUMMY.TOKEN.XXXX";
    controller.respondWith(Response.json({ success, hostname: "hub.localhost", action: "sign-in",
      "error-codes": success ? [] : ["invalid-input-response"] }));
  });
  interceptor.apply();
}
