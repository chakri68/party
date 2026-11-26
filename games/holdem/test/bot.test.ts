import { BOT_MAX_RUN, seededRandomInt, shuffle, type AnyGameDefinition, type BotContext, type BotView, type GameContext } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { equity, equityTrials, holdemBot, omahaPreflopTier, preflopTier, raiseThreshold } from "../server/bot.ts";
import { holdemGame } from "../server/game.ts";
import { bestHand, bestHandFor, compareHands, handScore, handScoreFor, makeDeck, parseCardId } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  type HoldemAction,
  type HoldemPrivateState,
  type HoldemPublicPlayer,
  type HoldemPublicState,
  type HoldemSettings,
  type LegalActions,
  type Variant,
} from "../shared/types.ts";

type View = BotView<HoldemPublicState, HoldemPrivateState>;

/** "As Kd Th" → cards. */
function c(text: string) {
  const suit = { s: "spades", h: "hearts", c: "clubs", d: "diamonds" } as const;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => parseCardId(`${suit[t.at(-1) as keyof typeof suit]}-${t.slice(0, -1).replace("T", "10")}`)!);
}

/** No slip (the first roll is high), then a fixed seed for the deals and sizes. */
function steady(seed = 1): BotContext {
  const rng = seededRandomInt(seed);
  let first = true;
  return {
    randomInt: (max) => {
      if (first) {
        first = false;
        return max - 1;
      }
      return rng(max);
    },
    chance: () => 99,
  };
}
/** Every roll at its top: no slip, no bluff, no loose call, the biggest size. */
const high: BotContext = { randomInt: (max) => max - 1, chance: () => 99 };

function player(id: string, o: Partial<HoldemPublicPlayer> = {}): HoldemPublicPlayer {
  return { id, stack: 1500, bet: 0, inHand: true, folded: false, allIn: false, sittingOut: false, away: false, removed: false, out: false, pendingRebuy: false, cards: null, ...o };
}

function view(o: {
  hole?: string;
  board?: string;
  opponents?: number;
  legal?: Partial<LegalActions> | null;
  pot?: number;
  currentBet?: number;
  me?: Partial<HoldemPublicPlayer>;
  others?: Partial<HoldemPublicPlayer>;
  flags?: Partial<Pick<HoldemPrivateState, "canBack" | "canRebuy" | "canShow">>;
  bb?: number;
  variant?: Variant;
}): View {
  const bb = o.bb ?? 20;
  const board = c(o.board ?? "");
  const legal: LegalActions | null =
    o.legal === null ? null : { check: true, call: 0, minRaiseTo: 2 * bb, maxRaiseTo: 1500, maxIsAllIn: true, opening: true, ...o.legal };
  const others = Array.from({ length: o.opponents ?? 1 }, (_, i) => player(`o${i}`, o.others));
  const pub = {
    variant: o.variant ?? "holdem",
    step: board.length === 0 ? "preflop" : board.length === 3 ? "flop" : board.length === 4 ? "turn" : "river",
    handNumber: 1,
    level: 1,
    sb: bb / 2,
    bb,
    players: [player("me", o.me), ...others],
    board,
    pot: o.pot ?? 3 * bb,
    pots: [],
    currentBet: o.currentBet ?? 0,
    currentPlayerId: legal ? "me" : "o0",
  } as unknown as HoldemPublicState;
  const priv: HoldemPrivateState = {
    hole: c(o.hole ?? "As Ks"),
    best: null,
    legal,
    canShow: false,
    canBack: false,
    canRebuy: false,
    ...o.flags,
  };
  return { playerId: "me", public: pub, private: priv };
}

