import { seededRandomInt, type GameContext, type GameEventEnvelope, type GameTransition } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { cheatGame as ch } from "../server/game.ts";
import { allowedClaims, isHonest, makeDeck, parseCardId } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  type CheatAction,
  type CheatEvent,
  type CheatServerState,
  type CheatSettings,
  type Play,
} from "../shared/types.ts";

const ctx = (seed = 1, now = 0): GameContext => ({ now, randomInt: seededRandomInt(seed) });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const cards = (ids: string[]) => ids.map((id) => parseCardId(id)!);

/** A mid-game state, bypassing the deal. */
function stateWith(
  hands: string[][],
  opts: {
    turn?: number;
    pile?: string[];
    lastClaim?: number | null;
    window?: { cards: string[]; claim: number };
    removed?: number[];
    settings?: Partial<CheatSettings>;
  } = {},
): CheatServerState {
  const turn = opts.turn ?? 0;
  const played = opts.window ? cards(opts.window.cards) : [];
  const lastPlay: Play | null = opts.window ? { playerId: `p${turn}`, cards: played, claim: opts.window.claim } : null;
  return {
    phase: "playing",
    step: opts.window ? "window" : "play",
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    players: hands.map((ids, i) => ({ id: `p${i}`, hand: cards(ids), removed: opts.removed?.includes(i) ?? false, away: false })),
    decks: 1,
    dealerIndex: 0,
    turnIndex: turn,
    turnNumber: 0,
    pile: [...cards(opts.pile ?? []), ...played],
    lastPlay,
    lastClaim: opts.window ? opts.window.claim : (opts.lastClaim ?? null),
    windowEndsAt: opts.window ? 8000 : 0,
    windowMs: opts.window ? 8000 : 0,
    passed: [],
    lastReveal: null,
    winnerId: null,
    endReason: null,
  };
}

function act(state: CheatServerState, playerId: string, action: CheatAction, seed = 1) {
  return ch.handleAction(state, playerId, action, ctx(seed));
}

function ok(result: ReturnType<typeof act>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition;
}

function err(result: ReturnType<typeof act>) {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}

const ids = (hand: { id: string }[]) => hand.map((c) => c.id).sort();
const eventTypes = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);
const CARD_ID = /(?:spades|hearts|clubs|diamonds)-(?:10|[2-9AJQK])(?:~\d)?/g;
const cardIdsIn = (x: unknown) => JSON.stringify(x).match(CARD_ID) ?? [];

/**
 * Every card id a viewer can see, in both projections and in the events that
 * reach them, must be theirs to know: their hand, their own play on top, or
 * a play that got called and flipped for everyone.
 */
function expectNoLeaks(t: GameTransition<CheatServerState, CheatEvent>) {
  const s = t.state;
  const reveal = new Set([
    ...(s.lastReveal?.cards.map((c) => c.id) ?? []),
    ...t.events.flatMap((e) => (e.event.type === "called" ? e.event.cards.map((c) => c.id) : [])),
  ]);
  const everyone = cardIdsIn([ch.getPublicState(s), t.events.filter((e) => e.visibility.kind === "public")]);
  const leaks: string[] = [];
  for (const v of s.players) {
    const known = new Set([...v.hand.map((c) => c.id), ...reveal]);
    if (s.lastPlay?.playerId === v.id) for (const c of s.lastPlay.cards) known.add(c.id);
    const mine = (e: GameEventEnvelope<CheatEvent>) => e.visibility.kind === "private" && e.visibility.playerId === v.id;
    for (const id of [...everyone, ...cardIdsIn([ch.getPrivateState(s, v.id), t.events.filter(mine)])]) {
      if (!known.has(id)) leaks.push(`${v.id} can see ${id}`);
    }
  }
  expect(leaks).toEqual([]);
}

