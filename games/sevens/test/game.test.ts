import { seededRandomInt, type GameContext } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { sevensGame as sevens } from "../server/game.ts";
import { emptyBoard, getPlayableCards, makeDeck, parseCardId } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  type SevensBoardState,
  type SevensServerState,
  type SevensSettings,
} from "../shared/types.ts";

const ctx = (seed = 1): GameContext => ({ now: 0, randomInt: seededRandomInt(seed) });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

/** Builds a mid-game state directly, bypassing the deal. */
function stateWith(
  hands: string[][],
  opts: { board?: Partial<SevensBoardState>; turn?: number; settings?: Partial<SevensSettings> } = {},
): SevensServerState {
  const settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  return {
    phase: "playing",
    settings,
    players: hands.map((ids, i) => ({
      id: `p${i}`,
      hand: ids.map((id) => parseCardId(id, settings.acePosition)!),
      removed: false,
    })),
    board: { ...emptyBoard(), ...opts.board },
    dealerIndex: 0,
    turnIndex: opts.turn ?? 0,
    winnerId: null,
    turnNumber: 0,
  };
}

function play(state: SevensServerState, playerId: string, cardId: string) {
  return sevens.handleAction(state, playerId, { type: "play-card", cardId }, ctx());
}

function ok(result: ReturnType<typeof play>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.transition;
}

const eventTypes = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);

describe("createGame", () => {
  it("deals all 52 cards, left of dealer first, and never leaks hands publicly", () => {
    const t = sevens.createGame(players(5), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 2 }, ctx());
    const sizes = t.state.players.map((p) => p.hand.length);
    expect(sizes.reduce((a, b) => a + b)).toBe(52);
    // 52 / 5 → two extra cards, going to seats 3 and 4 (left of dealer 2).
    expect(sizes).toEqual([10, 10, 10, 11, 11]);

    const pub = JSON.stringify(sevens.getPublicState(t.state));
    expect(pub).not.toContain("hand");
    expect(sevens.getPublicState(t.state).dealerId).toBe("p2");
  });

  it("uses an injected deck verbatim", () => {
    const deck = makeDeck("high");
    const t = sevens.createGame(players(4), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 3 }, ctx(), { deck });
    // Dealer 3 → seat 0 gets deck[0], deck[4], …
    expect(t.state.players[0]!.hand.map((c) => c.id)).toContain(deck[0]!.id);
    expect(t.state.players[1]!.hand.map((c) => c.id)).toContain(deck[1]!.id);
  });

  it("starts left of the dealer, auto-passing until someone holds a seven", () => {
    // Suit-ordered deck, dealt round-robin: every seat gets a spread of ranks.
    const t = sevens.createGame(players(3), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(), {
      deck: makeDeck("high"),
    });
    const cur = t.state.players[t.state.turnIndex]!;
    expect(getPlayableCards(cur.hand, t.state.board).length).toBeGreaterThan(0);
    const passes = t.events.filter((e) => e.event.type === "passed");
    // Whoever was skipped truly had nothing.
    for (const p of passes) {
      const pid = (p.event as { playerId: string }).playerId;
      expect(getPlayableCards(t.state.players.find((x) => x.id === pid)!.hand, t.state.board)).toHaveLength(0);
    }
  });

  it("seven-of-diamonds rule: the holder starts and must open with it", () => {
    const settings = { ...DEFAULT_SETTINGS, startingRule: "seven-of-diamonds" as const };
    const t = sevens.createGame(players(4), settings, { roundNumber: 1, dealerSeat: 0 }, ctx(7));
    const holder = t.state.players[t.state.turnIndex]!;
    expect(holder.hand.some((c) => c.id === "diamonds-7")).toBe(true);
    expect(sevens.getPrivateState(t.state, holder.id).playableCardIds).toEqual(["diamonds-7"]);
  });
});

