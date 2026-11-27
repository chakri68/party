import { BOT_MAX_RUN, seededRandomInt, shuffle, type AnyGameDefinition, type BotContext, type BotView } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { handStrength, packLine, showLine, teenPattiBot } from "../server/bot.ts";
import { teenPattiGame } from "../server/game.ts";
import { handScore, makeDeck, parseCardId } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  type LegalMoves,
  type TeenPattiPrivateState,
  type TeenPattiPublicPlayer,
  type TeenPattiPublicState,
  type TeenPattiSettings,
} from "../shared/types.ts";

type View = BotView<TeenPattiPublicState, TeenPattiPrivateState>;

/** "As Kd Th" → cards. */
function c(text: string) {
  const suit = { s: "spades", h: "hearts", c: "clubs", d: "diamonds" } as const;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => parseCardId(`${suit[t.at(-1) as keyof typeof suit]}-${t.slice(0, -1).replace("T", "10")}`)!);
}

/** Every roll at its top: no early look, no bluff, no double, no Sideshow. */
const high: BotContext = { randomInt: (max) => max - 1, chance: () => 99 };
/** Every roll at the bottom: looks, bluffs, doubles and asks whenever it may. */
const low: BotContext = { randomInt: () => 0, chance: () => 0 };

function player(id: string, o: Partial<TeenPattiPublicPlayer> = {}): TeenPattiPublicPlayer {
  return { id, stack: 1000, inHand: true, packed: false, seen: false, allIn: false, inPot: 10, lastMove: null, sittingOut: false, away: false, removed: false, out: false, cards: null, ...o };
}

function view(o: {
  cards?: string | null;
  legal?: Partial<LegalMoves> | null;
  opponents?: number;
  others?: Partial<TeenPattiPublicPlayer>;
  stake?: number;
  pot?: number;
  answer?: string;
  canBack?: boolean;
}): View {
  const seen = o.cards !== null && o.cards !== undefined;
  const stake = o.stake ?? 10;
  const legal: LegalMoves | null =
    o.legal === null || o.answer
      ? null
      : { chaal: seen ? 2 * stake : stake, double: seen ? 4 * stake : 2 * stake, allIn: null, show: null, sideshow: null, ...o.legal };
  const others = Array.from({ length: o.opponents ?? 2 }, (_, i) => player(`o${i}`, o.others));
  const pub = {
    step: o.answer ? "sideshow" : "betting",
    handNumber: 3,
    level: 1,
    boot: 10,
    nextBoot: 20,
    stake,
    potLimit: 2560,
    players: [player("me", { seen }), ...others],
    pot: o.pot ?? 30,
    pots: [],
    currentPlayerId: legal ? "me" : "o0",
  } as unknown as TeenPattiPublicState;
  const priv: TeenPattiPrivateState = {
    cards: seen ? c(o.cards!) : [],
    label: null,
    canSee: !seen,
    legal,
    answer: o.answer ? { fromId: o.answer } : null,
    peeks: [],
    canBack: o.canBack ?? false,
  };
  return { playerId: "me", public: pub, private: priv };
}

describe("hand strength", () => {
  it("runs from the worst hand to the best", () => {
    expect(handStrength(c("As Ah Ad"))).toBeGreaterThan(0.999);
    expect(handStrength(c("5s 3d 2c"))).toBeLessThan(0.002);
    expect(handStrength(c("Kh Kd 4s"))).toBeGreaterThan(handStrength(c("Ah Qd 9s")));
  });

  it("orders hands the way the game does", () => {
    const rng = seededRandomInt(9);
    for (let i = 0; i < 1000; i++) {
      const deck = shuffle(makeDeck(), rng);
      const a = deck.slice(0, 3);
      const b = deck.slice(3, 6);
      expect(Math.sign(handStrength(a) - handStrength(b))).toBe(Math.sign(handScore(a) - handScore(b)));
    }
  });

  it("packs more as the stake climbs and with Seen players against it; shows sooner in a big pot", () => {
    expect(packLine(8, 0, 3)).toBeGreaterThan(packLine(1, 0, 3));
    expect(packLine(1, 2, 3)).toBeGreaterThan(packLine(1, 0, 3));
    expect(packLine(1, 0, 1)).toBeLessThan(packLine(1, 0, 2));
    expect(showLine(80)).toBeLessThan(showLine(5));
  });
});

