import { describe, expect, it } from "vitest";
import { handleAuth, userFromRequest, type AuthDeps } from "../src/auth.ts";
import { createCode } from "../src/comps.ts";
import { grant } from "../src/entitlements.ts";
import type { ProductEnv } from "../src/env.ts";
import { fakeD1 } from "./d1.ts";

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const ORIGIN = "https://couchpartygames.com";

function setup(opts: { limit?: (key: string) => boolean; turnstile?: boolean; googleClaims?: Record<string, unknown> } = {}) {
  const db = fakeD1();
  const clock = { t: T0 };
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  const limitKeys: string[] = [];
  const env = {
    DB: db,
    APP_ORIGIN: ORIGIN,
    GOOGLE_CLIENT_ID: "gid",
    GOOGLE_CLIENT_SECRET: "gsecret",
    EMAIL_LIMIT: { limit: async ({ key }: { key: string }) => (limitKeys.push(key), { success: opts.limit ? opts.limit(key) : true }) },
  } as unknown as ProductEnv;
  const claims = { aud: "gid", email: "g@x.com", email_verified: true, ...opts.googleClaims };
  const idToken = `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.s`;
  const deps: AuthDeps = {
    now: () => clock.t,
    sendEmail: async (to, subject, html) => void sent.push({ to, subject, html }),
    fetch: (async () => new Response(JSON.stringify({ id_token: idToken }))) as typeof fetch,
    verifyTurnstile: async () => opts.turnstile ?? true,
  };
  const call = (method: string, path: string, init: { body?: unknown; cookie?: string } = {}) =>
    handleAuth(
      new Request(ORIGIN + path, {
        method,
        headers: { ...(init.cookie ? { cookie: init.cookie } : {}), "cf-connecting-ip": "1.2.3.4" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
      env,
      deps,
    ) as Promise<Response>;
  const requestLink = async (email: string, next?: string) => {
    const r = await call("POST", "/api/auth/email", { body: { email, next, turnstileToken: "t" } });
    const link = /href="([^"]+)"/.exec(sent.at(-1)?.html ?? "")?.[1];
    return { r, path: link ? link.replace(ORIGIN, "") : "" };
  };
  const cookieOf = (r: Response) => /cp_session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1];
  const tokenOf = (path: string) => new URL(ORIGIN + path).searchParams.get("token")!;
  /** What the account page does with ?token=: POST it. */
  const spend = (token: string) => call("POST", "/api/auth/verify", { body: { token } });
  const signIn = async (email: string) => {
    const { path } = await requestLink(email);
    const r = await spend(tokenOf(path));
    return `cp_session=${cookieOf(r)}`;
  };
  return { db, clock, sent, env, deps, call, requestLink, cookieOf, tokenOf, spend, signIn, limitKeys };
}

const count = async (db: ReturnType<typeof fakeD1>, table: string) =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

