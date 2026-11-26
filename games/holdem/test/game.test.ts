import { seededRandomInt, type GameContext } from "@games/game-core";
import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { STEP_TIMER, TURN_TIMER, holdemGame as he, showdownMs } from "../server/game.ts";
import { DEFAULT_SETTINGS, type HoldemAction, type HoldemServerState, type HoldemSettings } from "../shared/types.ts";

type S = HoldemServerState;

const ctx = (now = 0): GameContext => ({ now, randomInt: seededRandomInt(7) });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

/** "As Kd Th" → card ids. */
function c(text: string): string[] {
  const suit = { s: "spades", h: "hearts", c: "clubs", d: "diamonds" } as const;
  return text.split(/\s+/).filter(Boolean).map((t) => `${suit[t.at(-1) as keyof typeof suit]}-${t.slice(0, -1).replace("T", "10")}`);
}

/** Hole cards in deal order (from the button's left), then the board: one at a time, like a real deal. */
function deck(holes: string[], board: string): string[] {
  const hands = holes.map(c);
  const rounds = Math.max(...hands.map((h) => h.length));
  return [...Array.from({ length: rounds }, (_, r) => hands.map((h) => h[r]!)).flat(), ...c(board)];
}

/**
 * A table with chosen stacks and button, at the first hand's deal. Built by
 * running the between-hands timer over a fresh game, so the deal is the real one.
 */
function table(stacks: number[], opts: { button?: number; decks?: string[][]; settings?: Partial<HoldemSettings>; now?: number } = {}): S {
  const settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const s = structuredClone(he.createGame(ids(stacks.length).map((id) => ({ id })), settings, { roundNumber: 1, dealerSeat: 0 }, ctx(opts.now)).state);
  s.players.forEach((p, i) => {
    p.stack = stacks[i]!;
  });
  s.handNumber = 0;
  s.step = "between-hands";
  s.turnIndex = -1;
  s.buttonIndex = opts.button ?? 0;
  s.testDecks = opts.decks ?? null;
  return he.onTimer!(s, STEP_TIMER, ctx(opts.now)).state;
}

function act(s: S, playerId: string, action: HoldemAction, now = 0) {
  const r = he.handleAction(s, playerId, action, ctx(now));
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.transition;
}
const play = (s: S, playerId: string, action: HoldemAction, now = 0) => act(s, playerId, action, now).state;

function refuse(s: S, playerId: string, action: HoldemAction) {
  const r = he.handleAction(s, playerId, action, ctx());
  if (r.ok) throw new Error("expected a rejection");
  return r.error;
}

const timer = (s: S, id: string, now = 0) => he.onTimer!(s, id, ctx(now));
const pubOf = (s: S) => he.getPublicState(s);
const privOf = (s: S, id: string) => he.getPrivateState(s, id);
const turn = (s: S) => pubOf(s).currentPlayerId;
const stacks = (s: S) => s.players.map((p) => p.stack);
const types = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);

/** Folds whoever's up until the hand's over, then runs the pauses into the next deal. */
function foldOut(s: S, now = 0): S {
  while (pubOf(s).currentPlayerId) s = play(s, turn(s)!, { type: "fold" }, now);
  s = timer(s, STEP_TIMER, now).state; // awarded → between-hands
  if (s.phase === "playing") s = timer(s, STEP_TIMER, now).state; // → next hand
  return s;
}

describe("dealing and blinds", () => {
  it("deals two each, posts blinds left of the button, and starts left of the big blind", () => {
    const t = he.createGame(ids(4).map((id) => ({ id })), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 1 }, ctx());
    const s = t.state;
    const p = pubOf(s);
    expect(p).toMatchObject({ buttonId: "p1", sbId: "p2", bbId: "p3", currentPlayerId: "p0", level: 1, sb: 10, bb: 20, pot: 30 });
    expect(s.players.every((x) => x.hole.length === 2)).toBe(true);
    expect(types(t)).toEqual(["hand-start", "your-cards", "your-cards", "your-cards", "your-cards"]);
    expect(t.timers).toContainEqual({ kind: "set", timerId: TURN_TIMER, delayMs: 30_000 });
    expect(he.getAwaitedPlayerIds(s)).toEqual(["p0"]);
  });

  it("the button moves one left each hand, skipping busted seats", () => {
    let s = table([1500, 1500, 1500]);
    expect(pubOf(s).buttonId).toBe("p0");
    s = foldOut(s);
    expect(pubOf(s).buttonId).toBe("p1");
    s.players[2]!.out = true;
    s.players[2]!.stack = 0;
    s = foldOut(s);
    expect(pubOf(s).buttonId).toBe("p0");
  });

  it("a player short of a blind posts what they have and is all-in", () => {
    const s = table([1000, 5, 15]);
    expect(s.players[1]).toMatchObject({ bet: 5, stack: 0, allIn: true });
    expect(s.players[2]).toMatchObject({ bet: 15, stack: 0, allIn: true });
    // Everyone else still owes the full big blind.
    expect(privOf(s, "p0").legal).toMatchObject({ call: 20, check: false });
  });
});

