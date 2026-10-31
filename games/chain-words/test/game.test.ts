import { seededRandomInt, type GameContext, type GameTransition } from "@games/game-core";
import { allWords } from "@games/words/dictionary";
import { describe, expect, it } from "vitest";
import { chainWordsGame as cw } from "../server/game.ts";
import { wordsOn } from "../server/words.ts";
import { OPENERS } from "../shared/openers.ts";
import { DEFAULT_SETTINGS, type ChainWordsEvent, type ChainWordsServerState, type ChainWordsSettings } from "../shared/types.ts";

type T = GameTransition<ChainWordsServerState, ChainWordsEvent>;
type S = ChainWordsServerState;

const ctx = (now = 0, seed = 1): GameContext => ({ now, randomInt: seededRandomInt(seed) });
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

/** ROCKET opens unless told otherwise, so the first word wants a T. */
function start(n = 3, opts: { dealer?: number; settings?: Partial<ChainWordsSettings>; deck?: string[]; now?: number } = {}): T {
  return cw.createGame(players(n), { ...DEFAULT_SETTINGS, ...opts.settings }, { roundNumber: 1, dealerSeat: opts.dealer ?? 0 }, ctx(opts.now ?? 0), {
    deck: opts.deck ?? ["rocket"],
  });
}

/** Through parseAction, the way the room sends it. */
const play = (s: S, playerId: string, text: string, now = 1000) =>
  cw.handleAction(s, playerId, cw.parseAction({ type: "word", text })!, ctx(now));

function ok(result: ReturnType<typeof play>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.transition as T;
}

function err(result: ReturnType<typeof play>) {
  if (result.ok) throw new Error("expected a rejection");
  return result.error.code;
}

const events = (t: { events: { event: ChainWordsEvent }[] }) => t.events.map((e) => e.event);
const types = (t: { events: { event: { type: string } }[] }) => t.events.map((e) => e.event.type);
const lives = (s: S, id: string) => s.players.find((p) => p.id === id)!.lives;
/** The clock going off, on time. */
const ring = (s: S) => cw.onTimer!(s, "turn", ctx(s.deadline));