describe("magic link", () => {
  it("round trip: email, verify sets cookie, /api/me returns the email", async () => {
    const s = setup();
    const { r, path } = await s.requestLink("a@x.com");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(s.sent[0]!.subject).toBe("Your CouchParty sign-in link");
    expect(path).toMatch(/^\/api\/auth\/verify\?token=[\w-]{24}$/);
    expect(s.sent[0]!.html).toContain("This link works for 15 minutes. If you did not ask for it, ignore this email.");

    const v = await s.spend(s.tokenOf(path));
    expect(v.status).toBe(200);
    expect(await v.json()).toEqual({ next: "/account" });
    const setCookie = v.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^cp_session=[\w-]+; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=2592000$/);

    const me = await (await s.call("GET", "/api/me", { cookie: `cp_session=${s.cookieOf(v)}` })).json();
    expect(me).toEqual({ email: "a@x.com", tier: "free", plan: null, purchases: [] });
  });

  it("stores only hashes of the login and session tokens", async () => {
    const s = setup();
    const { path } = await s.requestLink("a@x.com");
    const token = s.tokenOf(path);
    const v = await s.spend(token);
    const dump = JSON.stringify([
      (await s.db.prepare("SELECT * FROM login_tokens").all()).results,
      (await s.db.prepare("SELECT * FROM sessions").all()).results,
    ]);
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(s.cookieOf(v)!);
  });

  it("opening the link spends nothing: it sends the token on to /account", async () => {
    const s = setup();
    const { path } = await s.requestLink("a@x.com", "/room/ABCD?upgrade=1");
    const token = s.tokenOf(path);
    // A mail scanner opening it twice, then the person.
    for (let i = 0; i < 3; i++) {
      const r = await s.call("GET", path);
      expect(r.status).toBe(302);
      expect(r.headers.get("set-cookie")).toBeNull();
      const loc = new URL(ORIGIN + r.headers.get("location"));
      expect(loc.pathname).toBe("/account");
      expect(Object.fromEntries(loc.searchParams)).toEqual({ token, next: "/room/ABCD?upgrade=1" });
    }
    expect(await count(s.db, "sessions")).toBe(0);
    expect((await s.db.prepare("SELECT used_at FROM login_tokens").first<{ used_at: number | null }>())!.used_at).toBeNull();
    expect(await (await s.spend(token)).json()).toEqual({ next: "/room/ABCD?upgrade=1" });
  });

  it("opening a used, expired, unknown or missing link goes to error=link", async () => {
    const s = setup();
    const { path } = await s.requestLink("a@x.com");
    await s.spend(s.tokenOf(path));
    expect((await s.call("GET", path)).headers.get("location")).toBe("/account?error=link");
    const { path: late } = await s.requestLink("a@x.com");
    s.clock.t += 16 * MIN;
    expect((await s.call("GET", late)).headers.get("location")).toBe("/account?error=link");
    expect((await s.call("GET", "/api/auth/verify?token=nope")).headers.get("location")).toBe("/account?error=link");
    expect((await s.call("GET", "/api/auth/verify")).headers.get("location")).toBe("/account?error=link");
  });

  it("a reused token is 400 with the link message and makes no second session", async () => {
    const s = setup();
    const { path } = await s.requestLink("a@x.com");
    await s.spend(s.tokenOf(path));
    const again = await s.spend(s.tokenOf(path));
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "That link did not work. Ask for a new one." });
    expect(again.headers.get("set-cookie")).toBeNull();
    expect(await count(s.db, "sessions")).toBe(1);
  });

  it("an expired token (16 min) is 400", async () => {
    const s = setup();
    const { path } = await s.requestLink("a@x.com");
    s.clock.t += 16 * MIN;
    expect((await s.spend(s.tokenOf(path))).status).toBe(400);
    expect(await count(s.db, "sessions")).toBe(0);
  });

  it("14 minutes is still fine; unknown, missing and junk tokens are 400", async () => {
    const s = setup();
    const { path } = await s.requestLink("a@x.com");
    s.clock.t += 14 * MIN;
    expect((await s.spend(s.tokenOf(path))).headers.get("set-cookie")).not.toBeNull();
    expect((await s.spend("nope")).status).toBe(400);
    expect((await s.call("POST", "/api/auth/verify", { body: {} })).status).toBe(400);
    expect((await s.call("POST", "/api/auth/verify", { body: { token: 5 } })).status).toBe(400);
  });

  it("case and spaces make one account", async () => {
    const s = setup();
    await s.signIn("  Foo@X.com ");
    await s.signIn("foo@x.com");
    expect(await count(s.db, "users")).toBe(1);
    expect(s.sent[0]!.to).toBe("foo@x.com");
  });

  it("next must be a same-site path", async () => {
    const s = setup();
    const nextOf = async (r: Response) => ((await r.json()) as { next: string }).next;
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "evil", "/a b", "/caf\u00e9", "/x\u0007"]) {
      const { path } = await s.requestLink("a@x.com", bad);
      expect(await nextOf(await s.spend(s.tokenOf(path)))).toBe("/account");
    }
    const { path } = await s.requestLink("a@x.com", "/play?x=1");
    expect(await nextOf(await s.spend(s.tokenOf(path)))).toBe("/play?x=1");
  });

  it("unknown and known emails both get { ok: true }", async () => {
    const s = setup();
    await s.signIn("known@x.com");
    for (const e of ["known@x.com", "new@x.com"]) {
      const r = await s.call("POST", "/api/auth/email", { body: { email: e, turnstileToken: "t" } });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true });
    }
  });

  it("rejects malformed email, failed Turnstile and rate limit without sending", async () => {
    const bad = await setup().call("POST", "/api/auth/email", { body: { email: "nope", turnstileToken: "t" } });
    expect(bad.status).toBe(400);

    const t = setup({ turnstile: false });
    expect((await t.call("POST", "/api/auth/email", { body: { email: "a@x.com", turnstileToken: "t" } })).status).toBe(400);
    expect(t.sent).toHaveLength(0);
    expect(await count(t.db, "login_tokens")).toBe(0);

    const l = setup({ limit: () => false });
    expect((await l.call("POST", "/api/auth/email", { body: { email: "a@x.com", turnstileToken: "t" } })).status).toBe(429);
    expect(l.sent).toHaveLength(0);
    expect(l.limitKeys).toEqual(["email:1.2.3.4"]);
  });
});

