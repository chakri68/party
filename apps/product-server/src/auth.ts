import { listPurchases } from "./billing/purchases.ts";
import { redeem } from "./comps.ts";
import { newId, normalizeEmail, sha256Hex, type Db } from "./db.ts";
import { sendEmail as sendViaResend } from "./email.ts";
import { activePlan, tierFor } from "./entitlements.ts";
import type { ProductEnv } from "./env.ts";
import {
  clearCookie, clientIp, json, OAUTH_COOKIE, readCookie, redirect, safeNext, SESSION_COOKIE, setCookie,
} from "./http.ts";
import { verifyTurnstile } from "./turnstile.ts";

const MINUTE = 60_000;
const SESSION_MS = 30 * 86_400_000;
const LOGIN_MS = 15 * MINUTE;
const GOOGLE_PATH = "/api/auth/google";

export interface AuthDeps {
  now(): number;
  sendEmail(to: string, subject: string, html: string): Promise<void>;
  fetch: typeof fetch;
  verifyTurnstile(token: string, ip: string): Promise<boolean>;
}

export function realDeps(env: ProductEnv): AuthDeps {
  return {
    now: () => Date.now(),
    sendEmail: (to, subject, html) => sendViaResend(env, to, subject, html),
    fetch: (...a) => fetch(...a),
    verifyTurnstile: (token, ip) => verifyTurnstile(env.TURNSTILE_SECRET, token, ip),
  };
}

export async function userFromRequest(db: Db, request: Request, now: number): Promise<{ id: string; email: string } | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return db
    .prepare("SELECT u.id AS id, u.email AS email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?")
    .bind(await sha256Hex(token), now)
    .first<{ id: string; email: string }>();
}

/** Makes the user if new, opens a session, and returns its Set-Cookie value. */
async function startSession(db: Db, email: string, now: number): Promise<string> {
  await db
    .prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING")
    .bind(newId(), email, now)
    .run();
  const user = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  const token = newId();
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(token), user!.id, now + SESSION_MS)
    .run();
  return setCookie(SESSION_COOKIE, token, SESSION_MS / 1000);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINK_FAILED = "That link did not work. Ask for a new one.";

function linkEmail(link: string): string {
  return `<p>Click the button to sign in to CouchParty.</p>
<p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#111;color:#fff;text-decoration:none;border-radius:8px">Sign in</a></p>
<p>This link works for 15 minutes. If you did not ask for it, ignore this email.</p>`;
}

async function postEmail(request: Request, env: ProductEnv, deps: AuthDeps): Promise<Response> {
  const ip = clientIp(request);
  const limited = await env.EMAIL_LIMIT.limit({ key: `email:${ip}` });
  if (!limited.success) return json({ error: "Too many tries. Wait a minute." }, 429);

  const body = (await request.json().catch(() => null)) as { email?: unknown; next?: unknown; turnstileToken?: unknown } | null;
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  if (email.length > 254 || !EMAIL_RE.test(email)) return json({ error: "Enter a valid email." }, 400);
  const token = typeof body?.turnstileToken === "string" ? body.turnstileToken : "";
  if (!(await deps.verifyTurnstile(token, ip))) return json({ error: "Check failed. Try again." }, 400);

  const now = deps.now();
  const secret = newId();
  await env.DB
    .prepare("INSERT INTO login_tokens (token_hash, email, next, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(secret), email, safeNext(body?.next), now + LOGIN_MS)
    .run();
  await deps.sendEmail(email, "Your CouchParty sign-in link", linkEmail(`${env.APP_ORIGIN}/api/auth/verify?token=${secret}`));
  return json({ ok: true });
}

/**
 * The link in the email. Mail scanners open links to check them, so this
 * only looks: a good token goes on to /account, which spends it with a POST.
 */
async function getVerify(url: URL, env: ProductEnv, deps: AuthDeps): Promise<Response> {
  const bad = redirect("/account?error=link");
  const token = url.searchParams.get("token");
  if (!token) return bad;
  const row = await env.DB
    .prepare("SELECT next FROM login_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
    .bind(await sha256Hex(token), deps.now())
    .first<{ next: string | null }>();
  if (!row) return bad;
  const params = new URLSearchParams({ token, next: safeNext(row.next) });
  return redirect(`/account?${params}`);
}

/** `POST /api/auth/verify { token }`: spends the link, sets the session cookie, says where to go. */
async function postVerify(request: Request, env: ProductEnv, deps: AuthDeps): Promise<Response> {
  const bad = json({ error: LINK_FAILED }, 400);
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return bad;
  const now = deps.now();
  const hash = await sha256Hex(token);
  // The conditional update is the lock: a token can be spent once, even by two simultaneous clicks.
  const took = await env.DB
    .prepare("UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
    .bind(now, hash, now)
    .run();
  if (took.meta.changes !== 1) return bad;
  const row = await env.DB.prepare("SELECT email, next FROM login_tokens WHERE token_hash = ?").bind(hash).first<{ email: string; next: string | null }>();
  if (!row) return bad;
  const cookie = await startSession(env.DB, row.email, now);
  return new Response(JSON.stringify({ next: safeNext(row.next) }), {
    headers: { "content-type": "application/json", "set-cookie": cookie },
  });
}

function googleStart(url: URL, env: ProductEnv): Response {
  const state = newId();
  const next = safeNext(url.searchParams.get("next"));
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.APP_ORIGIN}${GOOGLE_PATH}/callback`,
    response_type: "code",
    scope: "openid email",
    state,
  });
  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, [
    setCookie(OAUTH_COOKIE, `${state}|${encodeURIComponent(next)}`, 600, GOOGLE_PATH),
  ]);
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Google sends the browser back here. Every way it can go wrong lands on
 * /account with error=google, keeping the `next` from the oauth cookie so the
 * next try still goes back where they started. Cancel on Google's page
 * (`?error=access_denied`, no code) isn't an error: the same trip, no message.
 * The oauth cookie goes either way.
 */
async function googleCallback(request: Request, url: URL, env: ProductEnv, deps: AuthDeps): Promise<Response> {
  const clearOauth = clearCookie(OAUTH_COOKIE, GOOGLE_PATH);
  const cookie = readCookie(request, OAUTH_COOKIE);
  const sep = cookie ? cookie.indexOf("|") : -1;
  let next = "/account";
  if (cookie && sep > 0) {
    try {
      next = safeNext(decodeURIComponent(cookie.slice(sep + 1)));
    } catch {}
  }
  const back = (error: string | null) => {
    const q = new URLSearchParams();
    if (error) q.set("error", error);
    if (next !== "/account") q.set("next", next);
    return redirect(q.size ? `/account?${q}` : "/account", [clearOauth]);
  };
  const failed = back("google");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") === "access_denied" && !code) return back(null);
  if (!cookie || sep < 1 || !state || !code || cookie.slice(0, sep) !== state) return failed;

  let tokens: { id_token?: string } | null;
  try {
    const res = await deps.fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
        redirect_uri: `${env.APP_ORIGIN}${GOOGLE_PATH}/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) return failed;
    tokens = (await res.json().catch(() => null)) as { id_token?: string } | null;
  } catch {
    return failed;
  }
  // Trusted without signature check: fetched directly from Google over TLS in this request.
  const claims = tokens?.id_token ? decodeJwtPayload(tokens.id_token) : null;
  if (!claims || claims.aud !== env.GOOGLE_CLIENT_ID) return failed;
  if (claims.email_verified !== true && claims.email_verified !== "true") return failed;
  if (typeof claims.email !== "string" || !claims.email) return failed;
  const session = await startSession(env.DB, normalizeEmail(claims.email), deps.now());
  return redirect(next, [session, clearOauth]);
}