describe("betting", () => {
  it("minimum raises in a row: each must be at least the last full raise", () => {
    let s = table([3000, 3000, 3000]);
    expect(turn(s)).toBe("p0");
    expect(privOf(s, "p0").legal).toMatchObject({ minRaiseTo: 40, maxRaiseTo: 3000, call: 20 });
    expect(refuse(s, "p0", { type: "raise", to: 39 }).code).toBe("illegal-bet");
    s = play(s, "p0", { type: "raise", to: 100 }); // raise of 80
    expect(privOf(s, "p1").legal).toMatchObject({ minRaiseTo: 180 });
    expect(refuse(s, "p1", { type: "raise", to: 170 }).message).toMatch(/180/);
    s = play(s, "p1", { type: "raise", to: 300 }); // raise of 200
    expect(privOf(s, "p2").legal).toMatchObject({ minRaiseTo: 500 });
    s = play(s, "p2", { type: "raise", to: 500 });
    expect(privOf(s, "p0").legal).toMatchObject({ minRaiseTo: 700, call: 400 });
  });

  it("the opening bet after the flop is at least the big blind, and the round can check through", () => {
    let s = table([3000, 3000, 3000]);
    s = play(s, "p0", { type: "call" });
    s = play(s, "p1", { type: "call" });
    s = play(s, "p2", { type: "check" });
    expect(pubOf(s)).toMatchObject({ step: "flop", currentPlayerId: "p1", pot: 60, currentBet: 0 });
    expect(s.board).toHaveLength(3);
    expect(privOf(s, "p1").legal).toMatchObject({ check: true, call: 0, minRaiseTo: 20, opening: true });
    expect(refuse(s, "p1", { type: "raise", to: 10 }).code).toBe("illegal-bet");
    s = play(s, "p1", { type: "check" });
    s = play(s, "p2", { type: "check" });
    s = play(s, "p0", { type: "check" });
    expect(pubOf(s).step).toBe("turn");
  });

  it("a short all-in doesn't reopen the betting for players who already acted", () => {
    let s = table([3000, 3000, 140]);
    s = play(s, "p0", { type: "raise", to: 100 });
    s = play(s, "p1", { type: "call" });
    s = play(s, "p2", { type: "all-in" }); // to 140: 40 more, short of the 80 raise
    expect(s.currentBet).toBe(140);
    expect(turn(s)).toBe("p0");
    expect(privOf(s, "p0").legal).toMatchObject({ call: 40, minRaiseTo: null, maxRaiseTo: null });
    expect(refuse(s, "p0", { type: "raise", to: 400 }).message).toMatch(/only call or fold/);
    expect(refuse(s, "p0", { type: "all-in" }).message).toMatch(/only call or fold/);
    s = play(s, "p0", { type: "call" });
    expect(privOf(s, "p1").legal?.minRaiseTo).toBeNull();
    s = play(s, "p1", { type: "call" });
    expect(pubOf(s).step).toBe("flop");
  });

  it("a full all-in raise reopens it", () => {
    let s = table([3000, 3000, 300]);
    s = play(s, "p0", { type: "raise", to: 100 });
    s = play(s, "p1", { type: "call" });
    s = play(s, "p2", { type: "all-in" }); // to 300: a raise of 200
    expect(privOf(s, "p0").legal).toMatchObject({ call: 200, minRaiseTo: 500 });
    s = play(s, "p0", { type: "raise", to: 500 });
    expect(turn(s)).toBe("p1");
  });

  it("heads-up: the button posts the small blind and acts first before the flop, last after", () => {
    let s = table([1500, 1500]);
    expect(pubOf(s)).toMatchObject({ buttonId: "p0", sbId: "p0", bbId: "p1", currentPlayerId: "p0" });
    expect(s.players.map((p) => p.bet)).toEqual([10, 20]);
    s = play(s, "p0", { type: "call" });
    expect(turn(s)).toBe("p1"); // the big blind's option
    s = play(s, "p1", { type: "check" });
    expect(pubOf(s)).toMatchObject({ step: "flop", currentPlayerId: "p1" });
    s = play(s, "p1", { type: "check" });
    expect(turn(s)).toBe("p0");
    s = play(s, "p0", { type: "check" });
    expect(pubOf(s)).toMatchObject({ step: "turn", currentPlayerId: "p1" });
  });

  it("heads-up next hand: the button moves and the other player posts the small blind", () => {
    const s = foldOut(table([1500, 1500]));
    expect(pubOf(s)).toMatchObject({ buttonId: "p1", sbId: "p1", bbId: "p0", currentPlayerId: "p1" });
  });

  it("rejects moves out of turn and checks facing a bet", () => {
    const s = table([1500, 1500, 1500]);
    expect(refuse(s, "p1", { type: "call" }).code).toBe("not-your-turn");
    expect(refuse(s, "p0", { type: "check" }).code).toBe("illegal-bet");
  });
});