describe("google", () => {
  const start = async (s: ReturnType<typeof setup>, next?: string) => {
    const r = await s.call("GET", `/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`);
    const loc = new URL(r.headers.get("location")!);
    const cookie = /cp_oauth=([^;]+)/.exec(r.headers.get("set-cookie")!)![1]!;
    return { r, loc, cookie: `cp_oauth=${cookie}`, state: loc.searchParams.get("state")! };
  };

  it("redirects to Google with state and an HttpOnly oauth cookie", async () => {
    const s = setup();
    const { r, loc, cookie, state } = await start(s);
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(loc.searchParams)).toEqual({
      client_id: "gid",
      redirect_uri: `${ORIGIN}/api/auth/google/callback`,
      response_type: "code",
      scope: "openid email",
      state,
    });
    expect(cookie).toContain(state);
    expect(r.headers.get("set-cookie")).toContain("HttpOnly");
    expect(r.headers.get("set-cookie")).toContain("Max-Age=600");
  });

  /** Back to /account with error=google, and the oauth cookie cleared. */
  const expectFailed = (r: Response) => {
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/account?error=google");
    expect(r.headers.getSetCookie()).toEqual(["cp_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/google; Max-Age=0"]);
  };

  it("mismatched or missing state fails back to /account", async () => {
    const s = setup();
    const { cookie } = await start(s);
    expectFailed(await s.call("GET", "/api/auth/google/callback?code=c&state=wrong", { cookie }));
    expectFailed(await s.call("GET", "/api/auth/google/callback?code=c&state=x"));
    expect(await count(s.db, "sessions")).toBe(0);
  });

  it("Cancel on Google's page (error, no code) goes back to /account with no error", async () => {
    const s = setup();
    const { cookie, state } = await start(s);
    const r = await s.call("GET", `/api/auth/google/callback?error=access_denied&state=${state}`, { cookie });
    expect(r.headers.get("location")).toBe("/account");
    expect(r.headers.getSetCookie()).toEqual(["cp_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/google; Max-Age=0"]);
    expect(await count(s.db, "sessions")).toBe(0);
  });

  it("Cancel or a failure keeps next, so the next try still goes back to the room", async () => {
    const s = setup();
    const { cookie, state } = await start(s, "/room/ABCD?upgrade=1");
    const cancel = await s.call("GET", `/api/auth/google/callback?error=access_denied&state=${state}`, { cookie });
    expect(cancel.headers.get("location")).toBe(`/account?next=${encodeURIComponent("/room/ABCD?upgrade=1")}`);
    const fail = await s.call("GET", "/api/auth/google/callback?code=c&state=wrong", { cookie });
    expect(fail.headers.get("location")).toBe(`/account?error=google&next=${encodeURIComponent("/room/ABCD?upgrade=1")}`);
  });

  it("an evil next in the oauth cookie is dropped on failure too", async () => {
    const s = setup();
    const { state } = await start(s);
    const cookie = `cp_oauth=${state}|${encodeURIComponent("//evil.com")}`;
    expectFailed(await s.call("GET", `/api/auth/google/callback?code=c&state=wrong`, { cookie }));
  });

  it("a failed or unreachable token endpoint fails back to /account", async () => {
    const s = setup();
    const { cookie, state } = await start(s);
    s.deps.fetch = (async () => new Response("no", { status: 500 })) as typeof fetch;
    expectFailed(await s.call("GET", `/api/auth/google/callback?code=c&state=${state}`, { cookie }));
    s.deps.fetch = (async () => {
      throw new TypeError("network");
    }) as typeof fetch;
    expectFailed(await s.call("GET", `/api/auth/google/callback?code=c&state=${state}`, { cookie }));
  });

  it("email_verified false fails back to /account", async () => {
    const s = setup({ googleClaims: { email_verified: false } });
    const { cookie, state } = await start(s);
    expectFailed(await s.call("GET", `/api/auth/google/callback?code=c&state=${state}`, { cookie }));
    expect(await count(s.db, "users")).toBe(0);
  });

  it("wrong audience fails back to /account", async () => {
    const s = setup({ googleClaims: { aud: "other" } });
    const { cookie, state } = await start(s);
    expectFailed(await s.call("GET", `/api/auth/google/callback?code=c&state=${state}`, { cookie }));
  });

  it("happy path: session, next honoured, oauth cookie cleared", async () => {
    const s = setup({ googleClaims: { email: " G@X.com" } });
    const { cookie, state } = await start(s, "/play");
    const r = await s.call("GET", `/api/auth/google/callback?code=c&state=${state}`, { cookie });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/play");
    expect(r.headers.getSetCookie().some((c) => c.startsWith("cp_oauth=;") && c.includes("Max-Age=0"))).toBe(true);
    const me = await (await s.call("GET", "/api/me", { cookie: `cp_session=${s.cookieOf(r)}` })).json();
    expect(me).toMatchObject({ email: "g@x.com", tier: "free" });
  });

  it("evil next in the oauth cookie falls back to /account", async () => {
    const s = setup();
    const { state } = await start(s);
    const cookie = `cp_oauth=${state}|${encodeURIComponent("//evil.com")}`;
    const r = await s.call("GET", `/api/auth/google/callback?code=c&state=${state}`, { cookie });
    expect(r.headers.get("location")).toBe("/account");
  });
});