const REDEEM_MESSAGES = {
  unknown: "That code does not work.",
  revoked: "That code is no longer active.",
  "used-up": "That code has been used up.",
  "already-redeemed": "You have already used this code.",
} as const;

async function postRedeem(request: Request, env: ProductEnv, deps: AuthDeps): Promise<Response> {
  const now = deps.now();
  const user = await userFromRequest(env.DB, request, now);
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!(await env.EMAIL_LIMIT.limit({ key: `redeem:${user.id}` })).success) {
    return json({ error: "Too many tries. Wait a minute." }, 429);
  }
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.slice(0, 64) : "";
  const r = await redeem(env.DB, user.id, code, now);
  return r.ok ? json({ ok: true, endsAt: r.endsAt }) : json({ error: REDEEM_MESSAGES[r.reason] }, 400);
}

/** Returns null when the request is not an auth or account route. */
export async function handleAuth(request: Request, env: ProductEnv, deps: AuthDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  switch (route) {
    case "POST /api/auth/email":
      return postEmail(request, env, deps);
    case "GET /api/auth/verify":
      return getVerify(url, env, deps);
    case "POST /api/auth/verify":
      return postVerify(request, env, deps);
    case `GET ${GOOGLE_PATH}`:
      return googleStart(url, env);
    case `GET ${GOOGLE_PATH}/callback`:
      return googleCallback(request, url, env, deps);
    case "POST /api/auth/logout": {
      const token = readCookie(request, SESSION_COOKIE);
      if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", "set-cookie": clearCookie(SESSION_COOKIE) },
      });
    }
    case "GET /api/me": {
      const now = deps.now();
      const user = await userFromRequest(env.DB, request, now);
      if (!user) return json({ email: null, tier: "free" });
      return json({
        id: user.id,
        email: user.email,
        tier: await tierFor(env.DB, user.id, now),
        plan: await activePlan(env.DB, user.id, now),
        purchases: await listPurchases(env.DB, user.id),
      });
    }
    case "DELETE /api/account": {
      const user = await userFromRequest(env.DB, request, deps.now());
      if (!user) return json({ error: "Sign in first." }, 401);
      // Sessions and entitlements cascade from users. Sign-in links are keyed by
      // email (stored normalised), so they go in the same batch.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM login_tokens WHERE email = ?").bind(normalizeEmail(user.email)),
      ]);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", "set-cookie": clearCookie(SESSION_COOKIE) },
      });
    }
    case "POST /api/account/redeem":
      return postRedeem(request, env, deps);
    default:
      return null;
  }
}
