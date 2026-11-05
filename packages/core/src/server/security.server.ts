// Keep native provider policies: additional CSP policies are enforced together.
export function secureResponse(response: Response): Response {
  const secured = new Response(response.body, response);
  secured.headers.set("x-content-type-options", "nosniff");
  secured.headers.set("x-frame-options", "DENY");
  secured.headers.set("referrer-policy", "no-referrer");
  secured.headers.append("content-security-policy", "frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
  return secured;
}
