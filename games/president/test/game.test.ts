import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { presidentGame as pr } from "../server/game.ts";
import { bestCards, compareCards, makeDeck, parseCardId } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  type PresidentAction,
  type PresidentEvent,
  type PresidentServerState,
  type PresidentSettings,
} from "../shared/types.ts";

const ctx = (seed = 1): GameContext => ({ now: 0, randomInt: seededRandomInt(seed) });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const cards = (ids: string[]) => ids.map((id) => parseCardId(id)!);

/** A mid-round state, bypassing the deal. `trick` is [seat, card ids] per set, oldest first. */
function stateWith(
  hands: string[][],
  opts: {
    turn?: number;
    trick?: [number, string[]][];
    passed?: number[];
    removed?: number[];
    finishOrder?: string[];
    history?: string[][];
    round?: number;
    settings?: Partial<PresidentSettings>;
  } = {},
): PresidentServerState {
  const trick = (opts.trick ?? []).map(([seat, ids]) => ({ playerId: `p${seat}`, cards: cards(ids) }));
  return {
    phase: "playing",
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    players: hands.map((ids, i) => ({
      id: `p${i}`,
      hand: cards(ids).sort(compareCards),
      removed: opts.removed?.includes(i) ?? false,
      passed: opts.passed?.includes(i) ?? false,
      points: 0,
    })),
    round: opts.round ?? 1,
    dealerIndex: 0,
    turnIndex: opts.turn ?? 0,
    turnNumber: 0,
    trick,
    lastIndex: opts.trick?.length ? opts.trick.at(-1)![0] : -1,
    discard: [],
    finishOrder: opts.finishOrder ?? [],
    history: opts.history ?? [],
    exchange: [],
    winnerIds: [],
    endReason: null,
  };
}

function act(state: PresidentServerState, playerId: string, action: PresidentAction, seed = 1) {
  return pr.handleAction(state, playerId, action, ctx(seed));
}

function ok(result: ReturnType<typeof act>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition;
}

function err(result: ReturnType<typeof act>) {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}

const play = (...cardIds: string[]): PresidentAction => ({ type: "play", cardIds });
const ids = (hand: { id: string }[]) => hand.map((c) => c.id).sort();
const eventTypes = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);
const cardsInPlay = (s: PresidentServerState) =>
  [...s.players.flatMap((p) => p.hand), ...s.trick.flatMap((t) => t.cards), ...s.discard].map((c) => c.id);

describe("createGame", () => {
  it("deals the whole deck from the dealer's left, and the 3♣ leads round 1", () => {
    const t = pr.createGame(players(4), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 2 }, ctx());
    expect(cardsInPlay(t.state).sort()).toEqual(makeDeck().map((c) => c.id).sort());
    expect(t.state.phase).toBe("playing");
    expect(t.state.exchange).toEqual([]);
    expect(t.state.players[t.state.turnIndex]!.hand.some((c) => c.id === "clubs-3")).toBe(true);
    expect(t.events[0]!.event).toMatchObject({ type: "dealt", round: 1, dealerId: "p2", handSizes: { p3: 13, p0: 13, p1: 13, p2: 13 } });

    const pub = JSON.stringify(pr.getPublicState(t.state));
    for (const card of makeDeck()) expect(pub).not.toContain(`"${card.id}"`);
  });

  it("deals an injected deck in order, uneven hands going to the dealer's left first", () => {
    const deck = makeDeck().map((c) => c.id);
    const t = pr.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(), { deck });
    expect(t.events[0]!.event).toMatchObject({ handSizes: { p1: 18, p2: 17, p0: 17 } });
    // clubs-3 is the deck's third card: p0, the dealer, gets it.
    expect(t.state.turnIndex).toBe(0);
    expect(() => pr.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(), { deck: deck.slice(1) })).toThrow(/52/);
    expect(() => pr.createGame(players(2), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx())).toThrow(/3–8/);
  });

  it("validates settings and actions", () => {
    expect(pr.parseSettings({ rounds: 5, matchSkips: true })).toEqual({ rounds: 5, matchSkips: true });
    expect(pr.parseSettings({ rounds: 6 })).toBeNull();
    expect(pr.parseSettings({ matchSkips: "yes" })).toBeNull();
    expect(pr.parseAction({ type: "play", cardIds: ["hearts-5"] })).toEqual(play("hearts-5"));
    expect(pr.parseAction({ type: "play", cardIds: [] })).toBeNull();
    expect(pr.parseAction({ type: "give", cardIds: ["a", "b", "c", "d", "e"] })).toBeNull();
    expect(pr.parseAction({ type: "pass" })).toEqual({ type: "pass" });
  });
});

