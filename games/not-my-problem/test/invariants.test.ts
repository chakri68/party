import { seededRandomInt, type GameEventEnvelope, type TimerRequest } from "@games/game-core";
import { describe, expect, it } from "vitest";
import { notMyProblemGame as nmp } from "../server/game.ts";
import { alive, type State } from "../server/state.ts";
import { buildDeck } from "../shared/cards.ts";
import type { ActionKind, NmpAction, NmpEvent } from "../shared/index.ts";
import { act, ctx, ids, start } from "./helpers.ts";

/** Every card id the state holds, in any zone. */
export function zones(s: State): string[] {
  return [
    ...s.players.flatMap((p) => [...p.hand, ...(p.shield ? [p.shield] : [])]),
    ...s.drawPile,
    ...s.discard,
    ...s.hiddenDiscard,
    ...s.resolvedProblems,
    ...(s.problem ? [s.problem.card] : []),
    ...s.moves.map((m) => m.card),
    ...(s.report ? [s.report.reportCard, s.report.faceDown] : []),
  ].map((c) => c.id);
}

type Move =
  | { kind: "act"; playerId: string; action: NmpAction }
  | { kind: "timer" }
  | { kind: "remove" | "away" | "back" | "skip"; playerId: string };

/** Every move a player may make now, read from their private state only. */
function legalMoves(s: State, playerId: string): NmpAction[] {
  const v = nmp.getPrivateState(s, playerId);
  const token = v.token;
  const out: NmpAction[] = [];
  const kindOf = (id: string) => v.hand.find((c) => c.id === id)!.kind;
  for (const { cardId, targets } of v.playable) {
    const kind = kindOf(cardId);
    const withTargets = (make: (targetId: string) => NmpAction) => targets!.forEach((t) => out.push(make(t)));
    switch (kind) {
      case "overtime":
      case "spy":
        withTargets((targetId) => ({ type: "play", token, cardId, targetId }));
        break;
      case "intern":
      case "promotion":
        out.push({ type: "play", token, cardId });
        break;
      case "quick-fix":
        out.push({ type: "fix", token, cardId });
        break;
      case "blame-game":
        withTargets((targetId) => ({ type: "blame", token, cardId, targetId }));
        break;
      case "revenge":
        withTargets((targetId) => ({ type: "revenge", token, cardId, targetId }));
        break;
      case "not-me":
        out.push({ type: "not-me", token, cardId });
        break;
      case "hr-complaint":
        out.push({ type: "hr", token, cardId });
        break;
      case "fake-report":
        for (const c of v.hand) if (c.id !== cardId) out.push({ type: "fake-report", token, cardId, faceDownId: c.id });
        break;
    }
  }
  if (v.canDraw) out.push({ type: "draw", token });
  if (v.canAccept) out.push({ type: "accept", token });
  if (v.canPass) out.push({ type: "pass", token });
  if (v.canChallenge) out.push({ type: "challenge", token });
  return out;
}

const quoted = (id: string) => `"${id}"`;

/** Ids nobody but `playerId` may see in this state (null: nobody at all). */
function secretsOf(s: State): { id: string; owner: string | null }[] {
  return [
    ...s.players.flatMap((p) => p.hand.map((c) => ({ id: c.id, owner: p.id }))),
    ...s.drawPile.map((c) => ({ id: c.id, owner: null })),
    ...s.hiddenDiscard.map((c) => ({ id: c.id, owner: null })),
    ...(s.report ? [{ id: s.report.faceDown.id, owner: s.report.ownerId }] : []),
  ];
}

/** What the random games got to, across all seeds. */
const seen = new Set<string>();

interface RunOptions {
  seed: number;
  n: number;
  /** Remove, disconnect and skip players now and then. */
  churn: boolean;
}

