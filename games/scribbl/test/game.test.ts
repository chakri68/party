import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { scribblGame as sb } from "../server/game.ts";
import {
  CHOOSE_MS,
  DEFAULT_SETTINGS,
  MAX_POINTS,
  REVEAL_MS,
  type DrawingSnapshot,
  type ScribblAction,
  type ScribblEvent,
  type ScribblServerState,
  type ScribblSettings,
} from "../shared/types.ts";

type T = GameTransition<ScribblServerState, ScribblEvent>;

const ctx = (now = 0, seed = 1): GameContext => ({ now, randomInt: seededRandomInt(seed) });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
/** Long enough to have letters to hint at; the one word each turn offers. */
const ONE_WORD = ["watermelon"];

function start(n = 3, opts: { dealer?: number; settings?: Partial<ScribblSettings>; deck?: string[] } = {}): T {
  return sb.createGame(players(n), { ...DEFAULT_SETTINGS, ...opts.settings }, { roundNumber: 1, dealerSeat: opts.dealer ?? 0 }, ctx(), {
    deck: opts.deck ?? ONE_WORD,
  });
}

function act(state: ScribblServerState, playerId: string, action: ScribblAction, now = 0) {
  return sb.handleAction(state, playerId, action, ctx(now));
}

function ok(result: ReturnType<typeof act>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition as T;
}

function err(result: ReturnType<typeof act>) {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}

const types = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);
const drawer = (s: ScribblServerState) => s.turn.drawerId;
const score = (s: ScribblServerState, id: string) => s.players.find((p) => p.id === id)!.score;

/** Game started, first drawer has picked. Drawing began at t=0. */
function drawing(n = 3, opts: Parameters<typeof start>[1] = {}) {
  return ok(act(start(n, opts).state, "p1", { type: "choose", index: 0 })).state;
}

describe("createGame", () => {
  it("hands the pencil to the dealer's left, with a private choice of words", () => {
    const t = start(4, { dealer: 2, deck: ["cat", "dog", "fish", "bird"] });
    expect(drawer(t.state)).toBe("p3");
    expect(t.state.turn.phase).toBe("choosing");
    expect(t.timers).toContainEqual({ kind: "set", timerId: "phase", delayMs: CHOOSE_MS });
    expect(types(t)).toEqual(["turn-started"]);

    const choices = sb.getPrivateState(t.state, "p3").choices!;
    expect(choices).toHaveLength(3);
    expect(sb.getPrivateState(t.state, "p0").choices).toBeNull();
    const everyone = JSON.stringify(sb.getPublicState(t.state)) + JSON.stringify(sb.getPrivateState(t.state, "p0"));
    for (const w of choices) expect(everyone).not.toContain(w);
  });

  it("explains a bad word list", () => {
    expect(() => start(2, { deck: [] })).toThrow(/word list/);
  });
});

describe("choosing", () => {
  it("is the drawer's call alone", () => {
    const s = start().state;
    expect(err(act(s, "p0", { type: "choose", index: 0 }))).toBe("not-choosing");
  });

  it("starts the clock and shows the others blanks, not the word", () => {
    const t = ok(act(start(3, { deck: ["hot dog"] }).state, "p1", { type: "choose", index: 0 }));
    expect(t.state.turn.phase).toBe("drawing");
    expect(t.timers).toContainEqual({ kind: "set", timerId: "phase", delayMs: 80_000 });
    expect(t.timers).toContainEqual({ kind: "set", timerId: "hint", delayMs: 40_000 });
    const pub = sb.getPublicState(t.state);
    expect(pub.hint).toEqual([null, null, null, " ", null, null, null]);
    expect(pub.word).toBeNull();
    expect(sb.getPrivateState(t.state, "p1").word).toBe("hot dog");
    expect(sb.getPrivateState(t.state, "p0").word).toBeNull();
    expect(sb.getPrivateState(t.state, "p1")).toMatchObject({ canDraw: true, canChat: false });
  });

  it("picks for the drawer when they dither", () => {
    const t = sb.onTimer!(start().state, "phase", ctx(CHOOSE_MS));
    expect(t.state.turn.phase).toBe("drawing");
    expect(t.state.turn.word).toBe("watermelon");
  });
});