describe("createGame", () => {
  it("opens with a word from the list, the dealer's left first, on a visible clock", () => {
    const t = start(4, { dealer: 2, now: 500 });
    expect(events(t)).toEqual([{ type: "opened", word: "rocket", holderId: "p3" }]);
    expect(t.state).toMatchObject({ phase: "live", holderId: "p3", letter: "t", deadline: 8500, turn: 1 });
    expect(t.timers).toEqual([{ kind: "set", timerId: "turn", delayMs: 8000 }]);
    const pub = cw.getPublicState(t.state);
    expect(pub).toMatchObject({ deadline: 8500, turnMs: 8000, letter: "t", chainLength: 1, chain: [{ playerId: null, word: "rocket" }] });
    expect(cw.getAwaitedPlayerIds(t.state)).toEqual(["p3"]);
  });

  it("draws the opener from the real list by default", () => {
    const t = cw.createGame(players(2), DEFAULT_SETTINGS, { roundNumber: 1, dealerSeat: 0 }, ctx(0, 7));
    expect(OPENERS).toContain(t.state.chain[0]!.word);
  });

  it("takes its settings, and turns away ones off the menu", () => {
    expect(cw.parseSettings({ turnSeconds: 5, lives: 1 })).toEqual({ turnSeconds: 5, lives: 1 });
    expect(cw.parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(cw.parseSettings({ turnSeconds: 7 })).toBeNull();
    expect(cw.parseSettings({ lives: 9 })).toBeNull();
    expect(start(2, { settings: { turnSeconds: 12 } }).timers).toEqual([{ kind: "set", timerId: "turn", delayMs: 12_000 }]);
  });

  it("explains a bad opener list", () => {
    expect(() => start(2, { deck: ["Rocket"] })).toThrow(/opener list/);
  });
});

describe("words", () => {
  it("a good word joins the chain and passes the turn with a fresh clock", () => {
    const s = start(3).state;
    const t = ok(play(s, "p1", " TIGER ", 3000));
    expect(events(t)).toEqual([{ type: "played", playerId: "p1", word: "tiger", to: "p2" }]);
    expect(t.state).toMatchObject({ holderId: "p2", letter: "r", turn: s.turn + 1, deadline: 11_000 });
    expect(t.timers).toEqual([{ kind: "set", timerId: "turn", delayMs: 8000 }]);
    expect(t.state.players.find((p) => p.id === "p1")!.words).toBe(1);
    expect(cw.getPublicState(t.state).chain.map((l) => l.word)).toEqual(["rocket", "tiger"]);
  });

  it("wrong letter, non-words and repeats bounce, and the clock keeps running", () => {
    let s = start(3).state;
    expect(err(play(s, "p1", "river"))).toBe("bad-word");
    expect(err(play(s, "p1", "tigr"))).toBe("not-a-word");
    expect(err(play(s, "p1", "ti ger"))).toBe("bad-word");
    expect(err(play(s, "p1", "to"))).toBe("bad-word");
    s = ok(play(s, "p1", "tiger")).state;
    s = ok(play(s, "p2", "rat")).state;
    // Anyone's word counts as used, not just yours.
    expect(err(play(s, "p0", "tiger"))).toBe("used");
    expect(s.holderId).toBe("p0");
  });

  it("the opener counts as played", () => {
    let s = start(2, { deck: ["tablet"] }).state;
    expect(err(play(s, "p1", "tablet"))).toBe("used");
    s = ok(play(s, "p1", "toast")).state;
    expect(s.letter).toBe("t");
  });

  it("is only the holder's to play", () => {
    const s = start(3).state;
    expect(err(play(s, "p0", "tiger"))).toBe("not-your-turn");
    expect(cw.getPrivateState(s, "p1").holding).toBe(true);
    expect(cw.getPrivateState(s, "p0").holding).toBe(false);
  });
});

describe("the clock", () => {
  it("running out costs a life and passes the turn, same letter, fresh clock", () => {
    const s = start(3).state;
    const t = ring(s);
    expect(events(t)).toEqual([{ type: "timeout", playerId: "p1", lives: 2, to: "p2" }]);
    expect(t.state).toMatchObject({ holderId: "p2", letter: "t", turn: s.turn + 1, deadline: s.deadline + 8000 });
    expect([lives(t.state, "p0"), lives(t.state, "p1"), lives(t.state, "p2")]).toEqual([3, 2, 3]);
    expect(t.timers).toEqual([{ kind: "set", timerId: "turn", delayMs: 8000 }]);
  });

  it("an early alarm re-arms instead of firing", () => {
    const s = start(3).state;
    const t = cw.onTimer!(s, "turn", ctx(s.deadline - 3000));
    expect(t.state).toBe(s);
    expect(t.events).toEqual([]);
    expect(t.timers).toEqual([{ kind: "set", timerId: "turn", delayMs: 3000 }]);
    // Inside the slack counts as on time.
    expect(types(cw.onTimer!(s, "turn", ctx(s.deadline - 200)))).toEqual(["timeout"]);
    // Somebody else's timer id does nothing.
    expect(cw.onTimer!(s, "fuse", ctx(s.deadline)).state).toBe(s);
  });

  it("the last life puts you out, and the rotation skips you", () => {
    let s = start(3, { settings: { lives: 1 } }).state;
    s = ring(s).state; // p1 out
    expect(s.outOrder).toEqual(["p1"]);
    expect(err(play(s, "p1", "tiger"))).toBe("not-in-game");
    expect(s.holderId).toBe("p2");
    s = ok(play(s, "p2", "tiger")).state;
    expect(s.holderId).toBe("p0");
    s = ok(play(s, "p0", "rat")).state;
    expect(s.holderId).toBe("p2");
  });

  it("down to one, that one wins; the results list who went when", () => {
    let s = start(4, { settings: { lives: 1 } }).state;
    s = ok(play(s, "p1", "tiger")).state; // p2 holds
    s = ring(s).state; // p2 out, p3 holds
    s = ring(s).state; // p3 out, p0 holds
    s = ok(play(s, "p0", "rat")).state; // p1 holds
    const t = ring(s); // p1 out
    expect(events(t)).toEqual([
      { type: "timeout", playerId: "p1", lives: 0, to: null },
      { type: "game-over", winnerId: "p0" },
    ]);
    expect(t.state.phase).toBe("finished");
    expect(t.timers).toContainEqual({ kind: "cancel", timerId: "turn" });
    const result = cw.getResult(t.state)!;
    expect(result.winnerIds).toEqual(["p0"]);
    expect(result.standings.map((x) => [x.playerId, x.label])).toEqual([
      ["p0", "1 life left, 1 word"],
      ["p1", "out 3rd, 1 word"],
      ["p3", "out 2nd, 0 words"],
      ["p2", "first out, 0 words"],
    ]);
    expect(err(play(t.state, "p0", "tiger"))).toBe("game-finished");
    // A stray timer after the end does nothing.
    expect(ring(t.state).state).toBe(t.state);
    expect(cw.getAwaitedPlayerIds(t.state)).toEqual([]);
  });
});

describe("rescue", () => {
  const XS = allWords().filter((w) => w[0] === "x");

  it("a letter with nothing left is swapped for one that has words, and nobody pays", () => {
    const s = start(3).state;
    // Every X word's been played already. TAX ends on X.
    s.chain.push(...XS.map((word) => ({ playerId: "p0", word })));
    const t = ok(play(s, "p1", "tax"));
    expect(types(t)).toEqual(["played", "rescued"]);
    const rescued = events(t)[1] as Extract<ChainWordsEvent, { type: "rescued" }>;
    expect(rescued.from).toBe("x");
    expect(rescued.to).not.toBe("x");
    expect(t.state.letter).toBe(rescued.to);
    expect(wordsOn(t.state.letter, t.state.chain.map((l) => l.word))).toBeGreaterThan(0);
    expect(t.state.players.map((p) => p.lives)).toEqual([3, 3, 3]);
    expect(t.state.holderId).toBe("p2");
    expect(t.timers).toEqual([{ kind: "set", timerId: "turn", delayMs: 8000 }]);
  });

  it("leaves a letter alone while it has a single word left", () => {
    const s = start(3).state;
    s.chain.push(...XS.slice(1).map((word) => ({ playerId: "p0", word })));
    const t = ok(play(s, "p1", "tax"));
    expect(types(t)).toEqual(["played"]);
    expect(t.state.letter).toBe("x");
    expect(ok(play(t.state, "p2", XS[0]!)).state.holderId).toBe("p0");
  });

  it("if the whole dictionary's been played, everyone still in wins", () => {
    const s = start(3).state;
    s.chain = allWords()
      .filter((w) => w !== "tax")
      .map((word) => ({ playerId: null, word }));
    const t = ok(play(s, "p1", "tax"));
    expect(types(t)).toEqual(["played", "game-over"]);
    expect(cw.getResult(t.state)!.winnerIds).toEqual(["p0", "p1", "p2"]);
  });
});

describe("leaving and presence", () => {
  it("walking out on your turn hands it on with a full clock", () => {
    const s = start(3).state;
    const t = cw.onPlayerRemoved!(s, "p1", ctx(2000));
    expect(events(t)).toEqual([{ type: "left", playerId: "p1", to: "p2" }]);
    expect(t.state).toMatchObject({ holderId: "p2", deadline: 10_000, letter: "t" });
    expect(t.timers).toEqual([{ kind: "set", timerId: "turn", delayMs: 8000 }]);
  });

  it("someone else leaving leaves the clock alone", () => {
    const t = cw.onPlayerRemoved!(start(3).state, "p0", ctx(2000));
    expect(events(t)).toEqual([{ type: "left", playerId: "p0", to: null }]);
    expect(t.state.holderId).toBe("p1");
    expect(t.timers).toEqual([]);
  });

  it("leaving down to one ends it, and the one left wins", () => {
    const t = cw.onPlayerRemoved!(start(2).state, "p0", ctx());
    expect(t.state.phase).toBe("finished");
    const result = cw.getResult(t.state)!;
    expect(result.winnerIds).toEqual(["p1"]);
    expect(result.standings.at(-1)).toMatchObject({ playerId: "p0", label: "left the game, 0 words" });
  });

  it("the turn goes past someone who's dropped, unless there's nobody else", () => {
    let s = start(4).state;
    s = cw.onPlayerDisconnected!(s, "p2", ctx()).state;
    s = ok(play(s, "p1", "tiger")).state;
    expect(s.holderId).toBe("p3");
    s = cw.onPlayerDisconnected!(s, "p0", ctx()).state;
    s = cw.onPlayerDisconnected!(s, "p1", ctx()).state;
    s = ok(play(s, "p3", "rat")).state;
    expect(s.holderId).toBe("p0");
    s = cw.onPlayerReconnected!(s, "p2", ctx()).state;
    expect(s.players.find((p) => p.id === "p2")!.away).toBe(false);
  });

  it("a holder who drops keeps the turn; the host can skip them, no life lost", () => {
    let s = start(3).state;
    s = cw.onPlayerDisconnected!(s, "p1", ctx()).state;
    expect(s.holderId).toBe("p1");
    const t = cw.skipTurn!(s, "p1", ctx(4000));
    expect(events(t)).toEqual([{ type: "skipped", from: "p1", to: "p2" }]);
    expect(t.state).toMatchObject({ turn: s.turn + 1, deadline: 12_000, letter: "t" });
    expect(lives(t.state, "p1")).toBe(3);
    // Skipping someone who isn't holding it is a no-op.
    expect(cw.skipTurn!(t.state, "p0", ctx()).events).toEqual([]);
  });
});

describe("the typing stream", () => {
  it("takes the holder's typing for this turn only", () => {
    const s = start(3).state;
    expect(cw.onStream!(s, "p0", { turn: s.turn, text: "ti" })).toBeNull(); // not theirs
    expect(cw.onStream!(s, "p1", { turn: s.turn + 1, text: "ti" })).toBeNull(); // stale
    const out = cw.onStream!(s, "p1", { turn: s.turn, text: "Ti" })!;
    expect(out.relay).toEqual({ turn: s.turn, text: "ti" });
    expect(cw.getStreamSnapshot!(out.state)).toEqual({ turn: s.turn, text: "ti" });
    // A word landing clears it.
    const next = ok(play(out.state, "p1", "tiger")).state;
    expect(cw.getStreamSnapshot!(next)).toEqual({ turn: next.turn, text: "" });
  });
});

describe("what goes out", () => {
  it("public and private state carry neither the typing buffer nor who's away", () => {
    let s = start(3).state;
    s = cw.onStream!(s, "p1", { turn: s.turn, text: "zzqq" })!.state;
    s = cw.onPlayerDisconnected!(s, "p2", ctx()).state;
    const out = JSON.stringify(cw.getPublicState(s)) + ["p0", "p1", "p2"].map((id) => JSON.stringify(cw.getPrivateState(s, id))).join("");
    expect(out).not.toContain("zzqq");
    expect(out).not.toContain("away");
  });

  it("only the tail of a long chain goes to the table", () => {
    let s = start(2).state;
    // Words that start and end on T, so the chain never leaves it.
    const words = allWords().filter((w) => /^t.*t$/.test(w)).slice(0, 14);
    for (const w of words) s = ok(play(s, s.holderId, w)).state;
    const pub = cw.getPublicState(s);
    expect(pub.chainLength).toBe(words.length + 1);
    expect(pub.chain).toHaveLength(12);
    expect(pub.chain.at(-1)!.word).toBe(words.at(-1));
  });
});

describe("random games", () => {
  const byLetter = new Map<string, string[]>();
  for (const w of allWords()) byLetter.set(w[0]!, [...(byLetter.get(w[0]!) ?? []), w]);

  it("always end, with one winner and everyone else out in order", () => {
    for (let seed = 0; seed < 40; seed++) {
      const rng = seededRandomInt(seed * 7 + 3);
      const n = 2 + rng(11);
      const settings = { turnSeconds: 5, lives: 1 + rng(3) };
      let s = cw.createGame(players(n), settings, { roundNumber: 1, dealerSeat: rng(n) }, ctx(0, seed)).state;
      const usedSet = new Set(s.chain.map((l) => l.word));
      let steps = 0;
      while (s.phase !== "finished") {
        if (++steps > 5000) throw new Error(`seed ${seed}: no end in sight`);
        const roll = rng(10);
        if (roll < 6) {
          const word = byLetter.get(s.letter)!.find((w) => !usedSet.has(w))!;
          usedSet.add(word);
          s = ok(play(s, s.holderId, word, s.deadline - 1000)).state;
        } else if (roll === 6) {
          s = cw.skipTurn!(s, s.holderId, ctx(s.deadline - 1000)).state;
        } else if (roll === 7 && rng(20) === 0) {
          s = cw.onPlayerRemoved!(s, `p${rng(n)}`, ctx(s.deadline - 1000)).state;
        } else {
          s = ring(s).state;
        }
        if (s.phase === "live") {
          const holder = s.players.find((p) => p.id === s.holderId)!;
          expect(holder.lives > 0 && !holder.removed).toBe(true);
        }
      }
      const result = cw.getResult(s)!;
      expect(result.winnerIds).toHaveLength(1);
      expect(result.standings).toHaveLength(n);
      expect(new Set([...s.outOrder, ...result.winnerIds]).size).toBe(s.outOrder.length + 1);
    }
  });
});
