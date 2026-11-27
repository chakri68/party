import { seededRandomInt, type GameContext } from "@games/game-core";
import { findLeaks } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { blackjackGame as bj, DEALER_MS, SETTLE_MS, STEP_TIMER, TURN_TIMER } from "../server/game.ts";
import {
  DEFAULT_SETTINGS,
  RESHUFFLE_AT,
  SHOE_CARDS,
  type BlackjackAction,
  type BlackjackEvent,
  type BlackjackServerState,
  type BlackjackSettings,
  type MoveKind,
} from "../shared/types.ts";

type State = BlackjackServerState;

let clock = 1_000_000;
const ctx = (): GameContext => ({ now: clock, randomInt: seededRandomInt(7) });

function start(opts: { players?: number; deck?: string[]; settings?: Partial<BlackjackSettings> } = {}) {
  clock = 1_000_000;
  const ids = Array.from({ length: opts.players ?? 2 }, (_, i) => `p${i + 1}`);
  const t = bj.createGame(ids.map((id) => ({ id })), { ...DEFAULT_SETTINGS, ...opts.settings }, { roundNumber: 1, dealerSeat: 0 }, ctx(), {
    deck: opts.deck ?? [],
  });
  return { state: t.state, ids, events: t.events.map((e) => e.event) as BlackjackEvent[] };
}

/** A move without `cards` names the hand's size as it is now, as a fresh screen would. */
type Move = { type: MoveKind; hand: number; cards?: number };
type Loose = Exclude<BlackjackAction, { type: MoveKind }> | Move;

function fill(state: State, id: string, action: Loose): BlackjackAction {
  if (!("hand" in action) || action.cards !== undefined) return action as BlackjackAction;
  const cards = state.players.find((p) => p.id === id)!.hands.reduce((n, h) => n + h.cards.length, 0);
  return { ...action, cards };
}

function act(state: State, id: string, loose: Loose) {
  const action = fill(state, id, loose);
  const r = bj.handleAction(state, id, action, ctx());
  if (!r.ok) throw new Error(`${id} ${JSON.stringify(action)}: ${r.error.message}`);
  return { state: r.transition.state, events: r.transition.events.map((e) => e.event) as BlackjackEvent[], timers: r.transition.timers ?? [] };
}

function refuse(state: State, id: string, loose: Loose): string {
  const action = fill(state, id, loose);
  const r = bj.handleAction(state, id, action, ctx());
  if (r.ok) throw new Error(`${id} ${JSON.stringify(action)} was allowed`);
  return r.error.message;
}

function fire(state: State, timer: string, advance = 0) {
  clock += advance;
  const t = bj.onTimer!(state, timer, ctx());
  return { state: t.state, events: t.events.map((e) => e.event) as BlackjackEvent[] };
}

/** Dealer beats until the pay, then the pause after it: the next round's betting (or the end). */
function finishRound(state: State) {
  const events: BlackjackEvent[] = [];
  let s = state;
  for (let i = 0; i < 12 && s.step === "dealer"; i++) {
    const t = fire(s, STEP_TIMER, DEALER_MS);
    s = t.state;
    events.push(...t.events);
  }
  expect(s.step).toBe("settle");
  const t = fire(s, STEP_TIMER, SETTLE_MS);
  return { state: t.state, events: [...events, ...t.events] };
}

const stackOf = (s: State, id: string) => s.players.find((p) => p.id === id)!.stack;
const pub = (s: State) => bj.getPublicState(s);

