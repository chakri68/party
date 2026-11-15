import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFrames, fillNames, fitFrames, HOP_MS, MIN_MS, Playback, ROLL_MS, rollText, SPIDER, STEP_MS, voteResult, type Frame,
} from "../client/report.ts";
import { ITEM_USE, pendingLine, ROLE_POWER, roleStats, votedLine } from "../client/view.ts";
import { TILE_ORDER, coords } from "../shared/hex.ts";
import { N } from "../shared/numbers.ts";
import type { PublicExplorer, PublicTile, Step, TileId, WildsPublicState } from "../shared/types.ts";

type OpenTile = Extract<PublicTile, { open: true }>;

function pub(
  opts: {
    fog?: TileId[];
    tile?: Record<TileId, Partial<OpenTile>>;
    explorers?: (Partial<PublicExplorer> & { id: string; tile: TileId })[];
    spider?: TileId | null;
    phase?: WildsPublicState["phase"];
    lastRound?: WildsPublicState["lastRound"];
  } = {},
): WildsPublicState {
  const tiles: PublicTile[] = TILE_ORDER.map((id) => {
    if (opts.fog?.includes(id)) return { id, open: false };
    const { q, r } = coords(id);
    return { id, open: true, q, r, terrain: "grass", fire: 0, noise: 0, cache: false, nest: false, ruin: null, ...(opts.tile?.[id] ?? {}) };
  });
  return {
    phase: opts.phase ?? "plan", deadline: 0, round: 1, sun: 0, sunLimit: 10, planSeconds: 45,
    stones: [], half: [], gateOpen: false,
    order: (opts.explorers ?? []).map((e) => e.id),
    tiles,
    explorers: (opts.explorers ?? []).map((e) => ({ role: "fixer", hearts: 3, items: [], down: false, left: false, ready: false, ...e })),
    spider: opts.spider ? { tile: opts.spider, arrow: { path: [opts.spider, "0,0"], why: "hunt", bites: [] } } : null,
    event: null, pending: null, voted: null, lastRound: opts.lastRound ?? null, end: null,
  };
}

const name = (id: string) => id.toUpperCase();
const tileOf = (p: WildsPublicState, id: TileId) => p.tiles.find((t) => t.id === id)!;

describe("words for the screens", () => {
  it("fills name tokens", () => {
    expect(fillNames("{{p0}} got {{p1}} back up.", name)).toBe("P0 got P1 back up.");
  });

  it("writes a roll with its bonus and need", () => {
    const roll = (bonus: number): Extract<Step, { t: "roll" }> =>
      ({ t: "roll", who: "a", ruin: "tower", attr: "mind", dice: [4, 3], bonus, need: 9, pass: 7 + bonus >= 9, helpers: [] });
    expect(rollText(roll(2))).toBe("4 + 3 + 2 = 9. Need 9.");
    expect(rollText(roll(0))).toBe("4 + 3 = 7. Need 9.");
    expect(rollText(roll(-1))).toBe("4 + 3 − 1 = 6. Need 9.");
  });

  it("counts votes", () => {
    expect(votedLine(2, 3)).toBe("2 of 3 have voted.");
  });

  it("says when the stone hand's noise comes", () => {
    expect(pendingLine({ tile: "1,0", due: 5 }, 3)).toBe("The stone hand: noise on this bridge in 2 rounds.");
    expect(pendingLine({ tile: "1,0", due: 5 }, 4)).toBe("The stone hand: noise on this bridge in 1 round.");
    expect(pendingLine({ tile: "1,0", due: 5 }, 5)).toBe("The stone hand: noise on this bridge at the end of this round.");
  });

  it("gives each role's stats and power, with numbers from N", () => {
    expect(roleStats("runner")).toBe("Strength 0 · Mind +1 · Stealth +2");
    expect(roleStats("protector")).toBe("Strength +2 · Mind 0 · Stealth +1");
    expect(ROLE_POWER.runner).toBe(`Your Move goes up to ${N.runnerMove} tiles, not ${N.move}.`);
    expect(ROLE_POWER.guide).toContain(`Your Look reaches ${N.guideLook} tiles, not ${N.look}.`);
    expect(ITEM_USE.torch).toContain(`${N.scaredStep} tiles away`);
    expect(ITEM_USE.lure).toContain(`up to ${N.lureRange} tiles`);
  });

  it("says how a vote went", () => {
    const withVote = (id: "stone-hand" | "clear-sky", option: number, votes: number[]) =>
      pub({ lastRound: { round: 1, lines: [], votes, steps: [{ t: "event", id, option, nothing: false }] } });
    expect(voteResult(withVote("stone-hand", 0, [2, 1]))).toBe("The vote: Accept, 2 of 3.");
    expect(voteResult(withVote("stone-hand", 1, [1, 1]))).toBe("The vote: Refuse, 1 of 2. A tie means Refuse.");
    expect(voteResult(withVote("stone-hand", 1, [0, 0]))).toBe("No one voted, so: Refuse.");
    expect(voteResult(withVote("clear-sky", 0, [1, 1]))).toBe("The vote: Open the land around the gate, 1 of 2. A tie goes to the first option.");
    expect(voteResult(pub())).toBeNull();
  });
});

