import { describe, expect, it } from "vitest";
import { handleAdmin } from "../src/admin.ts";
import { handleAuth, type AuthDeps } from "../src/auth.ts";
import type { ProductEnv } from "../src/env.ts";
import { fakeD1 } from "./d1.ts";

const T0 = 1_800_000_000_000;
const ORIGIN = "https://couchpartygames.com";

function setup(adminKey: string | null = "k3y") {
  const db = fakeD1();
  const sent: string[] = [];
  const env = {
    DB: db,
    APP_ORIGIN: ORIGIN,
    ADMIN_KEY: adminKey ?? undefined,
    EMAIL_LIMIT: { limit: async () => ({ success: true }) },
  } as unknown as ProductEnv;
  const deps: AuthDeps = {
    now: () => T0,
    sendEmail: async (_to, { html }) => void sent.push(html),
    fetch,
    verifyTurnstile: async () => true,
  };
  const admin = (method: string, path: string, body?: unknown, auth: string | null = "Bearer k3y") =>
    handleAdmin(
      new Request(ORIGIN + path, {
        method,
        headers: auth ? { authorization: auth } : {},
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      () => T0,
    ) as Promise<Response>;
  const me = async (email: string) => {
    await handleAuth(
      new Request(ORIGIN + "/api/auth/email", { method: "POST", body: JSON.stringify({ email, turnstileToken: "t" }) }),
      env,
      deps,
    );
    const link = /href="([^"]+)"/.exec(sent.at(-1)!)![1]!.replace(ORIGIN, "");
    const token = new URL(ORIGIN + link).searchParams.get("token");
    const v = (await handleAuth(new Request(ORIGIN + "/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) }), env, deps))!;
    const cookie = `cp_session=${/cp_session=([^;]+)/.exec(v.headers.get("set-cookie")!)![1]}`;
    const r = (await handleAuth(new Request(ORIGIN + "/api/me", { headers: { cookie } }), env, deps))!;
    return (await r.json()) as { email: string; tier: string };
  };
  return { db, admin, me };
}

describe("admin auth", () => {
  it("ignores non-admin paths", async () => {
    const s = setup();
    expect(await s.admin("GET", "/api/me")).toBeNull();
  });
  it("401 without or with a wrong bearer", async () => {
    const s = setup();
    for (const auth of [null, "Bearer nope", "k3y"]) {
      const r = await s.admin("GET", "/api/admin/codes", undefined, auth);
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: "Not allowed." });
    }
  });
  it("503 when no key is set, even with a bearer", async () => {
    const s = setup(null);
    const r = await s.admin("GET", "/api/admin/codes", undefined, "Bearer ");
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "Admin is off." });
  });
  it("400 on a bad body, 404 on an unknown route", async () => {
    const s = setup();
    expect((await s.admin("POST", "/api/admin/grant", { email: "nope", days: 3 })).status).toBe(400);
    expect((await s.admin("POST", "/api/admin/grant", { email: "a@x.com", days: "3" })).status).toBe(400);
    expect((await s.admin("POST", "/api/admin/codes", { maxUses: 0, days: 3 })).status).toBe(400);
    expect((await s.admin("GET", "/api/admin/nothing")).status).toBe(404);
  });
});

describe("grants", () => {
  it("grant to an unknown email, then that email signs in as pass; revoke-grants returns it to free", async () => {
    const s = setup();
    const g = await s.admin("POST", "/api/admin/grant", { email: "  New@X.com ", days: 30 });
    expect(g.status).toBe(200);
    expect(await s.me("new@x.com")).toEqual({ id: expect.any(String), email: "new@x.com", tier: "pass", plan: expect.anything(), purchases: [] });
    const r = await s.admin("POST", "/api/admin/revoke-grants", { email: "NEW@x.com" });
    expect(r.status).toBe(200);
    expect((await s.me("new@x.com")).tier).toBe("free");
  });
  it("days null grants forever", async () => {
    const s = setup();
    await s.admin("POST", "/api/admin/grant", { email: "f@x.com", days: null });
    const row = await s.db.prepare("SELECT ends_at FROM entitlements").first<{ ends_at: number | null }>();
    expect(row!.ends_at).toBeNull();
  });
  it("a second grant adds a row", async () => {
    const s = setup();
    await s.admin("POST", "/api/admin/grant", { email: "a@x.com", days: 1 });
    await s.admin("POST", "/api/admin/grant", { email: "a@x.com", days: 2 });
    const n = await s.db.prepare("SELECT COUNT(*) AS n FROM entitlements").first<{ n: number }>();
    expect(n!.n).toBe(2);
  });
});

describe("codes", () => {
  it("create, list, revoke round trip", async () => {
    const s = setup();
    const c = await s.admin("POST", "/api/admin/codes", { maxUses: 3, days: 30, note: "family", prefix: "FAM" });
    const { code } = (await c.json()) as { code: string };
    expect(code).toMatch(/^FAM-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const list = (await (await s.admin("GET", "/api/admin/codes")).json()) as Array<{ code: string; maxUses: number; revoked: boolean }>;
    expect(list).toEqual([expect.objectContaining({ code, maxUses: 3, revoked: false })]);
    expect((await s.admin("POST", `/api/admin/codes/${code}/revoke`)).status).toBe(200);
    const after = (await (await s.admin("GET", "/api/admin/codes")).json()) as Array<{ revoked: boolean }>;
    expect(after[0]!.revoked).toBe(true);
    const nope = await s.admin("POST", "/api/admin/codes/ZZ-AAAA-BBBB/revoke");
    expect(nope.status).toBe(404);
    expect(await nope.json()).toEqual({ error: "No such code." });
  });
});