describe("hands", () => {
  it("fold-out: no showdown, the winner's cards stay down unless they show", () => {
    let s = table([1500, 1500, 1500]);
    s = play(s, "p0", { type: "raise", to: 60 });
    s = play(s, "p1", { type: "fold" });
    const t = act(s, "p2", { type: "fold" });
    s = t.state;
    expect(pubOf(s).step).toBe("awarded");
    expect(types(t)).toEqual(["bet", "returned", "awarded"]);
    expect(stacks(s)).toEqual([1530, 1490, 1480]);
    expect(pubOf(s).players[0]!.cards).toBeNull();
    expect(pubOf(s).lastHand).toMatchObject({ byFold: true, won: { p0: 50 } });
    expect(t.timers).toContainEqual({ kind: "set", timerId: STEP_TIMER, delayMs: 3000 });
    // Holes stay hidden from the others...
    for (const card of s.players[0]!.hole) {
      expect(findLeaks({ def: he, state: s, events: t.events, players: ids(3), secret: card.id, allowed: ["p0"] })).toEqual([]);
    }
    expect(privOf(s, "p0").canShow).toBe(true);
    expect(privOf(s, "p1").canShow).toBe(false);
    const shown = act(s, "p0", { type: "show" });
    expect(types(shown)).toEqual(["reveal"]);
    expect(pubOf(shown.state).players[0]!.cards).toEqual(s.players[0]!.hole);
    expect(refuse(shown.state, "p0", { type: "show" }).code).toBe("cant-show");
  });

  it("all-in run-out: cards turn up, the board comes out on a timer, best hand wins", () => {
    // Heads-up, deal order p1 then p0.
    let s = table([1500, 1500], { decks: [deck(["Kh Kd", "As Ad"], "2c 7s 9d Jc 3h")] });
    s = play(s, "p0", { type: "all-in" });
    const t = act(s, "p1", { type: "call" });
    s = t.state;
    expect(types(t)).toEqual(["bet", "reveal"]);
    expect(pubOf(s)).toMatchObject({ runout: true, currentPlayerId: null, board: [] });
    expect(pubOf(s).players.every((p) => p.cards?.length === 2)).toBe(true);
    expect(t.timers).toContainEqual({ kind: "set", timerId: STEP_TIMER, delayMs: 1500 });
    expect(he.getAwaitedPlayerIds(s)).toEqual([]);
    s = timer(s, STEP_TIMER).state;
    expect(s.board).toHaveLength(3);
    s = timer(s, STEP_TIMER).state;
    s = timer(s, STEP_TIMER).state;
    expect(s.board).toHaveLength(5);
    const sd = timer(s, STEP_TIMER);
    s = sd.state;
    expect(pubOf(s).step).toBe("showdown");
    expect(stacks(s)).toEqual([3000, 0]);
    expect(s.lastHand).toMatchObject({ pots: [{ amount: 3000, winners: ["p0"], label: "Pair of Aces" }] });
    expect(s.lastHand!.bestCards.p0).toEqual(c("As Ad Jc 9d 7s"));
    // p1 busts and the game's over after the pause.
    const end = timer(s, STEP_TIMER);
    expect(end.state.phase).toBe("over");
    expect(he.getResult(end.state)).toEqual({
      winnerIds: ["p0"],
      standings: [
        { playerId: "p0", value: 3000, label: "3,000 chips" },
        { playerId: "p1", value: 0, label: "out 2nd" },
      ],
    });
  });

  it("showdown: a split board splits the pot", () => {
    let s = table([1500, 1500, 1500], { decks: [deck(["2c 3d", "4c 5d", "7h 8h"], "As Ks Qs Js Ts")] });
    s = play(s, "p0", { type: "call" });
    s = play(s, "p1", { type: "call" });
    s = play(s, "p2", { type: "check" });
    for (let street = 0; street < 3; street++) for (const id of ["p1", "p2", "p0"]) s = play(s, id, { type: "check" });
    expect(pubOf(s).step).toBe("showdown");
    // The board's a royal flush: everyone plays it.
    expect(s.lastHand!.pots).toEqual([{ amount: 60, winners: ["p1", "p2", "p0"], label: "Royal flush" }]);
    expect(stacks(s)).toEqual([1500, 1500, 1500]);
  });

  it("showdown: every hand still in turns over, in order from the button's left, losers too", () => {
    let s = table([1500, 1500, 1500], { decks: [deck(["2c 3d", "Ac Ad", "7h 8d"], "Ks Qh 9c 4s 6d")] });
    s = play(s, "p0", { type: "call" });
    s = play(s, "p1", { type: "call" });
    s = play(s, "p2", { type: "check" });
    for (let street = 0; street < 2; street++) for (const id of ["p1", "p2", "p0"]) s = play(s, id, { type: "check" });
    // Until the river's done, nobody's cards are anyone else's business.
    expect(findLeaks({ def: he, state: s, players: ids(3), secret: "clubs-2", allowed: ["p1"] })).toEqual([]);
    s = play(s, "p1", { type: "check" });
    s = play(s, "p2", { type: "check" });
    const t = act(s, "p0", { type: "check" });
    s = t.state;
    expect(s.lastHand!.pots[0]).toMatchObject({ winners: ["p2"], label: "Pair of Aces" });
    expect(pubOf(s).players.map((x) => !!x.cards)).toEqual([true, true, true]);
    // Button p0: the reveal goes p1, p2, then the button.
    expect(s.lastHand!.order).toEqual(["p1", "p2", "p0"]);
    expect(s.lastHand!.labels).toEqual({ p1: "High card, King", p2: "Pair of Aces", p0: "High card, King" });
    expect(Object.keys(s.lastHand!.fives).sort()).toEqual(["p0", "p1", "p2"]);
    expect(s.lastHand!.fives.p1).toHaveLength(5);
    expect(Object.keys(s.lastHand!.bestCards)).toEqual(["p2"]);
    // Nothing left to Show: it's all face up.
    expect(privOf(s, "p1").canShow).toBe(false);
    // The pause makes room for a beat per hand.
    expect(t.timers).toContainEqual({ kind: "set", timerId: STEP_TIMER, delayMs: showdownMs(3) });
  });

  it("side pots: a short all-in wins only the main pot", () => {
    // Button p0; deal order p1, p2, p0. p1 has the best hand but only 100 chips.
    let s = table([1000, 100, 1000], { decks: [deck(["Ac Ad", "Kc Kd", "2s 7h"], "3c 8d 9h Js 4h")] });
    s = play(s, "p0", { type: "raise", to: 300 });
    s = play(s, "p1", { type: "all-in" });
    s = play(s, "p2", { type: "call" });
    expect(pubOf(s).runout).toBe(false); // p0 and p2 can still bet
    expect(pubOf(s).pots).toEqual([
      { amount: 300, eligible: ["p0", "p1", "p2"] },
      { amount: 400, eligible: ["p0", "p2"] },
    ]);
    for (let street = 0; street < 3; street++) for (const id of ["p2", "p0"]) s = play(s, id, { type: "check" });
    expect(s.lastHand!.pots).toEqual([
      { amount: 300, winners: ["p1"], label: "Pair of Aces" },
      { amount: 400, winners: ["p2"], label: "Pair of Kings" },
    ]);
    expect(stacks(s)).toEqual([700, 300, 1100]);
  });

  it("uncalled chips go back before the run-out", () => {
    let s = table([1000, 1000, 200]);
    s = play(s, "p0", { type: "all-in" });
    s = play(s, "p1", { type: "fold" });
    const t = act(s, "p2", { type: "call" });
    expect(t.events.map((e) => e.event)).toContainEqual({ type: "returned", playerId: "p0", amount: 800 });
    expect(t.state.players[0]!.stack).toBe(800);
    expect(pubOf(t.state).runout).toBe(true);
  });
});