describe("holdemBot off its turn", () => {
  it("rebuys, comes back, and never shows", () => {
    expect(holdemBot.decide(view({ legal: null, flags: { canRebuy: true } }), high)).toEqual({ type: "rebuy" });
    expect(holdemBot.decide(view({ legal: null, flags: { canBack: true } }), high)).toEqual({ type: "back" });
    expect(holdemBot.decide(view({ legal: null, flags: { canShow: true } }), high)).toBeNull();
  });

  it("does nothing when it is not its turn and no flag is set", () => {
    expect(holdemBot.decide(view({ legal: null }), high)).toBeNull();
  });

  it("sends back and rebuy only when the server takes them", () => {
    const ctx: GameContext = { now: 0, randomInt: seededRandomInt(3) };
    const base = holdemGame.createGame([{ id: "a" }, { id: "b" }, { id: "c" }], { ...DEFAULT_SETTINGS, rebuys: "early" }, { roundNumber: 1, dealerSeat: 0 }, ctx).state;
    const ask = (s: typeof base, id: string) =>
      holdemBot.decide({ playerId: id, public: holdemGame.getPublicState(s), private: holdemGame.getPrivateState(s, id) }, high);

    // Sitting out, not on turn: back, and then nothing more.
    const sitting = structuredClone(base);
    const off = sitting.players.find((p) => p !== sitting.players[sitting.turnIndex])!;
    off.sittingOut = true;
    expect(ask(sitting, off.id)).toEqual({ type: "back" });
    const back = holdemGame.handleAction(sitting, off.id, { type: "back" }, ctx);
    if (!back.ok) throw new Error(back.error.code);
    expect(ask(back.transition.state, off.id)).toBeNull();

    // Busted between hands with a rebuy open: rebuy once, then nothing more.
    const busted = structuredClone(base);
    busted.step = "between-hands";
    busted.turnIndex = -1;
    busted.players[0]!.stack = 0;
    busted.players[0]!.pendingRebuy = true;
    expect(ask(busted, "a")).toEqual({ type: "rebuy" });
    const rebuy = holdemGame.handleAction(busted, "a", { type: "rebuy" }, ctx);
    if (!rebuy.ok) throw new Error(rebuy.error.code);
    expect(ask(rebuy.transition.state, "a")).toBeNull();
  });
});

describe("holdemBot preflop", () => {
  it("ranks hands in five tiers", () => {
    expect(preflopTier(...(c("As Ad") as [never, never]))).toBe(1);
    expect(preflopTier(...(c("As Kd") as [never, never]))).toBe(1);
    expect(preflopTier(...(c("8s 8d") as [never, never]))).toBe(2);
    expect(preflopTier(...(c("Ah 5h") as [never, never]))).toBe(3);
    expect(preflopTier(...(c("9h 8h") as [never, never]))).toBe(4);
    expect(preflopTier(...(c("7s 2d") as [never, never]))).toBe(5);
  });

  it("raises a strong hand to about 3 big blinds", () => {
    const v = view({ hole: "Qs Qd", opponents: 5, currentBet: 20, legal: { check: false, call: 20, minRaiseTo: 40 } });
    expect(holdemBot.decide(v, high)).toEqual({ type: "raise", to: 60 });
  });

  it("folds trash to a big raise", () => {
    const v = view({ hole: "7s 2d", opponents: 5, currentBet: 200, pot: 230, legal: { check: false, call: 200, minRaiseTo: 380 } });
    expect(holdemBot.decide(v, high)).toEqual({ type: "fold" });
    // Even the loose call is only for a cheap bet.
    expect(holdemBot.decide(v, { randomInt: (max) => (max === 10 ? 9 : 0), chance: () => 0 })).toEqual({ type: "fold" });
  });

  it("checks trash when it is free", () => {
    const v = view({ hole: "7s 2d", opponents: 5, currentBet: 20, me: { bet: 20 }, legal: { check: true, call: 0 } });
    expect(holdemBot.decide(v, high)).toEqual({ type: "check" });
  });

  it("calls a playable hand up to about 4 big blinds", () => {
    const at = (bet: number) =>
      holdemBot.decide(view({ hole: "Ah 5h", opponents: 5, currentBet: bet, legal: { check: false, call: bet, minRaiseTo: 2 * bet } }), high);
    expect(at(80)).toEqual({ type: "call" });
    expect(at(120)).toEqual({ type: "fold" });
  });

  it("pushes or folds with a short stack", () => {
    const short = { me: { stack: 140 }, opponents: 5, currentBet: 20, legal: { check: false, call: 20, minRaiseTo: 40, maxRaiseTo: 140 } };
    expect(holdemBot.decide(view({ ...short, hole: "Ah 5h" }), high)).toEqual({ type: "all-in" });
    expect(holdemBot.decide(view({ ...short, hole: "9h 8h" }), high)).toEqual({ type: "fold" });
  });
});