describe("guessing", () => {
  it("scores the guesser by speed and gives the drawer a cut", () => {
    const s = drawing(3);
    const t = ok(act(s, "p2", { type: "guess", text: "Water Melon!" }, 40_000));
    expect(types(t)).toEqual(["guessed"]);
    expect(score(t.state, "p2")).toBe(175); // halfway: 50 + 125
    expect(score(t.state, "p1")).toBe(100); // 200 split two ways
    // Now they know it; the other guesser still doesn't.
    expect(sb.getPrivateState(t.state, "p2").word).toBe("watermelon");
    expect(sb.getPrivateState(t.state, "p0").word).toBeNull();
    // Nobody sees the guess itself, just that it landed.
    expect(JSON.stringify(sb.getPrivateState(t.state, "p0").chat)).not.toContain("Water");
  });

  it("ends the turn once everyone's got it", () => {
    let s = drawing(3);
    s = ok(act(s, "p2", { type: "guess", text: "watermelon" }, 10_000)).state;
    const t = ok(act(s, "p0", { type: "guess", text: "watermelon" }, 20_000));
    expect(types(t)).toEqual(["guessed", "turn-ended"]);
    expect(t.state.turn).toMatchObject({ phase: "reveal", endedBy: "all" });
    expect(t.timers).toContainEqual({ kind: "set", timerId: "phase", delayMs: REVEAL_MS });
    expect(sb.getPublicState(t.state).word).toBe("watermelon");
  });

  it("whispers \"close\" to a near miss, and only to them", () => {
    const t = ok(act(drawing(3), "p2", { type: "guess", text: "watermelom" }));
    expect(t.events).toEqual([{ visibility: { kind: "private", playerId: "p2" }, event: { type: "close" } }]);
    expect(sb.getPrivateState(t.state, "p2").chat.map((l) => l.kind)).toContain("close");
    expect(sb.getPrivateState(t.state, "p0").chat.map((l) => l.kind)).not.toContain("close");
    // The guess itself is fair game for everyone.
    expect(sb.getPrivateState(t.state, "p0").chat.at(-1)).toMatchObject({ kind: "msg", text: "watermelom" });
  });

  it("keeps chat from people who've got it among people who've got it", () => {
    let s = drawing(4);
    s = ok(act(s, "p2", { type: "guess", text: "watermelon" })).state;
    s = ok(act(s, "p2", { type: "guess", text: "so easy" })).state;
    for (const [id, sees] of [["p1", true], ["p2", true], ["p3", false], ["p0", false]] as const) {
      expect(sb.getPrivateState(s, id).chat.some((l) => l.text === "so easy")).toBe(sees);
    }
    // And guessing it twice doesn't score twice.
    const again = ok(act(s, "p2", { type: "guess", text: "watermelon" }));
    expect(score(again.state, "p2")).toBe(score(s, "p2"));
  });

  it("won't let the drawer type while drawing", () => {
    expect(err(act(drawing(), "p1", { type: "guess", text: "it's a fruit" }))).toBe("drawing");
  });

  it("is just chat outside the drawing", () => {
    const t = ok(act(start().state, "p1", { type: "guess", text: "watermelon" }));
    expect(t.events).toEqual([]);
    expect(score(t.state, "p1")).toBe(0);
  });
});

describe("hints", () => {
  it("fill in letters on the clock, never all of them", () => {
    let s = drawing(3);
    let t = sb.onTimer!(s, "hint", ctx(40_000));
    expect(types(t)).toEqual(["hint"]);
    expect(t.timers).toEqual([{ kind: "set", timerId: "hint", delayMs: 20_000 }]);
    s = sb.onTimer!(t.state, "hint", ctx(60_000)).state;
    expect(sb.getPublicState(s).hint!.filter(Boolean)).toHaveLength(2);
    t = sb.onTimer!(s, "hint", ctx(70_000));
    expect(t.events).toEqual([]);
  });
});