describe("tournament", () => {
  it("blinds rise on the hand count", () => {
    let s = table([3000, 3000, 3000], { settings: { handsPerLevel: 4 } });
    expect(pubOf(s)).toMatchObject({ level: 1, sb: 10, bb: 20, handsToNextLevel: 4, next: { sb: 15, bb: 30 } });
    for (let i = 0; i < 3; i++) s = foldOut(s);
    expect(pubOf(s)).toMatchObject({ handNumber: 4, level: 1, handsToNextLevel: 1 });
    while (pubOf(s).currentPlayerId) s = play(s, turn(s)!, { type: "fold" });
    s = timer(s, STEP_TIMER).state;
    const t = timer(s, STEP_TIMER);
    expect(t.events[0]!.event).toEqual({ type: "level-up", level: 2, sb: 15, bb: 30 });
    expect(pubOf(t.state)).toMatchObject({ handNumber: 5, level: 2, sb: 15, bb: 30, pot: 45, handsToNextLevel: 4 });
  });

  it("bust order: two out in the same hand rank by their stack going in", () => {
    let s = table([1000, 100, 200], { decks: [deck(["2c 7d", "3c 8d", "As Ad"], "Kh Qs 9c 4h Js")] });
    s = play(s, "p0", { type: "all-in" });
    s = play(s, "p1", { type: "call" });
    s = play(s, "p2", { type: "call" });
    while (s.step !== "showdown") s = timer(s, STEP_TIMER).state;
    expect(stacks(s)).toEqual([1300, 0, 0]);
    s = timer(s, STEP_TIMER).state;
    expect(he.getResult(s)?.standings).toEqual([
      { playerId: "p0", value: 1300, label: "1,300 chips" },
      { playerId: "p2", value: 0, label: "out 2nd" },
      { playerId: "p1", value: 0, label: "out 3rd" },
    ]);
  });

  it("equal stacks out in the same hand share the place; earlier busts rank lower", () => {
    let s = table([1000, 100, 100, 1000], {
      button: 3,
      // Deal order from p3's left: p0, p1, p2, p3.
      decks: [deck(["As Ad", "2c 7d", "3c 8d", "4s 9s"], "Kh Qs Tc 5h Jd")],
    });
    // p0 is SB, p1 BB; p2 is first to act.
    s = play(s, "p2", { type: "all-in" });
    s = play(s, "p3", { type: "fold" });
    s = play(s, "p0", { type: "call" });
    s = play(s, "p1", { type: "call" });
    while (s.step !== "showdown") s = timer(s, STEP_TIMER).state;
    s = timer(s, STEP_TIMER).state;
    expect(s.players.filter((p) => p.out).map((p) => p.id)).toEqual(["p1", "p2"]);
    // Now p3 busts to p0 a hand later.
    s.players[3]!.stack = 50;
    s = timer(s, STEP_TIMER).state;
    while (s.step !== "showdown" && s.step !== "awarded") {
      s = pubOf(s).currentPlayerId ? play(s, turn(s)!, { type: "all-in" }) : timer(s, STEP_TIMER).state;
    }
    // Whoever won, force the bust for the placing check.
    s.players[0]!.stack += s.players[3]!.stack;
    s.players[3]!.stack = 0;
    s = timer(s, STEP_TIMER).state;
    expect(he.getResult(s)?.standings.map((x) => [x.playerId, x.label])).toEqual([
      ["p0", `${(s.players[0]!.stack).toLocaleString("en-US")} chips`],
      ["p3", "out 2nd"],
      ["p1", "out 3rd"],
      ["p2", "out 3rd"],
    ]);
  });

  it("time cap: the hand in progress finishes, then the biggest stack wins", () => {
    let s = table([1500, 1500, 1500], { settings: { ending: 20 } });
    expect(pubOf(s).capEndsAt).toBe(20 * 60_000);
    s = play(s, "p0", { type: "raise", to: 100 }, 1000);
    s = play(s, "p1", { type: "fold" }, 1000);
    // Time's up mid-hand; the hand carries on.
    s = play(s, "p2", { type: "fold" }, 21 * 60_000);
    expect(s.phase).toBe("playing");
    const t = timer(s, STEP_TIMER, 21 * 60_000);
    expect(t.state.phase).toBe("over");
    expect(t.events.at(-1)!.event).toEqual({ type: "game-over", winnerIds: ["p0"], reason: "time" });
    expect(he.getResult(t.state)?.standings.map((x) => x.label)).toEqual(["1,530 chips", "1,490 chips", "1,480 chips"]);
  });

  it("before the cap, hands keep coming", () => {
    let s = table([1500, 1500, 1500], { settings: { ending: 20 } });
    s = foldOut(s, 19 * 60_000);
    expect(s.phase).toBe("playing");
    expect(s.handNumber).toBe(2);
  });

  it("rebuys: a busted player can buy back in during the window", () => {
    let s = table([1500, 100], { settings: { rebuys: "early" }, decks: [deck(["2c 7d", "As Ad"], "Kh Qs 9c 4h Js")] });
    s = play(s, "p0", { type: "all-in" });
    s = play(s, "p1", { type: "call" });
    while (s.step !== "showdown") s = timer(s, STEP_TIMER).state;
    const t = timer(s, STEP_TIMER);
    s = t.state;
    expect(t.events.map((e) => e.event)).toContainEqual({ type: "busted", playerIds: ["p1"], rebuy: ["p1"] });
    expect(s.phase).toBe("playing");
    expect(t.timers).toContainEqual({ kind: "set", timerId: STEP_TIMER, delayMs: 12_000 });
    expect(privOf(s, "p1").canRebuy).toBe(true);
    s = play(s, "p1", { type: "rebuy" });
    expect(s.players[1]).toMatchObject({ stack: 1500, rebuysUsed: 1, pendingRebuy: false });
    s = timer(s, STEP_TIMER).state;
    expect(s.handNumber).toBe(2);
  });

  it("rebuys: no rebuy in time and you're out", () => {
    let s = table([1500, 100], { settings: { rebuys: "early" }, decks: [deck(["2c 7d", "As Ad"], "Kh Qs 9c 4h Js")] });
    s = play(s, "p0", { type: "all-in" });
    s = play(s, "p1", { type: "call" });
    while (s.step !== "showdown") s = timer(s, STEP_TIMER).state;
    s = timer(s, STEP_TIMER).state;
    s = timer(s, STEP_TIMER).state;
    expect(s.phase).toBe("over");
    expect(he.getResult(s)?.winnerIds).toEqual(["p0"]);
  });
});

