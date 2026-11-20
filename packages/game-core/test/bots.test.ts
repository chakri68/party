import { describe, expect, it } from "vitest";
import type { AnyGameDefinition, BotContext, BotView } from "../src/index.ts";
import { playBots } from "../src/testing.ts";

// "Count to 20": players take turns adding 1 or 2. Reaching 20 opens a timed
// window with nobody awaited; the "window" timer then closes the game.
interface Toy {
  players: string[];
  total: number;
  turn: number;
  phase: "count" | "window" | "done";
  winner: string | null;
  timerRuns: number;
  hand: number[];
}
type Action = { type: "add"; n: number } | { type: "pass" };

type Step =
  | { ok: true; transition: { state: Toy; events: never[]; timers?: { kind: "set"; timerId: string; delayMs: number }[] } }
  | { ok: false; error: { code: string; message: string } };

function step(s: Toy, id: string, a: Action): Step {
  if (a.type === "pass") return { ok: true, transition: { state: s, events: [] } };
  if (s.phase !== "count" || s.players[s.turn] !== id) {
    return { ok: false, error: { code: "not-your-turn", message: "Not your turn" } };
  }
  if (a.n !== 1 && a.n !== 2) return { ok: false, error: { code: "bad-add", message: "Add 1 or 2" } };
  const total = s.total + a.n;
  if (total >= 20) {
    return {
      ok: true,
      transition: {
        state: { ...s, total, phase: "window", winner: id },
        events: [],
        timers: [{ kind: "set", timerId: "window", delayMs: 5000 }],
      },
    };
  }
  return { ok: true, transition: { state: { ...s, total, turn: (s.turn + 1) % s.players.length }, events: [] } };
}

function makeToy(
  decide: (view: BotView<any, any>, ctx: BotContext) => Action | null,
  opts: { startTimer?: boolean } = {},
) {
  const log = { timerRuns: 0, current: null as Toy | null };
  const def = {
    manifest: { id: "toy" },
    defaultSettings: {},
    createGame: (players: { id: string }[]) => {
      const state = { players: players.map((p) => p.id), total: 0, turn: 0, phase: "count", winner: null, timerRuns: 0, hand: [3, 1, 2] } as Toy;
      log.current = state;
      // A turn clock, as a game with a move timer would set.
      const timers = opts.startTimer ? [{ kind: "set", timerId: "clock", delayMs: 60_000 }] : [];
      return { state, events: [], timers };
    },
    handleAction: (s: Toy, id: string, a: Action) => {
      const r = step(s, id, a);
      if (r.ok) log.current = r.transition.state;
      return r;
    },
    onTimer: (s: Toy) => {
      log.timerRuns++;
      log.current = { ...s, phase: "done" as const };
      return { state: log.current, events: [] };
    },
    getPublicState: (s: Toy) => ({ total: s.total, phase: s.phase }),
    // `hand` is the live array, as a careless game might hand it out.
    getPrivateState: (s: Toy, id: string) => ({ me: id, myTurn: s.players[s.turn] === id, hand: s.hand }),
    getAwaitedPlayerIds: (s: Toy) => (s.phase === "count" ? [s.players[s.turn]!] : []),
    getResult: (s: Toy) =>
      s.phase === "done" && s.winner ? { winnerIds: [s.winner], standings: [] } : null,
    bot: { decide },
  } as unknown as AnyGameDefinition;
  return { def, log };
}

const adds = (view: BotView<any, any>): Action | null =>
  view.public.phase === "count" ? { type: "add", n: 1 } : null;

