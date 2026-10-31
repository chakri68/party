import { describe, expect, it } from "vitest";
import { parseAction } from "../server/parse.ts";
import { pinView } from "../server/race.ts";
import { guessLine } from "../server/scoring.ts";
import { COUNTDOWN_MS, MAX_PINS, PIN_GAP_MS, type BlindRallyState, type PinRecord } from "../shared/types.ts";
import { act, ctx, driveTo, east, finishRun, game, racing, refused, snapAt, SPAWN, TRACK } from "./helpers.ts";

// Spec §4.4: the Navigator's own "I think we're here" pins. p0 drives for p1.

const GO = COUNTDOWN_MS;
const pin = (x: number, z: number) => ({ type: "map.guess" as const, x, z });
const clear = { type: "map.guess" as const, clear: true as const };
const run = (s: BlindRallyState, team = 1) => s.teams.find((t) => t.id === team)!.run!;
const one = () => racing([["p0", "p1"]]);
const navRun = (s: BlindRallyState, id = "p1") => {
  const p = game.getPrivateState(s, id);
  if (p.role !== "navigator") throw new Error("not a navigator");
  return p.run;
};
const [SX, , SZ] = SPAWN;

describe("map.guess: who, when, where", () => {
  it("parses world x/z or a clear, nothing else", () => {
    expect(parseAction({ type: "map.guess", x: 12.345, z: -3 })).toEqual({ type: "map.guess", x: 12.3, z: -3 });
    expect(parseAction({ type: "map.guess", clear: true })).toEqual({ type: "map.guess", clear: true });
    for (const bad of [{}, { x: 1 }, { x: "1", z: 2 }, { x: NaN, z: 0 }, { x: 1e6, z: 0 }, { x: 1, z: Infinity }, { clear: "yes" }]) {
      expect(parseAction({ type: "map.guess", ...bad })).toBeNull();
    }
  });

  it("is the Navigator's: not the Driver's, not a spare's", () => {
    const s = racing([["p0", "p1"]], 3);
    refused(s, "p0", pin(SX, SZ), "not-navigator", ctx(GO));
    refused(s, "p2", pin(SX, SZ), "not-navigator", ctx(GO));
    expect(run(act(s, "p1", pin(SX, SZ), ctx(GO))).pins).toHaveLength(1);
  });

  it("only while racing: not in teams, not in the countdown, not after the end or the finish", () => {
    let s = game.createGame([{ id: "p0" }, { id: "p1" }], game.defaultSettings, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    s = act(s, "p0", { type: "team.join", teamId: 1, role: "driver" });
    s = act(s, "p1", { type: "team.join", teamId: 1, role: "navigator" });
    refused(s, "p1", pin(SX, SZ), "wrong-phase");
    refused(one(), "p1", pin(SX, SZ), "wrong-phase", ctx(GO - 1));
    refused(one(), "p1", pin(SX, SZ), "wrong-phase", ctx(one().endsAt!));
    const done = finishRun(one(), "p1", GO);
    refused(done.state, "p1", pin(SX, SZ), "wrong-phase", ctx(done.now + 10));
  });

  it("inside the track's bounds", () => {
    const b = TRACK.bounds;
    refused(one(), "p1", pin(b.x - 1, b.z + 1), "off-map", ctx(GO));
    refused(one(), "p1", pin(b.x + 1, b.z + b.depth + 1), "off-map", ctx(GO));
    expect(run(act(one(), "p1", pin(b.x, b.z), ctx(GO))).pins).toHaveLength(1);
    // A clear has nowhere to be.
    expect(run(act(one(), "p1", clear, ctx(GO))).pins).toEqual([[0]]);
  });

  it("one per half second, clears included", () => {
    const s = act(one(), "p1", pin(SX, SZ), ctx(GO));
    refused(s, "p1", pin(SX + 1, SZ), "too-soon", ctx(GO + PIN_GAP_MS - 1));
    refused(s, "p1", clear, "too-soon", ctx(GO + 100));
    expect(run(act(s, "p1", pin(SX + 1, SZ), ctx(GO + PIN_GAP_MS))).pins).toHaveLength(2);
  });
});

describe("pin storage", () => {
  it("keeps the time, the guess, where the server had the car, and the checkpoint count", () => {
    const { state, now } = driveTo(one(), "p1", east(100), GO);
    const s = act(state, "p1", pin(SX + 90, SZ + 4), ctx(now + 500));
    const [rec] = run(s).pins!;
    expect(rec).toEqual([now + 500 - GO, SX + 90, SZ + 4, SX + 100, SZ, 0]);
  });

  it("no fresh snapshot: the guess is kept, the truth isn't invented", () => {
    const s = game.onStream!(one(), "p1", snapAt(), ctx(GO))!.state;
    const later = act(s, "p1", pin(SX, SZ), ctx(GO + 5_000));
    expect(run(later).pins![0]).toEqual([5_000, SX, SZ, null, null, 0]);
    expect(run(act(one(), "p1", pin(SX, SZ), ctx(GO))).pins![0]![3]).toBeNull();
  });

  it(`caps at ${MAX_PINS}, dropping the oldest`, () => {
    let s = one();
    for (let i = 0; i < MAX_PINS + 5; i++) s = act(s, "p1", pin(SX + (i % 50), SZ), ctx(GO + i * PIN_GAP_MS));
    const pins = run(s).pins!;
    expect(pins).toHaveLength(MAX_PINS);
    expect(pins[0]![0]).toBe(5 * PIN_GAP_MS);
    expect(JSON.stringify(pins).length).toBeLessThan(MAX_PINS * 40);
  });

  it("an old room's run without pins still takes one", () => {
    const s = one();
    delete run(s).pins;
    expect(run(act(s, "p1", pin(SX, SZ), ctx(GO))).pins).toHaveLength(1);
    expect(navRun(s).pins).toEqual({ pin: null, trail: [] });
  });
});

describe("a reloaded Navigator gets its own pins back", () => {
  it("the current pin and the three before it, through initSession's private run", () => {
    let s = one();
    for (let i = 0; i < 6; i++) s = act(s, "p1", pin(SX + i, SZ), ctx(GO + i * 1_000));
    expect(navRun(s).pins).toEqual({ pin: [SX + 5, SZ], trail: [[SX + 2, SZ], [SX + 3, SZ], [SX + 4, SZ]] });
    // Cleared: no pin; the trail stays.
    s = act(s, "p1", clear, ctx(GO + 7_000));
    expect(navRun(s).pins).toEqual({ pin: null, trail: [[SX + 2, SZ], [SX + 3, SZ], [SX + 4, SZ]] });
    // And the cleared one never joins it.
    s = act(s, "p1", pin(SX + 9, SZ), ctx(GO + 8_000));
    expect(navRun(s).pins).toEqual({ pin: [SX + 9, SZ], trail: [[SX + 2, SZ], [SX + 3, SZ], [SX + 4, SZ]] });
  });

  it("pinView replays the same rules as the map", () => {
    const recs: PinRecord[] = [[0, 1, 1, null, null, 0], [1], [2, 2, 2, null, null, 0], [3, 3, 3, null, null, 0]];
    expect(pinView(recs)).toEqual({ pin: [3, 3], trail: [[2, 2]] });
    expect(pinView()).toEqual({ pin: null, trail: [] });
  });

  it("only to that Navigator: the other team's Navigator gets their own (none)", () => {
    let s = racing([["p0", "p1"], ["p2", "p3"]]);
    s = act(s, "p1", pin(SX, SZ), ctx(GO));
    expect(navRun(s, "p3").pins).toEqual({ pin: null, trail: [] });
  });
});

describe("results: closest guess", () => {
  it("one line, on the Navigator's row, from the nearest checked pin", () => {
    let { state: s, now } = driveTo(one(), "p1", east(100), GO);
    s = act(s, "p1", pin(SX + 70, SZ), ctx(now)); // 30 m off
    s = act(s, "p1", pin(SX + 112, SZ + 5), ctx(now + 600)); // 13 m off
    ({ state: s, now } = finishRun(s, "p1", now + 600));
    const r = game.getResult(s)!;
    const nav = r.standings.find((x) => x.playerId === "p1")!.label!;
    const drv = r.standings.find((x) => x.playerId === "p0")!.label!;
    expect(nav).toBe(`${drv}\nClosest guess: 13\u00a0m off before CP1`);
    expect(drv).not.toContain("guess");
  });

  it("names the checkpoint count at the time, and says nothing without a checkable pin", () => {
    const t = one().teams[0]!;
    expect(guessLine(t)).toBeNull();
    t.run!.pins = [[0, 5, 5, null, null, 0], [1]];
    expect(guessLine(t)).toBeNull();
    t.run!.pins = [[0, 5, 5, 5.3, 5, 3]];
    expect(guessLine(t)).toBe("Closest guess: exact after CP3");
  });

  it("a DNF Navigator gets the line too", () => {
    let { state: s, now } = driveTo(one(), "p1", east(50), GO);
    s = act(s, "p1", pin(SX + 50, SZ + 20), ctx(now));
    s = game.onTimer!(s, "time-up", ctx(s.endsAt!)).state;
    expect(game.getResult(s)!.standings.find((x) => x.playerId === "p1")!.label).toMatch(/\nClosest guess: 20\u00a0m off before CP1$/);
  });
});
