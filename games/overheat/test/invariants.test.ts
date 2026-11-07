import { describe, expect, it } from "vitest";
import { seededRandomInt } from "@games/game-core";
import { overheatGame as oh } from "../server/game.ts";
import type { OverheatServerState } from "../shared/types.ts";

const TOTAL_CARDS = 88;
const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const STEPS = 1500;

/** Throws a readable message on the first broken invariant. */
function check(s: OverheatServerState, where: string) {
  const ids: number[] = [...s.deck.map((c) => c.id), ...s.discard.map((c) => c.id)];
  for (const p of s.players) for (const e of p.engine) ids.push(e.card.id);
  if (s.pending) ids.push(s.pending.card.id);
  expect(ids.length, `${where}: card count`).toBe(TOTAL_CARDS);
  expect(new Set(ids).size, `${where}: duplicate ids`).toBe(ids.length);
  if (s.phase !== "playing") return;

  for (const p of s.players) {
    if (p.status === "flipping") expect(p.heat, `${where}: flipping at or over gauge`).toBeLessThan(p.gauge);
    if (p.removed) expect(p.status, `${where}: removed but not out`).toBe("out");
    expect(p.heat, `${where}: negative heat`).toBeGreaterThanOrEqual(0);
  }
  if (s.step === "turn") expect(s.players[s.turnIndex]!.status, `${where}: turn owner not flipping`).toBe("flipping");
  if (s.step === "choosing") {
    const chooser = s.players.find((p) => p.id === s.pending!.chooserId)!;
    expect(chooser.status, `${where}: chooser is out`).not.toBe("out");
  }
  if (s.step === "round-end") expect(s.players.some((p) => p.status === "flipping"), `${where}: flipper at round end`).toBe(false);
}

describe("invariants under random play", () => {
  it("holds across random actions, skips and leavers", () => {
    for (const seed of SEEDS) {
      const r = seededRandomInt(seed);
      const ctx = { now: 0, randomInt: r };
      const n = 2 + r(7);
      const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
      let t = oh.createGame(roster, { target: 100, powers: "classic" }, { roundNumber: 1, dealerSeat: r(n) }, ctx);
      let s = t.state;
      check(s, `seed ${seed} create`);

      for (let k = 0; k < STEPS && s.phase === "playing"; k++) {
        const roll = r(100);
        const pid = `p${r(n)}`;
        let where = `seed ${seed} step ${k}`;
        if (s.step === "round-end") {
          t = oh.onTimer!(s, "next-round", ctx);
          where += " timer";
        } else if (roll < 2) {
          t = oh.onPlayerRemoved!(s, pid, ctx);
          where += ` remove ${pid}`;
        } else if (roll < 10) {
          t = oh.skipTurn!(s, oh.getAwaitedPlayerIds!(s)[0] ?? pid, ctx);
          where += " skip";
        } else {
          const awaited = oh.getAwaitedPlayerIds!(s)[0] ?? pid;
          const me = s.players.find((p) => p.id === awaited)!;
          let action: Record<string, unknown>;
          if (s.step === "choosing") {
            const targetId = `p${r(n)}`;
            if (s.pending!.kind === "wrench") {
              const th = s.players.find((p) => p.id === targetId)!;
              action = {
                type: "wrench",
                targetId,
                mine: me.engine[r(me.engine.length || 1)]?.card.id ?? 0,
                theirs: th.engine[r(th.engine.length || 1)]?.card.id ?? 0,
              };
            } else action = { type: "target", targetId };
          } else {
            action = { type: me.heat >= me.gauge - 6 && r(3) ? "bank" : "flip" };
          }
          // Mostly the right player, sometimes a stranger: stale and hostile actions must leave state alone.
          const res = oh.handleAction(s, r(10) ? awaited : pid, action as never, ctx);
          if (!res.ok) continue;
          t = res.transition;
          where += ` ${JSON.stringify(action)}`;
        }
        s = t.state;
        check(s, where);
        expect(JSON.stringify(oh.getPublicState(s)) + JSON.stringify(t.events), `${where}: deck leaked`).not.toMatch(/"deck":/);
      }
    }
  }, 20_000);
});
