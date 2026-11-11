import { afterEach, describe, expect, it, vi } from "vitest";
import { meOrNull } from "../src/api.ts";

afterEach(() => vi.unstubAllGlobals());

describe("meOrNull", () => {
  it("returns the account on 200", async () => {
    const body = { email: "a@x.com", tier: "free" };
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body)));
    expect(await meOrNull()).toEqual(body);
  });
  it("returns null on a server error", async () => {
    vi.stubGlobal("fetch", async () => new Response("oops", { status: 500 }));
    expect(await meOrNull()).toBeNull();
  });
  it("returns null when the network fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    expect(await meOrNull()).toBeNull();
  });
});