describe("tricks", () => {
  it("follows with the same count, higher, and rejects everything else", () => {
    const s = stateWith(
      [["hearts-5", "clubs-5", "spades-K"], ["hearts-9", "clubs-9", "spades-3"], ["hearts-4", "spades-4", "clubs-J"]],
      { turn: 1, trick: [[0, ["diamonds-8", "spades-8"]]] },
    );
    expect(err(act(s, "p2", play("hearts-4")))).toBe("not-your-turn");
    expect(err(act(s, "p1", play("spades-3")))).toBe("illegal-play");
    expect(err(act(s, "p1", play("hearts-9")))).toBe("illegal-play");
    expect(err(act(s, "p1", play("hearts-2", "clubs-2")))).toBe("card-not-owned");
    expect(err(act(s, "p1", play("hearts-9", "hearts-9")))).toBe("bad-card");

    const t = ok(act(s, "p1", play("hearts-9", "clubs-9")));
    expect(ids(t.state.players[1]!.hand)).toEqual(["spades-3"]);
    // p2 has no pair above nines and passes without being asked; p0's fives
    // don't beat them either, so it's back to p1: cleared, p1 leads.
    expect(eventTypes(t)).toEqual(["played", "passed", "passed", "cleared"]);
    expect(t.events[1]!.event).toEqual({ type: "passed", playerId: "p2", auto: true });
    expect(t.state).toMatchObject({ turnIndex: 1, trick: [], lastIndex: -1 });
    expect(t.state.players.every((p) => !p.passed)).toBe(true);
    expect(t.state.discard).toHaveLength(4);
  });

  it("keeps a passed player out until the trick clears", () => {
    const s = stateWith(
      [["hearts-5", "clubs-Q"], ["hearts-9", "clubs-2"], ["hearts-7", "spades-A"]],
      { turn: 1, trick: [[0, ["diamonds-4"]]] },
    );
    expect(err(act(s, "p0", { type: "pass" }))).toBe("not-your-turn");
    const t1 = ok(act(s, "p1", { type: "pass" }));
    expect(t1.state.turnIndex).toBe(2);
    const t2 = ok(act(t1.state, "p2", play("hearts-7")));
    // p0 can beat a 7 with the queen; p1 could beat it too, but passed.
    expect(t2.state.turnIndex).toBe(0);
    const t3 = ok(act(t2.state, "p0", play("clubs-Q")));
    // p1 skipped, p2's ace beats the queen.
    expect(t3.state.turnIndex).toBe(2);
    const t4 = ok(act(t3.state, "p2", { type: "pass" }));
    expect(eventTypes(t4)).toEqual(["passed", "cleared"]);
    expect(t4.state.turnIndex).toBe(0);
  });

  it("won't let the leader pass", () => {
    const s = stateWith([["hearts-5"], ["hearts-9"], ["hearts-7"]], { turn: 0 });
    expect(err(act(s, "p0", { type: "pass" }))).toBe("leading");
  });

  it("hands the lead on when the last player to play has gone out", () => {
    const s = stateWith([["hearts-A"], ["hearts-9", "clubs-3"], ["hearts-7", "clubs-4"], ["spades-5", "clubs-5"]], { turn: 0 });
    const t = ok(act(s, "p0", play("hearts-A")));
    expect(t.state.finishOrder).toEqual(["p0"]);
    expect(eventTypes(t)).toEqual(["played", "went-out", "passed", "passed", "passed", "cleared"]);
    expect(t.events[1]!.event).toMatchObject({ place: 1, title: "President" });
    expect(t.state.turnIndex).toBe(1);
    expect(t.events.at(-1)!.event).toEqual({ type: "cleared", leaderId: "p1" });
  });

  it("with the house rule, matching the rank skips the next player", () => {
    const hands = [["hearts-6", "clubs-K"], ["spades-6", "clubs-3"], ["diamonds-9", "clubs-4"], ["clubs-10", "hearts-4"]];
    const s = stateWith(hands, { turn: 1, trick: [[0, ["clubs-6"]]], settings: { matchSkips: true } });
    const t = ok(act(s, "p1", play("spades-6")));
    expect(eventTypes(t)).toEqual(["played", "skipped"]);
    expect(t.events[1]!.event).toEqual({ type: "skipped", playerId: "p2" });
    expect(t.state.turnIndex).toBe(3);
    // Not a pass: p2 gets their go next time round.
    expect(t.state.players[2]!.passed).toBe(false);

    const off = stateWith(hands, { turn: 1, trick: [[0, ["clubs-6"]]] });
    expect(err(act(off, "p1", play("spades-6")))).toBe("illegal-play");
  });
});

