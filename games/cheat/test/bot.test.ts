import { BOT_MAX_RUN, seededRandomInt, type GameContext } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { cheatBot } from "../server/bot.ts";
import { cheatGame } from "../server/game.ts";
import { parseCardId } from "../shared/rules.ts";
import { DEFAULT_SETTINGS, type CheatAction, type CheatPrivateState, type CheatPublicState, type CheatSettings } from "../shared/types.ts";

const cards = (ids: string[]) => ids.map((id) => parseCardId(id)!);
/** The roll comes out high: no random move, no lie of two, no tack-on, and no call by chance. */
const high = { randomInt: (max: number) => max - 1, chance: () => 99 };
/** The roll comes out 0: the random move, the two-card lie, the tack-on, and a call by chance. */
const low = { randomInt: () => 0, chance: () => 0 };

function turnView(hand: string[], o: { claims?: number[]; rule?: "strict" | "near" } = {}) {
  const pub = { players: [], currentPlayerId: "me", claims: o.claims ?? [7], claimRule: o.rule ?? "strict", decks: 1, step: "play" } as unknown as CheatPublicState;
  const priv: CheatPrivateState = { hand: cards(hand), myPlay: null, canPlay: true, canCall: false };
  return { playerId: "me", public: pub, private: priv };
}

function windowView(
  hand: string[],
  o: { count?: number; claim?: number; ownerCards?: number; pile?: number; decks?: number; canCall?: boolean } = {},
) {
  const pub = {
    players: [
      { id: "o", cardCount: o.ownerCards ?? 8, removed: false, passed: false },
      { id: "me", cardCount: hand.length, removed: false, passed: false },
    ],
    currentPlayerId: null,
    claims: [],
    decks: o.decks ?? 1,
    step: "window",
    pileCount: o.pile ?? 6,
    lastPlay: { playerId: "o", count: o.count ?? 2, claim: o.claim ?? 7 },
  } as unknown as CheatPublicState;
  const priv: CheatPrivateState = { hand: cards(hand), myPlay: null, canPlay: false, canCall: o.canCall ?? true };
  return { playerId: "me", public: pub, private: priv };
}

describe("cheatBot play", () => {
  it("plays every copy of the rank it must claim", () => {
    const m = cheatBot.decide(turnView(["hearts-7", "clubs-7", "spades-7", "hearts-2", "clubs-9"]), high) as Extract<CheatAction, { type: "play" }>;
    expect(m.claim).toBe(7);
    expect([...m.cardIds].sort()).toEqual(["clubs-7", "hearts-7", "spades-7"]);
  });

  it("picks the allowed rank it holds most of when it may choose", () => {
    const v = turnView(["hearts-6", "clubs-8", "spades-8", "hearts-2"], { claims: [6, 7, 8], rule: "near" });
    const m = cheatBot.decide(v, high) as Extract<CheatAction, { type: "play" }>;
    expect(m.claim).toBe(8);
    expect(m.cardIds.sort()).toEqual(["clubs-8", "spades-8"]);
  });

  it("lies with one card of the rarest rank when it holds none", () => {
    const v = turnView(["hearts-2", "clubs-2", "spades-9", "hearts-4", "clubs-4"]);
    const m = cheatBot.decide(v, high) as Extract<CheatAction, { type: "play" }>;
    expect(m).toEqual({ type: "play", cardIds: ["spades-9"], claim: 7 });
  });

  it("sometimes lies with two cards", () => {
    const m = cheatBot.decide(turnView(["hearts-2", "spades-9", "hearts-4"]), { ...high, randomInt: (max) => (max === 100 ? 0 : max - 1) }) as Extract<CheatAction, { type: "play" }>;
    expect(m.cardIds).toHaveLength(2);
  });

  it("always plays honest with two cards or fewer left, even on the low roll", () => {
    for (const hand of [["hearts-7", "spades-3"], ["hearts-7"]]) {
      const m = cheatBot.decide(turnView(hand), low) as Extract<CheatAction, { type: "play" }>;
      expect(m).toEqual({ type: "play", cardIds: ["hearts-7"], claim: 7 });
    }
  });

  it("lies with one card, not two, with two cards left, even on the low roll", () => {
    const m = cheatBot.decide(turnView(["hearts-2", "spades-9"]), low) as Extract<CheatAction, { type: "play" }>;
    expect(m.type).toBe("play");
    expect(m.cardIds).toHaveLength(1);
  });

  it("can tack one junk card onto an honest play", () => {
    const v = turnView(["hearts-7", "spades-3", "clubs-9", "hearts-2"]);
    const m = cheatBot.decide(v, { randomInt: (max) => (max === 100 ? 0 : max - 1), chance: () => 0 }) as Extract<CheatAction, { type: "play" }>;
    expect(m.cardIds).toHaveLength(2);
    expect(m.cardIds).toContain("hearts-7");
  });

  it("does nothing when it is not its turn", () => {
    const v = turnView(["hearts-7"]);
    expect(cheatBot.decide({ ...v, private: { ...v.private, canPlay: false } }, high)).toBeNull();
    expect(cheatBot.decide({ ...v, public: { ...v.public, currentPlayerId: "o" } }, high)).toBeNull();
  });
});