describe("createGame", () => {
  it("deals the whole deck from the dealer's left, and starts there on Aces", () => {
    const t = ch.createGame(players(5), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 3 }, ctx());
    const held = t.state.players.flatMap((p) => p.hand);
    expect(new Set(held.map((c) => c.id)).size).toBe(52);
    expect(t.events[0]!.event).toMatchObject({ type: "dealt", dealerId: "p3", decks: 1, handSizes: { p4: 11, p0: 11, p1: 10, p2: 10, p3: 10 } });
    expect(ch.getPublicState(t.state)).toMatchObject({ currentPlayerId: "p4", claims: [1], pileCount: 0, step: "play" });
    expectNoLeaks(t);
  });

  it("uses two decks at seven players, and deals an injected deck in order", () => {
    const t = ch.createGame(players(7), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx());
    expect(t.state.decks).toBe(2);
    expect(t.state.players.flatMap((p) => p.hand)).toHaveLength(104);

    const deck = makeDeck(1).map((c) => c.id);
    const t2 = ch.createGame(players(4), { ...DEFAULT_SETTINGS, decks: 1 }, { roundNumber: 1, dealerSeat: 0 }, ctx(), { deck });
    expect(t2.state.players[1]!.hand[0]!.id).toBe(deck[0]);
    expect(() => ch.createGame(players(4), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(), { deck: deck.slice(1) })).toThrow(/52/);
    expect(() => ch.createGame(players(2), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow(/3–10/);
  });
});

describe("playing", () => {
  it("puts cards down face down, opens the window, and tells only the player what went down", () => {
    const s = stateWith([["spades-A", "hearts-7", "clubs-2"], ["spades-3"], ["hearts-4"]]);
    const t = ok(ch.handleAction(s, "p0", { type: "play", cardIds: ["spades-A", "hearts-7"] }, ctx(1, 1000)));
    expect(ids(t.state.players[0]!.hand)).toEqual(["clubs-2"]);
    expect(t.state.pile).toHaveLength(2);
    expect(t.timers).toEqual([{ kind: "set", timerId: "window", delayMs: 8000 }]);
    expect(ch.getPublicState(t.state)).toMatchObject({
      step: "window",
      currentPlayerId: null,
      lastPlay: { playerId: "p0", count: 2, claim: 1 },
      window: { playerId: "p0", endsAt: 9000, ms: 8000 },
    });
    expect(eventTypes(t)).toEqual(["played", "you-played"]);
    expect(t.events[1]!.visibility).toEqual({ kind: "private", playerId: "p0" });
    expect(ch.getPrivateState(t.state, "p0")).toMatchObject({ myPlay: cards(["spades-A", "hearts-7"]), canCall: false });
    expect(ch.getPrivateState(t.state, "p1")).toMatchObject({ myPlay: null, canCall: true, canPlay: false });
    expect(ch.getAwaitedPlayerIds(t.state)).toEqual([]);
    expectNoLeaks(t);
  });

  it("rejects plays out of turn, of cards you don't hold, of the wrong rank, and mid-window", () => {
    const s = stateWith([["spades-A", "hearts-7"], ["spades-3"], ["hearts-4"]], { lastClaim: 4 });
    expect(err(act(s, "p1", { type: "play", cardIds: ["spades-3"] }))).toBe("not-your-turn");
    expect(err(act(s, "p0", { type: "play", cardIds: ["spades-3"] }))).toBe("card-not-owned");
    expect(err(act(s, "p0", { type: "play", cardIds: ["spades-A", "spades-A"] }))).toBe("card-not-owned");
    expect(err(act(s, "p0", { type: "play", cardIds: ["spades-A"], claim: 4 }))).toBe("bad-claim");
    expect(ok(act(s, "p0", { type: "play", cardIds: ["spades-A"], claim: 5 })).state.lastClaim).toBe(5);

    const w = stateWith([["spades-A"], ["spades-3"], ["hearts-4"]], { window: { cards: ["hearts-9"], claim: 2 } });
    expect(err(act(w, "p0", { type: "play", cardIds: ["spades-A"] }))).toBe("window-open");

    expect(ch.parseAction({ type: "play", cardIds: [] })).toBeNull();
    expect(ch.parseAction({ type: "play", cardIds: ["a", "b", "c", "d", "e"] })).toBeNull();
    expect(ch.parseAction({ type: "play", cardIds: ["hearts-4"], claim: 14 })).toBeNull();
    expect(ch.parseAction({ type: "call" })).toEqual({ type: "call" });
  });

  it("near claims need the rank said out loud, from the three on offer", () => {
    const s = stateWith([["spades-A", "hearts-7"], ["spades-3"], ["hearts-4"]], { lastClaim: 7, settings: { claims: "near" } });
    expect(ch.getPublicState(s).claims).toEqual([6, 7, 8]);
    expect(err(act(s, "p0", { type: "play", cardIds: ["hearts-7"] }))).toBe("bad-claim");
    expect(err(act(s, "p0", { type: "play", cardIds: ["hearts-7"], claim: 9 }))).toBe("bad-claim");
    expect(ok(act(s, "p0", { type: "play", cardIds: ["hearts-7"], claim: 7 })).state.lastClaim).toBe(7);
  });
});

describe("calling", () => {
  // p0 just played two cards on top of a three-card pile.
  const lie = () => stateWith([["clubs-5"], ["spades-3"], ["hearts-4"]], { pile: ["clubs-J", "clubs-Q", "clubs-K"], window: { cards: ["hearts-2", "hearts-9"], claim: 2 } });
  const truth = () => stateWith([["clubs-5"], ["spades-3"], ["hearts-4"]], { pile: ["clubs-J", "clubs-Q", "clubs-K"], window: { cards: ["hearts-2", "spades-2"], claim: 2 } });

  it("a caught liar takes the whole pile, and play goes on from them", () => {
    const t = ok(act(lie(), "p2", { type: "call" }));
    expect(t.state.players[0]!.hand).toHaveLength(6);
    expect(t.state.pile).toEqual([]);
    expect(t.timers).toEqual([{ kind: "cancel", timerId: "window" }]);
    expect(t.state.lastReveal).toMatchObject({ callerId: "p2", playerId: "p0", lied: true, takerId: "p0", taken: 5, claim: 2 });
    expect(t.events.map((e) => e.event)).toEqual([expect.objectContaining({ type: "called", lied: true, cards: cards(["hearts-2", "hearts-9"]) })]);
    expect(ch.getPublicState(t.state)).toMatchObject({ currentPlayerId: "p1", claims: [3], lastPlay: null, pileCount: 0 });
    expectNoLeaks(t);
  });

  it("calling a true play costs the caller the pile", () => {
    const t = ok(act(truth(), "p1", { type: "call" }));
    expect(ids(t.state.players[1]!.hand)).toEqual(["clubs-J", "clubs-K", "clubs-Q", "hearts-2", "spades-2", "spades-3"]);
    expect(t.state.lastReveal).toMatchObject({ lied: false, takerId: "p1" });
    expect(ch.getPublicState(t.state).currentPlayerId).toBe("p1");
  });

  it("the first call wins the race; the second is too late", () => {
    const t = ok(act(lie(), "p2", { type: "call" }));
    expect(err(act(t.state, "p1", { type: "call" }))).toBe("too-late");
  });

  it("you can't call your own play, or call after letting it go", () => {
    expect(err(act(lie(), "p0", { type: "call" }))).toBe("own-play");
    const t = ok(act(lie(), "p1", { type: "pass" }));
    expect(eventTypes(t)).toEqual(["passed"]);
    expect(ch.getPublicState(t.state).players[1]!.passed).toBe(true);
    expect(ch.getPrivateState(t.state, "p1").canCall).toBe(false);
    expect(err(act(t.state, "p1", { type: "call" }))).toBe("passed");
  });

  it("closes early once everyone else lets it go", () => {
    const t1 = ok(act(lie(), "p1", { type: "pass" }));
    const t2 = ok(act(t1.state, "p2", { type: "pass" }));
    expect(eventTypes(t2)).toEqual(["passed", "accepted"]);
    expect(t2.timers).toEqual([{ kind: "cancel", timerId: "window" }]);
    // The lie stands; the pile stays put.
    expect(ch.getPublicState(t2.state)).toMatchObject({ currentPlayerId: "p1", pileCount: 5, claims: [3] });
  });

  it("closes when the timer runs out, and ignores stale timers", () => {
    const t = ch.onTimer!(lie(), "window", ctx());
    expect(eventTypes(t)).toEqual(["accepted"]);
    expect(ch.getPublicState(t.state).currentPlayerId).toBe("p1");
    expect(ch.onTimer!(t.state, "window", ctx()).state).toBe(t.state);
  });

  it("a dropped connection counts as letting it go", () => {
    const t1 = ok(act(lie(), "p1", { type: "pass" }));
    const t2 = ch.onPlayerDisconnected!(t1.state, "p2", ctx());
    expect(eventTypes(t2)).toEqual(["accepted"]);
    // Back again, and they can call next time.
    expect(ch.onPlayerReconnected!(t2.state, "p2", ctx()).state.players[2]!.away).toBe(false);
  });
});

describe("going out", () => {
  const last = (played: string[], claim = 2) =>
    stateWith([[], ["spades-3"], ["hearts-4"]], { pile: ["clubs-J"], window: { cards: played, claim } });

  it("an empty hand wins once nobody calls it", () => {
    const t = ch.onTimer!(last(["hearts-2"]), "window", ctx());
    expect(t.state).toMatchObject({ phase: "finished", winnerId: "p0", endReason: "out" });
    expect(eventTypes(t)).toEqual(["accepted", "game-over"]);
    const r = ch.getResult(t.state)!;
    expect(r.winnerIds).toEqual(["p0"]);
    expect(r.standings.map((s) => [s.playerId, s.label])).toEqual([
      ["p0", "out of cards"],
      ["p1", "1 card left"],
      ["p2", "1 card left"],
    ]);
    expect(err(act(t.state, "p1", { type: "call" }))).toBe("game-finished");
  });

  it("wins through a call on a true last play", () => {
    const t = ok(act(last(["hearts-2"]), "p1", { type: "call" }));
    expect(t.state).toMatchObject({ phase: "finished", winnerId: "p0" });
    expect(t.state.players[1]!.hand).toHaveLength(3);
  });

  it("a false last play caught means the pile, not the win", () => {
    const t = ok(act(last(["hearts-9"]), "p1", { type: "call" }));
    expect(t.state.phase).toBe("playing");
    expect(t.state.players[0]!.hand).toHaveLength(2);
    expect(ch.getPublicState(t.state).currentPlayerId).toBe("p1");
  });
});

describe("host and leavers", () => {
  it("a skipped player plays one true card if they have one", () => {
    const s = stateWith([["spades-9", "hearts-2", "clubs-K"], ["spades-3"], ["hearts-4"]], { lastClaim: 1 });
    const t = ch.skipTurn!(s, "p0", ctx(5));
    expect(eventTypes(t)).toEqual(["turn-skipped", "played", "you-played"]);
    expect(t.state.lastPlay).toMatchObject({ playerId: "p0", claim: 2, cards: cards(["hearts-2"]) });
    expect(ch.skipTurn!(s, "p1", ctx()).events).toEqual([]);
  });

  it("…and a random card, as a lie, if they don't", () => {
    const s = stateWith([["spades-9", "clubs-K"], ["spades-3"], ["hearts-4"]], { lastClaim: 1 });
    const t = ch.skipTurn!(s, "p0", ctx(5));
    expect(t.state.lastPlay!.claim).toBe(2);
    expect(t.state.lastPlay!.cards).toHaveLength(1);
    expect(isHonest(t.state.lastPlay!.cards, 2)).toBe(false);
  });

  it("puts a leaver's hand under the pile, and moves on if it was their play", () => {
    const s = stateWith([["clubs-5", "clubs-6"], ["spades-3"], ["hearts-4"], ["hearts-5"]], {
      pile: ["clubs-J"],
      window: { cards: ["hearts-2"], claim: 2 },
    });
    const t = ch.onPlayerRemoved!(s, "p0", ctx());
    expect(t.state.pile.map((c) => c.id)).toEqual(["clubs-5", "clubs-6", "clubs-J", "hearts-2"]);
    expect(t.timers).toEqual([{ kind: "cancel", timerId: "window" }]);
    expect(ch.getPublicState(t.state)).toMatchObject({ currentPlayerId: "p1", lastPlay: null, step: "play" });

    // Someone else leaving mid-window leaves the play callable.
    const t2 = ch.onPlayerRemoved!(s, "p2", ctx());
    expect(t2.state.step).toBe("window");
    expect(ok(act(t2.state, "p1", { type: "call" })).state.lastReveal).toMatchObject({ lied: false, takerId: "p1", taken: 3 });
  });

  it("ends with the last one standing when only one's left", () => {
    const s = stateWith([["clubs-5"], ["spades-3"], ["hearts-4"]], { removed: [2] });
    const t = ch.onPlayerRemoved!(s, "p0", ctx());
    expect(t.state).toMatchObject({ phase: "finished", winnerId: "p1", endReason: "abandoned" });
    expect(ch.getResult(t.state)!.standings.map((s) => s.label)).toEqual(["last one standing", "left", "left"]);
  });
});

describe("whole games", () => {
  it("conserves cards, never leaks one, settles calls right, and ends", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const n = 3 + (seed % 8);
      const rng = seededRandomInt(seed * 7);
      const settings: CheatSettings = { ...DEFAULT_SETTINGS, claims: seed % 2 ? "strict" : "near" };
      let t = ch.createGame(players(n), settings, { roundNumber: 1, dealerSeat: seed }, ctx(seed));
      const total = 52 * t.state.decks;
      let removals = seed % 3 === 0 ? 1 : 0;

      for (let steps = 0; t.state.phase === "playing"; steps++) {
        expect(steps).toBeLessThan(20000);
        const s = t.state;
        const pub = ch.getPublicState(s);
        const c = ctx(seed * 1000 + steps);
        if (removals && rng(200) === 0) {
          removals--;
          const who = s.players.filter((p) => !p.removed)[rng(s.players.filter((p) => !p.removed).length)]!;
          t = ch.onPlayerRemoved!(s, who.id, c);
        } else if (s.step === "play") {
          const me = s.players[s.turnIndex]!;
          const claim = pub.claims[rng(pub.claims.length)]!;
          // Mostly honest when they can be, so games end.
          const honest = me.hand.filter((x) => x.rank === claim);
          const pool = honest.length && rng(4) ? honest : me.hand;
          const k = 1 + rng(Math.min(4, pool.length));
          const picked = [...pool].sort(() => rng(3) - 1).slice(0, k);
          t = ok(ch.handleAction(s, me.id, { type: "play", cardIds: picked.map((x) => x.id), claim }, c));
        } else {
          const play = s.lastPlay!;
          const others = s.players.filter((p) => !p.removed && p.id !== play.playerId && !s.passed.includes(p.id));
          const roll = rng(10);
          if (roll < 3) {
            const caller = others[rng(others.length)]!;
            t = ok(ch.handleAction(s, caller.id, { type: "call" }, c));
            const lied = !isHonest(play.cards, play.claim);
            const taker = t.state.players.find((p) => p.id === (lied ? play.playerId : caller.id))!;
            expect(t.state.lastReveal).toMatchObject({ lied, takerId: taker.id, taken: s.pile.length });
            expect(taker.hand.length).toBe(s.players.find((p) => p.id === taker.id)!.hand.length + s.pile.length);
          } else if (roll < 7) {
            t = ok(ch.handleAction(s, others[rng(others.length)]!.id, { type: "pass" }, c));
          } else {
            t = ch.onTimer!(s, "window", c);
          }
        }
        const held = t.state.players.reduce((sum, p) => sum + p.hand.length, 0);
        expect(held + t.state.pile.length).toBe(total);
        expectNoLeaks(t);
        if (t.state.phase === "playing" && t.state.step === "play") {
          expect(ch.getPublicState(t.state).claims).toEqual(allowedClaims(t.state.lastClaim, settings.claims));
        }
      }
      const r = ch.getResult(t.state)!;
      if (t.state.endReason === "out") {
        expect(t.state.players.find((p) => p.id === t.state.winnerId)!.hand).toEqual([]);
        expect(r.winnerIds).toEqual([t.state.winnerId]);
        expect(r.standings[0]!.playerId).toBe(t.state.winnerId);
      }
    }
  });
});
