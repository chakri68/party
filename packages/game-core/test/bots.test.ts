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

function makeToy(decide: (view: BotView<any, any>) => Action | null) {
  const log = { timerRuns: 0 };
  const def = {
    manifest: { id: "toy" },
    defaultSettings: {},
    createGame: (players: { id: string }[]) => ({
      state: { players: players.map((p) => p.id), total: 0, turn: 0, phase: "count", winner: null, timerRuns: 0 } as Toy,
      events: [],
    }),
    handleAction: (s: Toy, id: string, a: Action) => {
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
    },
    onTimer: (s: Toy) => {
      log.timerRuns++;
      return { state: { ...s, phase: "done" as const }, events: [] };
    },
    getPublicState: (s: Toy) => ({ total: s.total, phase: s.phase }),
    getPrivateState: (_s: Toy, id: string) => ({ me: id }),
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
    const { def } = makeToy((v) => {
      seen.push(v);
      return adds(v);
    });
    playBots(def, { players: 2, seed: 1 });
    expect(seen.length).toBeGreaterThan(0);
    for (const v of seen) {
      expect(Object.keys(v).sort()).toEqual(["playerId", "private", "public"]);
      expect(v.private).toEqual({ me: v.playerId });
      expect(Object.keys(v.public).sort()).toEqual(["phase", "total"]);
    }
  });
});