describe("cheatBot call window", () => {
  it("calls a play that cannot be true", () => {
    // Three Sevens claimed and it holds two: five is more than one deck.
    expect(cheatBot.decide(windowView(["hearts-7", "clubs-7", "hearts-2"], { count: 3 }), high)).toEqual({ type: "call" });
    // Two decks hold eight.
    expect(cheatBot.decide(windowView(["hearts-7", "clubs-7", "hearts-2"], { count: 3, decks: 2 }), high)).toEqual({ type: "pass" });
    expect(cheatBot.decide(windowView(Array(5).fill("hearts-7"), { count: 4, decks: 2 }), high)).toEqual({ type: "call" });
  });

  it("calls a play that empties the owner's hand", () => {
    expect(cheatBot.decide(windowView(["hearts-2"], { ownerCards: 0 }), high)).toEqual({ type: "call" });
  });

  it("passes on a high roll and calls on a low one", () => {
    expect(cheatBot.decide(windowView(["hearts-2"]), high)).toEqual({ type: "pass" });
    expect(cheatBot.decide(windowView(["hearts-2"]), low)).toEqual({ type: "call" });
  });

  it("calls more for a big claim and less into a big pile", () => {
    const at = (roll: number) => ({ randomInt: () => 0, chance: () => roll });
    expect(cheatBot.decide(windowView(["hearts-2"], { count: 2 }), at(20))).toEqual({ type: "pass" });
    expect(cheatBot.decide(windowView(["hearts-2"], { count: 3 }), at(20))).toEqual({ type: "call" });
    expect(cheatBot.decide(windowView(["hearts-2"], { count: 3, pile: 30 }), at(20))).toEqual({ type: "pass" });
    expect(cheatBot.decide(windowView(["hearts-2"], { count: 3, pile: 30 }), at(10))).toEqual({ type: "call" });
  });

  it("shares the call rate among the seats that could call", () => {
    const seven = (roll: number, count = 2) => {
      const v = windowView(["hearts-2"], { count });
      const others = Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, cardCount: 8, removed: false, passed: i < 2 }));
      v.public = { ...v.public, players: [...v.public.players, ...others] } as CheatPublicState;
      return cheatBot.decide(v, { randomInt: () => 0, chance: () => roll });
    };
    // 6 callers (me and 5 more; the two who passed still count): 12 / 6 = 2 percent, and 30 / 6 = 5.
    expect(seven(1)).toEqual({ type: "call" });
    expect(seven(2)).toEqual({ type: "pass" });
    expect(seven(4, 3)).toEqual({ type: "call" });
    expect(seven(5, 3)).toEqual({ type: "pass" });
  });

  it("gives no move when it cannot call, even on a sure lie", () => {
    const v = windowView(["hearts-7", "clubs-7"], { count: 3, canCall: false });
    expect(cheatBot.decide(v, high)).toBeNull();
    expect(cheatBot.decide(windowView(["hearts-2"], { ownerCards: 0, canCall: false }), low)).toBeNull();
  });

  it("makes the same choice when asked again", () => {
    const v = windowView(["hearts-2", "clubs-9"], { count: 2, pile: 11 });
    const keyed = (seed: number) => ({ randomInt: seededRandomInt(seed), chance: (k: string) => k.length * 7 % 100 });
    const first = cheatBot.decide(v, keyed(1));
    for (let seed = 2; seed < 20; seed++) expect(cheatBot.decide(v, keyed(seed))).toEqual(first);
  });
});