describe("a round", () => {
  it("bets at once, splits, doubles, and the dealer busts", () => {
    // Deal order: p1, p2, dealer up, p1, p2, dealer down. Then draws as they happen.
    let { state } = start({
      deck: ["hearts-8", "clubs-5", "spades-6", "diamonds-8", "hearts-6", "spades-10", "clubs-3", "hearts-10", "spades-9", "diamonds-10", "clubs-K"],
    });
    expect(state.step).toBe("betting");
    expect(bj.getAwaitedPlayerIds(state)).toEqual(["p1", "p2"]);
    expect(bj.getPrivateState(state, "p1").bet).toEqual({ min: 10, max: 1000 });

    state = act(state, "p1", { type: "bet", amount: 100 }).state;
    expect(bj.getAwaitedPlayerIds(state)).toEqual(["p2"]);
    expect(refuse(state, "p1", { type: "bet", amount: 50 })).toBe("You already bet.");
    expect(refuse(state, "p2", { type: "bet", amount: 5 })).toBe("Bet from 10 to 1,000.");
    expect(refuse(state, "p2", { type: "bet", amount: 1001 })).toBe("Bet from 10 to 1,000.");
    const dealt = act(state, "p2", { type: "bet", amount: 50 });
    state = dealt.state;
    expect(dealt.events.map((e) => e.type)).toEqual(["bet", "deal"]);
    expect(state.step).toBe("play");
    // Both play at the same time.
    expect(bj.getAwaitedPlayerIds(state)).toEqual(["p1", "p2"]);
    // The face-down card stays hidden.
    expect(pub(state).dealer).toEqual({ cards: [expect.objectContaining({ id: "spades-6" }), null], total: 6, soft: false, blackjack: false });
    expect(JSON.stringify(pub(state))).not.toContain("spades-10");

    expect(bj.getPrivateState(state, "p1").moves).toEqual({ hand: 0, cards: 2, hit: true, stand: true, double: true, split: true });
    expect(bj.getPrivateState(state, "p2").moves).toMatchObject({ hand: 0, double: true, split: false });
    expect(refuse(state, "p2", { type: "split", hand: 0 })).toBe("You can split only 2 cards of the same rank.");

    state = act(state, "p1", { type: "split", hand: 0 }).state;
    const me = state.players[0]!;
    expect(me.hands.map((h) => h.cards.map((c) => c.id))).toEqual([["hearts-8", "clubs-3"], ["diamonds-8", "hearts-10"]]);
    expect(me.stack).toBe(800);
    expect(refuse(state, "p1", { type: "hit", hand: 1 })).toBe("That hand is done.");
    expect(bj.getPrivateState(state, "p1").moves).toMatchObject({ hand: 0, split: false, double: true });

    state = act(state, "p2", { type: "double", hand: 0 }).state;
    expect(state.players[1]!.hands[0]).toMatchObject({ bet: 100, doubled: true, done: true });
    expect(bj.getAwaitedPlayerIds(state)).toEqual(["p1"]);

    state = act(state, "p1", { type: "double", hand: 0 }).state;
    expect(state.players[0]!.hands[0]!.cards.map((c) => c.id)).toEqual(["hearts-8", "clubs-3", "diamonds-10"]);
    const last = act(state, "p1", { type: "stand", hand: 1 });
    state = last.state;
    expect(state.step).toBe("dealer");
    expect(last.events.map((e) => e.type)).toEqual(["move", "dealer-reveal"]);
    expect(last.timers).toContainEqual({ kind: "cancel", timerId: TURN_TIMER });

    const drew = fire(state, STEP_TIMER, DEALER_MS);
    expect(drew.events).toEqual([{ type: "dealer-draw", card: expect.objectContaining({ id: "clubs-K" }) }]);
    const paid = fire(drew.state, STEP_TIMER, DEALER_MS);
    state = paid.state;
    expect(state.step).toBe("settle");
    expect(paid.events[0]).toMatchObject({ type: "settled", dealerTotal: 26, dealerBust: true });
    // p1: 100 left of 1000 in, two wins (200 on the doubled hand) come back as 400 + 200.
    expect(stackOf(state, "p1")).toBe(1300);
    expect(stackOf(state, "p2")).toBe(1100);

    const next = fire(state, STEP_TIMER, SETTLE_MS).state;
    expect(next.step).toBe("betting");
    expect(next.round).toBe(2);
    expect(next.players[0]!.hands).toEqual([]);
  });

  it("ends at once when the dealer peeks a Blackjack: a player Blackjack ties, the rest lose", () => {
    let { state } = start({ deck: ["hearts-A", "clubs-10", "spades-A", "diamonds-Q", "hearts-9", "spades-K"] });
    state = act(state, "p1", { type: "bet", amount: 100 }).state;
    const t = act(state, "p2", { type: "bet", amount: 100 });
    state = t.state;
    expect(t.events.map((e) => e.type)).toEqual(["bet", "deal", "peek", "dealer-reveal", "settled"]);
    expect(t.events).toContainEqual({ type: "peek", blackjack: true });
    expect(state.step).toBe("settle");
    expect(stackOf(state, "p1")).toBe(1000);
    expect(stackOf(state, "p2")).toBe(900);
    expect(pub(state).dealer.blackjack).toBe(true);
  });

  it("says when the dealer peeked and found nothing, and pays a Blackjack 3 to 2 rounded down", () => {
    let { state } = start({ players: 1, deck: ["hearts-A", "spades-10", "diamonds-K", "hearts-7"] });
    const t = act(state, "p1", { type: "bet", amount: 15 });
    state = t.state;
    expect(t.events).toContainEqual({ type: "peek", blackjack: false });
    // A Blackjack has nothing to play: straight to the dealer, who has 17 and stands.
    expect(state.step).toBe("dealer");
    const paid = fire(state, STEP_TIMER, DEALER_MS);
    expect(paid.state.step).toBe("settle");
    expect(paid.state.players[0]!.hands[0]).toMatchObject({ result: "blackjack", paid: 37 });
    expect(stackOf(paid.state, "p1")).toBe(1000 - 15 + 37);
  });

  it("the dealer takes no cards when every hand is bust", () => {
    let { state } = start({ players: 1, deck: ["hearts-10", "spades-5", "diamonds-6", "hearts-2", "clubs-K"] });
    state = act(state, "p1", { type: "bet", amount: 10 }).state;
    state = act(state, "p1", { type: "hit", hand: 0 }).state;
    expect(state.step).toBe("dealer");
    const t = fire(state, STEP_TIMER, DEALER_MS);
    expect(t.state.dealer.cards).toHaveLength(2);
    expect(t.state.players[0]!.hands[0]!.result).toBe("bust");
  });

  it("split Aces get one card each, and 21 there pays only 1 to 1", () => {
    let { state } = start({ players: 1, deck: ["hearts-A", "spades-9", "diamonds-A", "hearts-8", "clubs-K", "clubs-5"] });
    state = act(state, "p1", { type: "bet", amount: 100 }).state;
    state = act(state, "p1", { type: "split", hand: 0 }).state;
    expect(state.players[0]!.hands.map((h) => [h.cards.length, h.done])).toEqual([[2, true], [2, true]]);
    expect(state.step).toBe("dealer");
    // Dealer: 9 and 8, 17, stands. 21 and 16.
    state = fire(state, STEP_TIMER, DEALER_MS).state;
    expect(state.players[0]!.hands.map((h) => h.result)).toEqual(["win", "lose"]);
    expect(stackOf(state, "p1")).toBe(1000);
  });

  it("splits once a round, and needs the chips for it", () => {
    let { state } = start({ players: 1, deck: ["hearts-8", "spades-9", "diamonds-8", "hearts-7", "clubs-8", "clubs-8"] });
    state = act(state, "p1", { type: "bet", amount: 600 }).state;
    expect(bj.getPrivateState(state, "p1").moves).toMatchObject({ split: false, double: false });
    expect(refuse(state, "p1", { type: "split", hand: 0 })).toBe("You need more chips to split.");
    expect(refuse(state, "p1", { type: "double", hand: 0 })).toBe("You need more chips to double.");

    ({ state } = start({ players: 1, deck: ["hearts-8", "spades-9", "diamonds-8", "hearts-7", "clubs-8", "clubs-3"] }));
    state = act(state, "p1", { type: "bet", amount: 100 }).state;
    state = act(state, "p1", { type: "split", hand: 0 }).state;
    // 8 and 8 again on the first hand: no second split.
    expect(bj.getPrivateState(state, "p1").moves).toMatchObject({ hand: 0, split: false, double: true });
    expect(refuse(state, "p1", { type: "split", hand: 0 })).toBe("You can split only once a round.");
  });

  it("counts a bust, at once, and keeps the count out of every view", () => {
    let { state } = start({ deck: ["hearts-10", "clubs-10", "spades-9", "diamonds-6", "hearts-9", "spades-8", "clubs-K"] });
    state = act(state, "p1", { type: "bet", amount: 50 }).state;
    state = act(state, "p2", { type: "bet", amount: 50 }).state;
    const t = act(state, "p1", { type: "hit", hand: 0 });
    state = t.state;
    expect(t.events).toContainEqual({ type: "bust", playerId: "p1", hand: 0, total: 26 });
    expect(state.players[0]!.hands[0]!.done).toBe(true);
    expect(bj.partyStats!(state)).toEqual({ p1: { busts: 1 } });
    expect(findLeaks({ def: bj, state, events: [], players: ["p1", "p2"], secret: "busts", allowed: [] })).toEqual([]);
    expect(findLeaks({ def: bj, state, events: [], players: ["p1", "p2"], secret: "stats", allowed: [] })).toEqual([]);
  });

  it("a double that goes over counts as a bust", () => {
    let { state } = start({ players: 1, deck: ["hearts-10", "spades-9", "diamonds-2", "hearts-8", "clubs-K"] });
    state = act(state, "p1", { type: "bet", amount: 50 }).state;
    state = act(state, "p1", { type: "double", hand: 0 }).state;
    expect(state.players[0]!.hands[0]).toMatchObject({ bet: 100, doubled: true, done: true });
    expect(bj.partyStats!(state)).toEqual({ p1: { busts: 1 } });
  });
});

