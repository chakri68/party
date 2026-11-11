import { describe, expect, it, vi } from "vitest";
import type { Result } from "../src/api.ts";
import { finishUpgrade } from "../src/upgrade-return.ts";

const ORIGIN = "https://couchpartygames.com";

function deps(opts: { key?: string | null; result?: Result } = {}) {
  const calls: Array<{ code: string; key: string }> = [];
  const urls: string[] = [];
  return {
    calls,
    urls,
    hostKeyFor: () => (opts.key === undefined ? "k" : opts.key),
    upgradeRoom: async (code: string, key: string) => (calls.push({ code, key }), opts.result ?? { ok: true as const }),
    replaceUrl: (p: string) => void urls.push(p),
  };
}

describe("back from sign-in with ?upgrade=1", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});

  it("does nothing without ?upgrade=1", async () => {
    const d = deps();
    expect(await finishUpgrade(new URL(`${ORIGIN}/room/ABCD`), d)).toBeNull();
    expect(d.calls).toEqual([]);
    expect(d.urls).toEqual([]);
  });

  it("lifts the room and cleans the URL", async () => {
    const d = deps();
    expect(await finishUpgrade(new URL(`${ORIGIN}/room/ABCD?upgrade=1`), d)).toBeNull();
    expect(d.calls).toEqual([{ code: "ABCD", key: "k" }]);
    expect(d.urls).toEqual(["/room/ABCD"]);
  });

  it("returns the code when the server says no (no Host Pass yet)", async () => {
    const d = deps({ result: { ok: false, error: "This needs Host Pass." } });
    expect(await finishUpgrade(new URL(`${ORIGIN}/room/ABCD?upgrade=1`), d)).toBe("ABCD");
    expect(d.urls).toEqual(["/room/ABCD"]);
  });

  it("returns the code without calling the server when this browser has no host key", async () => {
    const d = deps({ key: null });
    expect(await finishUpgrade(new URL(`${ORIGIN}/room/ABCD?upgrade=1`), d)).toBe("ABCD");
    expect(d.calls).toEqual([]);
  });
});