describe("cheat with computer players: stats", () => {
  const ctx = (): GameContext => ({ now: 0, randomInt: seededRandomInt(1) });
  it("counts a lie and a right call when a bot calls", () => {
    const hands = [["hearts-2", "clubs-3", "hearts-9"], ["hearts-5", "clubs-5", "hearts-K"], ["spades-5", "clubs-8", "hearts-4"]];
    let state = cheatGame.createGame([{ id: "a" }, { id: "b" }, { id: "c" }], DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 2 }, ctx()).state;
    state = {
      ...state,
      players: state.players.map((p, i) => ({ ...p, hand: cards(hands[i]!) })),
    };
    // a has no Ace and lies.
    const played = cheatGame.handleAction(state, "a", { type: "play", cardIds: ["hearts-2"] }, ctx());
    if (!played.ok) throw new Error(played.error.code);
    state = played.transition.state;
    const get = (id: string) => ({
      playerId: id,
      public: cheatGame.getPublicState(state),
      private: cheatGame.getPrivateState(state, id),
    });
    // The bot at seat b holds no Ace, and a claimed one Ace: not certain, so make b call by a low roll.
    const move = cheatBot.decide(get("b"), low);
    expect(move).toEqual({ type: "call" });
    const called = cheatGame.handleAction(state, "b", move as CheatAction, ctx());
    if (!called.ok) throw new Error(called.error.code);
    expect(cheatGame.partyStats!(called.transition.state)).toEqual({ a: { liesTold: 1 }, b: { rightCalls: 1 } });
    // After the call the window is closed: no move for the other bot.
    const after = called.transition.state;
    expect(cheatBot.decide({ playerId: "c", public: cheatGame.getPublicState(after), private: cheatGame.getPrivateState(after, "c") }, low)).toBeNull();
    expect(JSON.stringify([cheatGame.getPublicState(after), cheatGame.getPrivateState(after, "c")])).not.toContain("liesTold");
  });

  it("after a pass, the bot has no more moves in that window", () => {
    let state = cheatGame.createGame([{ id: "a" }, { id: "b" }, { id: "c" }], DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 2 }, ctx()).state;
    const first = state.players[state.turnIndex]!;
    const play = cheatGame.handleAction(state, first.id, { type: "play", cardIds: [first.hand[0]!.id] }, ctx());
    if (!play.ok) throw new Error(play.error.code);
    state = play.transition.state;
    const other = state.players.find((p) => p.id !== first.id)!.id;
    const view = () => ({ playerId: other, public: cheatGame.getPublicState(state), private: cheatGame.getPrivateState(state, other) });
    const move = cheatBot.decide(view(), high);
    expect(move).toEqual({ type: "pass" });
    const res = cheatGame.handleAction(state, other, move as CheatAction, ctx());
    if (!res.ok) throw new Error(res.error.code);
    state = res.transition.state;
    expect(cheatBot.decide(view(), low)).toBeNull();
  });
});

describe("cheatBot all-bot games", () => {
  // Table size is capped at 7 (Ruling P2-E). Games take 200 to 500 moves (a few thousand at most),
  // so 200 seeds fit at the smaller sizes. Seven-player games are the longest: 200 seeds took 65 s
  // on a busy machine, so they run 80. The extra settings run at 50 seeds: "one deck" is the default at
  // 4 players, so only near claims and two decks (the default at 7) need their own runs.
  const extras: [string, Partial<CheatSettings>, number][] = [
    ["near claims", { claims: "near" }, 4],
    ["two decks", { decks: 2 }, 6],
  ];
  const check = (players: number, name: string, s: Partial<CheatSettings>, seeds: number) => {
    for (let seed = 1; seed <= seeds; seed++) {
      const run = playBots(cheatGame, { players, seed, settings: { ...DEFAULT_SETTINGS, ...s }, maxMoves: 20_000 });
      const at = `${name} seed ${seed}, ${players} players`;
      expect(run.rejected, at).toEqual([]);
      expect(run.stuck, at).toEqual([]);
      expect(run.outcome, at).not.toBeNull();
      expect(run.longestRun, at).toBeLessThan(BOT_MAX_RUN);
    }
  };
  const m = cheatGame.manifest;
  const sizes = [...new Set([m.minPlayers, m.bestMinPlayers ?? m.minPlayers, Math.min(m.maxPlayers, 7)])];
  it.each(sizes)("games finish with %i players", (players) => {
    check(players, "defaults", {}, players >= 7 ? 80 : 200);
  }, 60_000);

  it.each(extras)("games finish with %s", (name, s, players) => {
    check(players, name, s, 50);
  }, 30_000);

  it("stays fast", () => {
    let moves = 0;
    const start = performance.now();
    for (let seed = 1; seed <= 20; seed++) moves += playBots(cheatGame, { players: 4, seed }).moves;
    expect((performance.now() - start) / moves).toBeLessThan(2);
  });
});