describe("rounds and the exchange", () => {
  /** p1 plays out, leaving p0 and p2; p2 plays out: p0 is the Asshole. */
  function endOfRound1() {
    const s = stateWith([["hearts-5", "clubs-5"], ["hearts-2"], ["hearts-A"]], { turn: 1, settings: { rounds: 2 } });
    const t1 = ok(act(s, "p1", play("hearts-2")));
    return ok(act(t1.state, "p2", play("hearts-A"), 7));
  }

  it("ends the round when one player's left holding, scores it, and deals round 2", () => {
    const t = endOfRound1();
    const types = eventTypes(t);
    expect(types.slice(0, 4)).toEqual(["played", "went-out", "went-out", "round-over"]);
    expect(t.events[2]!.event).toMatchObject({ playerId: "p0", place: 3, title: "Asshole" });
    expect(t.events[3]!.event).toEqual({ type: "round-over", round: 1, order: ["p1", "p2", "p0"], points: { p1: 2, p2: 1, p0: 0 } });
    expect(types.slice(4)).toEqual(["dealt", "swapped", "swap-cards", "swap-cards"]);
    expect(t.state).toMatchObject({ phase: "exchange", round: 2, history: [["p1", "p2", "p0"]] });
    // The Asshole deals and will lead.
    expect(t.events[4]!.event).toMatchObject({ dealerId: "p0" });
    expect(t.state.turnIndex).toBe(0);
    expect(cardsInPlay(t.state)).toHaveLength(52);
    expect(pr.getPublicState(t.state).players.map((p) => [p.id, p.points, p.title])).toEqual([
      ["p0", 0, "Asshole"],
      ["p1", 2, "President"],
      ["p2", 1, "Citizen"],
    ]);
  });

  it("the Asshole's best two go to the President, who gives back any two", () => {
    const t = endOfRound1();
    const tribute = t.state.exchange[0]!;
    expect(tribute).toMatchObject({ kind: "tribute", fromId: "p0", toId: "p1", count: 2 });
    const asshole = t.state.players[0]!;
    expect(ids(bestCards([...asshole.hand, ...tribute.cards!], 2))).toEqual(ids(tribute.cards!));
    // The cards themselves are private to the two of them.
    const priv = t.events.filter((e) => e.event.type === "swap-cards").map((e) => e.visibility);
    expect(priv).toEqual([{ kind: "private", playerId: "p0" }, { kind: "private", playerId: "p1" }]);
    expect(JSON.stringify(t.events.find((e) => e.event.type === "swapped")!.event)).not.toContain(tribute.cards![0]!.id);

    expect(pr.getAwaitedPlayerIds(t.state)).toEqual(["p1"]);
    expect(pr.getPrivateState(t.state, "p1")).toMatchObject({ mustGive: 2, got: tribute.cards });
    expect(pr.getPrivateState(t.state, "p0")).toMatchObject({ mustGive: 0, gave: tribute.cards });

    const pres = t.state.players[1]!.hand;
    expect(err(act(t.state, "p0", play(asshole.hand[0]!.id)))).toBe("exchanging");
    expect(err(act(t.state, "p0", { type: "give", cardIds: [asshole.hand[0]!.id] }))).toBe("nothing-to-give");
    expect(err(act(t.state, "p1", { type: "give", cardIds: [pres[0]!.id] }))).toBe("wrong-count");
    expect(err(act(t.state, "p1", { type: "give", cardIds: [pres[0]!.id, asshole.hand[0]!.id] }))).toBe("card-not-owned");

    // Giving one of the tribute cards straight back is allowed.
    const back = [pres[0]!.id, tribute.cards![1]!.id];
    const g = ok(act(t.state, "p1", { type: "give", cardIds: back }));
    expect(g.state.phase).toBe("playing");
    expect(g.state.players[0]!.hand.map((c) => c.id)).toEqual(expect.arrayContaining(back));
    expect(g.state.players[0]!.hand).toHaveLength(17);
    expect(pr.getPublicState(g.state).currentPlayerId).toBe("p0");
    expect(eventTypes(g)).toEqual(["swapped", "swap-cards", "swap-cards"]);
  });

  it("with four or more, the vices swap one too, and both givers are awaited", () => {
    const s = stateWith([["hearts-5"], ["hearts-2"], ["hearts-A"], ["hearts-K"]], { turn: 1, settings: { rounds: 3 } });
    let state = ok(act(s, "p1", play("hearts-2"))).state; // p1 out, cleared, p2 leads
    state = ok(act(state, "p2", play("hearts-A"))).state; // p2 out, p3 leads
    const t = ok(act(state, "p3", play("hearts-K"), 3)); // p3 out; p0 left holding
    expect(t.state.history).toEqual([["p1", "p2", "p3", "p0"]]);
    expect(t.state.exchange.map((x) => [x.kind, x.fromId, x.toId, x.count])).toEqual([
      ["tribute", "p0", "p1", 2],
      ["tribute", "p3", "p2", 1],
      ["return", "p1", "p0", 2],
      ["return", "p2", "p3", 1],
    ]);
    expect(pr.getAwaitedPlayerIds(t.state)).toEqual(["p1", "p2"]);
    const vp = t.state.players[2]!.hand[0]!.id;
    const g = ok(act(t.state, "p2", { type: "give", cardIds: [vp] }));
    expect(g.state.phase).toBe("exchange");
    expect(pr.getAwaitedPlayerIds(g.state)).toEqual(["p1"]);
    expect(pr.getPublicState(g.state).exchange.map((x) => x.done)).toEqual([true, true, false, true]);
  });

  it("finishes after the last round, most points winning and ties going to the last round's better finish", () => {
    // Round 2 of 2. Going in: p0 2, p1 1, p2 0.
    const s = stateWith([["hearts-5", "clubs-5"], ["hearts-2"], ["hearts-A"]], {
      turn: 1,
      round: 2,
      settings: { rounds: 2 },
      history: [["p0", "p1", "p2"]],
    });
    s.players[0]!.points = 2;
    s.players[1]!.points = 1;
    let state = ok(act(s, "p1", play("hearts-2"))).state;
    const t = ok(act(state, "p2", play("hearts-A")));
    // p1 3, p0 2, p2 1.
    expect(t.state.phase).toBe("finished");
    expect(eventTypes(t).at(-1)).toBe("game-over");
    const r = pr.getResult(t.state)!;
    expect(r.winnerIds).toEqual(["p1"]);
    expect(r.standings.map((x) => [x.playerId, x.label])).toEqual([
      ["p1", "3 pts · President"],
      ["p0", "2 pts · Asshole"],
      ["p2", "1 pt · Citizen"],
    ]);

    // Tied on points: the last round decides.
    const tie = stateWith([["hearts-5", "clubs-5"], ["hearts-2"], ["hearts-A"]], { turn: 2, round: 2, settings: { rounds: 2 } });
    tie.players[1]!.points = 2;
    tie.players[2]!.points = 1;
    state = ok(act(tie, "p2", play("hearts-A"))).state; // p2 out first: 1 + 2 = 3
    const t2 = ok(act(state, "p1", play("hearts-2"))); // p1 second: 2 + 1 = 3
    expect(t2.state.players.map((p) => p.points)).toEqual([0, 3, 3]);
    expect(pr.getResult(t2.state)!.winnerIds).toEqual(["p2"]);
    expect(err(act(t2.state, "p0", play("hearts-5")))).toBe("game-finished");
  });
});

