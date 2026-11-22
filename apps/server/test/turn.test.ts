import { describe, expect, it } from "vitest";
import { turnMinter } from "../src/turn.ts";

const URL = "https://rtc.live.cloudflare.com/v1/turn/keys/kid/credentials/generate-ice-servers";
const ok = (body: unknown, status = 201) => new Response(JSON.stringify(body), { status });

describe("turnMinter", () => {
  it("is undefined without both secrets", () => {
    expect(turnMinter({})).toBeUndefined();
    expect(turnMinter({ TURN_KEY_ID: "kid" })).toBeUndefined();
    expect(turnMinter({ TURN_KEY_TOKEN: "tok" })).toBeUndefined();
    expect(turnMinter({ TURN_KEY_ID: "kid", TURN_KEY_TOKEN: "tok" })).toBeTypeOf("function");
  });

  it("posts the TTL to the Cloudflare URL with the bearer token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return ok({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }] });
    }) as unknown as typeof fetch;
    const mint = turnMinter({ TURN_KEY_ID: "kid", TURN_KEY_TOKEN: "tok" }, fake)!;
    expect(await mint(14400)).toEqual([{ urls: ["stun:stun.cloudflare.com:3478"] }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(URL);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: "Bearer tok", "Content-Type": "application/json" });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ ttl: 14400 });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("drops port 53 URLs", async () => {
    const fake = (async () =>
      ok({
        iceServers: [
          { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
          {
            urls: ["turn:turn.cloudflare.com:53?transport=udp", "turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:5349?transport=tcp"],
            username: "u",
            credential: "c",
          },
          { urls: ["turn:turn.cloudflare.com:53?transport=tcp"], username: "u", credential: "c" },
        ],
      })) as unknown as typeof fetch;
    const mint = turnMinter({ TURN_KEY_ID: "kid", TURN_KEY_TOKEN: "tok" }, fake)!;
    expect(await mint(60)).toEqual([
      { urls: ["stun:stun.cloudflare.com:3478"] },
      { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:5349?transport=tcp"], username: "u", credential: "c" },
    ]);
  });

  it("gives null on a non-2xx, bad JSON, a missing list or a thrown fetch", async () => {
    const env = { TURN_KEY_ID: "kid", TURN_KEY_TOKEN: "tok" };
    const run = (f: unknown) => turnMinter(env, f as typeof fetch)!(60);
    expect(await run(async () => ok({ iceServers: [] }, 500))).toBeNull();
    expect(await run(async () => new Response("nope", { status: 201 }))).toBeNull();
    expect(await run(async () => ok({ other: 1 }))).toBeNull();
    expect(
      await run(async () => {
        throw new Error("down");
      }),
    ).toBeNull();
  });
});