describe("clocks", () => {
  it("no bet in time sits you out; two in a row and the table stops waiting", () => {
    const round = ["hearts-10", "clubs-9", "spades-7", "diamonds-8"];
    let { state } = start({ deck: [...round, ...round] });
    state = act(state, "p1", { type: "bet", amount: 10 }).state;
    const t = fire(state, TURN_TIMER, 20_000);
    expect(t.events).toContainEqual({ type: "sit-out", playerId: "p2", auto: "timer" });
    state = t.state;
    expect(state.step).toBe("play");
    expect(state.players[1]!.hands).toEqual([]);
    // Out of time playing: you stand.
    const stood = fire(state, TURN_TIMER, 20_000);
    expect(stood.events).toContainEqual(expect.objectContaining({ type: "move", playerId: "p1", kind: "stand", auto: "timer" }));
    ({ state } = finishRound(stood.state));
    expect(state.round).toBe(2);
    state = act(state, "p1", { type: "bet", amount: 10 }).state;
    state = fire(state, TURN_TIMER, 20_000).state;
    state = fire(state, TURN_TIMER, 20_000).state;
    ({ state } = finishRound(state));
    // p2 missed twice: p1's bet alone deals.
    expect(pub(state).players[1]!.sittingOut).toBe(true);
    expect(bj.getAwaitedPlayerIds(state)).toEqual(["p1"]);
    expect(bj.getPrivateState(state, "p2").bet).not.toBeNull();
    // Betting again brings them back.
    state = act(state, "p2", { type: "bet", amount: 10 }).state;
    expect(state.players[1]!.missed).toBe(0);
  });

  it("with no bet at all, the clock still runs out before the next round", () => {
    let { state } = start({ players: 1 });
    expect(bj.getAwaitedPlayerIds(state)).toEqual(["p1"]);
    const t = fire(state, TURN_TIMER, 20_000);
    expect(t.events).toContainEqual({ type: "settled", results: [], dealerTotal: 0, dealerBust: false });
    state = fire(t.state, STEP_TIMER, 2000).state;
    expect(state.round).toBe(2);
  });

  it("the host's Skip sits out a bet, and stands a hand", () => {
    let { state } = start({ deck: ["hearts-10", "clubs-5", "spades-9", "diamonds-6"] });
    state = act(state, "p1", { type: "bet", amount: 10 }).state;
    state = bj.skipTurn!(state, "p2", ctx()).state;
    expect(state.step).toBe("play");
    const t = bj.skipTurn!(state, "p1", ctx());
    expect(t.events.map((e) => e.event)).toContainEqual(expect.objectContaining({ type: "move", playerId: "p1", kind: "stand", auto: "skip" }));
    expect(t.state.step).toBe("dealer");
  });

  it("pause moves the clock on by the time paused", () => {
    let { state } = start();
    const D = state.deadline;
    clock += 5000;
    state = bj.pause!(state, true, ctx()).state;
    expect(pub(state).pausedAt).toBe(clock);
    clock += 60_000;
    state = bj.pause!(state, false, ctx()).state;
    expect(state.deadline).toBe(D + 60_000);
    expect(state.pausedAt).toBeNull();
  });
});