describe("playBots", () => {
  it("finishes a game whose bot always moves", () => {
    const { def } = makeToy(adds);
    const r = playBots(def, { players: 3, seed: 1 });
    expect(r.outcome).not.toBeNull();
    expect(r.rejected).toEqual([]);
    expect(r.stuck).toEqual([]);
  });

  it("fires game timers when nobody wants to move", () => {
    const { def, log } = makeToy(adds);
    const r = playBots(def, { players: 2, seed: 1 });
    expect(r.outcome).not.toBeNull();
    expect(log.timerRuns).toBeGreaterThanOrEqual(1);
  });

  it("reports a bot that returns null while awaited", () => {
    const { def } = makeToy((v) => (v.public.total >= 10 ? null : adds(v)));
    const r = playBots(def, { players: 2, seed: 1 });
    expect(r.outcome).toBeNull();
    // Ten single adds, two seats: the turn is back on p1.
    expect(r.stuck).toEqual([{ playerId: "p1", reason: "null-while-awaited" }]);
  });

  it("reports an awaited null even when a timer is pending", () => {
    const { def, log } = makeToy((v) => (v.public.total >= 10 ? null : adds(v)), { startTimer: true });
    const r = playBots(def, { players: 2, seed: 1 });
    expect(r.stuck).toEqual([{ playerId: "p1", reason: "null-while-awaited" }]);
    expect(log.timerRuns).toBe(0);
  });

  it("reports an awaited null even when another seat has a move", () => {
    // p2 always passes, which is always allowed; p1 stalls on its turn.
    const { def } = makeToy((v) => (v.playerId === "p2" && v.public.total >= 10 ? { type: "pass" } : v.public.total >= 10 ? null : adds(v)));
    const r = playBots(def, { players: 2, seed: 1, maxMoves: 200 });
    expect(r.stuck).toEqual([{ playerId: "p1", reason: "null-while-awaited" }]);
  });

  it("records a rejected move and stops", () => {
    const { def } = makeToy((v) => (v.public.phase === "count" ? { type: "add", n: 3 } : null));
    const r = playBots(def, { players: 2, seed: 1 });
    expect(r.rejected[0]?.code).toBe("bad-add");
    expect(r.rejected).toHaveLength(1);
    expect(r.outcome).toBeNull();
  });

  it("decide only ever gets views", () => {
    const seen: BotView<any, any>[] = [];
    const checks: unknown[] = [];
    // `log` is assigned below, before playBots runs.
    let toy!: ReturnType<typeof makeToy>;
    toy = makeToy((v) => {
      seen.push(v);
      const cur = toy.log.current;
      checks.push({
        playerId: v.playerId,
        public: toy.def.getPublicState(cur),
        private: toy.def.getPrivateState(cur, v.playerId),
      });
      return adds(v);
    });
    playBots(toy.def, { players: 2, seed: 1 });
    expect(seen.length).toBeGreaterThan(0);
    seen.forEach((v, i) => expect(v).toEqual(checks[i]));
  });

  it("chance is stable per seat and key, and spread over 0 to 99", () => {
    const seen = new Map<string, number>();
    const { def } = makeToy((v, ctx) => {
      for (let k = 0; k < 20; k++) {
        const key = `call:${k}`;
        const value = ctx.chance(key);
        expect(ctx.chance(key)).toBe(value);
        const at = `${v.playerId}/${key}`;
        if (seen.has(at)) expect(seen.get(at)).toBe(value);
        seen.set(at, value);
      }
      return adds(v);
    });
    const r = playBots(def, { players: 3, seed: 7 });
    expect(r.outcome).not.toBeNull();
    const values = [...seen.values()];
    expect(values).toHaveLength(60);
    for (const value of values) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(100);
    }
    // Different keys for one seat, and one key for different seats, don't all agree.
    expect(new Set([...seen].filter(([at]) => at.startsWith("p1/")).map(([, v]) => v)).size).toBeGreaterThan(5);
    expect(new Set(["p1", "p2", "p3"].map((p) => seen.get(`${p}/call:0`))).size).toBeGreaterThan(1);
  });

  it("chance depends on the seed", () => {
    const first = (seed: number) => {
      let value = -1;
      const { def } = makeToy((v, ctx) => {
        if (value < 0) value = ctx.chance("call");
        return adds(v);
      });
      playBots(def, { players: 2, seed });
      return value;
    };
    expect(first(1)).toBe(first(1));
    expect(new Set([1, 2, 3, 4, 5, 6].map(first)).size).toBeGreaterThan(1);
  });

  it("a bot that changes its view throws, and the live state stays unfrozen", () => {
    const toy = makeToy((v) => {
      v.private.hand.sort();
      return adds(v);
    });
    expect(() => playBots(toy.def, { players: 2, seed: 1 })).toThrow(TypeError);
    expect(Object.isFrozen(toy.log.current!.hand)).toBe(false);
    expect(toy.log.current!.hand).toEqual([3, 1, 2]);
  });

  it("longestRun counts one seat's moves in a row, not timers", () => {
    let passes = 0;
    const { def } = makeToy((v) => {
      // p1 passes twice, then adds: three accepted moves in a row.
      if (v.playerId === "p1" && v.private.myTurn && passes < 2) {
        passes++;
        return { type: "pass" };
      }
      return v.private.myTurn ? adds(v) : null;
    });
    const r = playBots(def, { players: 2, seed: 1 });
    expect(r.outcome).not.toBeNull();
    expect(r.longestRun).toBe(3);

    const plain = playBots(makeToy((v) => (v.private.myTurn ? adds(v) : null)).def, { players: 2, seed: 1 });
    expect(plain.longestRun).toBe(1);
  });
});