describe("host and leavers", () => {
  it("a skip passes mid-trick, and hands the lead on when leading", () => {
    const s = stateWith([["hearts-5"], ["hearts-9", "clubs-3"], ["hearts-7", "clubs-4"]], { turn: 1, trick: [[0, ["clubs-5"]]] });
    const t = pr.skipTurn!(s, "p1", ctx());
    expect(eventTypes(t)[0]).toBe("turn-skipped");
    expect(t.state.players[1]!.passed).toBe(true);
    expect(t.state.turnIndex).toBe(2);
    expect(pr.skipTurn!(s, "p2", ctx()).events).toEqual([]);

    const lead = stateWith([["hearts-5"], ["hearts-9"], ["hearts-7"]], { turn: 1 });
    const t2 = pr.skipTurn!(lead, "p1", ctx());
    expect(t2.state).toMatchObject({ turnIndex: 2, trick: [] });
    expect(t2.state.players[1]!.passed).toBe(false);
  });

  it("a skip in the exchange gives back the lowest cards", () => {
    const s = stateWith([["hearts-5", "clubs-5"], ["hearts-2"], ["hearts-A"]], { turn: 1, settings: { rounds: 2 } });
    const t = ok(act(ok(act(s, "p1", play("hearts-2"))).state, "p2", play("hearts-A")));
    const low = [...t.state.players[1]!.hand].sort(compareCards).slice(0, 2);
    const k = pr.skipTurn!(t.state, "p1", ctx());
    expect(eventTypes(k)[0]).toBe("turn-skipped");
    expect(k.state.phase).toBe("playing");
    expect(ids(k.state.exchange[1]!.cards!)).toEqual(ids(low));
  });

  it("a leaver's cards go out of play and the turn moves on", () => {
    const s = stateWith([["hearts-5"], ["hearts-9", "clubs-3"], ["hearts-7", "clubs-K"], ["spades-5", "clubs-8"]], {
      turn: 1,
      trick: [[0, ["clubs-5"]]],
    });
    const t = pr.onPlayerRemoved!(s, "p1", ctx());
    expect(t.state.players[1]!).toMatchObject({ removed: true, hand: [] });
    expect(t.state.discard.map((c) => c.id).sort()).toEqual(["clubs-3", "hearts-9"]);
    expect(t.state.turnIndex).toBe(2);
    expect(cardsInPlay(t.state)).toHaveLength(8);
  });

  it("a leaver who leaves one holder ends the round; one who leaves one player ends the game", () => {
    const s = stateWith([["hearts-5"], ["hearts-9"], ["hearts-7"]], { turn: 0, finishOrder: ["p2"], settings: { rounds: 1 } });
    s.players[2]!.hand = [];
    const t = pr.onPlayerRemoved!(s, "p1", ctx());
    expect(eventTypes(t)).toEqual(["player-removed", "went-out", "round-over", "game-over"]);
    expect(t.state.history).toEqual([["p2", "p0"]]);
    expect(pr.getResult(t.state)!.winnerIds).toEqual(["p2"]);

    const three = stateWith([["hearts-5"], ["hearts-9"], ["hearts-7"]], { removed: [2] });
    const t2 = pr.onPlayerRemoved!(three, "p1", ctx());
    expect(t2.state).toMatchObject({ phase: "finished", endReason: "abandoned", winnerIds: ["p0"] });
  });

  it("a leaver in the exchange calls off their swap", () => {
    const s = stateWith([["hearts-5", "clubs-5"], ["hearts-2"], ["hearts-A"], ["hearts-K"]], { turn: 1, settings: { rounds: 2 } });
    let state = ok(act(s, "p1", play("hearts-2"))).state;
    state = ok(act(state, "p2", play("hearts-A"))).state;
    state = ok(act(state, "p3", play("hearts-K"))).state;
    expect(state.phase).toBe("exchange");
    // The President leaves: the Asshole's tribute is gone with them, and play starts once the vices are done.
    const t = pr.onPlayerRemoved!(state, "p1", ctx());
    expect(pr.getAwaitedPlayerIds(t.state)).toEqual(["p2"]);
    const g = ok(act(t.state, "p2", { type: "give", cardIds: [t.state.players[2]!.hand[0]!.id] }));
    expect(g.state.phase).toBe("playing");
    expect(pr.getPublicState(g.state).currentPlayerId).toBe("p0");
    expect(cardsInPlay(g.state)).toHaveLength(52);
  });
});