describe("pause in the dealer's turn", () => {
  it("moves the dealer's beat on, and leaves the stopped clock alone", () => {
    let { state } = start({ players: 1, deck: ["hearts-10", "spades-6", "diamonds-7", "hearts-9", "clubs-5"] });
    state = act(state, "p1", { type: "bet", amount: 10 }).state;
    state = act(state, "p1", { type: "stand", hand: 0 }).state;
    expect(state.step).toBe("dealer");
    const beat = state.stepEndsAt;
    expect(state.deadline).toBe(0);
    clock += 300;
    state = bj.pause!(state, true, ctx()).state;
    clock += 45_000;
    state = bj.pause!(state, false, ctx()).state;
    expect(state.stepEndsAt).toBe(beat + 45_000);
    expect(state.deadline).toBe(0);
    expect(pub(state).clock).toBeNull();
    // The room fires the held timer on resume: the dealer goes on from there.
    const t = fire(state, STEP_TIMER, DEALER_MS - 300);
    expect(t.events).toEqual([{ type: "dealer-draw", card: expect.objectContaining({ id: "clubs-5" }) }]);
    expect(t.state.stepEndsAt).toBe(clock + DEALER_MS);
  });
});

describe("chips and the end", () => {
  it("rebuys once in the first half", () => {
    let { state } = start({ players: 1, settings: { rebuys: "one" }, deck: ["hearts-10", "spades-10", "diamonds-6", "hearts-9"] });
    state = act(state, "p1", { type: "bet", amount: 1000 }).state;
    state = act(state, "p1", { type: "stand", hand: 0 }).state;
    const end = finishRound(state);
    state = end.state;
    expect(end.events).toContainEqual({ type: "busted", playerIds: ["p1"], rebuy: ["p1"] });
    expect(state.round).toBe(2);
    expect(bj.getPrivateState(state, "p1")).toMatchObject({ canRebuy: true, bet: null });
    expect(bj.getAwaitedPlayerIds(state)).toEqual(["p1"]);
    expect(refuse(state, "p1", { type: "bet", amount: 10 })).toBe("Rebuy first.");
    state = act(state, "p1", { type: "rebuy" }).state;
    expect(stackOf(state, "p1")).toBe(1000);
    expect(bj.getPrivateState(state, "p1")).toMatchObject({ canRebuy: false, bet: { min: 10, max: 1000 } });
    expect(state.players[0]!.rebuysUsed).toBe(1);
  });

  it("staying out ends the game when nobody else has chips", () => {
    let { state } = start({ players: 1, settings: { rebuys: "one" }, deck: ["hearts-10", "spades-10", "diamonds-6", "hearts-9"] });
    state = act(state, "p1", { type: "bet", amount: 1000 }).state;
    state = act(state, "p1", { type: "stand", hand: 0 }).state;
    state = finishRound(state).state;
    const t = act(state, "p1", { type: "stay-out" });
    expect(t.state.phase).toBe("over");
    expect(t.events).toContainEqual({ type: "game-over", winnerIds: [], reason: "everyone-out" });
    expect(bj.getResult(t.state)).toMatchObject({ winnerIds: [], standings: [{ playerId: "p1", value: 0, label: "out in round 1" }] });
  });

  it("no rebuy after the first half, or with rebuys off", () => {
    let { state } = start({ players: 2, deck: ["hearts-10", "clubs-2", "spades-10", "diamonds-6", "clubs-3", "hearts-9"] });
    state = act(state, "p1", { type: "bet", amount: 1000 }).state;
    state = act(state, "p2", { type: "bet", amount: 10 }).state;
    state = act(state, "p1", { type: "stand", hand: 0 }).state;
    state = act(state, "p2", { type: "stand", hand: 0 }).state;
    const end = finishRound(state);
    expect(end.events).toContainEqual({ type: "busted", playerIds: ["p1"], rebuy: [] });
    expect(end.state.players[0]!.out).toBe(true);
    expect(bj.getAwaitedPlayerIds(end.state)).toEqual(["p2"]);

    ({ state } = start({ players: 2, settings: { rebuys: "one" } }));
    state.round = 6;
    state.players[0]!.stack = 0;
    state.players[0]!.bet = 0;
    state.step = "settle";
    const late = fire(state, STEP_TIMER, SETTLE_MS);
    expect(late.events).toContainEqual({ type: "busted", playerIds: ["p1"], rebuy: [] });
  });

  it("ends after the last round, most chips first", () => {
    let { state } = start({ settings: { rounds: 10 } });
    for (let r = 1; r <= 10; r++) {
      expect(state.round).toBe(r);
      state = act(state, "p1", { type: "bet", amount: 10 }).state;
      state = act(state, "p2", { type: "bet", amount: 20 }).state;
      if (state.step === "play") state = fire(state, TURN_TIMER, 20_000).state;
      if (state.step !== "settle") state = finishRound(state).state;
      else state = fire(state, STEP_TIMER, SETTLE_MS).state;
    }
    expect(state.phase).toBe("over");
    expect(state.endReason).toBe("rounds");
    const result = bj.getResult(state)!;
    const [a, b] = result.standings;
    expect(a!.value).toBeGreaterThanOrEqual(b!.value);
    expect(a!.label).toMatch(/chips$/);
    expect(result.winnerIds).toContain(a!.playerId);
  });

  it("shuffles the shoe again when three quarters are used, and says so", () => {
    let { state } = start({ players: 1, deck: ["hearts-10", "spades-10", "diamonds-7", "hearts-8"] });
    state = act(state, "p1", { type: "bet", amount: 10 }).state;
    state = act(state, "p1", { type: "stand", hand: 0 }).state;
    state.shoe = state.shoe.slice(0, RESHUFFLE_AT - 1);
    const t = finishRound(state);
    expect(t.events).toContainEqual({ type: "round-start", round: 2, shuffled: true });
    expect(pub(t.state)).toMatchObject({ shuffled: true, shoeLeft: SHOE_CARDS });
  });

  it("a player who leaves takes their chips; the table stops waiting on them", () => {
    let { state } = start({ players: 3 });
    state = act(state, "p1", { type: "bet", amount: 10 }).state;
    state = act(state, "p2", { type: "bet", amount: 10 }).state;
    state = bj.onPlayerRemoved!(state, "p3", ctx()).state;
    expect(state.step).toBe("play");
    const r = bj.getResult({ ...state, phase: "over" })!;
    expect(r.standings.at(-1)).toEqual({ playerId: "p3", value: 0, label: "left" });
  });

  it("a dropped player is not waited on: their hands stand", () => {
    let { state } = start({ deck: ["hearts-10", "clubs-5", "spades-9", "diamonds-6", "clubs-3", "hearts-8"] });
    state = act(state, "p1", { type: "bet", amount: 10 }).state;
    state = act(state, "p2", { type: "bet", amount: 10 }).state;
    state = bj.onPlayerDisconnected!(state, "p2", ctx()).state;
    expect(bj.getAwaitedPlayerIds(state)).toEqual(["p1"]);
    expect(state.players[1]!.hands[0]!.done).toBe(true);
  });
});

