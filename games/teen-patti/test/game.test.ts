import { STAT_KEYS, seededRandomInt, type GameContext } from "@games/game-core";
import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { ANSWER_TIMER, STEP_TIMER, TURN_TIMER, showdownMs, teenPattiGame as tp } from "../server/game.ts";
import {
  DEFAULT_SETTINGS,
  SIDESHOW_ANSWER_MS,
  type TeenPattiAction,
  type TeenPattiServerState,
  type TeenPattiSettings,
} from "../shared/types.ts";

type S = TeenPattiServerState;

const ctx = (now = 0): GameContext => ({ now, randomInt: seededRandomInt(7) });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

/** "As Kd Th" → card ids. */
function c(text: string): string[] {
  const suit = { s: "spades", h: "hearts", c: "clubs", d: "diamonds" } as const;
  return text.split(/\s+/).filter(Boolean).map((t) => `${suit[t.at(-1) as keyof typeof suit]}-${t.slice(0, -1).replace("T", "10")}`);
}

/** Hands in deal order (from the dealer's left), dealt one card at a time like a real deal. */
function deal(...hands: string[]): string[] {
  const hs = hands.map(c);
  return [0, 1, 2].flatMap((r) => hs.map((h) => h[r]!));
}

/**
 * A table with chosen stacks and dealer, at the first hand's deal. Built by
 * running the between-hands timer over a fresh game, so the deal is the real one.
 */
function table(
  stacks: number[],
  opts: { dealer?: number; decks?: string[][]; settings?: Partial<TeenPattiSettings>; now?: number; hand?: number } = {},
): S {
  const settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const s = structuredClone(tp.createGame(ids(stacks.length).map((id) => ({ id })), settings, { roundNumber: 1, dealerSeat: 0 }, ctx(opts.now)).state);
  s.players.forEach((p, i) => {
    p.stack = stacks[i]!;
  });
  s.handNumber = (opts.hand ?? 1) - 1;
  s.step = "between-hands";
  s.turnIndex = -1;
  s.dealerIndex = opts.dealer ?? 0;
  s.testDecks = opts.decks ?? null;
  return tp.onTimer!(s, STEP_TIMER, ctx(opts.now)).state;
}

function act(s: S, playerId: string, action: TeenPattiAction, now = 0) {
  const r = tp.handleAction(s, playerId, action, ctx(now));
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.transition;
}
const play = (s: S, playerId: string, action: TeenPattiAction, now = 0) => act(s, playerId, action, now).state;

function refuse(s: S, playerId: string, action: TeenPattiAction) {
  const r = tp.handleAction(s, playerId, action, ctx());
  if (r.ok) throw new Error("expected a rejection");
  return r.error;
}

const timer = (s: S, id: string, now = 0) => tp.onTimer!(s, id, ctx(now));
const pubOf = (s: S) => tp.getPublicState(s);
const privOf = (s: S, id: string) => tp.getPrivateState(s, id);
const turn = (s: S) => pubOf(s).currentPlayerId;
const stacks = (s: S) => s.players.map((p) => p.stack);
const types = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);
const stats = (s: S) => tp.partyStats!(s);

/** Packs whoever's up until the hand's over, then runs the pauses into the next deal. */
function packOut(s: S, now = 0): S {
  while (pubOf(s).currentPlayerId) s = play(s, turn(s)!, { type: "pack" }, now);
  s = timer(s, STEP_TIMER, now).state; // awarded → between-hands
  if (s.phase === "playing") s = timer(s, STEP_TIMER, now).state; // → next hand
  return s;
}

describe("dealing and the boot", () => {
  it("everyone puts in the boot, gets 3 cards face down, and play starts left of the dealer", () => {
    const t = tp.createGame(ids(4).map((id) => ({ id })), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 1 }, ctx());
    const s = t.state;
    expect(pubOf(s)).toMatchObject({ dealerId: "p1", currentPlayerId: "p2", level: 1, boot: 10, stake: 10, pot: 40, potLimit: 2560, step: "betting" });
    expect(s.players.every((p) => p.cards.length === 3 && p.contributed === 10 && !p.seen)).toBe(true);
    expect(types(t)).toEqual(["hand-start"]);
    expect(t.timers).toContainEqual({ kind: "set", timerId: TURN_TIMER, delayMs: 30_000 });
    expect(tp.getAwaitedPlayerIds(s)).toEqual(["p2"]);
    // Blind: you don't get your cards until you look.
    expect(privOf(s, "p2")).toMatchObject({ cards: [], label: null, canSee: true });
    expect(pubOf(s).players.every((p) => p.cards === null && !p.seen)).toBe(true);
  });

  it("the dealer moves one left each hand, skipping players who are out", () => {
    let s = table([1000, 1000, 1000, 1000]);
    expect(pubOf(s).dealerId).toBe("p0");
    s = packOut(s);
    expect(pubOf(s).dealerId).toBe("p1");
    s.players[2]!.out = true;
    s.players[2]!.stack = 0;
    s = packOut(s);
    expect(pubOf(s).dealerId).toBe("p3");
  });

  it("a stack shorter than the boot puts in what it has and is all-in", () => {
    const s = table([1000, 6, 1000, 1000]);
    expect(s.players[1]).toMatchObject({ contributed: 6, stack: 0, allIn: true });
    expect(pubOf(s).pot).toBe(36);
    expect(turn(s)).toBe("p2"); // the all-in player is skipped
  });

  it("the boot goes up every few hands", () => {
    let s = table([1000, 1000, 1000], { settings: { handsPerLevel: 4 } });
    for (let i = 0; i < 3; i++) s = packOut(s);
    expect(pubOf(s)).toMatchObject({ handNumber: 4, boot: 10, nextBoot: 20, handsToNextLevel: 1 });
    while (pubOf(s).currentPlayerId) s = play(s, turn(s)!, { type: "pack" });
    s = timer(s, STEP_TIMER).state;
    const t = timer(s, STEP_TIMER);
    expect(types(t)).toContain("level-up");
    expect(pubOf(t.state)).toMatchObject({ handNumber: 5, level: 2, boot: 20, stake: 20, pot: 60, potLimit: 5120 });
  });
});