describe("turn clock and sitting out", () => {
  it("expiry checks if free, folds otherwise; two in a row sits you out until you're back", () => {
    let s = table([1500, 1500, 1500]);
    let t = timer(s, TURN_TIMER);
    expect(t.events[0]!.event).toMatchObject({ type: "bet", playerId: "p0", kind: "fold", auto: "timer" });
    s = t.state;
    expect(s.players[0]!.timeouts).toBe(1);
    s = foldOut(s); // button p1: p2 SB, p0 BB, p1 first
    s = play(s, "p1", { type: "call" });
    s = play(s, "p2", { type: "call" });
    expect(turn(s)).toBe("p0");
    t = timer(s, TURN_TIMER);
    // The big blind's option is free: checked, not folded.
    expect(t.events.map((e) => e.event)).toContainEqual({ type: "bet", playerId: "p0", kind: "check", amount: 20, to: 20, auto: "timer" });
    expect(t.events.map((e) => e.event)).toContainEqual({ type: "sitting-out", playerId: "p0" });
    s = t.state;
    expect(pubOf(s).players[0]!.sittingOut).toBe(true);
    expect(privOf(s, "p0").canBack).toBe(true);
    // Flop: p2 bets, p0's turn folds at once.
    expect(turn(s)).toBe("p2");
    t = act(s, "p2", { type: "raise", to: 40 });
    expect(turn(t.state)).toBe("p1");
    expect(t.events.map((e) => e.event)).toContainEqual({ type: "bet", playerId: "p0", kind: "fold", amount: 0, to: 0, auto: "sitting-out" });
    s = play(t.state, "p0", { type: "back" });
    expect(s.players[0]).toMatchObject({ sittingOut: false, timeouts: 0 });
  });

  it("a real move resets the count", () => {
    let s = table([1500, 1500, 1500]);
    s = timer(s, TURN_TIMER).state; // p0 folds
    s = foldOut(s);
    s = play(s, "p1", { type: "call" });
    s = play(s, "p2", { type: "call" });
    s = play(s, "p0", { type: "check" });
    expect(s.players[0]!.timeouts).toBe(0);
  });

  it("the host's Skip does what the timer would", () => {
    const s = table([1500, 1500, 1500]);
    const t = he.skipTurn!(s, "p0", ctx());
    expect(t.events[0]!.event).toMatchObject({ kind: "fold", auto: "skip" });
    expect(t.state.players[0]!.timeouts).toBe(1);
    expect(he.skipTurn!(s, "p1", ctx()).state).toBe(s);
  });

  it("a disconnected player is acted for at once and comes back on reconnect", () => {
    let s = table([1500, 1500, 1500]);
    const t = he.onPlayerDisconnected!(s, "p0", ctx());
    expect(t.events[0]!.event).toMatchObject({ playerId: "p0", kind: "fold", auto: "sitting-out" });
    s = t.state;
    expect(turn(s)).toBe("p1");
    s = he.onPlayerDisconnected!(s, "p2", ctx()).state;
    expect(turn(s)).toBe("p1"); // not p2's turn yet
    s = play(s, "p1", { type: "call" });
    // p2's option: a free check, not a fold.
    expect(pubOf(s).step).toBe("flop");
    s = he.onPlayerReconnected!(s, "p2", ctx()).state;
    expect(s.players[2]).toMatchObject({ away: false, sittingOut: false });
  });
});