function runGame({ seed, n, churn }: RunOptions) {
  const rand = seededRandomInt(seed * 7919 + n);
  const players = ids(n);
  let now = 0;
  const created = nmp.createGame(players.map((id) => ({ id })), nmp.defaultSettings, { roundNumber: 1, dealerSeat: seed % n }, ctx(now, seed));
  let s = created.state;
  const deck = zones(s).sort();
  const timers = new Set<string>();
  const applyTimers = (list: TimerRequest[] | undefined) => {
    for (const t of list ?? []) {
      if (t.kind === "set") timers.add(t.timerId);
      else timers.delete(t.timerId);
    }
  };
  applyTimers(created.timers);

  const { actions, problems } = buildDeck(n);
  expect(deck.length).toBe(actions.length + problems.length);
  expect(new Set(deck).size).toBe(deck.length);

  const check = (t: { state: State; events: GameEventEnvelope<NmpEvent>[]; timers?: TimerRequest[] }, prevSecrets: { id: string; owner: string | null }[], what: string) => {
    applyTimers(t.timers);
    const st = t.state;
    for (const e of t.events) {
      const ev = e.event;
      seen.add(ev.type === "played" ? `played:${ev.kind}` : ev.type === "challenged" ? `challenged:${ev.lied}` : ev.type);
    }
    seen.add(`step:${st.step}`);
    const where = `seed ${seed} n ${n} after ${what}`;
    expect(zones(st).sort(), where).toEqual(deck);
    for (const id of nmp.getAwaitedPlayerIds(st)) expect(alive(st.players.find((p) => p.id === id)!), where).toBe(true);
    if (st.step !== "finished") {
      expect(st.deadline, where).not.toBeNull();
      expect(timers.has(`step:${st.token}`), where).toBe(true);
    }
    // No secret from before or after reaches public state, public events, or another player's view.
    const pub = JSON.stringify(nmp.getPublicState(st));
    const pubEvents = JSON.stringify(t.events.filter((e) => e.visibility.kind === "public").map((e) => e.event));
    // A challenge shows the face-down card, and a drawn Problem is public.
    const revealed = [
      ...t.events.flatMap((e) => (e.event.type === "challenged" ? [e.event.card.id] : [])),
      ...(st.problem ? [st.problem.card.id] : []),
    ];
    const secrets = [...prevSecrets, ...secretsOf(st)].filter((x) => !revealed.includes(x.id));
    for (const { id } of secrets) {
      expect(pub.includes(quoted(id)), `${where}: ${id} in public state`).toBe(false);
      expect(pubEvents.includes(quoted(id)), `${where}: ${id} in public events`).toBe(false);
    }
    for (const { id, owner } of secretsOf(st)) {
      for (const p of players) {
        if (p === owner) continue;
        expect(JSON.stringify(nmp.getPrivateState(st, p)).includes(quoted(id)), `${where}: ${id} seen by ${p}`).toBe(false);
      }
    }
    s = st;
  };

  let steps = 0;
  for (; s.step !== "finished" && steps < 4000; steps++) {
    const moves: Move[] = [];
    for (const p of players) for (const action of legalMoves(s, p)) moves.push({ kind: "act", playerId: p, action });
    let move: Move;
    const roll = rand(1000);
    const living = players.filter((p) => alive(s.players.find((x) => x.id === p)!));
    if (churn && roll < 6 && living.length > 1) move = { kind: "remove", playerId: living[rand(living.length)]! };
    else if (churn && roll < 20) move = { kind: "away", playerId: players[rand(n)]! };
    else if (churn && roll < 40) move = { kind: "back", playerId: players[rand(n)]! };
    else if (churn && roll < 50) move = { kind: "skip", playerId: players[rand(n)]! };
    else if (!moves.length || roll >= 940) move = { kind: "timer" };
    else move = moves[rand(moves.length)]!;

    const prev = secretsOf(s);
    switch (move.kind) {
      case "act": {
        now += 100;
        const r = nmp.handleAction(s, move.playerId, move.action, ctx(now, seed + steps));
        if (!r.ok) throw new Error(`seed ${seed} n ${n}: ${move.playerId} ${JSON.stringify(move.action)} refused: ${r.error.code}`);
        check(r.transition, prev, `${move.playerId} ${move.action.type}`);
        break;
      }
      case "timer":
        now = Math.max(now, s.deadline ?? now);
        check(nmp.onTimer!(s, `step:${s.token}`, ctx(now, seed + steps)), prev, "timer");
        break;
      case "remove":
        check(nmp.onPlayerRemoved!(s, move.playerId, ctx(now)), prev, `remove ${move.playerId}`);
        break;
      case "away":
        check(nmp.onPlayerDisconnected!(s, move.playerId, ctx(now)), prev, `away ${move.playerId}`);
        break;
      case "back":
        check(nmp.onPlayerReconnected!(s, move.playerId, ctx(now)), prev, `back ${move.playerId}`);
        break;
      case "skip":
        check(nmp.skipTurn!(s, move.playerId, ctx(now, seed + steps)), prev, `skip ${move.playerId}`);
        break;
    }
  }
  return { state: s, steps };
}

describe("card conservation and liveness over random games", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const n = 3 + (seed % 6);
    const churn = seed % 3 === 0;
    it(`seed ${seed}, ${n} players${churn ? ", with leavers" : ""}`, () => {
      const { state } = runGame({ seed, n, churn });
      expect(state.step).toBe("finished");
      expect(nmp.getResult(state)).not.toBeNull();
    });
  }

  it("reached every card, both challenge outcomes, firing and leaving", () => {
    const want = [
      "played:blame-game", "played:not-me", "played:revenge", "played:hr-complaint", "played:overtime",
      "played:intern", "played:promotion", "played:spy", "report", "challenged:true", "challenged:false",
      "fixed", "moved", "fired", "removed", "step:target", "step:hr", "step:challenge",
    ];
    expect(want.filter((k) => !seen.has(k))).toEqual([]);
  });
});

describe("card conservation in scripted endings", () => {
  it("a wrong challenge that ends the game leaves the Problem in its zone", () => {
    const hands: ActionKind[][] = [
      ["hr-complaint", "blame-game", "not-me", "quick-fix", "promotion"],
      ["fake-report", "spy", "quick-fix", "fake-report", "intern"],
      ["revenge", "not-me", "quick-fix", "blame-game", "hr-complaint"],
    ];
    let s = start(3, { hands, pile: ["server-down", "spy"] });
    const deck = zones(s).sort();
    s = nmp.onPlayerRemoved!(s, "p0", ctx()).state;
    s = act(s, "p1", { type: "draw" }).state;
    s = act(s, "p1", { type: "fake-report", cardId: "fake-report-1", faceDownId: "quick-fix-2" }).state;
    s.players[2]!.warnings = 2;
    s = act(s, "p2", { type: "challenge" }).state;
    expect(s.step).toBe("finished");
    expect(s.winnerIds).toEqual(["p1"]);
    expect(s.problem?.card.id).toBe("server-down-1");
    expect(zones(s).sort()).toEqual(deck);
  });
});