describe("Blind and Seen", () => {
  it("seeing is free, you keep your turn, and only you get the cards", () => {
    const s = table([1000, 1000, 1000], { decks: [deal("Kh Kd 4s", "2c 7d 9h", "As Ah Ad")] });
    expect(turn(s)).toBe("p1");
    const t = act(s, "p1", { type: "see" });
    expect(t.events).toEqual([
      { visibility: { kind: "private", playerId: "p1" }, event: { type: "your-cards", cards: t.state.players[1]!.cards } },
      { visibility: { kind: "public" }, event: { type: "saw", playerId: "p1" } },
    ]);
    expect(turn(t.state)).toBe("p1");
    expect(stacks(t.state)).toEqual(stacks(s));
    expect(privOf(t.state, "p1")).toMatchObject({ label: "Pair of Kings", canSee: false });
    expect(privOf(t.state, "p1").cards.map((x) => x.id)).toEqual(c("Kh Kd 4s"));
    expect(pubOf(t.state).players[1]).toMatchObject({ seen: true, cards: null });
    expect(refuse(t.state, "p1", { type: "see" }).code).toBe("cant-see");
  });

  it("you can see off your turn, but not after you pack", () => {
    let s = table([1000, 1000, 1000]);
    s = play(s, "p0", { type: "see" });
    expect(turn(s)).toBe("p1");
    expect(s.players[0]!.seen).toBe(true);
    s = play(s, "p1", { type: "pack" });
    expect(refuse(s, "p1", { type: "see" }).code).toBe("cant-see");
  });

  it("Blind bets 1x or 2x the stake; Seen bets 2x or 4x; the bigger bet doubles the stake", () => {
    let s = table([1000, 1000, 1000, 1000]);
    expect(privOf(s, "p1").legal).toMatchObject({ chaal: 10, double: 20, allIn: null, show: null, sideshow: null });
    s = play(s, "p1", { type: "chaal" });
    expect(pubOf(s).stake).toBe(10);
    s = play(s, "p2", { type: "double" });
    expect(pubOf(s).stake).toBe(20);
    expect(pubOf(s).players[2]!.lastMove).toEqual({ kind: "double", amount: 20 });
    s = play(s, "p3", { type: "see" });
    expect(privOf(s, "p3").legal).toMatchObject({ chaal: 40, double: 80 });
    s = play(s, "p3", { type: "double" });
    expect(pubOf(s).stake).toBe(40);
    expect(privOf(s, "p0").legal).toMatchObject({ chaal: 40, double: 80 });
    s = play(s, "p0", { type: "chaal" });
    expect(pubOf(s)).toMatchObject({ stake: 40, pot: 40 + 10 + 20 + 80 + 40 });
    expect(stacks(s)).toEqual([950, 980, 970, 910]);
  });

  it("refuses moves out of turn and moves that aren't allowed", () => {
    const s = table([1000, 1000, 1000]);
    expect(refuse(s, "p2", { type: "chaal" }).code).toBe("not-your-turn");
    expect(refuse(s, "p1", { type: "show" }).code).toBe("illegal-move");
    expect(refuse(s, "p1", { type: "sideshow" }).code).toBe("illegal-move");
    expect(refuse(s, "p1", { type: "all-in" }).code).toBe("illegal-move");
    expect(refuse(s, "p1", { type: "accept" }).code).toBe("no-sideshow");
    expect(tp.parseAction({ type: "raise", to: 50 })).toBeNull();
    expect(tp.parseAction({ type: "see" })).toEqual({ type: "see" });
  });
});

describe("Show", () => {
  /** Three players, p0 dealer; p2 packs so p0 and p1 are left, with p1 up next round. */
  function headsUp(hands: [string, string, string], seen: { p0?: boolean; p1?: boolean } = {}) {
    let s = table([1000, 1000, 1000], { decks: [deal(...hands)] });
    if (seen.p1) s = play(s, "p1", { type: "see" });
    s = play(s, "p1", { type: "chaal" });
    s = play(s, "p2", { type: "pack" });
    if (seen.p0) s = play(s, "p0", { type: "see" });
    return s;
  }

  it("only with 2 players left", () => {
    const s = table([1000, 1000, 1000]);
    expect(privOf(s, "p1").legal!.show).toBeNull();
    expect(privOf(headsUp(["Kh Kd 4s", "2c 7d 9h", "As Ah Ad"]), "p0").legal!.show).toBe(10);
  });

  it("costs your normal bet: the Blind price, or the Seen price", () => {
    expect(privOf(headsUp(["Kh Kd 4s", "2c 7d 9h", "As Ah Ad"]), "p0").legal!.show).toBe(10);
    expect(privOf(headsUp(["Kh Kd 4s", "2c 7d 9h", "As Ah Ad"], { p0: true }), "p0").legal!.show).toBe(20);
  });

  it("both hands turn over and the better hand wins the pot", () => {
    // Deal order p1, p2, p0. p0 has the Trail.
    const s = headsUp(["Kh Kd 4s", "2c 7d 9h", "As Ah Ad"]);
    const t = act(s, "p0", { type: "show" });
    expect(types(t)).toEqual(["bet", "reveal", "awarded"]);
    expect(t.state.step).toBe("showdown");
    expect(t.state.lastHand).toMatchObject({ reason: "show", showBy: "p0", won: { p0: 50 }, order: ["p1", "p0"] });
    expect(t.state.lastHand!.labels).toEqual({ p1: "Pair of Kings", p0: "Trail of Aces" });
    expect(stacks(t.state)).toEqual([1030, 980, 990]);
    expect(t.timers).toContainEqual({ kind: "set", timerId: STEP_TIMER, delayMs: showdownMs(2) });
    expect(pubOf(t.state).players[1]!.cards!.map((x) => x.id)).toEqual(c("Kh Kd 4s"));
    expect(stats(t.state).p0).toMatchObject({ rightCalls: 1 });
  });

  it("on equal hands, the player who asked for the Show loses", () => {
    const s = headsUp(["Ks Qd 9c", "2c 7d 4h", "Kd Qh 9s"]);
    const t = act(s, "p0", { type: "show" });
    expect(t.state.lastHand!.won).toEqual({ p1: 50 });
    expect(stats(t.state).p0).toMatchObject({ wrongCalls: 1 });
  });
});