describe("removal", () => {
  it("mid-hand: their cards fold, their bet stays, the turn moves on", () => {
    let s = table([1500, 1500, 1500]);
    s = play(s, "p0", { type: "raise", to: 100 });
    const t = he.onPlayerRemoved!(s, "p1", ctx());
    s = t.state;
    expect(s.players[1]).toMatchObject({ removed: true, folded: true, stack: 0, contributed: 10 });
    expect(turn(s)).toBe("p2");
    s = play(s, "p2", { type: "fold" });
    // 80 of p0's 100 was never called and came back.
    expect(s.lastHand?.won).toEqual({ p0: 50 });
    expect(stacks(s)).toEqual([1530, 0, 1480]);
  });

  it("one player left wins", () => {
    const s = table([1500, 1500]);
    const t = he.onPlayerRemoved!(s, "p1", ctx());
    expect(t.state.phase).toBe("over");
    expect(he.getResult(t.state)).toMatchObject({ winnerIds: ["p0"] });
    expect(t.state.players[0]!.stack).toBe(1520);
  });
});

describe("hidden cards", () => {
  it("hole cards reach only their owner until shown", () => {
    const t = he.createGame(ids(4).map((id) => ({ id })), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx());
    for (const p of t.state.players) {
      for (const card of p.hole) {
        expect(findLeaks({ def: he, state: t.state, events: t.events, players: ids(4), secret: card.id, allowed: [p.id] })).toEqual([]);
      }
    }
    // The deck itself never goes out.
    expect(JSON.stringify(pubOf(t.state))).not.toMatch(/deck/);
  });

  it("your best hand shows once there's a flop", () => {
    let s = table([1500, 1500], { decks: [deck(["9c 9d", "2h 5s"], "Kh 4c 7d 8s Js")] });
    expect(privOf(s, "p1").best).toBeNull();
    s = play(s, "p0", { type: "call" });
    s = play(s, "p1", { type: "check" });
    expect(privOf(s, "p1").best?.label).toBe("Pair of Nines");
  });

  it("parses actions and settings defensively", () => {
    expect(he.parseAction({ type: "raise", to: 40 })).toEqual({ type: "raise", to: 40 });
    expect(he.parseAction({ type: "raise", to: -1 })).toBeNull();
    expect(he.parseAction({ type: "raise", to: 1.5 })).toBeNull();
    expect(he.parseAction({ type: "nope" })).toBeNull();
    expect(he.parseSettings({ startingChips: 3000, ending: 30 })).toMatchObject({ startingChips: 3000, ending: 30 });
    expect(he.parseSettings({ startingChips: 99 })).toBeNull();
  });
});

