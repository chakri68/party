import { describe, expect, it } from "vitest";
import { handleConfig } from "../src/config.ts";
import type { ProductEnv } from "../src/env.ts";

const env = (over: Record<string, string>) => ({ TURNSTILE_SITE_KEY: "site", GOOGLE_CLIENT_ID: "gid", ...over }) as unknown as ProductEnv;
const get = (e: ProductEnv, path = "/api/config", method = "GET", headers: Record<string, string> = {}) =>
  handleConfig(new Request(`https://x.test${path}`, { method, headers }), e);

describe("GET /api/config", () => {
  it("returns the site key and google flag", async () => {
    const r = (await get(env({})))!;
    expect(await r.json()).toEqual({ turnstileSiteKey: "site", googleEnabled: true, country: null, billing: null });
  });
  it("passes the visitor's country from CF-IPCountry", async () => {
    const r = (await get(env({}), "/api/config", "GET", { "CF-IPCountry": "IN" }))!;
    expect(((await r.json()) as { country: string | null }).country).toBe("IN");
  });
  it("google is off for the placeholder or an empty id", async () => {
    for (const id of ["<set at setup>", ""]) {
      const r = (await get(env({ GOOGLE_CLIENT_ID: id })))!;
      expect(((await r.json()) as { googleEnabled: boolean }).googleEnabled).toBe(false);
    }
  });
  it("billing is null when BILLING is 0", async () => {
    const r = (await get(env({ BILLING: "0" }), "/api/config", "GET", { "CF-IPCountry": "IN" }))!;
    expect(((await r.json()) as { billing: unknown }).billing).toBeNull();
  });
  it("billing picks the provider by country and carries public ids", async () => {
    const e = env({
      BILLING: "1",
      RAZORPAY_KEY_ID: "rzp_k",
      PADDLE_ENV: "sandbox",
      PADDLE_CLIENT_TOKEN: "tok",
      PADDLE_PRICE_MONTH: "pri_m",
      PADDLE_PRICE_YEAR: "pri_y",
    });
    const body = async (c: string) => ((await (await get(e, "/api/config", "GET", { "CF-IPCountry": c }))!.json()) as { billing: { provider: string } }).billing;
    expect((await body("IN")).provider).toBe("razorpay");
    expect(await body("US")).toEqual({
      provider: "paddle",
      razorpayKeyId: "rzp_k",
      paddle: { env: "sandbox", token: "tok", prices: { month: "pri_m", year: "pri_y" } },
    });
  });
  it("billing is null when BILLING is 1 but the provider's values are placeholders or missing", async () => {
    const ph = "<set at setup>";
    const e = env({ BILLING: "1", RAZORPAY_KEY_ID: ph, PADDLE_ENV: "sandbox", PADDLE_CLIENT_TOKEN: ph, PADDLE_PRICE_MONTH: ph, PADDLE_PRICE_YEAR: ph });
    for (const c of ["IN", "US"]) {
      const r = (await get(e, "/api/config", "GET", { "CF-IPCountry": c }))!;
      expect(((await r.json()) as { billing: unknown }).billing).toBeNull();
    }
    // Only the applicable provider matters: Paddle ready, Razorpay not.
    const half = env({ BILLING: "1", PADDLE_CLIENT_TOKEN: "t", PADDLE_PRICE_MONTH: "m", PADDLE_PRICE_YEAR: "y" });
    const us = (await get(half, "/api/config", "GET", { "CF-IPCountry": "US" }))!;
    expect(((await us.json()) as { billing: unknown }).billing).not.toBeNull();
    const inn = (await get(half, "/api/config", "GET", { "CF-IPCountry": "IN" }))!;
    expect(((await inn.json()) as { billing: unknown }).billing).toBeNull();
  });
  it("ignores other routes and methods", async () => {
    expect(await get(env({}), "/api/other")).toBeNull();
    expect(await get(env({}), "/api/config", "POST")).toBeNull();
  });
});