describe("taps and sitting out", () => {
  it("a second Hit sent for the same cards is refused, not played", () => {
    let { state } = start({ players: 1, deck: ["hearts-2", "spades-9", "diamonds-3", "hearts-8", "clubs-4", "clubs-5"] });
    state = act(state, "p1", { type: "bet", amount: 10 }).state;
    // Both taps were sent while the hand had 2 cards.
    state = act(state, "p1", { type: "hit", hand: 0, cards: 2 }).state;
    expect(refuse(state, "p1", { type: "hit", hand: 0, cards: 2 })).toBe("Your cards changed. Look again.");
    expect(refuse(state, "p1", { type: "stand", hand: 0, cards: 2 })).toBe("Your cards changed. Look again.");
    expect(state.players[0]!.hands[0]!.cards).toHaveLength(3);
    expect(bj.getPrivateState(state, "p1").moves).toMatchObject({ hand: 0, cards: 3 });
    state = act(state, "p1", { type: "hit", hand: 0, cards: 3 }).state;
    expect(state.players[0]!.hands[0]!.cards).toHaveLength(4);
  });

  it("a tap sent before a split showed is refused too", () => {
    // 8 and 8 against a 6. The split deals a 2 and a 3: hand 1 is 8-2, two cards again.
    let { state } = start({ players: 1, deck: ["hearts-8", "spades-6", "diamonds-8", "hearts-9", "clubs-2", "clubs-3", "clubs-4"] });
    state = act(state, "p1", { type: "bet", amount: 10 }).state;
    state = act(state, "p1", { type: "split", hand: 0, cards: 2 }).state;
    expect(state.players[0]!.hands.map((h) => h.cards.length)).toEqual([2, 2]);
    expect(refuse(state, "p1", { type: "hit", hand: 0, cards: 2 })).toBe("Your cards changed. Look again.");
    expect(bj.getPrivateState(state, "p1").moves).toMatchObject({ hand: 0, cards: 4 });
    state = act(state, "p1", { type: "hit", hand: 0, cards: 4 }).state;
    expect(state.players[0]!.hands[0]!.cards.map((c) => c.id)).toEqual(["hearts-8", "clubs-2", "clubs-4"]);
  });

  it("a seat the host skipped gets no bet for that round", () => {
    let { state } = start();
    state = bj.skipTurn!(state, "p2", ctx()).state;
    expect(bj.getPrivateState(state, "p2").bet).toBeNull();
    expect(refuse(state, "p2", { type: "bet", amount: 10 })).toBe("You sit out this round.");
    // A computer in that seat has nothing to do, so it can't undo the skip.
    const view = { playerId: "p2", public: bj.getPublicState(state), private: bj.getPrivateState(state, "p2") };
    expect(bj.bot!.decide(view, { randomInt: () => 0, chance: () => 0 })).toBeNull();
  });

  it("Play next round: a sitting-out seat makes the next betting wait for it again", () => {
    const round = ["hearts-10", "clubs-9", "spades-7", "diamonds-8"];
    let { state } = start({ deck: [...round, ...round, ...round] });
    for (let r = 0; r < 2; r++) {
      state = act(state, "p1", { type: "bet", amount: 10 }).state;
      state = fire(state, TURN_TIMER, 20_000).state;
      state = fire(state, TURN_TIMER, 20_000).state;
      state = finishRound(state).state;
    }
    expect(pub(state).players[1]!.sittingOut).toBe(true);
    expect(bj.getAwaitedPlayerIds(state)).toEqual(["p1"]);
    // p1 bets: the table doesn't wait on p2.
    state = act(state, "p1", { type: "bet", amount: 10 }).state;
    expect(state.step).toBe("play");
    expect(bj.getPrivateState(state, "p2").canBack).toBe(true);
    const back = act(state, "p2", { type: "back" });
    expect(back.events).toEqual([{ type: "back", playerId: "p2" }]);
    state = back.state;
    expect(bj.getPrivateState(state, "p2").canBack).toBe(false);
    expect(refuse(state, "p2", { type: "back" })).toBe("You are already playing.");
    state = fire(state, TURN_TIMER, 20_000).state;
    state = finishRound(state).state;
    expect(state.step).toBe("betting");
    expect(bj.getAwaitedPlayerIds(state)).toEqual(["p1", "p2"]);
    state = act(state, "p1", { type: "bet", amount: 10 }).state;
    expect(state.step).toBe("betting");
  });
});

