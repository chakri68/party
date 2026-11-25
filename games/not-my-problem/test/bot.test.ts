import { BOT_MAX_RUN, seededRandomInt, type BotContext } from "@games/game-core";
import { playBots } from "@games/game-core/testing";
import { describe, expect, it } from "vitest";
import { notMyProblemBot as bot } from "../server/bot.ts";
import { notMyProblemGame as nmp } from "../server/game.ts";
import type { State } from "../server/state.ts";
import type { ActionKind, NmpAction } from "../shared/index.ts";
import { act, cardOf, start } from "./helpers.ts";

/** Rolls come out high: no Fake Report, no HR Complaint, no challenge. */
const high: BotContext = { randomInt: (max) => max - 1, chance: () => 99 };
/** Rolls come out 0: Fake Report, HR Complaint and challenge when allowed. */
const low: BotContext = { randomInt: () => 0, chance: () => 0 };

const view = (s: State, id: string) => ({ playerId: id, public: nmp.getPublicState(s), private: nmp.getPrivateState(s, id) });
const decide = (s: State, id: string, c: BotContext = high) => bot.decide(view(s, id), c);

/** Applies the bot's move for this seat. */
function step(s: State, id: string, c: BotContext = high): { state: State; move: NmpAction } {
  const move = decide(s, id, c);
  if (!move) throw new Error(`${id} has no move`);
  return { state: act(s, id, move).state, move };
}

// Dealer at seat 0, so p1 plays first.
const quiet: ActionKind[] = ["quick-fix", "not-me", "revenge", "blame-game", "hr-complaint"];

describe("notMyProblemBot action step", () => {
  it("plays Intern and Spy, then draws after two proactive cards", () => {
    const hands: ActionKind[][] = [quiet, ["intern", "spy", "overtime", "quick-fix", "blame-game"], quiet];
    let s = start(3, { hands, pile: ["spy", "spy"] });
    const moves: NmpAction[] = [];
    for (let i = 0; i < 3; i++) {
      const r = step(s, "p1");
      moves.push(r.move);
      s = r.state;
    }
    expect(moves[0]).toEqual({ type: "play", token: expect.any(Number), cardId: "intern-1" });
    expect(moves[1]).toMatchObject({ type: "play", cardId: "spy-1" });
    expect(moves[2]).toMatchObject({ type: "draw" });
  });

  it("plays Promotion only with a warning, and aims Overtime at the fewest warnings", () => {
    const hands: ActionKind[][] = [quiet, ["promotion", "overtime", "quick-fix", "blame-game", "not-me"], quiet];
    let s = start(3, { hands, pile: ["spy", "spy"] });
    s.players[0]!.warnings = 2;
    expect(decide(s, "p1")).toMatchObject({ type: "play", cardId: "overtime-1", targetId: "p2" });
    s.players[1]!.warnings = 1;
    expect(decide(s, "p1")).toMatchObject({ type: "play", cardId: "promotion-1" });
  });

  it("copies the token from the view", () => {
    const s = start(3, { hands: [quiet, quiet, quiet], pile: ["spy"] });
    expect(decide(s, "p1")).toEqual({ type: "draw", token: s.token });
  });

  it("gives no move off its turn outside a window", () => {
    const s = start(3, { hands: [quiet, quiet, quiet], pile: ["spy"] });
    expect(decide(s, "p0")).toBeNull();
    expect(decide(s, "p2")).toBeNull();
  });
});

describe("notMyProblemBot Problem step", () => {
  it("blames the player with the most warnings", () => {
    const s0 = start(4, { hands: [quiet, quiet, quiet, quiet], pile: ["server-down", "spy"] });
    s0.players[3]!.warnings = 2;
    const s = act(s0, "p1", { type: "draw" }).state;
    expect(decide(s, "p1")).toEqual({ type: "blame", token: s.token, cardId: "blame-game-2", targetId: "p3" });
  });

  it("fixes when it can't pass, else bluffs with its least useful card, else accepts", () => {
    const fixer: ActionKind[] = ["quick-fix", "not-me", "spy", "hr-complaint", "fake-report"];
    let s = act(start(3, { hands: [quiet, fixer, quiet], pile: ["server-down", "spy"] }), "p1", { type: "draw" }).state;
    expect(decide(s, "p1", low)).toMatchObject({ type: "fix", cardId: "quick-fix-2" });

    const bluffer: ActionKind[] = ["not-me", "spy", "fake-report", "hr-complaint", "fake-report"];
    s = act(start(3, { hands: [quiet, bluffer, quiet], pile: ["server-down", "spy"] }), "p1", { type: "draw" }).state;
    expect(decide(s, "p1", low)).toEqual({ type: "fake-report", token: s.token, cardId: "fake-report-1", faceDownId: "spy-1" });
    expect(decide(s, "p1", high)).toEqual({ type: "accept", token: s.token });
  });
});