describe("teenPattiBot while Blind", () => {
  it("looks soon, and always once the stake or the pot is big", () => {
    expect(teenPattiBot.decide(view({}), low)).toEqual({ type: "see" });
    expect(teenPattiBot.decide(view({}), high)).toEqual({ type: "chaal" });
    expect(teenPattiBot.decide(view({ stake: 40 }), high)).toEqual({ type: "see" });
    expect(teenPattiBot.decide(view({ pot: 150 }), high)).toEqual({ type: "see" });
  });

  it("looks before it goes all-in", () => {
    expect(teenPattiBot.decide(view({ legal: { chaal: null, double: null, allIn: 5 } }), high)).toEqual({ type: "see" });
  });

  it("sometimes doubles Blind", () => {
    // The look roll misses (99), the double roll hits (0).
    const rolls = [99, 0];
    const ctx: BotContext = { randomInt: () => rolls.shift() ?? 99, chance: () => 99 };
    expect(teenPattiBot.decide(view({}), ctx)).toEqual({ type: "double" });
  });
});

describe("teenPattiBot when Seen", () => {
  it("packs a weak hand, unless it bluffs", () => {
    expect(teenPattiBot.decide(view({ cards: "7s 4d 2c" }), high)).toEqual({ type: "pack" });
    const bluff: BotContext = { randomInt: () => 0, chance: () => 99 };
    expect(teenPattiBot.decide(view({ cards: "7s 4d 2c" }), bluff)).not.toEqual({ type: "pack" });
  });

  it("bets a good hand and sometimes doubles a great one", () => {
    expect(teenPattiBot.decide(view({ cards: "Kh Kd 4s" }), high)).toEqual({ type: "chaal" });
    expect(teenPattiBot.decide(view({ cards: "As Ah Ad" }), low)).toEqual({ type: "double" });
  });

  it("asks for a Sideshow with a middle hand", () => {
    const legal = { sideshow: { toId: "o1", cost: 20 } };
    expect(teenPattiBot.decide(view({ cards: "Ah Kd 9s", legal }), low)).toEqual({ type: "sideshow" });
    expect(teenPattiBot.decide(view({ cards: "Ah Kd 9s", legal }), high)).toEqual({ type: "chaal" });
    expect(teenPattiBot.decide(view({ cards: "As Ah Ad", legal }), high)).toEqual({ type: "chaal" });
  });

  it("with 2 left, asks for a Show with a strong hand, and sooner when the pot is big", () => {
    const legal = { show: 20 };
    // K-J-4 beats about half of all hands: it bets on in a small pot, and asks for a Show in a big one.
    expect(teenPattiBot.decide(view({ cards: "Kh Jd 4s", legal, opponents: 1 }), high)).toEqual({ type: "chaal" });
    expect(teenPattiBot.decide(view({ cards: "Kh Jd 4s", legal, opponents: 1, pot: 800 }), high)).toEqual({ type: "show" });
    expect(teenPattiBot.decide(view({ cards: "Qh Qd 9s", legal, opponents: 1 }), high)).toEqual({ type: "show" });
  });

  it("short of a bet: all-in with a good hand, pack with a bad one", () => {
    const legal = { chaal: null, double: null, allIn: 15 };
    expect(teenPattiBot.decide(view({ cards: "Qh Qd 9s", legal }), high)).toEqual({ type: "all-in" });
    expect(teenPattiBot.decide(view({ cards: "7s 4d 2c", legal }), high)).toEqual({ type: "pack" });
  });
});

