import { describe, expect, it } from "vitest";
import type { AnyGameDefinition, BotView } from "../src/index.ts";
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

function makeToy(decide: (view: BotView<any, any>) => Action | null) {
  const log = { timerRuns: 0, current: null as Toy | null };
  const def = {
    manifest: { id: "toy" },
    defaultSettings: {},
    createGame: (players: { id: string }[]) => {
      const state = { players: players.map((p) => p.id), total: 0, turn: 0, phase: "count", winner: null, timerRuns: 0 } as Toy;
      log.current = state;
      return { state, events: [] };
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
    getPrivateState: (s: Toy, id: string) => ({ me: id, myTurn: s.players[s.turn] === id }),
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
});