describe("session", () => {
  it("/api/me signed out", async () => {
    const s = setup();
    expect(await (await s.call("GET", "/api/me")).json()).toEqual({ email: null, tier: "free" });
  });

  it("expires after 30 days", async () => {
    const s = setup();
    const cookie = await s.signIn("a@x.com");
    const req = new Request(ORIGIN, { headers: { cookie } });
    expect(await userFromRequest(s.db, req, s.clock.t + 29 * 86_400_000)).toMatchObject({ email: "a@x.com" });
    expect(await userFromRequest(s.db, req, s.clock.t + 31 * 86_400_000)).toBeNull();
  });

  it("/api/me lists purchases", async () => {
    const s = setup();
    const cookie = await s.signIn("a@x.com");
    const u = (await s.db.prepare("SELECT id FROM users").first<{ id: string }>())!;
    await s.db
      .prepare("INSERT INTO purchases (id, user_id, provider, ref, plan, amount, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("p1", u.id, "razorpay", "pay_1", "month", 9900, "INR", "paid", T0)
      .run();
    const me = (await (await s.call("GET", "/api/me", { cookie })).json()) as { purchases: unknown };
    expect(me.purchases).toEqual([{ plan: "month", amount: 9900, currency: "INR", status: "paid", createdAt: T0 }]);
  });

  it("/api/me shows pass tier and plan", async () => {
    const s = setup();
    const cookie = await s.signIn("a@x.com");
    const u = (await s.db.prepare("SELECT id FROM users").first<{ id: string }>())!;
    await grant(s.db, u.id, { source: "grant", plan: "x", days: null, ref: null }, T0);
    expect(await (await s.call("GET", "/api/me", { cookie })).json()).toEqual({
      email: "a@x.com",
      tier: "pass",
      plan: { source: "grant", startsAt: T0, endsAt: null },
      purchases: [],
    });
  });

  it("logout deletes the session and clears the cookie", async () => {
    const s = setup();
    const cookie = await s.signIn("a@x.com");
    const r = await s.call("POST", "/api/auth/logout", { cookie });
    expect(r.headers.get("set-cookie")).toMatch(/^cp_session=; .*Max-Age=0/);
    expect(await count(s.db, "sessions")).toBe(0);
    expect(await (await s.call("GET", "/api/me", { cookie })).json()).toEqual({ email: null, tier: "free" });
  });

  it("DELETE /api/account removes user, sessions and entitlements", async () => {
    const s = setup();
    const cookie = await s.signIn("a@x.com");
    const u = (await s.db.prepare("SELECT id FROM users").first<{ id: string }>())!;
    await grant(s.db, u.id, { source: "grant", plan: "x", days: null, ref: null }, T0);
    const r = await s.call("DELETE", "/api/account", { cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    for (const t of ["users", "sessions", "entitlements"]) expect(await count(s.db, t)).toBe(0);
  });

  it("DELETE /api/account also deletes that email's sign-in links, and only those", async () => {
    const s = setup();
    const cookie = await s.signIn("a@x.com");
    await s.requestLink("  A@X.com "); // a second, unused link for the same account
    await s.requestLink("b@x.com");
    expect(await count(s.db, "login_tokens")).toBe(3);
    expect((await s.call("DELETE", "/api/account", { cookie })).status).toBe(200);
    const left = await s.db.prepare("SELECT email FROM login_tokens").all<{ email: string }>();
    expect(left.results.map((r) => r.email)).toEqual(["b@x.com"]);
  });

  it("DELETE /api/account signed out is 401", async () => {
    expect((await setup().call("DELETE", "/api/account")).status).toBe(401);
  });

  it("non-auth routes return null", async () => {
    const s = setup();
    expect(await s.call("GET", "/api/rooms")).toBeNull();
  });
});

describe("redeem", () => {
  it("signed out is 401", async () => {
    const r = await setup().call("POST", "/api/account/redeem", { body: { code: "X" } });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Sign in first." });
  });

  it("success gives pass", async () => {
    const s = setup();
    const cookie = await s.signIn("a@x.com");
    const code = await createCode(s.db, { maxUses: 1, days: null }, T0);
    const r = await s.call("POST", "/api/account/redeem", { cookie, body: { code } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, endsAt: null });
    expect(((await (await s.call("GET", "/api/me", { cookie })).json()) as { tier: string }).tier).toBe("pass");
    expect(s.limitKeys.at(-1)).toMatch(/^redeem:/);
  });

  it("each failure reason maps to its message", async () => {
    const s = setup();
    const cookie = await s.signIn("a@x.com");
    const other = await s.signIn("b@x.com");
    const post = async (c: string, code: string) => {
      const r = await s.call("POST", "/api/account/redeem", { cookie: c, body: { code } });
      return [r.status, ((await r.json()) as { error: string }).error] as const;
    };
    expect(await post(cookie, "NOPE-AAAA-BBBB")).toEqual([400, "That code does not work."]);

    const one = await createCode(s.db, { maxUses: 1, days: null }, T0);
    await post(cookie, one);
    expect(await post(cookie, one)).toEqual([400, "You have already used this code."]);
    expect(await post(other, one)).toEqual([400, "That code has been used up."]);

    const dead = await createCode(s.db, { maxUses: 1, days: null }, T0);
    await s.db.prepare("UPDATE comp_codes SET revoked_at = 1 WHERE code = ?").bind(dead).run();
    expect(await post(other, dead)).toEqual([400, "That code is no longer active."]);
  });

  it("is rate limited per user", async () => {
    const s = setup({ limit: (k) => !k.startsWith("redeem:") });
    const cookie = await s.signIn("a@x.com");
    const r = await s.call("POST", "/api/account/redeem", { cookie, body: { code: "X" } });
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "Too many tries. Wait a minute." });
  });
});