describe("holdemBot after the flop", () => {
  it("goes all-in with a hand that cannot lose", () => {
    const v = view({ hole: "As Ks", board: "Qs Js Ts 2d 3c", opponents: 3, pot: 300 });
    expect(holdemBot.decide(v, steady())).toEqual({ type: "all-in" });
  });

  it("folds nothing to a big bet on the river", () => {
    const v = view({ hole: "7s 2d", board: "As Kh Qc 9d 4h", opponents: 2, currentBet: 400, pot: 600, legal: { check: false, call: 400, minRaiseTo: 800 } });
    expect(holdemBot.decide(v, steady())).toEqual({ type: "fold" });
  });

  it("bets a good hand at half to three quarters of the pot", () => {
    // Second pair heads-up: about 0.68, over the raise line and under the all-in one.
    for (let seed = 1; seed <= 10; seed++) {
      const move = holdemBot.decide(view({ hole: "7h 6h", board: "Ac 7s 2d", opponents: 1, pot: 200 }), steady(seed));
      expect(move?.type).toBe("raise");
      const to = (move as Extract<HoldemAction, { type: "raise" }>).to;
      expect(to).toBeGreaterThanOrEqual(100);
      expect(to).toBeLessThanOrEqual(150);
    }
  });

  it("can raise back with good equity facing a bet, not only go all-in", () => {
    // Facing a bet with 2 opponents, equity of about 0.77 is under the all-in line (0.8).
    for (const opponents of [1, 2, 4]) {
      expect(raiseThreshold(opponents, 100)).toBeLessThan(0.77);
      expect(raiseThreshold(opponents, 0)).toBeLessThan(raiseThreshold(opponents, 100));
    }
  });

  it("never makes an illegal move", () => {
    const rng = seededRandomInt(99);
    for (let i = 0; i < 400; i++) {
      const cards = shuffle(makeDeck(), rng);
      const boardSize = [0, 3, 4, 5][rng(4)]!;
      const currentBet = rng(3) === 0 ? 0 : 20 * (1 + rng(30));
      const myBet = rng(2) ? 0 : Math.min(currentBet, 20 * rng(5));
      const stack = 1 + rng(3000);
      const owed = Math.min(Math.max(0, currentBet - myBet), stack);
      const max = myBet + stack;
      const canRaise = max > currentBet && rng(4) > 0;
      const legal: LegalActions = {
        check: owed === 0,
        call: owed,
        minRaiseTo: canRaise ? Math.min(currentBet + 20 * (1 + rng(10)), max) : null,
        maxRaiseTo: canRaise ? max : null,
        maxIsAllIn: true,
        opening: currentBet === 0,
      };
      const v = view({ opponents: 1 + rng(6), currentBet, pot: currentBet + rng(5000), me: { stack, bet: myBet }, legal });
      const pub = { ...v.public, board: cards.slice(2, 2 + boardSize) };
      const move = holdemBot.decide({ ...v, public: pub, private: { ...v.private, hole: cards.slice(0, 2) } }, { randomInt: rng, chance: () => 50 });
      const at = `case ${i}: ${JSON.stringify(legal)} -> ${JSON.stringify(move)}`;
      expect(move, at).not.toBeNull();
      if (move!.type === "check") expect(legal.check, at).toBe(true);
      if (move!.type === "call") expect(legal.call, at).toBeGreaterThan(0);
      if (move!.type === "raise") {
        expect(Number.isInteger(move!.to), at).toBe(true);
        expect(move!.to, at).toBeGreaterThanOrEqual(legal.minRaiseTo!);
        expect(move!.to, at).toBeLessThanOrEqual(legal.maxRaiseTo!);
      }
      if (move!.type === "all-in") expect(legal.maxRaiseTo !== null || legal.call > 0, at).toBe(true);
    }
  });

  it("decides in under 20 ms on the river with 5 opponents", () => {
    // Quads lose to almost nothing: no early way out, every deal runs to the last opponent.
    const v = view({ hole: "9s 9d", board: "9h 9c 4d Kh 2s", opponents: 5, pot: 500 });
    for (let i = 0; i < 5; i++) holdemBot.decide(v, steady(i));
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      holdemBot.decide(v, steady(i));
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    expect(times[10]).toBeLessThan(20);
  });
});