describe("whole games", () => {
  /** A random but legal move for whoever's awaited. */
  function randomMove(state: PresidentServerState, rng: (n: number) => number): [string, PresidentAction] {
    const [id] = pr.getAwaitedPlayerIds(state);
    const priv = pr.getPrivateState(state, id!);
    const shuffled = [...priv.hand].sort(() => rng(3) - 1);
    if (priv.mustGive) return [id!, { type: "give", cardIds: shuffled.slice(0, priv.mustGive).map((c) => c.id) }];
    if (priv.canPass && rng(5) === 0) return [id!, { type: "pass" }];
    const rank = priv.playableRanks[rng(priv.playableRanks.length)]!;
    const of = priv.hand.filter((c) => c.rank === rank);
    const count = state.trick.at(-1)?.cards.length ?? 1 + rng(of.length);
    return [id!, play(...of.slice(0, count).map((c) => c.id))];
  }

  it("conserves cards, terminates, places everyone, and swaps the right cards", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const n = 3 + (seed % 6);
      const settings: PresidentSettings = { rounds: 1 + (seed % 5), matchSkips: seed % 2 === 0 };
      const rng = seededRandomInt(seed * 13);
      // Every fifth game, someone walks out partway through.
      const leaveAt = seed % 5 === 0 ? 20 + rng(200) : -1;
      let state = pr.createGame(players(n), settings, { roundNumber: 1, dealerSeat: seed }, ctx(seed)).state;
      const dealtTo: string[][] = [state.players.map((p) => p.id)];

      for (let moves = 0; state.phase !== "finished"; moves++) {
        expect(moves).toBeLessThan(3000);
        let events: { event: PresidentEvent }[];
        if (moves === leaveAt) {
          const who = state.players.find((p) => !p.removed)!.id;
          const t = pr.onPlayerRemoved!(state, who, ctx(seed + moves));
          state = t.state;
          events = t.events;
        } else {
          const [id, action] = randomMove(state, rng);
          const t = ok(act(state, id, action, seed + moves));
          state = t.state;
          events = t.events;
        }
        if (state.phase !== "finished") expect(cardsInPlay(state).sort()).toEqual(makeDeck().map((c) => c.id).sort());
        for (const { event: e } of events) {
          if (e.type === "dealt") dealtTo.push(Object.keys(e.handSizes));
          // A tribute is always the giver's best cards at the time.
          if (e.type === "dealt" && state.phase === "exchange") {
            for (const s of state.exchange.filter((x) => x.kind === "tribute")) {
              const from = state.players.find((p) => p.id === s.fromId)!;
              expect(ids(bestCards([...from.hand, ...s.cards!], s.count))).toEqual(ids(s.cards!));
            }
          }
        }
        if (state.phase === "playing") {
          const cur = state.players[state.turnIndex]!;
          expect(cur.removed || cur.passed || !cur.hand.length).toBe(false);
        }
      }

      if (state.endReason === "done") {
        expect(state.history).toHaveLength(settings.rounds);
        // Each round's order is exactly the players dealt in, minus any who left before going out.
        state.history.forEach((order, r) => {
          expect(new Set(order).size).toBe(order.length);
          for (const id of order) expect(dealtTo[r]).toContain(id);
          if (leaveAt < 0) expect(order.sort()).toEqual([...dealtTo[r]!].sort());
        });
        if (leaveAt < 0) {
          const total = state.players.reduce((sum, p) => sum + p.points, 0);
          expect(total).toBe((settings.rounds * n * (n - 1)) / 2);
        }
      }
      const r = pr.getResult(state)!;
      expect(r.winnerIds.length).toBeGreaterThanOrEqual(1);
      const top = Math.max(...state.players.filter((p) => !p.removed).map((p) => p.points));
      for (const id of r.winnerIds) expect(state.players.find((p) => p.id === id)!.points).toBe(top);
      expect(r.standings).toHaveLength(n);
    }
  });
});
