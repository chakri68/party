import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoom } from "../src/api.ts";

function stub() {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  vi.stubGlobal("fetch", async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    return new Response(JSON.stringify({ code: "ABCD", hostKey: "hk" }));
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("createRoom", () => {
  it("posts to the plain path with no setup", async () => {
    const calls = stub();
    expect(await createRoom(null)).toEqual({ code: "ABCD", hostKey: "hk" });
    expect(calls[0].url).toBe("/api/rooms");
  });

  it("posts to the path it is given, and keeps the token header", async () => {
    const calls = stub();
    await createRoom("tok", "/api/rooms?game=cheat&computers=3");
    expect(calls[0].url).toBe("/api/rooms?game=cheat&computers=3");
    expect(calls[0].headers["x-turnstile-token"]).toBe("tok");
  });
});