describe("holdemBot hand reading", () => {
  // As the table plays it: two hole cards each and five shared board cards.
  it("scores hands in the same order as the game", () => {
    const rng = seededRandomInt(5);
    for (let i = 0; i < 3000; i++) {
      const cards = shuffle(makeDeck(), rng);
      const board = cards.slice(4, 9);
      const a = [...cards.slice(0, 2), ...board];
      const b = [...cards.slice(2, 4), ...board];
      expect(Math.sign(handScore(a) - handScore(b)), `${a.map((x) => x.id)} vs ${b.map((x) => x.id)}`).toBe(
        Math.sign(compareHands(bestHand(a), bestHand(b))),
      );
    }
  });

  it.each([
    ["the board plays: a tie", "As Ks Qd Jc Th", "2c 3d", "4h 5c", 0],
    ["a wheel (A to 5) beats a pair", "3c 4s 5h Kd 9c", "Ah 2d", "Kh Qd", 1],
    ["a wheel loses to a 7-high straight", "3c 4s 5h Kd 9c", "Ah 2d", "6c 7d", -1],
    ["two trips make a full house: the second trips is the pair", "Kh Kd Ks 7c 2d", "7d 7h", "2s Qc", 1],
    ["a six-card flush counts its top five", "2h 5h 8h Jh Kh", "3h 9c", "4h 9d", -1],
    ["quads: the best kicker wins", "9s 9h 9d 9c 2h", "Kd 3c", "Qd Jc", 1],
    ["quads: a kicker on the board ties", "9s 9h 9d 9c Ah", "Kd 3c", "Qd Jc", 0],
    ["a straight flush beats a flush", "5h 6h 7h 8h Kd", "9h 2c", "Ah 2d", 1],
    ["trips and two pairs: the higher pair plays", "Kh Kd 7c 7d 2s", "Ks 2d", "Kc 3h", 0],
    ["two trips equal trips and a pair", "Kh Kd 7c 7d 2s", "Ks 7h", "Kc 2d", 0],
    ["full house: the trips rank counts first", "Kh Kd 7c 7d 2s", "7h 3c", "Ks 3d", -1],
    ["full house: same trips, the pair decides", "Kh Kd Ks 5c 2d", "Qh Qd", "7h 7d", 1],
    ["quads and trips: quads, with the best kicker", "9s 9h 9d 9c 7d", "Ks 7h", "7c 7s", 1],
  ] as const)("%s", (_, board, holeA, holeB, want) => {
    const a = c(`${holeA} ${board}`);
    const b = c(`${holeB} ${board}`);
    expect(Math.sign(handScore(a) - handScore(b))).toBe(want);
    expect(Math.sign(compareHands(bestHand(a), bestHand(b)))).toBe(want);
  });

  it("uses face-up cards and deals only the hidden ones", () => {
    const board = c("Kh 8d 3c 2s 5h");
    // Their Aces are face up: a pair of Kings loses to them, three Kings beat them.
    expect(equity("holdem", c("Ks 7d"), board, [c("As Ad")], 200, seededRandomInt(1))).toBe(0);
    expect(equity("holdem", c("Ks Kd"), board, [c("As Ad")], 200, seededRandomInt(1))).toBe(1);
    // A tie splits.
    expect(equity("holdem", c("Ac 4d"), board, [c("As 4c")], 200, seededRandomInt(1))).toBe(0.5);
  });

  it("finds about the right share against hidden hands", () => {
    const aces = equity("holdem", c("As Ad"), [], [null], 200, seededRandomInt(2));
    expect(aces).toBeGreaterThan(0.75);
    expect(aces).toBeLessThan(0.95);
    const trash = equity("holdem", c("7s 2d"), [], [null, null, null, null], 200, seededRandomInt(2));
    expect(trash).toBeLessThan(0.2);
  });
});

