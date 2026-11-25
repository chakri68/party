import { BOT_MAX_RUN } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { overheatBot } from "../server/bot.ts";
import { overheatGame } from "../server/game.ts";
import { cardFromCode } from "../shared/rules.ts";
import {
  DEFAULT_SETTINGS,
  type OverheatPlayerState,
  type OverheatPublicState,
  type OverheatSettings,
  type Pending,
} from "../shared/types.ts";

/** Never takes the random move; other rolls land on the top value. */
const steady = { randomInt: (max: number) => max - 1, chance: () => 0 };
/** Always rolls 0: the random move, and a flip in the middle band. */
const zero = { randomInt: () => 0, chance: () => 0 };

let nextId = 1;
const engine = (codes: string[]) =>
  codes.map((c) => ({ card: cardFromCode(c, nextId++) as never as { value: number }, mult: 1 as const })) as never as OverheatPlayerState["engine"];

function player(id: string, o: Partial<OverheatPlayerState> & { cards?: string[] } = {}): OverheatPlayerState {
  const eng = engine(o.cards ?? []);
  return {
    id,
    score: 0,
    removed: false,
    status: "flipping",
    engine: eng,
    heat: eng.reduce((s, e) => s + e.card.value * e.mult, 0),
    gauge: 24,
    fuses: 0,
    turbo: false,
    flipped: eng.length > 0,
    redline: false,
    roundPoints: 0,
    ...o,
  };
}

function view(
  players: OverheatPlayerState[],
  o: { turn?: string; pending?: Pending | null; target?: number } = {},
) {
  const pending = o.pending ?? null;
  const pub = {
    players,
    step: pending ? "choosing" : "turn",
    round: 1,
    gauge: 24,
    currentPlayerId: o.turn ?? "me",
    pending,
    awaitedId: null,
    deckCount: 40,
    discardCount: 0,
    handCounts: {},
    leaderId: null,
    played: false,
    roundEndsAt: 0,
    settings: { ...DEFAULT_SETTINGS, target: o.target ?? 150 },
    winnerIds: [],
    endReason: null,
  } as OverheatPublicState;
  return { playerId: "me", public: pub, private: { hand: [] } };
}
const pend = (kind: Pending["kind"], chooserId: string): Pending => ({
  kind,
  chooserId,
  card: { kind: "power", id: 999, power: kind },
  fromHand: false,
});

describe("overheatBot turn", () => {
  it("flips when it has not flipped yet", () => {
    expect(overheatBot.decide(view([player("me"), player("o")]), steady)).toEqual({ type: "flip" });
  });

  it("banks at a low margin", () => {
    // 22 heat of 24, margin 2.
    const v = view([player("me", { cards: ["R9", "B9", "G4"] }), player("o")]);
    expect(overheatBot.decide(v, steady)).toEqual({ type: "bank" });
  });

  it("flips at a high margin", () => {
    const v = view([player("me", { cards: ["R3"] }), player("o")]);
    expect(overheatBot.decide(v, steady)).toEqual({ type: "flip" });
  });

  it("counts fuses and Turbo against the margin", () => {
    // Heat 9, gauge 24: margin 15 is a flip. With 3 fuses it is 12; turbo halves it to 6 (middle band, bank).
    const base = player("me", { cards: ["R9"], fuses: 3, turbo: true });
    expect(overheatBot.decide(view([base, player("o")]), steady)).toEqual({ type: "bank" });
  });

  it("goes either way in the middle band by the roll", () => {
    const v = view([player("me", { cards: ["R9", "B9"], gauge: 24 }), player("o")]); // margin 6
    expect(overheatBot.decide(v, steady)).toEqual({ type: "bank" });
    expect(overheatBot.decide(v, { randomInt: (m: number) => (m === 3 ? 0 : m - 1), chance: () => 0 })).toEqual({ type: "flip" });
  });

  it("banks when the bank would win the game", () => {
    const v = view([player("me", { cards: ["R3"], score: 148 }), player("o")], { target: 150 });
    expect(overheatBot.decide(v, steady)).toEqual({ type: "bank" });
  });

  it("never banks before it has flipped, even on the random roll", () => {
    expect(overheatBot.decide(view([player("me"), player("o")]), zero)).toEqual({ type: "flip" });
  });

  it("passes on a saved or too-hot turn", () => {
    for (const status of ["banked", "busted"] as const) {
      const v = view([player("me", { cards: ["R3"], status }), player("o", { cards: ["R2"] })]);
      for (const ctx of [steady, zero]) expect(overheatBot.decide(v, ctx)).toEqual({ type: "pass" });
    }
  });

  it("does nothing off its turn, in round-end or when finished", () => {
    expect(overheatBot.decide(view([player("me"), player("o")], { turn: "o" }), steady)).toBeNull();
    const v = view([player("me"), player("o")]);
    expect(overheatBot.decide({ ...v, public: { ...v.public, step: "round-end" } }, steady)).toBeNull();
    expect(overheatBot.decide({ ...v, public: { ...v.public, step: "finished" } }, steady)).toBeNull();
  });
});