describe("notMyProblemBot target step", () => {
  const blamed = (target: ActionKind[]) => {
    const hands: ActionKind[][] = [quiet, ["blame-game", "spy", "spy", "spy", "spy"], target, quiet];
    const s = act(start(4, { hands, pile: ["server-down", "spy"] }), "p1", { type: "draw" }).state;
    return act(s, "p1", { type: "blame", cardId: cardOf(s, "p1", "blame-game"), targetId: "p2" }).state;
  };

  it("plays Not Me first", () => {
    const s = blamed(["revenge", "not-me", "spy", "spy", "spy"]);
    expect(decide(s, "p2")).toEqual({ type: "not-me", token: s.token, cardId: cardOf(s, "p2", "not-me") });
  });

  it("sends Revenge to the legal target with the most warnings", () => {
    const s = blamed(["revenge", "spy", "spy", "spy", "spy"]);
    expect(decide(s, "p2")).toMatchObject({ type: "revenge", targetId: "p0" });
    s.players[3]!.warnings = 1;
    expect(decide(s, "p2")).toMatchObject({ type: "revenge", targetId: "p3" });
  });

  it("accepts with neither", () => {
    const s = blamed(["spy", "spy", "spy", "spy", "spy"]);
    expect(decide(s, "p2")).toEqual({ type: "accept", token: s.token });
  });
});

describe("notMyProblemBot windows", () => {
  const hrWindow = () => {
    const hands: ActionKind[][] = [quiet, ["blame-game", "spy", "spy", "spy", "spy"], ["spy", "spy", "spy", "spy", "spy"], quiet];
    let s = act(start(4, { hands, pile: ["server-down", "spy"] }), "p1", { type: "draw" }).state;
    s = act(s, "p1", { type: "blame", cardId: cardOf(s, "p1", "blame-game"), targetId: "p2" }).state;
    return act(s, "p2", { type: "accept" }).state;
  };

  it("passes in an HR window on a high roll, then has no move there", () => {
    let s = hrWindow();
    expect(s.step).toBe("hr");
    expect(decide(s, "p1")).toBeNull();
    expect(decide(s, "p0")).toEqual({ type: "pass", token: s.token });
    s = act(s, "p0", { type: "pass" }).state;
    expect(s.step).toBe("hr");
    expect(decide(s, "p0", low)).toBeNull();
  });

  it("plays HR Complaint on a low roll only when it holds one", () => {
    const s = hrWindow();
    expect(decide(s, "p0", low)).toMatchObject({ type: "hr", cardId: "hr-complaint-1" });
    expect(decide(s, "p2", low)).toEqual({ type: "pass", token: s.token });
  });

  it("challenges a Fake Report on a low roll, passes on a high one", () => {
    const hands: ActionKind[][] = [quiet, ["fake-report", "spy", "spy", "spy", "spy"], quiet];
    let s = act(start(3, { hands, pile: ["server-down", "spy"] }), "p1", { type: "draw" }).state;
    s = act(s, "p1", { type: "fake-report", cardId: "fake-report-1", faceDownId: "spy-1" }).state;
    expect(s.step).toBe("challenge");
    expect(decide(s, "p1", low)).toBeNull();
    expect(decide(s, "p2", low)).toEqual({ type: "challenge", token: s.token });
    expect(decide(s, "p2", high)).toEqual({ type: "pass", token: s.token });
  });

  it("keys the HR choice on the window: new per window, the same after another seat passes", () => {
    const keysFor = (s: State, id: string) => {
      const keys: string[] = [];
      bot.decide(view(s, id), { randomInt: () => 0, chance: (k) => (keys.push(k), 99) });
      return keys;
    };
    // First window: p1 passed Server Down to p2, who accepted.
    let s = hrWindow();
    const first = keysFor(s, "p0");
    expect(first).toHaveLength(1);
    s = act(s, "p3", { type: "pass" }).state;
    expect(s.step).toBe("hr");
    expect(keysFor(s, "p0")).toEqual(first);

    // Second window, same Problem: it landed on p2, who passes it to p3.
    s = act(s, "p0", { type: "pass" }).state;
    s = act(s, "p2", { type: "pass" }).state;
    expect(s.step).toBe("problem");
    expect(s.problem?.ownerId).toBe("p2");
    s.players[2]!.hand.push({ id: "blame-game-9", kind: "blame-game" });
    s = act(s, "p2", { type: "blame", cardId: "blame-game-9", targetId: "p3" }).state;
    s = act(s, "p3", { type: "accept" }).state;
    expect(s.step).toBe("hr");
    const second = keysFor(s, "p0");
    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(first[0]);
  });

  it("makes the same window choice when asked again", () => {
    const s = hrWindow();
    const keyed = (seed: number): BotContext => ({ randomInt: seededRandomInt(seed), chance: (k) => (k.length * 13) % 100 });
    const first = decide(s, "p0", keyed(1));
    for (let seed = 2; seed < 15; seed++) expect(decide(s, "p0", keyed(seed))).toEqual(first);
  });
});

describe("notMyProblemBot all-bot games", () => {
  const check = (players: number, seed: number, settings?: { reactionSeconds: number }) => {
    const run = playBots(nmp, { players, seed, ...(settings && { settings }) });
    const at = `seed ${seed}, ${players} players${settings ? `, ${settings.reactionSeconds} s` : ""}`;
    expect(run.rejected, at).toEqual([]);
    expect(run.stuck, at).toEqual([]);
    expect(run.outcome, at).not.toBeNull();
    expect(run.longestRun, at).toBeLessThan(BOT_MAX_RUN);
  };

  it.each([3, 4, 5, 6, 7, 8])("games finish with %i players", (players) => {
    for (let seed = 1; seed <= 30; seed++) check(players, seed);
  }, 30_000);

  it.each([3, 5, 8])("games finish with 5 s windows and %i players", (players) => {
    for (let seed = 1; seed <= 10; seed++) check(players, seed, { reactionSeconds: 5 });
  }, 30_000);
});