describe("Sideshow", () => {
  /** Four players, p0 dealer. p1 and p2 look and bet; p3 is next. */
  function seenPair(hands: [string, string, string, string]) {
    let s = table([1000, 1000, 1000, 1000], { decks: [deal(...hands)] });
    s = play(s, "p1", { type: "see" });
    s = play(s, "p1", { type: "chaal" });
    s = play(s, "p2", { type: "see" });
    return s;
  }

  it("needs you Seen, the player before you Seen, and 3 players left", () => {
    let s = table([1000, 1000, 1000, 1000]);
    s = play(s, "p1", { type: "chaal" }); // p1 stays Blind
    s = play(s, "p2", { type: "see" });
    expect(privOf(s, "p2").legal!.sideshow).toBeNull();
    s = play(s, "p2", { type: "chaal" });
    expect(privOf(s, "p3").legal!.sideshow).toBeNull(); // p3 is Blind
    s = play(s, "p3", { type: "see" });
    expect(privOf(s, "p3").legal!.sideshow).toEqual({ toId: "p2", cost: 20 });
  });

  it("asks the last player still in before you", () => {
    let s = seenPair(["Kh Kd 4s", "2c 7d 9h", "As Ah Ad", "5c 5d 5h"]);
    s = play(s, "p2", { type: "chaal" });
    s = play(s, "p3", { type: "pack" });
    s = play(s, "p0", { type: "see" });
    expect(privOf(s, "p0").legal!.sideshow).toEqual({ toId: "p2", cost: 20 });
  });

  it("accepted: the two compare in private and the lower hand packs", () => {
    // Deal order p1, p2, p3, p0. p2 asks p1.
    const s = seenPair(["Kh Kd 4s", "2c 7d 9h", "As Ah Ad", "5c 5d 5h"]);
    const asked = act(s, "p2", { type: "sideshow" });
    expect(types(asked)).toEqual(["bet", "sideshow-ask"]);
    expect(asked.state.step).toBe("sideshow");
    expect(asked.timers).toEqual([
      { kind: "cancel", timerId: TURN_TIMER },
      { kind: "set", timerId: ANSWER_TIMER, delayMs: SIDESHOW_ANSWER_MS },
    ]);
    expect(tp.getAwaitedPlayerIds(asked.state)).toEqual(["p1"]);
    expect(pubOf(asked.state)).toMatchObject({ currentPlayerId: null, sideshow: { fromId: "p2", toId: "p1", ms: SIDESHOW_ANSWER_MS } });
    expect(privOf(asked.state, "p1").answer).toEqual({ fromId: "p2" });
    expect(privOf(asked.state, "p1").legal).toBeNull();
    expect(refuse(asked.state, "p3", { type: "chaal" }).code).toBe("not-your-turn");
    expect(refuse(asked.state, "p2", { type: "accept" }).code).toBe("no-sideshow");

    const t = act(asked.state, "p1", { type: "accept" });
    expect(types(t)).toEqual(["sideshow-answer", "sideshow-cards", "sideshow-cards", "pack"]);
    expect(t.state.players[2]!.packed).toBe(true); // 2-7-9 loses to a pair
    expect(t.state.players[1]!.packed).toBe(false);
    expect(turn(t.state)).toBe("p3"); // play goes on after the asker
    expect(stats(t.state).p2).toMatchObject({ wrongCalls: 1 });
    // Only the two see the cards.
    for (const id of ["p1", "p2"]) {
      const secret = t.state.players[id === "p1" ? 2 : 1]!.cards[0]!.id;
      expect(findLeaks({ def: tp, state: t.state, events: t.events, players: ids(4), secret, allowed: ["p1", "p2"] })).toEqual([]);
    }
    expect(privOf(t.state, "p1").peeks).toEqual([{ playerId: "p2", cards: t.state.players[2]!.cards, label: "High card, Nine" }]);
    expect(privOf(t.state, "p2").peeks[0]!.label).toBe("Pair of Kings");
  });

  it("a win for the asker packs the asked player", () => {
    const s = seenPair(["2c 7d 9h", "Kh Kd 4s", "As Ah Ad", "5c 5d 5h"]);
    let t = act(s, "p2", { type: "sideshow" }).state;
    t = play(t, "p1", { type: "accept" });
    expect(t.players[1]!.packed).toBe(true);
    expect(stats(t).p2).toMatchObject({ rightCalls: 1 });
  });

  it("on equal hands, the player who asked packs", () => {
    const s = seenPair(["Ks Qd 9c", "Kd Qh 9s", "As Ah Ad", "5c 5d 5h"]);
    let t = act(s, "p2", { type: "sideshow" }).state;
    t = play(t, "p1", { type: "accept" });
    expect(t.players[2]!.packed).toBe(true);
    expect(t.players[1]!.packed).toBe(false);
  });

  it("refused: nobody packs, the asker's bet stays in, and play goes on", () => {
    const s = seenPair(["Kh Kd 4s", "2c 7d 9h", "As Ah Ad", "5c 5d 5h"]);
    const asked = act(s, "p2", { type: "sideshow" }).state;
    const t = act(asked, "p1", { type: "refuse" });
    expect(types(t)).toEqual(["sideshow-answer"]);
    expect(t.state.players.filter((p) => p.packed)).toEqual([]);
    expect(t.state.players[2]!.contributed).toBe(30);
    expect(turn(t.state)).toBe("p3");
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: ANSWER_TIMER });
    expect(stats(t.state).p2).toBeUndefined();
  });

  it("no answer in time is a no, and so is the host's Skip or a dropped connection", () => {
    const s = seenPair(["Kh Kd 4s", "2c 7d 9h", "As Ah Ad", "5c 5d 5h"]);
    const asked = act(s, "p2", { type: "sideshow" }).state;
    for (const t of [timer(asked, ANSWER_TIMER), tp.skipTurn!(asked, "p1", ctx()), tp.onPlayerDisconnected!(asked, "p1", ctx())]) {
      expect(t.events[0]!.event).toMatchObject({ type: "sideshow-answer", accepted: false });
      expect(turn(t.state)).toBe("p3");
      expect(t.state.players.some((p) => p.packed)).toBe(false);
    }
  });

  it("isn't offered against a player who is away", () => {
    let s = seenPair(["Kh Kd 4s", "2c 7d 9h", "As Ah Ad", "5c 5d 5h"]);
    s = tp.onPlayerDisconnected!(s, "p1", ctx()).state;
    expect(privOf(s, "p2").legal!.sideshow).toBeNull();
  });

  it("the asker leaving calls it off", () => {
    const s = seenPair(["Kh Kd 4s", "2c 7d 9h", "As Ah Ad", "5c 5d 5h"]);
    const asked = act(s, "p2", { type: "sideshow" }).state;
    const t = tp.onPlayerRemoved!(asked, "p2", ctx());
    expect(t.state).toMatchObject({ step: "betting", sideshow: null });
    expect(turn(t.state)).toBe("p3");
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: ANSWER_TIMER });
  });

  it("the asked player leaving calls it off too", () => {
    const s = seenPair(["Kh Kd 4s", "2c 7d 9h", "As Ah Ad", "5c 5d 5h"]);
    const asked = act(s, "p2", { type: "sideshow" }).state;
    const pot = pubOf(asked).pot;
    const t = tp.onPlayerRemoved!(asked, "p1", ctx());
    expect(t.state).toMatchObject({ step: "betting", sideshow: null });
    expect(t.state.players[1]).toMatchObject({ packed: true, removed: true });
    expect(t.state.players[2]!.packed).toBe(false); // the asker stays in, and the bet stays in the pot
    expect(pubOf(t.state).pot).toBe(pot);
    expect(turn(t.state)).toBe("p3");
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: ANSWER_TIMER });
    expect(types(t)).not.toContain("sideshow-cards");
  });
});

