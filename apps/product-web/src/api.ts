export type Plan = { source: string; endsAt: number | null };
export type Me = { email: string | null; tier: "free" | "pass"; plan?: Plan | null };
export type Config = { turnstileSiteKey: string; googleEnabled: boolean; country: string | null };
export type Result = { ok: true } | { ok: false; error: string };

const FAIL = "Something went wrong. Please try again.";

async function post(path: string, body?: unknown, headers: Record<string, string> = {}, method = "POST"): Promise<Response> {
  return fetch(path, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function result(res: Response): Promise<Result> {
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return { ok: false, error: body?.error ?? FAIL };
}

export async function me(): Promise<Me> {
  try {
    const res = await fetch("/api/me");
    if (res.ok) return (await res.json()) as Me;
  } catch {}
  return { email: null, tier: "free" };
}

/** Like me(), but null when the call fails, so the account page can tell "signed out" from "could not load". */
export async function meOrNull(): Promise<Me | null> {
  try {
    const res = await fetch("/api/me");
    if (res.ok) return (await res.json()) as Me;
  } catch {}
  return null;
}

let config: Promise<Config> | null = null;
export function loadConfig(): Promise<Config> {
  config ??= fetch("/api/config").then((r) => r.json() as Promise<Config>);
  config.catch(() => (config = null));
  return config;
}

export async function createRoom(turnstileToken: string | null): Promise<{ code: string; hostKey: string } | { error: string }> {
  try {
    const res = await post("/api/rooms", undefined, turnstileToken ? { "x-turnstile-token": turnstileToken } : {});
    const body = (await res.json()) as { code?: string; hostKey?: string; error?: string };
    if (res.ok && body.code && body.hostKey) return { code: body.code, hostKey: body.hostKey };
    return { error: body.error ?? "Could not create a room." };
  } catch {
    return { error: FAIL };
  }
}

export async function upgradeRoom(code: string, hostKey: string): Promise<Result> {
  try {
    return await result(await post(`/api/rooms/${encodeURIComponent(code)}/upgrade`, { hostKey }));
  } catch {
    return { ok: false, error: FAIL };
  }
}

export async function redeem(code: string): Promise<Result> {
  try {
    return await result(await post("/api/account/redeem", { code }));
  } catch {
    return { ok: false, error: FAIL };
  }
}

export async function logout(): Promise<void> {
  await post("/api/auth/logout").catch(() => {});
}

export async function deleteAccount(): Promise<Result> {
  try {
    return await result(await post("/api/account", undefined, {}, "DELETE"));
  } catch {
    return { ok: false, error: FAIL };
  }
}

export async function startEmailSignIn(email: string, next: string, turnstileToken: string): Promise<Result> {
  try {
    return await result(await post("/api/auth/email", { email, next, turnstileToken }));
  } catch {
    return { ok: false, error: FAIL };
  }
}