describe("chips", () => {
  /** Chips a seat holds: its stack, plus what it has on the table and not yet paid. */
  const holdings = (p: State["players"][number]) =>
    p.removed ? 0 : p.stack + (p.hands.length ? p.hands.filter((h) => h.result === null).reduce((a, h) => a + h.bet, 0) : (p.bet ?? 0));
  const ledger = (s: State) => s.players.reduce((a, p) => a + holdings(p), 0);

  it("are never made or lost except by the pay, rebuys and leavers", () => {
    // Random moves, junk moves, skips, drops, leavers and pauses, against a ledger.
    for (let seed = 1; seed <= 30; seed++) {
      const r = seededRandomInt(seed);
      const n = 1 + r(7);
      const ids = Array.from({ length: n }, (_, i) => `p${i + 1}`);
      clock = 1_000_000;
      const c = (): GameContext => ({ now: clock, randomInt: r });
      const settings: BlackjackSettings = { rounds: [10, 15, 20][r(3)]!, rebuys: r(2) ? "one" : "off", turnSeconds: 15 };
      const created = bj.createGame(ids.map((id) => ({ id })), settings, { roundNumber: 1, dealerSeat: 0 }, c());
      let s = created.state;
      const timers = new Map<string, number>();
      const track = (reqs: { kind: string; timerId: string; delayMs?: number }[] = []) => {
        for (const t of reqs) t.kind === "set" ? timers.set(t.timerId, clock + t.delayMs!) : timers.delete(t.timerId);
      };
      track(created.timers);
      const apply = (t: { state: State; events: { event: BlackjackEvent }[]; timers?: never[] | unknown[] }, left = 0) => {
        let expected = ledger(s) - left;
        for (const { event: e } of t.events) {
          if (e.type === "settled") for (const res of e.results) expected += res.paid - res.bet;
          if (e.type === "rebuy") expected += e.chips;
        }
        expect(ledger(t.state), `seed ${seed}`).toBe(expected);
        for (const p of t.state.players) expect(p.stack, `seed ${seed}`).toBeGreaterThanOrEqual(0);
        s = t.state;
        track(t.timers as never);
      };
      for (let step = 0; step < 4000 && !bj.getResult(s); step++) {
        const roll = r(100);
        const id = ids[r(n)]!;
        if (roll < 2) {
          s = bj.pause!(s, true, c()).state;
          clock += r(5000);
          s = bj.pause!(s, false, c()).state;
        } else if (roll < 3) {
          const p = s.players.find((x) => x.id === id)!;
          apply(bj.onPlayerRemoved!(s, id, c()), holdings(p));
        } else if (roll < 6) {
          apply(r(2) ? bj.onPlayerDisconnected!(s, id, c()) : bj.onPlayerReconnected!(s, id, c()));
        } else if (roll < 8) {
          apply(bj.skipTurn!(s, id, c()));
        } else if (roll < 70) {
          const priv = bj.getPrivateState(s, id);
          const view = { playerId: id, public: bj.getPublicState(s), private: priv };
          const kinds = ["hit", "stand", "double", "split"] as const;
          const k = r(10);
          const action: unknown =
            k < 3 ? { type: kinds[r(4)], hand: r(2), cards: 2 + r(2) }
            : k < 4 ? { type: "bet", amount: 1 + r(1500) }
            : k < 5 ? { type: r(2) ? "rebuy" : "back" }
            : bj.bot!.decide(view, { randomInt: r, chance: () => r(100) });
          const parsed = bj.parseAction(action);
          if (!parsed) continue;
          const res = bj.handleAction(s, id, parsed, c());
          if (res.ok) apply(res.transition);
        } else {
          const next = [...timers.entries()].sort((a, b) => a[1] - b[1])[0];
          expect(next, `seed ${seed}: no timer in ${s.step}`).toBeDefined();
          timers.delete(next![0]);
          clock = Math.max(clock, next![1]);
          apply(bj.onTimer!(s, next![0], c()));
        }
      }
      expect(bj.getResult(s), `seed ${seed} never ended`).not.toBeNull();
    }
  }, 30_000);
});