describe("all-in and side pots", () => {
  it("a short stack can't Chaal, but can go all-in, and wins the pot as it was then", () => {
    // p1 has 30 after the boot. Deal order p1, p2, p0. p1 has the best hand, p2 the next.
    let s = table([1000, 40, 1000], { decks: [deal("As Ah Ad", "Ks Kh Kd", "2c 7d 9h")] });
    s = play(s, "p1", { type: "see" });
    expect(privOf(s, "p1").legal).toMatchObject({ chaal: 20, double: null });
    s = play(s, "p1", { type: "chaal" });
    expect(s.players[1]).toMatchObject({ stack: 10, allIn: false });
    s = play(s, "p2", { type: "see" });
    s = play(s, "p2", { type: "double" }); // Seen 4x: 40, and the stake is 20
    s = play(s, "p0", { type: "chaal" }); // Blind 20
    expect(privOf(s, "p1").legal).toEqual({ chaal: null, double: null, allIn: 10, show: null, sideshow: null });
    expect(refuse(s, "p1", { type: "chaal" }).code).toBe("illegal-move");
    s = play(s, "p1", { type: "all-in" });
    expect(s.players[1]).toMatchObject({ stack: 0, allIn: true, contributed: 40 });
    expect(turn(s)).toBe("p2");
    // In: p0 30, p1 40 (all-in), p2 50. p1 can win all 120: still one pot.
    expect(pubOf(s).pots).toEqual([]);
    expect(s.allIns).toEqual([{ playerId: "p1", at: { p0: 30, p1: 40, p2: 50 } }]);
    // p2 and p0 go on into a side pot, then p2 packs: p0 and the all-in p1 show.
    s = play(s, "p2", { type: "chaal" }); // p2 in for 90
    s = play(s, "p0", { type: "chaal" }); // p0 in for 50
    expect(pubOf(s).pots).toEqual([
      { amount: 120, eligible: ["p0", "p1", "p2"] },
      { amount: 60, eligible: ["p0", "p2"] },
    ]);
    const t = act(s, "p2", { type: "pack" });
    expect(t.state.lastHand).toMatchObject({ reason: "all-in", showBy: null });
    // p1's Trail takes the 120 it could win. The side pot, p2's packed chips too, goes to p0.
    expect(t.state.lastHand!.won).toEqual({ p1: 120, p0: 60 });
    expect(stacks(t.state)).toEqual([1010, 120, 910]);
  });

  it("with 2 players left, an all-in shows both hands at once", () => {
    let s = table([1000, 30, 1000], { decks: [deal("2c 7d 9h", "Ks Kh Kd", "As Ah Ad")] });
    s = play(s, "p1", { type: "chaal" });
    s = play(s, "p2", { type: "pack" });
    s = play(s, "p0", { type: "see" });
    s = play(s, "p0", { type: "double" }); // 40: stake 20
    const t = act(s, "p1", { type: "all-in" }); // p1 has 10 left: short of 20
    expect(t.state.step).toBe("showdown");
    expect(t.state.lastHand).toMatchObject({ reason: "all-in" });
    // In: p0 50, p1 30, p2 10. p1 could win all 90, so p0 wins all 90. A Seen bet is not "more" than a Blind one.
    expect(t.state.lastHand!.won).toEqual({ p0: 90 });
    expect(stacks(t.state)).toEqual([1040, 0, 990]);
  });

  it("Seen bets against a Blind player don't come back to the Seen player who goes all-in", () => {
    // p1 (100) plays Seen, p2 Blind, p0 packs. Deal order p1, p2, p0.
    let s = table([1000, 100, 1000], { decks: [deal("Kh Kd 4s", "As Ah Ad", "2c 7d 9h")] });
    s = play(s, "p1", { type: "see" });
    s = play(s, "p1", { type: "chaal" }); // Seen 20
    s = play(s, "p2", { type: "chaal" }); // Blind 10
    s = play(s, "p0", { type: "pack" });
    for (let i = 0; i < 3; i++) {
      s = play(s, "p1", { type: "chaal" });
      s = play(s, "p2", { type: "chaal" });
    }
    expect(s.players[1]).toMatchObject({ stack: 10, contributed: 90 });
    expect(s.players[2]!.contributed).toBe(50);
    const t = act(s, "p1", { type: "all-in" });
    // p1 is in for 100, p2 for 50, p0 for 10. p2 can win the whole 160; nothing comes back to p1.
    expect(t.state.lastHand).toMatchObject({ reason: "all-in", won: { p2: 160 } });
    expect(t.state.lastHand!.pots).toEqual([{ amount: 160, winners: ["p2"], label: "Trail of Aces" }]);
    expect(stacks(t.state)).toEqual([990, 0, 1110]);
    // The loser has no chips: they are out.
    const next = timer(t.state, STEP_TIMER).state;
    expect(next.players[1]).toMatchObject({ out: true, bustedHand: 1 });
  });

  it("a Blind all-in wins the Seen bets made before it", () => {
    // p1 (30) stays Blind and goes all-in with the best hand. Deal order p1, p2, p0.
    let s = table([1000, 30, 1000], { decks: [deal("As Ah Ad", "Ks Kh Kd", "2c 7d 9h")] });
    s = play(s, "p1", { type: "chaal" }); // Blind 10: 10 left
    s = play(s, "p2", { type: "see" });
    s = play(s, "p2", { type: "double" }); // Seen 40: the stake is 20
    s = play(s, "p0", { type: "see" });
    s = play(s, "p0", { type: "chaal" }); // Seen 40
    s = play(s, "p1", { type: "all-in" }); // 10, short of 20
    // In: p0 50, p1 30, p2 50. p1 can win all 130.
    s = play(s, "p2", { type: "chaal" }); // 40
    const t = act(s, "p0", { type: "pack" });
    expect(t.state.lastHand!.pots).toEqual([
      { amount: 130, winners: ["p1"], label: "Trail of Aces" },
      { amount: 40, winners: ["p2"], label: null, uncalled: true },
    ]);
    expect(t.state.lastHand!.won).toEqual({ p1: 130 });
    expect(stacks(t.state)).toEqual([950, 130, 950]);
  });

  it("a short stack at the boot matches chips only, even while away", () => {
    // 7 players at a boot of 10; p1 has 1 chip and the best hand. Deal order p1 … p6, p0.
    const hands = ["As Ah Ad", "2c 3d 5h", "2d 3h 5s", "2h 3s 5c", "2s 3c 6d", "4c 6h 8s", "Kh Kd 4s"];
    let s = table([1000, 1, 1000, 1000, 1000, 1000, 1000], { decks: [deal(...hands)] });
    s = tp.onPlayerDisconnected!(s, "p1", ctx()).state;
    expect(pubOf(s).pot).toBe(61);
    expect(s.allIns).toEqual([{ playerId: "p1", at: { p0: 1, p1: 1, p2: 1, p3: 1, p4: 1, p5: 1, p6: 1 } }]);
    while (turn(s)) s = play(s, turn(s)!, { type: "pack" });
    // Only p0 can still bet: the hands turn over. p1 wins 1 from each player, p0 the rest.
    expect(s.lastHand).toMatchObject({ reason: "all-in", won: { p1: 7, p0: 54 } });
  });

  it("at a boot of 500, a 5-chip stack wins 35, not 3,005", () => {
    const hands = ["As Ah Ad", "2c 3d 5h", "2d 3h 5s", "2h 3s 5c", "2s 3c 6d", "4c 6h 8s", "Kh Kd 4s"];
    let s = table([100000, 5, 100000, 100000, 100000, 100000, 100000], { decks: [deal(...hands)], settings: { handsPerLevel: 4 }, hand: 37 });
    expect(pubOf(s)).toMatchObject({ boot: 500, pot: 3005 });
    while (turn(s)) s = play(s, turn(s)!, { type: "pack" });
    expect(s.lastHand!.won).toEqual({ p1: 35, p0: 2970 });
  });

  it("pots that the same players can win are one pot", () => {
    let s = table([1000, 40, 1000]);
    s = play(s, "p1", { type: "double" }); // 20: the stake is 20, 10 left
    s = play(s, "p2", { type: "chaal" });
    s = play(s, "p0", { type: "chaal" });
    s = play(s, "p1", { type: "all-in" }); // 10: p1 can win 100
    s = play(s, "p2", { type: "chaal" });
    s = play(s, "p0", { type: "chaal" });
    expect(pubOf(s).pots).toEqual([
      { amount: 100, eligible: ["p0", "p1", "p2"] },
      { amount: 40, eligible: ["p0", "p2"] },
    ]);
    // The all-in player leaves: both pots are now for p0 and p2, so they are one pot.
    s = tp.onPlayerRemoved!(s, "p1", ctx()).state;
    expect(pubOf(s)).toMatchObject({ pot: 140, pots: [] });
  });

  it("several all-ins nest side pots, in the order they happened", () => {
    // Deal order p1, p2, p3, p0. Best hand p1, then p2, then p0.
    let s = table([1000, 40, 80, 1000], { decks: [deal("As Ah Ad", "Ks Kh Kd", "2c 7d 9h", "Qs Qh 4d")] });
    s = play(s, "p1", { type: "double" }); // Blind 20: the stake is 20, 10 left
    s = play(s, "p2", { type: "chaal" }); // 20: 50 left
    s = play(s, "p3", { type: "chaal" });
    s = play(s, "p0", { type: "chaal" });
    s = play(s, "p1", { type: "all-in" }); // 10: p1 can win 130
    s = play(s, "p2", { type: "chaal" }); // 20: 30 left
    s = play(s, "p3", { type: "double" }); // 40: the stake is 40
    s = play(s, "p0", { type: "chaal" }); // 40
    s = play(s, "p2", { type: "all-in" }); // 30: p2 can win 260
    expect(s.allIns!.map((a) => a.playerId)).toEqual(["p1", "p2"]);
    s = play(s, "p3", { type: "chaal" }); // 40
    s = play(s, "p0", { type: "chaal" }); // 40
    expect(pubOf(s).pots).toEqual([
      { amount: 130, eligible: ["p0", "p1", "p2", "p3"] },
      { amount: 130, eligible: ["p0", "p2", "p3"] },
      { amount: 80, eligible: ["p0", "p3"] },
    ]);
    const t = act(s, "p3", { type: "pack" });
    expect(t.state.lastHand!.won).toEqual({ p1: 130, p2: 130, p0: 80 });
    expect(stacks(t.state)).toEqual([970, 130, 130, 890]);
  });

  it("Show is open when 2 can still bet, with an all-in player still in; the asker loses ties", () => {
    // Deal order p1, p2, p0. p2 and p0 have equal hands; p1 the worst.
    let s = table([1000, 40, 1000], { decks: [deal("2c 3d 5h", "Ks Kh 4d", "Kc Kd 4s")] });
    s = play(s, "p1", { type: "double" }); // 20: the stake is 20
    s = play(s, "p2", { type: "chaal" });
    s = play(s, "p0", { type: "chaal" });
    s = play(s, "p1", { type: "all-in" }); // 10
    expect(privOf(s, "p2").legal).toMatchObject({ show: 20, sideshow: null });
    const t = act(s, "p2", { type: "show" });
    expect(t.state.lastHand).toMatchObject({ reason: "show", showBy: "p2" });
    // Every hand still in turns over, the all-in one too.
    expect(t.state.lastHand!.order).toEqual(["p1", "p2", "p0"]);
    expect(Object.keys(t.state.lastHand!.shown).sort()).toEqual(["p0", "p1", "p2"]);
    // p2 asked and ties p0: p0 takes the main pot and the Show bet.
    expect(t.state.lastHand!.won).toEqual({ p0: 120 });
    expect(stats(t.state).p2).toEqual({ wrongCalls: 1 });
  });

  it("in a Show, the asker's equal hand splits with an all-in player", () => {
    // p1 (all-in) and p2 (the asker) have equal hands; p0, the asked player, is worse.
    let s = table([1000, 40, 1000], { decks: [deal("Ks Kh 4d", "Kc Kd 4s", "2c 3d 5h")] });
    s = play(s, "p1", { type: "double" });
    s = play(s, "p2", { type: "chaal" });
    s = play(s, "p0", { type: "chaal" });
    s = play(s, "p1", { type: "all-in" });
    const t = act(s, "p2", { type: "show" });
    // Main pot 100: p1 and p2 split it. The Show bet of 20 is a side pot for p0 and p2: p2 wins it.
    expect(t.state.lastHand!.won).toEqual({ p1: 50, p2: 70 });
    expect(stats(t.state).p2).toEqual({ rightCalls: 1 });
  });
});