describe("overheatBot choices", () => {
  it("answers when a Shove makes it the chooser off its own turn", () => {
    const v = view([player("me", { cards: ["R2"] }), player("o", { cards: ["R5"] }), player("x", { cards: ["R5"] })], {
      turn: "o",
      pending: pend("fuse", "me"),
    });
    expect(overheatBot.decide(v, steady)).toMatchObject({ type: "target" });
  });

  it("does nothing when another seat is the chooser", () => {
    const v = view([player("me"), player("o", { cards: ["R5"] })], { turn: "me", pending: pend("fuse", "o") });
    expect(overheatBot.decide(v, steady)).toBeNull();
  });

  it("shoves the player closest to the limit", () => {
    const v = view(
      [player("me", { cards: ["R2"] }), player("a", { cards: ["R5"] }), player("b", { cards: ["R9", "B9", "G4"] })],
      { pending: pend("shove", "me") },
    );
    expect(overheatBot.decide(v, steady)).toEqual({ type: "target", targetId: "b" });
  });

  it("fuses the score leader", () => {
    const v = view(
      [
        player("me", { cards: ["R2"] }),
        player("a", { cards: ["R5"], score: 90 }),
        player("b", { cards: ["R5"], score: 10 }),
      ],
      { pending: pend("fuse", "me") },
    );
    expect(overheatBot.decide(v, steady)).toEqual({ type: "target", targetId: "a" });
  });

  it("never aims at a banked, busted or removed player or itself", () => {
    const v = view(
      [
        player("me", { cards: ["R2"], score: 500 }),
        player("a", { cards: ["R5"], status: "banked", score: 400 }),
        player("b", { cards: ["R5"], status: "busted", score: 300 }),
        player("c", { cards: ["R5"], removed: true, status: "out", score: 200 }),
        player("d", { cards: ["R5"], score: 1 }),
      ],
      { pending: pend("fuse", "me") },
    );
    for (const ctx of [steady, zero]) {
      expect(overheatBot.decide(v, ctx)).toEqual({ type: "target", targetId: "d" });
    }
  });

  it("wrenches to bust a target that would go over", () => {
    const me = player("me", { cards: ["R9", "R1"] });
    const a = player("a", { cards: ["R2", "B3"] });
    const b = player("b", { cards: ["R9", "B9", "G4"] }); // heat 22; swap its 4 for my 9 -> 27 > 24
    const move = overheatBot.decide(view([me, a, b], { pending: pend("wrench", "me") }), steady) as {
      targetId: string;
      mine: number;
      theirs: number;
    };
    expect(move).toMatchObject({ type: "wrench", targetId: "b", mine: me.engine[0]!.card.id, theirs: b.engine[2]!.card.id });
  });

  it("otherwise gives its highest card and takes a target's lowest", () => {
    const me = player("me", { cards: ["R9", "R4"] });
    const a = player("a", { cards: ["R2", "B3"] });
    const b = player("b", { cards: ["R1", "B3"] });
    const move = overheatBot.decide(view([me, a, b], { pending: pend("wrench", "me") }), steady);
    expect(move).toMatchObject({ type: "wrench", targetId: "b", mine: me.engine[0]!.card.id, theirs: b.engine[0]!.card.id });
  });

  it("only wrenches players with cards, with cards from each engine, even on the random roll", () => {
    const me = player("me", { cards: ["R9", "R4"] });
    const a = player("a", { cards: [], flipped: false });
    const b = player("b", { cards: ["R1", "B3"] });
    const v = view([me, a, b], { pending: pend("wrench", "me") });
    for (const ctx of [steady, zero]) {
      const m = overheatBot.decide(v, ctx) as { targetId: string; mine: number; theirs: number };
      expect(m.targetId).toBe("b");
      expect(me.engine.map((e) => e.card.id)).toContain(m.mine);
      expect(b.engine.map((e) => e.card.id)).toContain(m.theirs);
    }
  });
});

describe("overheatBot all-bot games", () => {
  const settings: [string, Partial<OverheatSettings>][] = [
    ["powers off", { powers: "off" }],
    ["target 100", { target: 100 }],
  ];
  const check = (players: number, name: string, s: Partial<OverheatSettings>, seeds: number) => {
    for (let seed = 1; seed <= seeds; seed++) {
      const run = playBots(overheatGame, { players, seed, settings: { ...DEFAULT_SETTINGS, ...s } });
      const at = `${name} seed ${seed}, ${players} players`;
      expect(run.rejected, at).toEqual([]);
      expect(run.stuck, at).toEqual([]);
      expect(run.outcome, at).not.toBeNull();
      expect(run.longestRun, at).toBeLessThan(BOT_MAX_RUN);
    }
  };
  const m = overheatGame.manifest;
  const sizes = [...new Set([m.minPlayers, m.bestMinPlayers ?? m.minPlayers, Math.min(m.maxPlayers, 7)])];
  it.each(sizes)("games finish with %i players", (players) => {
    check(players, "defaults", {}, 200);
    for (const [name, s] of settings) check(players, name, s, 50);
  }, 60_000);

  it("Cutthroat games finish with 2 to 8 players", () => {
    for (let players = 2; players <= 8; players++) check(players, "cutthroat", { powers: "cutthroat" }, 25);
  }, 60_000);

  it("stays fast", () => {
    let moves = 0;
    const start = performance.now();
    for (let seed = 1; seed <= 50; seed++) moves += playBots(overheatGame, { players: 4, seed }).moves;
    expect((performance.now() - start) / moves).toBeLessThan(2);
  });
});
