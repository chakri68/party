import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type THAction } from "../shared/types.ts";
import { treasureHuntGame as th, type THState } from "../server/game.ts";

const ctx = (now = 1000): GameContext => ({ now, randomInt: seededRandomInt(7), hostId: "p0" });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const okState = (r: ReturnType<typeof th.handleAction>): THState => {
  if (!r.ok) throw new Error(r.error.code);
  return r.transition.state;
};
const act = (s: THState, id: string, a: THAction) => th.handleAction(s, id, a, ctx(11_000));
const code = (r: ReturnType<typeof th.handleAction>) => (r.ok ? null : r.error.code);

/** p0 and p1 on one team, p2 on another. Everyone ready, started. */
function started(): THState {
  let s = th.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
  const t = s.players[0]!.teamId!;
  s = okState(th.handleAction(s, "p1", { type: "team.join", teamId: t }, ctx(1500)));
  for (const p of s.players) s = okState(th.handleAction(s, p.id, { type: "ready" }, ctx(2000)));
  return okState(th.handleAction(s, "p0", { type: "start" }, ctx(2000)));
}
const hunting = () => th.onTimer!(started(), "countdown", ctx(10_000)).state;
const mine = (s: THState, id: string) => th.getPrivateState(s, id).pins;

describe("pins", () => {
  it("parses pin and unpin", () => {
    expect(th.parseAction({ type: "pin", x: 1, z: 2 })).toEqual({ type: "pin", x: 1, z: 2 });
    expect(th.parseAction({ type: "pin", x: "1", z: 2 })).toBeNull();
    expect(th.parseAction({ type: "unpin", pinId: "q0" })).toEqual({ type: "unpin", pinId: "q0" });
    expect(th.parseAction({ type: "unpin", pinId: "123456789" })).toBeNull();
    expect(th.parseAction({ type: "unpin" })).toBeNull();
  });

  it("pin shows to teammates, not to the other team", () => {
    let s = okState(act(hunting(), "p0", { type: "pin", x: 10.04, z: -20.26 }));
    expect(mine(s, "p0")).toEqual([{ id: "q0", by: "p0", x: 10, z: -20.3 }]);
    expect(mine(s, "p1")).toEqual(mine(s, "p0"));
    expect(mine(s, "p2")).toEqual([]);
    s = okState(act(s, "p2", { type: "pin", x: 1, z: 1 }));
    expect(mine(s, "p2")).toEqual([{ id: "q1", by: "p2", x: 1, z: 1 }]);
    expect(mine(s, "p0").map((p) => p.id)).toEqual(["q0"]);
  });

  it("works in countdown, not in teams", () => {
    expect(code(act(started(), "p0", { type: "pin", x: 1, z: 1 }))).toBeNull();
    let s = th.createGame(players(2), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(code(act(s, "p0", { type: "pin", x: 1, z: 1 }))).toBe("not-hunting");
  });

  it("sixth pin drops the oldest", () => {
    let s = hunting();
    for (let i = 0; i < 5; i++) s = okState(act(s, "p0", { type: "pin", x: i, z: 0 }));
    s = okState(act(s, "p1", { type: "pin", x: 99, z: 0 }));
    s = okState(act(s, "p0", { type: "pin", x: 5, z: 0 }));
    expect(mine(s, "p0").filter((p) => p.by === "p0").map((p) => p.id)).toEqual(["q1", "q2", "q3", "q4", "q6"]);
    expect(mine(s, "p0").filter((p) => p.by === "p1")).toHaveLength(1);
  });

  it("only the owner unpins", () => {
    let s = okState(act(hunting(), "p0", { type: "pin", x: 1, z: 1 }));
    expect(code(act(s, "p1", { type: "unpin", pinId: "q0" }))).toBe("not-your-pin");
    expect(code(act(s, "p2", { type: "unpin", pinId: "q0" }))).toBe("not-your-pin");
    expect(code(act(s, "p0", { type: "unpin", pinId: "q9" }))).toBe("no-pin");
    s = okState(act(s, "p0", { type: "unpin", pinId: "q0" }));
    expect(mine(s, "p0")).toEqual([]);
  });

  it("out of bounds is refused", () => {
    const s = hunting();
    expect(code(act(s, "p0", { type: "pin", x: 951, z: 0 }))).toBe("bad-pin");
    expect(code(act(s, "p0", { type: "pin", x: 0, z: -951 }))).toBe("bad-pin");
    expect(code(act(s, "p0", { type: "pin", x: NaN, z: 0 }))).toBe("bad-pin");
    expect(code(act(s, "p0", { type: "pin", x: 950, z: -950 }))).toBeNull();
  });

  it("a removed player's pins go, in countdown and in hunting", () => {
    for (const base of [started(), hunting()]) {
      let s = okState(act(base, "p0", { type: "pin", x: 1, z: 1 }));
      s = okState(act(s, "p1", { type: "pin", x: 2, z: 2 }));
      s = th.onPlayerRemoved!(s, "p0", ctx(11_000)).state;
      expect(mine(s, "p1").map((p) => p.by)).toEqual(["p1"]);
      expect(s.pins.some((p) => p.by === "p0")).toBe(false);
    }
  });

  it("spectators can't pin", () => {
    const s = hunting();
    s.players[2]!.spectator = true;
    expect(code(act(s, "p2", { type: "pin", x: 1, z: 1 }))).toBe("not-in-game");
  });
});