describe("pot limit", () => {
  it("at 256 boots, every hand still in turns over and the best wins", () => {
    let s = table([5000, 5000, 5000], { decks: [deal("Kh Kd 4s", "2c 7d 9h", "Qs Qh Qd")] });
    s.stake = 600; // set up a big stake: Blind bets 600
    s = play(s, "p1", { type: "chaal" });
    s = play(s, "p2", { type: "chaal" });
    expect(pubOf(s).pot).toBe(1230);
    s = play(s, "p0", { type: "chaal" });
    s = play(s, "p1", { type: "chaal" });
    expect(pubOf(s).pot).toBe(2430);
    const t = act(s, "p2", { type: "chaal" });
    expect(t.events.map((e) => e.event.type)).toContain("pot-limit");
    expect(t.state.lastHand).toMatchObject({ reason: "pot-limit", won: { p0: 3030 } });
    expect(t.state.lastHand!.order).toEqual(["p1", "p2", "p0"]);
  });

  it("a Sideshow that reaches the limit shows every hand instead", () => {
    let s = table([5000, 5000, 5000], { decks: [deal("Kh Kd 4s", "2c 7d 9h", "Qs Qh Qd")] });
    s.stake = 700;
    s = play(s, "p1", { type: "see" });
    s = play(s, "p1", { type: "chaal" }); // 1400: pot 1430
    s = play(s, "p2", { type: "see" });
    const t = act(s, "p2", { type: "sideshow" }); // 1400 more: 2830
    expect(t.state).toMatchObject({ step: "showdown", sideshow: null });
    expect(t.state.lastHand!.reason).toBe("pot-limit");
  });
});

