export async function verifyTurnstile(
  secret: string | undefined,
  token: string,
  ip: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  if (!secret || !token) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (ip !== "unknown") form.set("remoteip", ip);
  const res = await fetchFn("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  if (!res.ok) return false;
  const body = (await res.json()) as { success?: boolean };
  return body.success === true;
}