describe("handleAction", () => {
  const base = () =>
    stateWith([["clubs-7", "clubs-8", "hearts-2"], ["clubs-6", "spades-7"], ["hearts-7", "diamonds-9"]]);

  it("rejects playing out of turn", () => {
    const r = play(base(), "p1", "clubs-6");
    expect(r.ok || r.error.code).toBe("not-your-turn");
  });

  it("rejects cards the player doesn't hold", () => {
    const r = play(base(), "p0", "clubs-6");
    expect(r.ok || r.error.code).toBe("card-not-owned");
  });

  it("rejects illegal plays", () => {
    const r = play(base(), "p0", "clubs-8");
    expect(r.ok || r.error.code).toBe("illegal-play");
  });

  it("rejects unknown players and garbage ids", () => {
    expect(play(base(), "p9", "clubs-7").ok).toBe(false);
    const r = play(base(), "p0", "clubs-99");
    expect(r.ok || r.error.code).toBe("bad-card");
  });

  it("applies a legal play and advances the turn", () => {
    const t = ok(play(base(), "p0", "clubs-7"));
    expect(t.state.board.clubs).toEqual({ low: 7, high: 7 });
    expect(t.state.players[0]!.hand.map((c) => c.id)).not.toContain("clubs-7");
    expect(t.state.turnIndex).toBe(1);
    expect(eventTypes(t)).toEqual(["card-played"]);
  });

  it("never mutates the input state", () => {
    const s = base();
    const before = structuredClone(s);
    ok(play(s, "p0", "clubs-7"));
    expect(s).toEqual(before);
  });

  it("auto-passes players with no legal move", () => {
    // After p0 opens clubs, p1 holds nothing playable except… nothing: auto-pass to p2.
    const s = stateWith([["clubs-7", "hearts-2"], ["diamonds-2", "spades-9"], ["clubs-8", "hearts-3"]]);
    const t = ok(play(s, "p0", "clubs-7"));
    expect(eventTypes(t)).toEqual(["card-played", "passed"]);
    expect(t.events[1]!.event).toEqual({ type: "passed", playerId: "p1", auto: true });
    expect(t.state.turnIndex).toBe(2);
  });

  it("rejects a manual pass when a legal play exists", () => {
    const r = sevens.handleAction(base(), "p0", { type: "pass" }, ctx());
    expect(r.ok || r.error.code).toBe("must-play");
  });

  it("accepts a manual pass when no legal play exists", () => {
    // Only reachable by hand-building the state: settle() would have auto-passed.
    const s = stateWith([["hearts-2"], ["clubs-7"], ["hearts-7"]]);
    const t = ok(sevens.handleAction(s, "p0", { type: "pass" }, ctx()));
    expect(t.events[0]!.event).toEqual({ type: "passed", playerId: "p0", auto: false });
    expect(t.state.turnIndex).toBe(1);
  });

  it("allows passing with legal moves when forcedPlay is off", () => {
    const s = stateWith([["clubs-7"], ["clubs-8"], ["hearts-7"]], { settings: { forcedPlay: false } });
    expect(sevens.getPrivateState(s, "p0").canPass).toBe(true);
    expect(sevens.handleAction(s, "p0", { type: "pass" }, ctx()).ok).toBe(true);
  });

  it("the last card wins, and nothing is accepted afterwards", () => {
    const s = stateWith([["clubs-7"], ["clubs-8", "hearts-7"], ["hearts-8"]]);
    const t = ok(play(s, "p0", "clubs-7"));
    expect(t.state.phase).toBe("finished");
    expect(t.state.winnerId).toBe("p0");
    expect(eventTypes(t)).toEqual(["card-played", "game-over"]);
    expect(sevens.getResult(t.state)).toEqual({
      winnerIds: ["p0"],
      standings: [
        { playerId: "p0", value: 0 },
        { playerId: "p2", value: 1 },
        { playerId: "p1", value: 2 },
      ],
    });
    expect(sevens.getAwaitedPlayerIds(t.state)).toEqual([]);

    const again = play(t.state, "p1", "clubs-8");
    expect(again.ok || again.error.code).toBe("game-finished");
  });
});

describe("skipTurn", () => {
  it("advances even when the skipped player has legal moves", () => {
    const s = stateWith([["clubs-7"], ["hearts-7"], ["spades-7"]]);
    const t = sevens.skipTurn!(s, "p0", ctx());
    expect(t.state.turnIndex).toBe(1);
    expect(t.state.players[0]!.hand).toHaveLength(1);
    expect(eventTypes(t)).toEqual(["turn-skipped"]);
  });

  it("is a no-op for anyone but the current player", () => {
    const s = stateWith([["clubs-7"], ["hearts-7"], ["spades-7"]]);
    expect(sevens.skipTurn!(s, "p1", ctx())).toEqual({ state: s, events: [] });
  });
});