describe("ending and placing", () => {
  it("the last player with chips wins; busted players rank by when they went out", () => {
    // Hand 1: p1 (10 chips) is all-in on the boot. Deal order p1, p2, p0.
    let s = table([1000, 10, 15], { decks: [deal("2c 3d 5h", "As Ah Ad", "7c 8d Th"), deal("As Ah Ad", "2c 3d 5h")] });
    expect(turn(s)).toBe("p2");
    s = play(s, "p2", { type: "all-in" });
    // Only p0 can still bet: everyone shows. p2's Trail takes all 35.
    expect(s.step).toBe("showdown");
    expect(s.lastHand!.won).toEqual({ p2: 35 });
    s = timer(s, STEP_TIMER).state;
    expect(s.players[1]).toMatchObject({ out: true, bustedHand: 1 });
    expect(s.step).toBe("between-hands");
    s = timer(s, STEP_TIMER).state;
    // Hand 2: the dealer moves to p2, so p0 is first. p2 (35, so 25 after the boot) loses it all to p0.
    expect(s.handNumber).toBe(2);
    expect(turn(s)).toBe("p0");
    s = play(s, "p0", { type: "see" });
    s = play(s, "p0", { type: "double" }); // 40: the stake is 20
    s = play(s, "p2", { type: "chaal" }); // 20: 5 left
    s = play(s, "p0", { type: "double" }); // 80: the stake is 40
    s = play(s, "p2", { type: "all-in" });
    expect(s.step).toBe("showdown");
    s = timer(s, STEP_TIMER).state;
    expect(s.phase).toBe("over");
    const r = tp.getResult(s)!;
    expect(r.winnerIds).toEqual(["p0"]);
    expect(r.standings.map((x) => [x.playerId, x.label])).toEqual([
      ["p0", "1,025 chips"],
      ["p2", "out 2nd"],
      ["p1", "out 3rd"],
    ]);
  });

  it("with a time cap, the hand finishes and the biggest stack wins", () => {
    let s = table([1000, 1200, 800], { settings: { ending: 20 } });
    expect(pubOf(s).capEndsAt).toBe(20 * 60_000);
    const late = 20 * 60_000 + 1;
    while (pubOf(s).currentPlayerId) s = play(s, turn(s)!, { type: "pack" }, late);
    const t = timer(s, STEP_TIMER, late);
    expect(t.state.phase).toBe("over");
    expect(t.state.endReason).toBe("time");
    expect(tp.getResult(t.state)!.winnerIds).toEqual(["p1"]);
  });

  it("a leaver packs mid-hand; their chips in the pot stay", () => {
    let s = table([1000, 1000, 1000]);
    s = play(s, "p1", { type: "chaal" });
    const t = tp.onPlayerRemoved!(s, "p2", ctx());
    expect(types(t)).toEqual(["player-removed", "pack"]);
    expect(turn(t.state)).toBe("p0");
    expect(pubOf(t.state).pot).toBe(40);
    const left = tp.onPlayerRemoved!(t.state, "p1", ctx());
    expect(left.state.phase).toBe("over");
    expect(left.state.endReason).toBe("abandoned");
    expect(tp.getResult(left.state)!.winnerIds).toEqual(["p0"]);
  });
});

