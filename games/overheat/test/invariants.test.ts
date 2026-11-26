import { describe, expect, it } from "vitest";
import { seededRandomInt } from "@games/game-core";
import { findLeaks } from "@games/game-core/testing";
import { overheatGame as oh } from "../server/game.ts";
import { HAND_MAX, type OverheatServerState, type PowerSetting } from "../shared/types.ts";

const TOTAL_CARDS: Record<PowerSetting, number> = { off: 72, classic: 88, cutthroat: 98 };
const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const STEPS = 1500;

/** Throws a readable message on the first broken invariant. */
function check(s: OverheatServerState, where: string) {
  const ids: number[] = [...s.deck.map((c) => c.id), ...s.discard.map((c) => c.id)];
  for (const p of s.players) for (const e of p.engine) ids.push(e.card.id);
  for (const p of s.players) {
    const hand = s.hands[p.id] ?? [];
    for (const c of hand) ids.push(c.id);
    expect(hand.length, `${where}: hand too big`).toBeLessThanOrEqual(HAND_MAX);
    if (p.removed) expect(hand, `${where}: removed player holds cards`).toEqual([]);
    if (s.settings.powers !== "cutthroat") expect(hand, `${where}: hand outside Cutthroat`).toEqual([]);
  }
  if (s.pending) ids.push(s.pending.card.id);
  expect(ids.length, `${where}: card count`).toBe(TOTAL_CARDS[s.settings.powers]);
  expect(new Set(ids).size, `${where}: duplicate ids`).toBe(ids.length);
  if (s.phase !== "playing") return;

  for (const p of s.players) {
    if (p.status === "flipping") expect(p.heat, `${where}: flipping at or over gauge`).toBeLessThan(p.gauge);
    if (p.removed) expect(p.status, `${where}: removed but not out`).toBe("out");
    expect(p.heat, `${where}: negative heat`).toBeGreaterThanOrEqual(0);
  }
  if (s.step === "turn") {
    const owner = s.players[s.turnIndex]!;
    if (owner.status !== "flipping") {
      // Cutthroat: a saved or too-hot player with cards, while someone still flips.
      expect(s.settings.powers, `${where}: turn owner not flipping`).toBe("cutthroat");
      expect(["banked", "busted"], `${where}: turn owner is out`).toContain(owner.status);
      expect((s.hands[owner.id] ?? []).length, `${where}: saved turn owner with no cards`).toBeGreaterThan(0);
      expect(s.players.some((p) => p.status === "flipping"), `${where}: saved turn with nobody flipping`).toBe(true);
    }
  }
  if (s.step === "choosing") {
    const chooser = s.players.find((p) => p.id === s.pending!.chooserId)!;
    expect(chooser.status, `${where}: chooser is out`).not.toBe("out");
  }
  if (s.step === "round-end") expect(s.players.some((p) => p.status === "flipping"), `${where}: flipper at round end`).toBe(false);
}

describe("invariants under random play", () => {
  it.each(["classic", "cutthroat"] as const)("%s: holds across random actions, skips and leavers", (powers) => {
    const accepted = { play: 0, pass: 0, keep: 0, steal: 0, dump: 0, audit: 0, block: 0 };
    for (const seed of SEEDS) {
      const r = seededRandomInt(seed);
      const ctx = { now: 0, randomInt: r };
      const n = 2 + r(7);
      const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
      let t = oh.createGame(roster, { target: 100, powers }, { roundNumber: 1, dealerSeat: r(n) }, ctx);
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
            const th = s.players.find((p) => p.id === targetId)!;
            const mine = me.engine[r(me.engine.length || 1)]?.card.id ?? 0;
            const theirs = th.engine[r(th.engine.length || 1)]?.card.id ?? 0;
            const kind = s.pending!.kind;
            if (kind === "wrench") action = { type: "wrench", targetId, mine, theirs };
            else if (kind === "steal") action = { type: "steal", targetId, theirs };
            else if (kind === "dump") action = { type: "dump", targetId, mine };
            else action = { type: "target", targetId };
          } else {
            const hand = s.hands[me.id] ?? [];
            const turn = roll % 4;
            if (hand.length && turn === 0) action = { type: "play", cardId: hand[r(hand.length)]!.id };
            else if (me.status !== "flipping" || turn === 1) action = { type: "pass" };
            else action = { type: me.heat >= me.gauge - 6 && r(3) ? "bank" : "flip" };
          }
          // Mostly the right player, sometimes a stranger: stale and hostile actions must leave state alone.
          const res = oh.handleAction(s, r(10) ? awaited : pid, action as never, ctx);
          if (!res.ok) continue;
          t = res.transition;
          if (action.type === "play" || action.type === "pass") accepted[action.type]++;
          for (const e of t.events) if (e.event.type === "steal" || e.event.type === "dump" || e.event.type === "audit" || e.event.type === "block") accepted[e.event.type]++;
          where += ` ${JSON.stringify(action)}`;
        }
        s = t.state;
        if (t.events.some((e) => e.event.type === "keep")) accepted.keep++;
        check(s, where);
        expect(JSON.stringify(oh.getPublicState(s)) + JSON.stringify(t.events), `${where}: deck leaked`).not.toMatch(/"deck":/);
        for (const owner of s.players) {
          for (const card of s.hands[owner.id] ?? []) {
            const leaks = findLeaks({ def: oh, state: s, events: t.events, players: roster.map((p) => p.id), secret: JSON.stringify(card), allowed: [owner.id] });
            expect(leaks, `${where}: ${owner.id}'s ${card.power} leaked`).toEqual([]);
          }
        }
      }
    }
    if (powers === "cutthroat") {
      expect(accepted.play, "plays").toBeGreaterThan(50);
      expect(accepted.pass, "passes").toBeGreaterThan(50);
      expect(accepted.keep, "keeps").toBeGreaterThan(50);
      for (const kind of ["steal", "dump", "audit", "block"] as const) expect(accepted[kind], kind).toBeGreaterThan(5);
    } else expect(accepted).toEqual({ play: 0, pass: 0, keep: 0, steal: 0, dump: 0, audit: 0, block: 0 });
  }, 30_000);
});