describe("holdemBot in Omaha", () => {
  const omaha = { variant: "omaha" } as const;
  /** The 90th percentile of 30 timed decisions, in ms, after a few to warm up. */
  const p90Ms = (v: View) => {
    for (let i = 0; i < 5; i++) holdemBot.decide(v, steady(i));
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      holdemBot.decide(v, steady(i));
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return times[26]!;
  };

  it("ranks starting hands by pairs, suits, close ranks and high cards across all 4", () => {
    expect(omahaPreflopTier(c("As Ks Ah Kh"))).toBe(1); // two pairs, two suits, all high
    expect(omahaPreflopTier(c("Ks Qs Jh Th"))).toBe(1); // four in a row, two suits
    expect(omahaPreflopTier(c("Js Th 9s 8h"))).toBe(2); // four in a row, two suits
    expect(omahaPreflopTier(c("Jh Th 9c 8d"))).toBe(3); // four in a row, one suit
    expect(omahaPreflopTier(c("As Ad 7c 2h"))).toBe(2); // Aces, nothing else
    expect(omahaPreflopTier(c("6s 7h 8s 9h"))).toBe(3); // a middle run, two suits
    // Low runs make low straights, which lose to higher ones.
    expect(omahaPreflopTier(c("2c 3c 4d 5d"))).toBe(4);
    expect(omahaPreflopTier(c("As 2s 3h 4h"))).toBe(3);
    expect(omahaPreflopTier(c("9s 9d 9h 2c"))).toBeGreaterThanOrEqual(4); // three of a kind blocks itself
    expect(omahaPreflopTier(c("Kc 8d 4h 2s"))).toBe(5); // nothing works together
  });

  it("throws away about half of all starting hands", () => {
    const rng = seededRandomInt(11);
    const counts = [0, 0, 0, 0, 0, 0];
    const n = 20_000;
    for (let i = 0; i < n; i++) counts[omahaPreflopTier(shuffle(makeDeck(), rng).slice(0, 4))]!++;
    const share = (tier: number) => counts[tier]! / n;
    expect(share(5)).toBeGreaterThan(0.38);
    expect(share(5)).toBeLessThan(0.52);
    expect(share(1)).toBeLessThan(0.07);
    expect(share(1) + share(2)).toBeLessThan(0.18);
  });

  it("raises a top starting hand and folds trash to a raise", () => {
    const raise = view({ ...omaha, hole: "As Ks Ah Kh", opponents: 5, currentBet: 20, legal: { check: false, call: 20, minRaiseTo: 40, maxRaiseTo: 70, maxIsAllIn: false } });
    expect(holdemBot.decide(raise, high)).toEqual({ type: "raise", to: 60 });
    const trash = view({ ...omaha, hole: "Kc 8d 4h 2s", opponents: 5, currentBet: 200, pot: 230, legal: { check: false, call: 200, minRaiseTo: 380, maxRaiseTo: 630, maxIsAllIn: false } });
    expect(holdemBot.decide(trash, high)).toEqual({ type: "fold" });
  });

  it("bets the pot, not all-in, with the best hand under the pot limit", () => {
    // A royal flush: As Ks in hand, Qs Js Ts on the board.
    const v = view({ ...omaha, hole: "As Ks 7c 8d", board: "Qs Js Ts", opponents: 2, pot: 300, legal: { maxRaiseTo: 300, maxIsAllIn: false } });
    expect(holdemBot.decide(v, steady())).toEqual({ type: "raise", to: 300 });
    const allIn = view({ ...omaha, hole: "As Ks 7c 8d", board: "Qs Js Ts", opponents: 2, pot: 300, me: { stack: 200 }, legal: { maxRaiseTo: 200, maxIsAllIn: true } });
    expect(holdemBot.decide(allIn, steady())).toEqual({ type: "all-in" });
  });

  it("reads hands by the 2+3 rule", () => {
    const board = c("Ah Kh 7h 2h 9c");
    // One heart in hand is no flush: their pair of Aces wins every time.
    expect(equity("omaha", c("Qh 3s 4d 8c"), board, [c("Ac 5d 6s Tc")], 50, seededRandomInt(1))).toBe(0);
    // Two hearts in hand is a flush.
    expect(equity("omaha", c("Qh 3h 4d 8c"), board, [c("Ac 5d 6s Tc")], 50, seededRandomInt(1))).toBe(1);
    // Hidden hands get 4 cards: Aces against 8 hidden hands is far from a sure thing.
    const aces = equity("omaha", c("As Ad 7c 2h"), [], [null, null, null, null, null, null, null, null], equityTrials("omaha", 8), seededRandomInt(2));
    expect(aces).toBeGreaterThan(0.05);
    expect(aces).toBeLessThan(0.4);
  });

  it("scores Omaha hands in the same order as the game", () => {
    const rng = seededRandomInt(6);
    for (let i = 0; i < 1000; i++) {
      const cards = shuffle(makeDeck(), rng);
      const board = cards.slice(8, 13);
      const a = cards.slice(0, 4);
      const b = cards.slice(4, 8);
      const at = `${a.map((x) => x.id)} vs ${b.map((x) => x.id)} on ${board.map((x) => x.id)}`;
      expect(Math.sign(handScoreFor("omaha", a, board) - handScoreFor("omaha", b, board)), at).toBe(
        Math.sign(compareHands(bestHandFor("omaha", a, board), bestHandFor("omaha", b, board))),
      );
    }
  });

  it("never makes an illegal move under the pot limit", () => {
    const rng = seededRandomInt(98);
    for (let i = 0; i < 300; i++) {
      const cards = shuffle(makeDeck(), rng);
      const boardSize = [0, 3, 4, 5][rng(4)]!;
      const currentBet = rng(3) === 0 ? 0 : 20 * (1 + rng(30));
      const myBet = rng(2) ? 0 : Math.min(currentBet, 20 * rng(5));
      const stack = 1 + rng(3000);
      const pot = currentBet + rng(2000);
      const owed = Math.min(Math.max(0, currentBet - myBet), stack);
      const all = myBet + stack;
      const cap = Math.min(all, Math.max(currentBet + pot + owed, currentBet + 20));
      const canRaise = all > currentBet && rng(4) > 0;
      const legal: LegalActions = {
        check: owed === 0,
        call: owed,
        minRaiseTo: canRaise ? Math.min(currentBet + 20 * (1 + rng(10)), cap) : null,
        maxRaiseTo: canRaise ? cap : null,
        maxIsAllIn: cap === all,
        opening: currentBet === 0,
      };
      const v = view({ variant: "omaha", opponents: 1 + rng(8), currentBet, pot, me: { stack, bet: myBet }, legal });
      const pub = { ...v.public, board: cards.slice(4, 4 + boardSize) };
      const move = holdemBot.decide({ ...v, public: pub, private: { ...v.private, hole: cards.slice(0, 4) } }, { randomInt: rng, chance: () => 50 });
      const at = `case ${i}: ${JSON.stringify(legal)} -> ${JSON.stringify(move)}`;
      expect(move, at).not.toBeNull();
      if (move!.type === "check") expect(legal.check, at).toBe(true);
      if (move!.type === "call") expect(legal.call, at).toBeGreaterThan(0);
      if (move!.type === "raise") {
        expect(Number.isInteger(move!.to), at).toBe(true);
        expect(move!.to, at).toBeGreaterThanOrEqual(legal.minRaiseTo!);
        expect(move!.to, at).toBeLessThanOrEqual(legal.maxRaiseTo!);
      }
      // All-in past the pot limit is refused.
      if (move!.type === "all-in") expect((legal.maxRaiseTo !== null && legal.maxIsAllIn) || legal.call > 0, at).toBe(true);
    }
  });

  it("decides in about 5 ms at worst: the flop, 8 opponents, a hand that cannot lose", () => {
    // A royal flush on the flop: every deal reads every hand to the end, 60 fives each.
    const flop = p90Ms(view({ ...omaha, hole: "As Ks 7c 8d", board: "Qs Js Ts", opponents: 8, pot: 500 }));
    const river = p90Ms(view({ ...omaha, hole: "As Ks 7c 8d", board: "Qs Js Ts 2h 3d", opponents: 8, pot: 500 }));
    const headsUp = p90Ms(view({ ...omaha, hole: "As Ks 7c 8d", board: "Qs Js Ts", opponents: 1, pot: 500 }));
    // The target is 5 ms. Measured on a laptop: a p90 of about 3 ms. The bound adds 1 ms for a busy test
    // machine, so twice the work (about 6 ms) fails.
    for (const t of [flop, river, headsUp]) expect(t).toBeLessThan(6);
  });
});