describe("turn clock and sitting out", () => {
  it("the clock packs you; twice in a row and you sit out until you're back", () => {
    let s = table([1000, 1000, 1000]);
    let t = timer(s, TURN_TIMER);
    expect(t.events[0]!.event).toEqual({ type: "pack", playerId: "p1", reason: "timer" });
    s = packOut(t.state);
    // Hand 2: p2 is up first, then p0, then p1.
    s = play(s, "p2", { type: "chaal" });
    s = play(s, "p0", { type: "chaal" });
    t = timer(s, TURN_TIMER);
    expect(types(t)).toEqual(["pack", "sitting-out"]);
    expect(privOf(t.state, "p1").canBack).toBe(true);
    s = packOut(t.state);
    // Hand 3: p1 is sitting out and packs on the spot when it's their turn.
    expect(turn(s)).toBe("p0");
    const auto = act(s, "p0", { type: "chaal" });
    expect(auto.events.at(-1)!.event).toEqual({ type: "pack", playerId: "p1", reason: "sitting-out" });
    expect(turn(auto.state)).toBe("p2");
    s = play(s, "p1", { type: "back" });
    expect(s.players[1]!.sittingOut).toBe(false);
  });

  it("the host's Skip packs the turn player", () => {
    const s = table([1000, 1000, 1000]);
    const t = tp.skipTurn!(s, "p1", ctx());
    expect(t.events[0]!.event).toEqual({ type: "pack", playerId: "p1", reason: "skip" });
    expect(turn(t.state)).toBe("p2");
    expect(tp.skipTurn!(s, "p2", ctx()).state).toBe(s);
  });
});

describe("pause", () => {
  it("moves the turn, the Sideshow answer, the pause between hands and the time cap on by the time paused", () => {
    const s = table([1000, 1000, 1000, 1000], { settings: { ending: 30 }, now: 1000 });
    const paused = tp.pause!(s, true, ctx(5000)).state;
    expect(pubOf(paused).pausedAt).toBe(5000);
    const resumed = tp.pause!(paused, false, ctx(65_000)).state;
    expect(resumed.deadline).toBe(s.deadline + 60_000);
    expect(pubOf(resumed).capEndsAt).toBe(pubOf(s).capEndsAt! + 60_000);
    expect(resumed.pausedAt).toBeNull();

    let a = play(s, "p1", { type: "see" });
    a = play(a, "p1", { type: "chaal" });
    a = play(a, "p2", { type: "see" });
    a = play(a, "p2", { type: "sideshow" }, 2000);
    const back = tp.pause!(tp.pause!(a, true, ctx(3000)).state, false, ctx(13_000)).state;
    expect(back.sideshow!.deadline).toBe(2000 + SIDESHOW_ANSWER_MS + 10_000);

    // Resuming what wasn't paused changes nothing.
    expect(tp.pause!(s, false, ctx(9000)).state).toBe(s);
  });
});