describe("Omaha", () => {
  const omaha = { variant: "omaha" } as const;

  it("deals four each and reads every hand as 2 private cards and 3 shared", () => {
    // Deal order p1, p2, p0. Four hearts on the board: p1 and p0 hold one heart each, so no flush.
    let s = table([1500, 1500, 1500], {
      settings: omaha,
      decks: [deck(["Qh 3s 4d 8c", "Ac 5d 6s Tc", "2c 3c 8d 8h"], "Ah Kh 7h 2h 9c")],
    });
    expect(pubOf(s).variant).toBe("omaha");
    expect(s.players.every((p) => p.hole.length === 4)).toBe(true);
    expect(pubOf(s).players.every((p) => p.cards === null)).toBe(true);
    s = play(s, "p0", { type: "call" });
    s = play(s, "p1", { type: "call" });
    s = play(s, "p2", { type: "check" });
    expect(privOf(s, "p1").best?.label).toBe("High card, Ace");
    for (let street = 0; street < 3; street++) for (const id of ["p1", "p2", "p0"]) s = play(s, id, { type: "check" });
    expect(pubOf(s).step).toBe("showdown");
    expect(s.lastHand!.labels).toEqual({ p0: "Pair of Eights", p1: "High card, Ace", p2: "Pair of Aces" });
    expect(s.lastHand!.pots).toEqual([{ amount: 60, winners: ["p2"], label: "Pair of Aces" }]);
    expect(s.lastHand!.bestCards.p2).toEqual(c("Ac Ah Kh Tc 9c"));
    expect(pubOf(s).players.every((p) => p.cards?.length === 4)).toBe(true);
  });

  it("pot-limit: the most you can raise to is the call plus the pot after the call", () => {
    // Button p0, blinds p1 and p2: p3 acts first.
    let s = table([3000, 3000, 3000, 3000], { settings: omaha });
    expect(privOf(s, "p3").legal).toMatchObject({ call: 20, minRaiseTo: 40, maxRaiseTo: 70, maxIsAllIn: false });
    expect(refuse(s, "p3", { type: "raise", to: 71 }).message).toMatch(/70/);
    expect(refuse(s, "p3", { type: "all-in" }).message).toMatch(/pot.*70/);
    s = play(s, "p3", { type: "raise", to: 70 });
    // 70 to call, and 100 in the pot: 70 + 170.
    expect(privOf(s, "p0").legal).toMatchObject({ call: 70, minRaiseTo: 120, maxRaiseTo: 240, maxIsAllIn: false });
    s = play(s, "p0", { type: "raise", to: 240 });
    // The small blind owes 230, and the pot is 340: 240 + 570.
    expect(privOf(s, "p1").legal).toMatchObject({ call: 230, maxRaiseTo: 810 });
    s = play(s, "p1", { type: "call" });
    s = play(s, "p2", { type: "call" });
    s = play(s, "p3", { type: "call" });
    // After the flop, the top opening bet is the pot.
    expect(pubOf(s)).toMatchObject({ step: "flop", pot: 960, currentPlayerId: "p1" });
    expect(privOf(s, "p1").legal).toMatchObject({ opening: true, minRaiseTo: 20, maxRaiseTo: 960, maxIsAllIn: false });
    s = play(s, "p1", { type: "raise", to: 960 });
    expect(s.players[1]!.stack).toBe(3000 - 240 - 960);
  });

  it("pot-limit: a stack under the limit can go all-in", () => {
    let s = table([3000, 3000, 3000, 60], { settings: omaha });
    expect(privOf(s, "p3").legal).toMatchObject({ minRaiseTo: 40, maxRaiseTo: 60, maxIsAllIn: true });
    s = play(s, "p3", { type: "all-in" });
    expect(pubOf(s).players[3]).toMatchObject({ allIn: true, bet: 60, stack: 0 });
  });

  it("pot-limit: a short all-in doesn't reopen the betting, and the next cap counts it", () => {
    let s = table([100, 3000, 3000, 3000], { settings: omaha });
    s = play(s, "p3", { type: "raise", to: 70 }); // a raise of 50
    // p0 has 100: under the cap of 240, so all-in is allowed. It raises by only 30.
    expect(privOf(s, "p0").legal).toMatchObject({ maxRaiseTo: 100, maxIsAllIn: true });
    s = play(s, "p0", { type: "all-in" });
    // The small blind owes 90, and the pot is 200: 100 + 290.
    expect(privOf(s, "p1").legal).toMatchObject({ call: 90, minRaiseTo: 150, maxRaiseTo: 390 });
    s = play(s, "p1", { type: "call" });
    s = play(s, "p2", { type: "call" });
    // p3 already acted, and the short all-in was not a full raise: call or fold only.
    expect(privOf(s, "p3").legal).toMatchObject({ call: 30, minRaiseTo: null, maxRaiseTo: null });
    expect(refuse(s, "p3", { type: "raise", to: 200 }).code).toBe("illegal-bet");
  });

  it("pot-limit: a folded player's chips count in the pot", () => {
    let s = table([3000, 3000, 3000, 3000], { settings: omaha });
    s = play(s, "p3", { type: "raise", to: 70 });
    s = play(s, "p0", { type: "call" });
    s = play(s, "p1", { type: "fold" }); // the small blind's 10 stays in
    // The big blind owes 50, and the pot is 170: 70 + 220.
    expect(privOf(s, "p2").legal).toMatchObject({ call: 50, maxRaiseTo: 290 });
  });

  it("Show after a fold-out names the hand by the 2+3 rule", () => {
    // Heads-up, deal order p1 then p0. p1 holds one heart; the board gets four.
    let s = table([1500, 1500], { settings: omaha, decks: [deck(["Qh 3s 4d 8c", "Ac 5d 6s Tc"], "Ah Kh 7h 2h 9c")] });
    s = play(s, "p0", { type: "call" });
    s = play(s, "p1", { type: "check" });
    s = play(s, "p1", { type: "check" });
    s = play(s, "p0", { type: "check" });
    s = play(s, "p1", { type: "raise", to: 20 });
    s = play(s, "p0", { type: "fold" });
    expect(s.board).toHaveLength(4);
    expect(privOf(s, "p1").canShow).toBe(true);
    s = play(s, "p1", { type: "show" });
    // All seven cards would make a flush. Two of p1's cards and three shared ones don't.
    expect(s.lastHand!.labels.p1).toBe("High card, Ace");
  });

  it("Hold'em stays no-limit", () => {
    const s = table([3000, 3000, 3000, 3000]);
    expect(pubOf(s).variant).toBe("holdem");
    expect(privOf(s, "p3").legal).toMatchObject({ maxRaiseTo: 3000, maxIsAllIn: true });
  });

  it("plays a whole game to the end, betting the pot every time", () => {
    const settings = { ...DEFAULT_SETTINGS, startingChips: 1000, variant: "omaha" as const };
    let s = he.createGame(ids(3).map((id) => ({ id })), settings, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    let hands = 0;
    for (let i = 0; i < 5000 && s.phase === "playing"; i++) {
      if (s.step === "between-hands") expect(stacks(s).reduce((a, b) => a + b, 0)).toBe(3000);
      const id = turn(s);
      if (!id) {
        s = timer(s, STEP_TIMER).state;
        continue;
      }
      const legal = privOf(s, id).legal!;
      const me = s.players.find((p) => p.id === id)!;
      if (legal.maxRaiseTo !== null) expect(legal.maxRaiseTo).toBeLessThanOrEqual(me.stack + me.bet);
      const move: HoldemAction =
        legal.maxRaiseTo === null
          ? { type: legal.call ? "call" : "check" }
          : legal.maxIsAllIn
            ? { type: "all-in" }
            : { type: "raise", to: legal.maxRaiseTo };
      s = play(s, id, move);
      hands = s.handNumber;
    }
    expect(s.phase).toBe("over");
    expect(hands).toBeGreaterThan(0);
    const result = he.getResult(s)!;
    expect(result.winnerIds).toHaveLength(1);
    expect(result.standings[0]).toMatchObject({ value: 3000 });
  });

  it("each player's four cards reach only them", () => {
    const t = he.createGame(ids(4).map((id) => ({ id })), { ...DEFAULT_SETTINGS, variant: "omaha" }, { roundNumber: 1, dealerSeat: 0 }, ctx());
    for (const p of t.state.players) {
      expect(p.hole).toHaveLength(4);
      for (const card of p.hole) {
        expect(findLeaks({ def: he, state: t.state, events: t.events, players: ids(4), secret: card.id, allowed: [p.id] })).toEqual([]);
      }
    }
  });

  it("settings: Omaha is a choice, and settings stored without one play Hold'em", () => {
    expect(he.parseSettings({})).toMatchObject({ variant: "holdem" });
    expect(he.parseSettings({ variant: "omaha" })).toMatchObject({ variant: "omaha" });
    expect(he.parseSettings({ variant: "stud" })).toBeNull();
    const old = { ...DEFAULT_SETTINGS } as Partial<HoldemSettings>;
    delete old.variant;
    const s = he.createGame(ids(3).map((id) => ({ id })), old as HoldemSettings, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(s.players.every((p) => p.hole.length === 2)).toBe(true);
    expect(pubOf(s).variant).toBe("holdem");
    expect(privOf(s, "p0").legal).toMatchObject({ maxRaiseTo: 1500, maxIsAllIn: true });
  });
});

describe("Short Deck", () => {
  const short = { variant: "shortdeck" } as const;
  const rankOf = (id: string) => {
    const r = id.split("-")[1]!;
    return r === "A" ? 14 : r === "K" ? 13 : r === "Q" ? 12 : r === "J" ? 11 : Number(r);
  };

  it("a flush beats a full house at the showdown, and A-6-7-8-9 is a straight", () => {
    // Deal order p1, p2, p0. Board: three hearts and a pair of Kings.
    let s = table([1500, 1500, 1500], {
      settings: short,
      decks: [deck(["Ah Th", "Ks 9d", "As 8c"], "Kh 9h 6h Kc 7d")],
    });
    expect(pubOf(s).variant).toBe("shortdeck");
    s = play(s, "p0", { type: "call" });
    s = play(s, "p1", { type: "call" });
    s = play(s, "p2", { type: "check" });
    for (let street = 0; street < 3; street++) for (const id of ["p1", "p2", "p0"]) s = play(s, id, { type: "check" });
    expect(s.lastHand!.labels).toEqual({
      p0: "Straight, Nine high",
      p1: "Flush, Ace high",
      p2: "Full house, Kings over Nines",
    });
    expect(s.lastHand!.pots).toEqual([{ amount: 60, winners: ["p1"], label: "Flush, Ace high" }]);
  });

  it("test decks must come from the 36 cards", () => {
    expect(() =>
      he.createGame(ids(2).map((id) => ({ id })), { ...DEFAULT_SETTINGS, ...short }, { roundNumber: 1, dealerSeat: 0 }, ctx(), { deck: ["clubs-2"] }),
    ).toThrow(/this deck/);
  });

  it("plays a whole game to the end, and only cards 6 to Ace ever show", () => {
    const settings = { ...DEFAULT_SETTINGS, startingChips: 1000, ...short };
    let s = he.createGame(ids(4).map((id) => ({ id })), settings, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    const seen = new Set<string>();
    const look = () => {
      const text = JSON.stringify([pubOf(s), ...ids(4).map((id) => privOf(s, id))]);
      for (const m of text.matchAll(/"((?:clubs|diamonds|hearts|spades)-(?:A|K|Q|J|10|[2-9]))"/g)) seen.add(m[1]!);
    };
    for (let i = 0; i < 5000 && s.phase === "playing"; i++) {
      look();
      if (s.step === "between-hands") expect(stacks(s).reduce((a, b) => a + b, 0)).toBe(4000);
      if (s.step === "preflop" && s.board.length === 0) expect(s.deck.length + s.players.filter((p) => p.inHand).length * 2).toBe(36);
      const id = turn(s);
      if (!id) {
        s = timer(s, STEP_TIMER).state;
        continue;
      }
      const legal = privOf(s, id).legal!;
      // No-limit: the top raise is all your chips.
      if (legal.maxRaiseTo !== null) expect(legal.maxIsAllIn).toBe(true);
      s = play(s, id, legal.maxRaiseTo !== null ? { type: "all-in" } : { type: legal.call ? "call" : "check" });
    }
    expect(s.phase).toBe("over");
    expect(he.getResult(s)!.winnerIds).toHaveLength(1);
    expect(seen.size).toBeGreaterThan(8);
    expect([...seen].filter((id) => rankOf(id) < 6)).toEqual([]);
  });

  it("is a choice in the settings", () => {
    expect(he.parseSettings({ variant: "shortdeck" })).toMatchObject({ variant: "shortdeck" });
  });
});