describe("settings", () => {
  it("parses only the listed options", () => {
    expect(bj.parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(bj.parseSettings({ rounds: 15, rebuys: "one", turnSeconds: 30 })).toEqual({ rounds: 15, rebuys: "one", turnSeconds: 30 });
    expect(bj.parseSettings({ rounds: 12 })).toBeNull();
    expect(bj.parseSettings({ rebuys: "two" })).toBeNull();
  });

  it("parses moves", () => {
    expect(bj.parseAction({ type: "bet", amount: 50 })).toEqual({ type: "bet", amount: 50 });
    expect(bj.parseAction({ type: "bet", amount: 1.5 })).toBeNull();
    expect(bj.parseAction({ type: "hit", hand: 1, cards: 3 })).toEqual({ type: "hit", hand: 1, cards: 3 });
    expect(bj.parseAction({ type: "hit", hand: 1 })).toBeNull();
    expect(bj.parseAction({ type: "hit", hand: 2, cards: 2 })).toBeNull();
    expect(bj.parseAction({ type: "stand", hand: 0, cards: 0 })).toBeNull();
    expect(bj.parseAction({ type: "back" })).toEqual({ type: "back" });
    expect(bj.parseAction({ type: "rebuy" })).toEqual({ type: "rebuy" });
    expect(bj.parseAction({ type: "insurance" })).toBeNull();
  });
});
