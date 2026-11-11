import { describe, expect, it } from "vitest";
import { handleConfig } from "../src/config.ts";
import type { ProductEnv } from "../src/env.ts";

const env = (over: Record<string, string>) => ({ TURNSTILE_SITE_KEY: "site", GOOGLE_CLIENT_ID: "gid", ...over }) as unknown as ProductEnv;
const get = (e: ProductEnv, path = "/api/config", method = "GET", headers: Record<string, string> = {}) =>
  handleConfig(new Request(`https://x.test${path}`, { method, headers }), e);

describe("GET /api/config", () => {
  it("returns the site key and google flag", async () => {
    const r = (await get(env({})))!;
    expect(await r.json()).toEqual({ turnstileSiteKey: "site", googleEnabled: true, country: null });
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
  it("ignores other routes and methods", async () => {
    expect(await get(env({}), "/api/other")).toBeNull();
    expect(await get(env({}), "/api/config", "POST")).toBeNull();
  });
});