/** A person who goes all-in every hand they can and never buys back in or comes back. */
const reckless = (view: View): HoldemAction | null => {
  const legal = view.private.legal;
  if (!legal) return null;
  if (legal.maxRaiseTo !== null) return { type: "all-in" };
  return legal.call > 0 ? { type: "call" } : { type: "check" };
};
/** A person who only ever checks or folds, as the turn clock would for them. */
const passive = (view: View): HoldemAction | null => {
  const legal = view.private.legal;
  if (!legal) return null;
  return legal.check ? { type: "check" } : { type: "fold" };
};

describe("holdemBot all-bot games", () => {
  // Table size is capped at 7 (Ruling P2-E). A game takes about 50 moves heads-up and about 350 at 7
  // (10 to 40 hands: the blinds go up every 6 hands). So 200 seeds at 2 and 4 players, and 100 at 7,
  // the biggest and slowest table. Hold'em may take up to about 60 s for this file; aim well under.
  // Only the rebuy setting adds a move; it runs at 50 seeds.
  const check = (def: AnyGameDefinition, players: number, name: string, s: Partial<HoldemSettings>, seed: number) => {
    const run = playBots(def, { players, seed, settings: { ...DEFAULT_SETTINGS, ...s }, maxMoves: 20_000 });
    const at = `${name} seed ${seed}, ${players} players`;
    expect(run.rejected, at).toEqual([]);
    expect(run.stuck, at).toEqual([]);
    expect(run.outcome, at).not.toBeNull();
    expect(run.longestRun, at).toBeLessThan(BOT_MAX_RUN);
    return run;
  };
  const m = holdemGame.manifest;
  const sizes = [...new Set([m.minPlayers, m.bestMinPlayers ?? m.minPlayers, Math.min(m.maxPlayers, 7)])];
  const seedsAt = (players: number) => (players >= 7 ? 100 : 200);
  it.each(sizes)("games finish with %i players", (players) => {
    for (let seed = 1; seed <= seedsAt(players); seed++) check(holdemGame, players, "defaults", {}, seed);
  }, 60_000);

  // Omaha decisions read 60 fives a hand, and pot-limit games run longer: fewer seeds, about 5 s each size.
  const omahaSeeds: Record<number, number> = { 2: 50, 4: 20, 7: 12 };
  it.each(sizes)("Omaha games finish with %i players", (players) => {
    for (let seed = 1; seed <= (omahaSeeds[players] ?? 20); seed++) check(holdemGame, players, "omaha", { variant: "omaha" }, seed);
  }, 60_000);

  it("games finish with rebuys", () => {
    for (let seed = 1; seed <= 50; seed++) check(holdemGame, 4, "rebuys", { rebuys: "early" }, seed);
  }, 30_000);

  // Review Focus 4: the person busts (and does not buy back in), and the bots play on to the end.
  it.each([
    ["goes all-in every hand", reckless],
    ["only checks or folds", passive],
  ] as const)("bots play on after a person who %s busts", (_, person) => {
    let busted = 0;
    for (let seed = 1; seed <= 50; seed++) {
      let botMovesAfterBust = 0;
      const def: AnyGameDefinition = {
        ...holdemGame,
        bot: {
          decide(view, ctx) {
            const v = view as View;
            if (v.playerId === "p1") return person(v);
            const move = holdemBot.decide(v, ctx);
            if (move && v.private.legal && v.public.players[0]!.out) botMovesAfterBust++;
            return move;
          },
        },
      };
      const run = check(def, 4, "a person busts", { rebuys: "early" }, seed);
      const p1 = run.outcome!.standings.find((s) => s.playerId === "p1")!;
      if (p1.label?.startsWith("out")) {
        busted++;
        expect(run.outcome!.winnerIds, `seed ${seed}`).not.toContain("p1");
        // Out first of four: three bots were left, so they played on.
        if (p1.label === "out 4th") expect(botMovesAfterBust, `seed ${seed}`).toBeGreaterThan(0);
      }
    }
    // Most of the time the person is the one who goes out.
    expect(busted).toBeGreaterThan(25);
  }, 30_000);

  it("stays fast", () => {
    let moves = 0;
    const start = performance.now();
    for (let seed = 1; seed <= 20; seed++) moves += playBots(holdemGame, { players: 4, seed, maxMoves: 20_000 }).moves;
    expect((performance.now() - start) / moves).toBeLessThan(2);
  });
});
