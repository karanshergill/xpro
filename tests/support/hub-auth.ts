export type HubSignIn = {
  handle: (request: Request) => Promise<Response>;
  origin: string;
  email: string;
  password: string;
};

export async function signInAtHub(input: HubSignIn): Promise<string> {
  const response = await input.handle(new Request(new URL("/api/auth/sign-in/email", input.origin), {
    method: "POST",
    headers: { origin: input.origin, "content-type": "application/json" },
    body: JSON.stringify({ email: input.email, password: input.password }),
  }));
  if (!response.ok) throw new Error(`Hub fixture sign-in was refused (${response.status}).`);
  const cookies = response.headers.getSetCookie();
  if (cookies.length === 0) throw new Error("Hub fixture sign-in returned no cookies.");
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}