describe("settings", () => {
  it("reads good settings and refuses bad ones", () => {
    expect(tp.parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(tp.parseSettings({ startingChips: 2000, handsPerLevel: 4, ending: 45, turnSeconds: 20 })).toEqual({
      startingChips: 2000,
      handsPerLevel: 4,
      ending: 45,
      turnSeconds: 20,
    });
    expect(tp.parseSettings({ startingChips: 1234 })).toBeNull();
    expect(tp.parseSettings({ handsPerLevel: 5 })).toBeNull();
    expect(tp.parseSettings({ ending: 10 })).toBeNull();
    expect(tp.parseSettings({ turnSeconds: 5 })).toBeNull();
    expect(tp.parseSettings([])).toBeNull();
    expect(tp.parseSettings({ extra: true })).toEqual(DEFAULT_SETTINGS);
  });

  it("starting chips set every stack", () => {
    const s = tp.createGame(ids(3).map((id) => ({ id })), { ...DEFAULT_SETTINGS, startingChips: 2000 }, { roundNumber: 1, dealerSeat: 0 }, ctx()).state;
    expect(s.players.map((p) => p.stack + p.contributed)).toEqual([2000, 2000, 2000]);
  });

  it("needs 3 to 7 players", () => {
    expect(() => tp.createGame(ids(2).map((id) => ({ id })), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow();
    expect(() => tp.createGame(ids(8).map((id) => ({ id })), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow();
  });
});

describe("party stats", () => {
  it("a Seen bet on a high card is a lie, once per hand; winning when all pack leaves it uncaught", () => {
    let s = table([1000, 1000, 1000], { decks: [deal("2c 7d 9h", "Kh Kd 4s", "As 3h 8d")] });
    s = play(s, "p1", { type: "see" });
    s = play(s, "p1", { type: "chaal" });
    s = play(s, "p2", { type: "pack" });
    s = play(s, "p0", { type: "chaal" });
    s = play(s, "p1", { type: "double" });
    expect(stats(s).p1).toEqual({ liesTold: 1 });
    s = play(s, "p0", { type: "pack" });
    expect(stats(s).p1).toEqual({ liesTold: 1, liesUncaught: 1 });
  });

  it("a lie caught in a Sideshow isn't uncaught, even if the liar wins later", () => {
    // Deal order p1, p2, p3, p0. p2 bluffs on a high card and wins the Sideshow against p1's worse one.
    let s = table([1000, 1000, 1000, 1000], { decks: [deal("2c 4d 7h", "Kc 9d 3h", "5c 6d 9s", "Js 2h 3d")] });
    s = play(s, "p1", { type: "see" });
    s = play(s, "p1", { type: "chaal" });
    s = play(s, "p2", { type: "see" });
    s = play(s, "p2", { type: "chaal" });
    s = play(s, "p3", { type: "pack" });
    s = play(s, "p0", { type: "pack" });
    s = play(s, "p1", { type: "pack" });
    expect(s.lastHand!.won).toEqual({ p2: 80 });
    expect(stats(s).p2).toEqual({ liesTold: 1, liesUncaught: 1 });

    let u = table([1000, 1000, 1000, 1000], { decks: [deal("2c 4d 7h", "Kc 9d 3h", "5c 6d 9s", "Js 2h 3d")] });
    u = play(u, "p1", { type: "see" });
    u = play(u, "p1", { type: "chaal" });
    u = play(u, "p2", { type: "see" });
    u = play(u, "p2", { type: "sideshow" });
    u = play(u, "p1", { type: "accept" });
    expect(u.players[1]!.packed).toBe(true);
    u = play(u, "p3", { type: "pack" });
    u = play(u, "p0", { type: "pack" });
    expect(u.lastHand!.won).toEqual({ p2: 80 });
    expect(stats(u).p2).toEqual({ rightCalls: 1 });
    expect(stats(u).p1).toEqual({ liesTold: 1 });
  });

  it("a Blind Chaal or Double once the pot is past 20 boots is a big bet, once per hand", () => {
    let s = table([1000, 1000, 1000]);
    s = play(s, "p1", { type: "double" }); // 20, stake 20
    s = play(s, "p2", { type: "double" }); // 40, stake 40
    expect(pubOf(s).pot).toBe(90);
    s = play(s, "p0", { type: "double" }); // 80: pot 170
    s = play(s, "p1", { type: "chaal" }); // 80 into a pot of 170: not past 200 before the bet
    expect(stats(s)).toEqual({});
    s = play(s, "p2", { type: "chaal" }); // 80 into a pot of 250
    expect(stats(s)).toEqual({ p2: { bigBids: 1 } }); // only the player who bet
    s = play(s, "p0", { type: "see" });
    s = play(s, "p0", { type: "chaal" }); // Seen: not a Blind bet
    s = play(s, "p1", { type: "chaal" });
    s = play(s, "p2", { type: "chaal" }); // again: still once
    const big = (id: string) => stats(s)[id]?.bigBids ?? 0;
    expect([big("p0"), big("p1"), big("p2")]).toEqual([0, 1, 1]);
  });

  it("never shows in the public or private state", () => {
    let s = table([1000, 1000, 1000], { decks: [deal("2c 7d 9h", "Kh Kd 4s", "As 3h 8d")] });
    s = play(s, "p1", { type: "see" });
    s = play(s, "p1", { type: "chaal" });
    s = play(s, "p2", { type: "pack" });
    expect(Object.keys(stats(s)).length).toBeGreaterThan(0);
    const views = JSON.stringify([pubOf(s), ...ids(3).map((id) => privOf(s, id))]);
    for (const key of STAT_KEYS) expect(views).not.toContain(key);
    expect(views).not.toContain('"lied"');
  });
});

describe("hidden cards", () => {
  it("nobody sees a Blind hand, not even its owner; a Seen hand only reaches its owner", () => {
    const t = tp.createGame(ids(3).map((id) => ({ id })), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(), {
      deck: deal("Kh Kd 4s", "2c 7d 9h", "As Ah Ad"),
    });
    for (const secret of c("Kh Kd 4s")) {
      expect(findLeaks({ def: tp, state: t.state, events: t.events, players: ids(3), secret, allowed: [] })).toEqual([]);
    }
    const seen = act(t.state, "p1", { type: "see" });
    for (const secret of c("Kh Kd 4s")) {
      expect(findLeaks({ def: tp, state: seen.state, events: seen.events, players: ids(3), secret, allowed: ["p1"] })).toEqual([]);
    }
  });
});

describe("a whole game through the server", () => {
  it("plays hands to the end, with chips kept the same all the way", () => {
    let s = tp.createGame(ids(4).map((id) => ({ id })), { ...DEFAULT_SETTINGS, startingChips: 500, handsPerLevel: 4 }, { roundNumber: 1, dealerSeat: 2 }, ctx()).state;
    const total = 2000;
    let now = 0;
    for (let step = 0; step < 5000 && s.phase === "playing"; step++) {
      now += 100;
      const chips = s.players.reduce((sum, p) => sum + p.stack + (s.step === "betting" || s.step === "sideshow" ? p.contributed : 0), 0);
      expect(chips).toBe(total);
      if (s.step === "sideshow") {
        s = play(s, s.sideshow!.toId, { type: step % 2 ? "accept" : "refuse" }, now);
        continue;
      }
      const id = turn(s);
      if (!id) {
        s = timer(s, STEP_TIMER, now).state;
        continue;
      }
      const legal = privOf(s, id).legal!;
      const pick: TeenPattiAction =
        step % 7 === 0 && privOf(s, id).canSee ? { type: "see" }
        : legal.sideshow && step % 3 === 0 ? { type: "sideshow" }
        : legal.show !== null && step % 5 === 0 ? { type: "show" }
        : legal.allIn !== null ? { type: "all-in" }
        : step % 11 === 0 ? { type: "pack" }
        : legal.double !== null && step % 4 === 0 ? { type: "double" }
        : { type: "chaal" };
      s = play(s, id, pick, now);
    }
    expect(s.phase).toBe("over");
    const r = tp.getResult(s)!;
    expect(r.winnerIds).toHaveLength(1);
    expect(r.standings[0]).toMatchObject({ playerId: r.winnerIds[0], value: total });
  });
});
