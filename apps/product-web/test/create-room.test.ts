import { describe, expect, it } from "vitest";
import { roomCreator } from "../src/create-room.ts";
import type { RoomSetup } from "@games/web/shell";
import type { Me } from "../src/api.ts";

const FREE: Me = { email: null, tier: "free" };
const PASS: Me = { email: "a@x.com", tier: "pass" };

function deps(opts: { load: Me; fresh?: Me; create?: (token: string | null) => { code: string; hostKey: string } | { error: string } }) {
  const calls = { me: 0, token: 0, create: [] as Array<string | null>, setups: [] as unknown[], saved: [] as string[] };
  const d = {
    me: async () => (calls.me++, opts.fresh ?? opts.load),
    token: async () => (calls.token++, "tok"),
    create: async (token: string | null, setup?: RoomSetup) => (calls.create.push(token), calls.setups.push(setup), opts.create?.(token) ?? { code: "ABCD", hostKey: "hk" }),
    save: (code: string) => void calls.saved.push(code),
  };
  return { d, calls };
}

describe("roomCreator", () => {
  it("the first room uses the account check from page load, not another one", async () => {
    const { d, calls } = deps({ load: FREE });
    const create = roomCreator(Promise.resolve(FREE), d);
    expect(await create()).toEqual({ code: "ABCD" });
    expect(calls.me).toBe(0);
    expect(calls.create).toEqual(["tok"]);
    expect(calls.saved).toEqual(["ABCD"]);
  });

  it("a pass holder skips Turnstile", async () => {
    const { d, calls } = deps({ load: PASS });
    await roomCreator(Promise.resolve(PASS), d)();
    expect(calls.token).toBe(0);
    expect(calls.create).toEqual([null]);
  });

  it("later rooms check the account again: it can change while the page is open", async () => {
    const { d, calls } = deps({ load: FREE, fresh: PASS });
    const create = roomCreator(Promise.resolve(FREE), d);
    await create();
    await create();
    expect(calls.me).toBe(1);
    expect(calls.create).toEqual(["tok", null]);
  });

  it("a pass that ran out since page load: asks again, then retries with Turnstile once", async () => {
    const { d, calls } = deps({ load: PASS, fresh: FREE, create: (t) => (t ? { code: "WXYZ", hostKey: "hk" } : { error: "Please try again." }) });
    expect(await roomCreator(Promise.resolve(PASS), d)()).toEqual({ code: "WXYZ" });
    expect(calls.create).toEqual([null, "tok"]);
  });

  it("a real error with a token is shown, not retried", async () => {
    const { d, calls } = deps({ load: FREE, create: () => ({ error: "Too many rooms right now. Please try again later." }) });
    expect(await roomCreator(Promise.resolve(FREE), d)()).toEqual({ error: "Too many rooms right now. Please try again later." });
    expect(calls.create).toHaveLength(1);
  });

  it("a failed human check gives the plain message", async () => {
    const { d } = deps({ load: FREE });
    d.token = async () => {
      throw new Error("timeout");
    };
    expect(await roomCreator(Promise.resolve(FREE), d)()).toEqual({ error: "Could not check you are human. Please try again." });
  });

  it("passes the setup to the server, and on the Turnstile retry too", async () => {
    const setup = { gameId: "cheat", computers: 3 };
    const { d, calls } = deps({ load: PASS, fresh: FREE, create: (t) => (t ? { code: "WXYZ", hostKey: "hk" } : { error: "Please try again." }) });
    expect(await roomCreator(Promise.resolve(PASS), d)(setup)).toEqual({ code: "WXYZ" });
    expect(calls.setups).toEqual([setup, setup]);
  });

  it("makes a plain room when there is no setup", async () => {
    const { d, calls } = deps({ load: FREE });
    await roomCreator(Promise.resolve(FREE), d)();
    expect(calls.setups).toEqual([undefined]);
  });
});