describe("onPlayerRemoved", () => {
  it("places ghost cards as soon as they're playable, chaining", () => {
    // p1 is removed holding 8♣ 9♣ 10♣. With 7♣ down, all three go down in one go.
    const s = stateWith([["hearts-7", "hearts-8"], ["clubs-8", "clubs-9", "clubs-10"], ["spades-7", "spades-8"], ["hearts-6"]], {
      board: { clubs: { low: 7, high: 7 } },
    });
    const t = sevens.onPlayerRemoved!(s, "p1", ctx());
    expect(eventTypes(t)).toEqual(["player-removed", "ghost-card-placed", "ghost-card-placed", "ghost-card-placed"]);
    expect(t.state.board.clubs).toEqual({ low: 7, high: 10 });
    expect(t.state.players[1]!.hand).toHaveLength(0);
    // Emptied ghost hand is not a win.
    expect(t.state.phase).toBe("playing");
    expect(t.state.winnerId).toBeNull();
  });

  it("holds ghosts until they become playable later", () => {
    const s = stateWith([["clubs-7", "hearts-2"], ["clubs-8"], ["spades-7", "hearts-3"]], { turn: 0 });
    const removed = sevens.onPlayerRemoved!(s, "p1", ctx());
    expect(removed.state.players[1]!.hand).toHaveLength(1); // 8♣ waits for 7♣

    const t = ok(play(removed.state, "p0", "clubs-7"));
    expect(eventTypes(t)).toContain("ghost-card-placed");
    expect(t.state.board.clubs).toEqual({ low: 7, high: 8 });
  });

  it("skips a removed player's turns", () => {
    const s = stateWith([["clubs-7", "clubs-9"], ["hearts-7"], ["clubs-8", "hearts-8"], ["spades-7"]]);
    const removed = sevens.onPlayerRemoved!(s, "p1", ctx()).state;
    // hearts-7 was a ghost and went straight down.
    expect(removed.board.hearts).toEqual({ low: 7, high: 7 });
    const t = ok(play(removed, "p0", "clubs-7"));
    expect(t.state.players[t.state.turnIndex]!.id).toBe("p2");
  });

  it("passes the turn on when the current player is removed", () => {
    const s = stateWith([["clubs-7"], ["hearts-7"], ["spades-7"]], { turn: 1 });
    const t = sevens.onPlayerRemoved!(s, "p1", ctx());
    expect(t.state.players[t.state.turnIndex]!.id).toBe("p2");
  });

  it("ends the game when fewer than two active players remain", () => {
    const s = stateWith([["clubs-7"], ["hearts-7"], ["spades-7"]]);
    const one = sevens.onPlayerRemoved!(s, "p1", ctx()).state;
    expect(one.phase).toBe("playing");
    const two = sevens.onPlayerRemoved!(one, "p2", ctx());
    expect(two.state.phase).toBe("finished");
    expect(two.state.winnerId).toBe("p0");
  });
});

describe("no-deadlock property", () => {
  it("someone can always move until the game ends, across random games with removals", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const rng = seededRandomInt(seed);
      const n = 3 + rng(6); // 3–8
      const settings: SevensSettings = {
        ...DEFAULT_SETTINGS,
        acePosition: rng(2) ? "high" : "low",
        startingRule: rng(2) ? "dealer-left" : "seven-of-diamonds",
      };
      let state = sevens.createGame(players(n), settings, { roundNumber: 1, dealerSeat: rng(n) }, ctx(seed)).state;

      for (let steps = 0; state.phase === "playing"; steps++) {
        expect(steps).toBeLessThan(600);
        const cur = state.players[state.turnIndex]!;
        expect(cur.removed).toBe(false);
        const legal = sevens.getPrivateState(state, cur.id).playableCardIds;
        expect(legal.length).toBeGreaterThan(0);

        // Occasionally the host removes someone (never below 2 active).
        const active = state.players.filter((p) => !p.removed);
        if (rng(40) === 0 && active.length > 2) {
          state = sevens.onPlayerRemoved!(state, active[rng(active.length)]!.id, ctx()).state;
          continue;
        }
        state = ok(play(state, cur.id, legal[rng(legal.length)]!)).state;
      }
      expect(state.winnerId).not.toBeNull();
    }
  });
});
