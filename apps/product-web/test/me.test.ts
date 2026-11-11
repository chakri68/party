import { afterEach, describe, expect, it, vi } from "vitest";
import { meOrNull, spendLink } from "../src/api.ts";

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

describe("spendLink", () => {
  it("returns next on 200", async () => {
    vi.stubGlobal("fetch", async (_p: string, init: RequestInit) => {
      expect(JSON.parse(init.body as string)).toEqual({ token: "t" });
      return new Response(JSON.stringify({ next: "/room/ABCD?upgrade=1" }));
    });
    expect(await spendLink("t")).toEqual({ next: "/room/ABCD?upgrade=1" });
  });
  it("returns the server's message on 400", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "That link did not work. Ask for a new one." }), { status: 400 }));
    expect(await spendLink("t")).toEqual({ error: "That link did not work. Ask for a new one." });
  });
  it("returns a plain message when the network fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    expect(await spendLink("t")).toEqual({ error: "Something went wrong. Please try again." });
  });
});