describe("buildFrames", () => {
  const a = { id: "a", tile: "0,0" };

  it("walks a move one tile a frame, and ends on the real board", () => {
    const start = pub({ explorers: [a] });
    const end = pub({ phase: "report", explorers: [{ ...a, tile: "2,0" }] });
    const frames = buildFrames(start, end, [{ t: "move", who: "a", path: ["0,0", "1,0", "2,0"] }], name);
    const hops = frames.filter((f) => f.slide);
    expect(hops.map((f) => f.slide)).toEqual([
      { who: "a", from: "0,0", to: "1,0" },
      { who: "a", from: "1,0", to: "2,0" },
    ]);
    expect(hops.map((f) => f.ms)).toEqual([HOP_MS, HOP_MS]);
    expect(hops[0]!.pub.explorers[0]!.tile).toBe("1,0");
    expect(hops[0]!.caption).toBe("A moves.");
    expect(frames[frames.length - 1]!.pub).toBe(end);
  });

  it("starts from the board before the beats, without the plan's arrow", () => {
    const start = pub({ spider: "3,0" });
    const frames = buildFrames(start, pub({ phase: "report", spider: "3,0" }), [], name);
    expect(frames[0]!.pub.spider).toEqual({ tile: "3,0", arrow: null });
    expect(frames[0]!.pub.phase).toBe("report");
  });

  it("opens only tiles that are open at the end, and never shows terrain under fog", () => {
    const start = pub({ fog: ["1,0", "2,0"] });
    const end = pub({ phase: "report", fog: ["2,0"], tile: { "1,0": { terrain: "forest" } } });
    const frames = buildFrames(start, end, [{ t: "open", tiles: ["1,0", "2,0"] }], name);
    const opened = frames.find((f) => f.caption === "New land opens.")!;
    expect(tileOf(opened.pub, "1,0")).toMatchObject({ open: true, terrain: "forest" });
    for (const f of frames) expect(tileOf(f.pub, "2,0")).toEqual({ id: "2,0", open: false });
  });

  it("shows a roll with its dice for longer", () => {
    const roll: Step = { t: "roll", who: "a", ruin: "tower", attr: "mind", dice: [6, 5], bonus: 1, need: 9, pass: true, helpers: [] };
    const frames = buildFrames(pub({ explorers: [a] }), pub({ phase: "report", explorers: [a] }), [roll, { t: "stone", who: "a", ruin: "tower", how: "roll" }], name);
    const r = frames.find((f) => f.roll)!;
    expect(r.ms).toBe(ROLL_MS);
    expect(r.caption).toBe("A rolls at the Star Tower. Mind +1.");
    const stone = frames[frames.indexOf(r) + 1]!;
    expect(stone.pub.stones).toEqual(["tower"]);
    expect(stone.caption).toBe("A finds the key stone.");
  });

  it("takes Hearts on damage, and not when Guard blocks it", () => {
    const steps: Step[] = [
      { t: "damage", who: "a", by: "spider", blocked: true },
      { t: "damage", who: "a", by: "fire", blocked: false },
      { t: "damage", who: "a", by: "fire", blocked: false },
      { t: "damage", who: "a", by: "fire", blocked: false },
      { t: "down", who: "a" },
    ];
    const frames = buildFrames(pub({ explorers: [a] }), pub({ phase: "report", explorers: [a] }), steps, name);
    expect(frames.slice(1, 6).map((f) => f.pub.explorers[0]!.hearts)).toEqual([3, 2, 1, 0, 0]);
    expect(frames[1]!.caption).toBe("A is safe. Guard stopped it.");
    expect(frames[5]!.pub.explorers[0]!.down).toBe(true);
  });

  it("brings a spider out of the fog onto its open path, and lights fire with a flicker", () => {
    const steps: Step[] = [
      { t: "spider", path: ["2,0", "1,0"], why: "noise" },
      { t: "lit", tile: "0,1", by: "a" },
    ];
    const frames = buildFrames(pub({ explorers: [a] }), pub({ phase: "report", explorers: [a] }), steps, name);
    const walk = frames.filter((f) => f.slide?.who === SPIDER);
    expect(walk).toHaveLength(1);
    expect(walk[0]!.pub.spider?.tile).toBe("1,0");
    expect(walk[0]!.caption).toBe("The spider goes to the noise.");
    const lit = frames.find((f) => f.flame === "0,1")!;
    expect(tileOf(lit.pub, "0,1")).toMatchObject({ fire: N.fireLife });
  });

  it("skips a planned Guard and fire-full, but explains a Guard that had a reason", () => {
    const steps: Step[] = [
      { t: "guard", who: "a", why: null },
      { t: "fire-full" },
      { t: "guard", who: "a", why: "The way is blocked." },
    ];
    const frames = buildFrames(pub({ explorers: [a] }), pub({ phase: "report", explorers: [a] }), steps, name);
    expect(frames.map((f) => f.caption)).toEqual(["", "A guards instead. The way is blocked.", ""]);
  });
});