describe("turn order and the end", () => {
  it("goes round the table, then round again, then ends on the top scorer", () => {
    let s = start(2, { settings: { rounds: 2 } }).state;
    const drawers: string[] = [];
    let now = 0;
    const tick = (ms: number, id = "phase") => {
      now += ms;
      return (s = sb.onTimer!(s, id, ctx(now)).state);
    };
    for (let turn = 0; turn < 4; turn++) {
      drawers.push(drawer(s));
      tick(CHOOSE_MS);
      const guesser = drawer(s) === "p0" ? "p1" : "p0";
      // p0 is quicker every time.
      s = ok(act(s, guesser, { type: "guess", text: "watermelon" }, now + (guesser === "p0" ? 1000 : 70_000))).state;
      tick(REVEAL_MS);
    }
    expect(drawers).toEqual(["p1", "p0", "p1", "p0"]);
    expect(s.phase).toBe("finished");
    const result = sb.getResult(s)!;
    expect(result.winnerIds).toEqual(["p0"]);
    expect(result.standings.map((x) => x.playerId)).toEqual(["p0", "p1"]);
    expect(result.standings[0]!.label).toMatch(/points$/);
  });

  it("the clock ending the drawing reveals the word", () => {
    const t = sb.onTimer!(drawing(), "phase", ctx(80_000));
    expect(t.state.turn).toMatchObject({ phase: "reveal", endedBy: "time" });
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: "hint" });
  });

  it("someone away when their go comes round misses it", () => {
    let s = drawing(3);
    s = sb.onPlayerDisconnected!(s, "p2", ctx()).state;
    s = sb.onTimer!(s, "phase", ctx(80_000)).state; // reveal
    const t = sb.onTimer!(s, "phase", ctx(85_000));
    expect(types(t)).toEqual(["missed", "turn-started"]);
    expect(drawer(t.state)).toBe("p0");
  });

  it("an away guesser doesn't hold up \"everyone got it\"", () => {
    let s = drawing(3);
    s = ok(act(s, "p2", { type: "guess", text: "watermelon" })).state;
    const t = sb.onPlayerDisconnected!(s, "p0", ctx());
    expect(t.state.turn.endedBy).toBe("all");
  });

  it("the drawer leaving ends their turn; too few left ends the game", () => {
    let t = sb.onPlayerRemoved!(drawing(3), "p1", ctx());
    expect(t.state.turn).toMatchObject({ phase: "reveal", endedBy: "left" });
    t = sb.onPlayerRemoved!(t.state, "p2", ctx());
    expect(t.state).toMatchObject({ phase: "finished", endReason: "abandoned" });
    expect(sb.getResult(t.state)!.winnerIds).toEqual([]);
  });

  it("the drawer leaving mid-pick moves straight on", () => {
    const t = sb.onPlayerRemoved!(start(3).state, "p1", ctx());
    expect(drawer(t.state)).toBe("p2");
    expect(t.state.turn.phase).toBe("choosing");
  });
});

describe("the drawing stream", () => {
  const line = (turn: number, id: number, points = [10, 10, 20, 20]) => ({ turn, op: "start", id, color: 3, size: 1, points });

  it("takes strokes from the drawer, for this turn, in order", () => {
    const s = drawing();
    const turn = s.turn.number;
    expect(sb.onStream!(s, "p0", line(turn, 0))).toBeNull(); // not the drawer
    expect(sb.onStream!(s, "p1", line(turn + 1, 0))).toBeNull(); // stale turn
    expect(sb.onStream!(s, "p1", line(turn, 5))).toBeNull(); // skipped an id

    let out = sb.onStream!(s, "p1", line(turn, 0))!;
    expect(out.relay).toEqual(line(turn, 0));
    out = sb.onStream!(out.state, "p1", { turn, op: "add", id: 0, points: [30, 30] })!;
    expect(sb.onStream!(out.state, "p1", { turn, op: "add", id: 7, points: [1, 1] })).toBeNull();
    out = sb.onStream!(out.state, "p1", line(turn, 1))!;
    out = sb.onStream!(out.state, "p1", { turn, op: "undo" })!;

    const snap = sb.getStreamSnapshot!(out.state) as DrawingSnapshot;
    expect(snap).toEqual({ turn, nextId: 2, strokes: [{ id: 0, color: 3, size: 1, points: [10, 10, 20, 20, 30, 30] }] });
    // The original's untouched: onStream is as pure as the rest.
    expect(s.turn.strokes).toEqual([]);
    // And none of it rides along in the regular projections.
    expect(JSON.stringify(sb.getPublicState(out.state))).not.toContain("strokes");
  });

  it("is refused outside the drawing, and past the ink budget", () => {
    expect(sb.onStream!(start().state, "p1", line(1, 0))).toBeNull();
    const s = drawing();
    const full = { ...s, turn: { ...s.turn, pointCount: MAX_POINTS - 1 } };
    expect(sb.onStream!(full, "p1", line(s.turn.number, 0))).toBeNull();
  });

  it("the next turn starts on a clean page", () => {
    let s = drawing();
    s = sb.onStream!(s, "p1", line(s.turn.number, 0))!.state;
    s = sb.onTimer!(s, "phase", ctx(80_000)).state;
    expect((sb.getStreamSnapshot!(s) as DrawingSnapshot).strokes).toHaveLength(1); // still up during the reveal
    s = sb.onTimer!(s, "phase", ctx(85_000)).state;
    expect(sb.getStreamSnapshot!(s)).toMatchObject({ strokes: [], nextId: 0 });
  });
});