describe("teenPattiBot off its turn", () => {
  it("does nothing when nothing is asked of it", () => {
    expect(teenPattiBot.decide(view({ legal: null }), low)).toBeNull();
    expect(teenPattiBot.decide(view({ legal: null, canBack: true }), low)).toEqual({ type: "back" });
  });

  it("answers a Sideshow by its hand, the same way every time it is asked", () => {
    expect(teenPattiBot.decide(view({ cards: "As Ah Ad", answer: "o1" }), low)).toEqual({ type: "accept" });
    expect(teenPattiBot.decide(view({ cards: "7s 4d 2c", answer: "o1" }), high)).toEqual({ type: "refuse" });
    // A middle hand near the line: the answer comes from `chance` with the exact request's key.
    const keys: string[] = [];
    const ctx = (n: number): BotContext => ({ randomInt: (max) => n % max, chance: (key) => (keys.push(key), 50) });
    const v = view({ cards: "Ts 9d 4c", answer: "o1", pot: 140 });
    const answers = [1, 2, 3, 4].map((n) => teenPattiBot.decide(v, ctx(n)));
    expect(new Set(answers.map((a) => a!.type)).size).toBe(1);
    expect(new Set(keys)).toEqual(new Set(["sideshow:3:o1:140"]));
  });
});

describe("teenPattiBot does little work", () => {
  it("a decision rolls at most twice and asks `chance` at most once: no dealing out of random hands", () => {
    // Every view a real game produces, from all-bot games.
    let worstRolls = 0;
    let worstChance = 0;
    const counting: AnyGameDefinition = {
      ...teenPattiGame,
      bot: {
        decide(v, ctx) {
          let rolls = 0;
          let chances = 0;
          const move = teenPattiBot.decide(v as View, {
            randomInt: (max) => (rolls++, ctx.randomInt(max)),
            chance: (key) => (chances++, ctx.chance(key)),
          });
          worstRolls = Math.max(worstRolls, rolls);
          worstChance = Math.max(worstChance, chances);
          return move;
        },
      },
    };
    for (let seed = 1; seed <= 10; seed++) playBots(counting, { players: 5, seed, maxMoves: 50_000 });
    expect(worstRolls).toBeLessThanOrEqual(2);
    expect(worstChance).toBeLessThanOrEqual(1);
  });

  it("decides well under 20 ms at worst", () => {
    // A smoke test only: a slow, busy test machine must not fail it. The test above pins the work.
    const views = [
      view({ cards: "Ts 9d 4c", legal: { sideshow: { toId: "o1", cost: 20 }, show: null }, opponents: 6 }),
      view({ cards: "Ts 9d 4c", answer: "o1", opponents: 6 }),
      view({ opponents: 6 }),
    ];
    const times: number[] = [];
    for (let i = 0; i < 200; i++) {
      const start = performance.now();
      teenPattiBot.decide(views[i % 3]!, { randomInt: seededRandomInt(i), chance: () => 50 });
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    expect(times[100]!).toBeLessThan(20);
  });
});

describe("teenPattiBot all-bot games", () => {
  const check = (players: number, name: string, s: Partial<TeenPattiSettings>, seed: number) => {
    const run = playBots(teenPattiGame, { players, seed, settings: { ...DEFAULT_SETTINGS, ...s }, maxMoves: 50_000 });
    const at = `${name} seed ${seed}, ${players} players`;
    expect(run.rejected, at).toEqual([]);
    expect(run.stuck, at).toEqual([]);
    expect(run.outcome, at).not.toBeNull();
    expect(run.longestRun, at).toBeLessThan(BOT_MAX_RUN);
    return run;
  };
  const m = teenPattiGame.manifest;
  const sizes = [m.minPlayers, m.bestMinPlayers!, m.bestMaxPlayers!, m.maxPlayers];

  // About 300 moves a game at 3 players and 700 at 7, a few ms each game.
  it.each(sizes)("games finish with %i players", (players) => {
    for (let seed = 1; seed <= (players >= 6 ? 60 : 100); seed++) check(players, "defaults", {}, seed);
  }, 60_000);

  it.each([
    ["slow boot", { handsPerLevel: 10 }],
    ["fast boot", { handsPerLevel: 4 }],
    ["500 chips", { startingChips: 500 }],
    ["2,000 chips", { startingChips: 2000 }],
    ["a 20 minute cap", { ending: 20 }],
    ["20 second turns", { turnSeconds: 20 }],
  ] as const)("games finish with %s", (name, s) => {
    for (let seed = 1; seed <= 20; seed++) check(4, name, s, seed);
  }, 60_000);
});