describe("fitFrames", () => {
  const f = (ms: number): Frame => ({ pub: pub(), ms, caption: "", roll: null, slide: null, flame: null });

  it("leaves a short round alone", () => {
    const frames = [f(STEP_MS), f(STEP_MS), f(0)];
    expect(fitFrames(frames, 5000)).toBe(frames);
  });

  it("speeds up a long round to fit, never below the floor", () => {
    const fitted = fitFrames([f(1000), f(1000), f(0)], 1000);
    expect(fitted.map((x) => x.ms)).toEqual([500, 500, 0]);
    expect(fitFrames([f(1000), f(1000)], 10).map((x) => x.ms)).toEqual([MIN_MS, MIN_MS]);
  });
});

describe("Playback", () => {
  afterEach(() => vi.useRealTimers());
  const f = (caption: string, ms: number): Frame => ({ pub: pub(), ms, caption, roll: null, slide: null, flame: null });

  it("shows each frame but the last, then ends, and idle waits for that", async () => {
    vi.useFakeTimers();
    const shown: (string | null)[] = [];
    const p = new Playback((x) => shown.push(x ? x.caption : null));
    p.play([f("one", 500), f("two", 500), f("end", 0)]);
    let idle = false;
    void p.idle().then(() => (idle = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toEqual(["one"]);
    expect(p.frame?.caption).toBe("one");
    await vi.advanceTimersByTimeAsync(500);
    expect(shown).toEqual(["one", "two"]);
    expect(idle).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(shown).toEqual(["one", "two", null]);
    expect(idle).toBe(true);
    expect(p.running).toBe(false);
  });

  it("jumps to the end on skip", async () => {
    vi.useFakeTimers();
    const shown: (string | null)[] = [];
    const p = new Playback((x) => shown.push(x ? x.caption : null));
    p.play([f("one", 500), f("two", 500), f("end", 0)]);
    await vi.advanceTimersByTimeAsync(0);
    const idle = p.idle();
    p.skip();
    await idle;
    expect(shown).toEqual(["one", null]);
    expect(p.frame).toBeNull();
  });
});
