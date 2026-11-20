// Test helpers for games. Imported by game tests, which bring their own
// `expect`, so nothing here may import vitest.

import {
  seededRandomInt,
  stableHash,
  type BotContext,
  type AnyGameDefinition,
  type GameContext,
  type GameEventEnvelope,
  type GameOutcome,
  type TimerRequest,
} from "./index.ts";

/**
 * Everywhere a secret shows up that a seat outside `allowed` would receive:
 * public state, other seats' private state, public events, private events
 * addressed elsewhere. Empty means it kept. Matching is on the JSON the wire
 * would carry, ignoring case, so "Wolf" in a label counts as "wolf".
 *
 * Public anything is always a leak, even when every seat is allowed: public
 * state also reaches whoever joins later. Call it at each step of a scripted
 * game, up to the phase where the secret is meant to come out.
 *
 *   expect(findLeaks({ def, state, events, players, secret: "wolf", allowed: wolves })).toEqual([]);
 */
export function findLeaks<S>(opts: {
  def: Pick<AnyGameDefinition, "getPublicState" | "getPrivateState">;
  state: S;
  events?: GameEventEnvelope<unknown>[];
  players: string[];
  secret: string;
  allowed: string[];
}): string[] {
  const { def, state, events = [], players, allowed } = opts;
  const secret = opts.secret.toLowerCase();
  const has = (value: unknown) => (JSON.stringify(value) ?? "").toLowerCase().includes(secret);
  const out: string[] = [];

  if (has(def.getPublicState(state))) out.push("public state");
  for (const id of players) {
    if (!allowed.includes(id) && has(def.getPrivateState(state, id))) out.push(`private state of ${id}`);
  }
  events.forEach((e, i) => {
    if (!has(e.event)) return;
    if (e.visibility.kind === "public") out.push(`public event #${i}`);
    else if (!allowed.includes(e.visibility.playerId)) out.push(`private event #${i} to ${e.visibility.playerId}`);
  });
  return out;
}

export interface BotRunResult {
  /** Null when it hit `maxMoves`, or stopped early. */
  outcome: GameOutcome | null;
  moves: number;
  rejected: { playerId: string; action: unknown; code: string }[];
  stuck: { playerId: string; reason: "null-while-awaited" }[];
  /**
   * The most accepted moves by one seat with no other seat's move between, as
   * the room counts it. Fired timers neither count nor break a run. The room
   * calls a bot stuck past `BOT_MAX_RUN`.
   */
  longestRun: number;
}

/**
 * A copy nothing can change: a bot that writes to its view throws. Copied
 * through JSON, as the wire would carry it (and far quicker than
 * `structuredClone` over thousands of moves).
 */
function frozenCopy<T>(value: T): T {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (v: unknown) => {
    if (v === null || typeof v !== "object" || Object.isFrozen(v)) return;
    Object.freeze(v);
    for (const inner of Object.values(v)) freeze(inner);
  };
  freeze(copy);
  return copy;
}

/**
 * Plays a whole game with every seat a bot, to catch a bot that stalls or
 * breaks a rule. Bots get views only, as frozen copies: a bot that changes
 * its view throws, and the throw comes out of `playBots`. Game timers fire in
 * due order when no bot wants to move. Stops on the first rejected move or
 * stuck seat.
 */
export function playBots(
  def: AnyGameDefinition,
  opts: { players: number; seed: number; settings?: unknown; maxMoves?: number },
): BotRunResult {
  const bot = def.bot;
  if (!bot) throw new Error("playBots: the game has no bot");
  const maxMoves = opts.maxMoves ?? 5000;
  const randomInt = seededRandomInt(opts.seed);
  let clock = 1_000_000;
  const ctx = (): GameContext => ({ now: clock, randomInt, hostId: "p1" });
  const ids = Array.from({ length: opts.players }, (_, i) => `p${i + 1}`);
  const result: BotRunResult = { outcome: null, moves: 0, rejected: [], stuck: [], longestRun: 0 };
  let run = { playerId: "", moves: 0 };
  const ctxFor = (playerId: string): BotContext => ({
    randomInt,
    chance: (key) => stableHash(`${opts.seed}:${playerId}:${key}`) % 100,
  });

  const timers = new Map<string, number>();
  const track = (requests: TimerRequest[] | undefined) => {
    for (const t of requests ?? []) {
      if (t.kind === "set") timers.set(t.timerId, clock + t.delayMs);
      else timers.delete(t.timerId);
    }
  };

  const created = def.createGame(
    ids.map((id) => ({ id })),
    opts.settings ?? def.defaultSettings,
    { roundNumber: 1, dealerSeat: 0 },
    ctx(),
  );
  let state = created.state;
  track(created.timers);

  while (!def.getResult(state) && result.moves < maxMoves) {
    const awaited = def.getAwaitedPlayerIds(state) as string[];
    // Frozen, so one copy serves every seat.
    const publicState = frozenCopy(def.getPublicState(state));
    const picks = ids.map((id) => ({
      id,
      action: bot.decide(
        { playerId: id, public: publicState, private: frozenCopy(def.getPrivateState(state, id)) },
        ctxFor(id),
      ),
    }));
    const pick =
      picks.find((p) => p.action !== null && awaited.includes(p.id)) ?? picks.find((p) => p.action !== null);

    if (pick) {
      const res = def.handleAction(state, pick.id, pick.action, ctx());
      if (!res.ok) {
        result.rejected.push({ playerId: pick.id, action: pick.action, code: res.error.code });
        break;
      }
      state = res.transition.state;
      track(res.transition.timers);
      result.moves++;
      run = run.playerId === pick.id ? { playerId: pick.id, moves: run.moves + 1 } : { playerId: pick.id, moves: 1 };
      result.longestRun = Math.max(result.longestRun, run.moves);
      continue;
    }

    const next = [...timers.entries()].sort((a, b) => a[1] - b[1])[0];
    if (!next || !def.onTimer) {
      for (const id of awaited) result.stuck.push({ playerId: id, reason: "null-while-awaited" });
      break;
    }
    timers.delete(next[0]);
    clock = Math.max(clock, next[1]);
    const t = def.onTimer(state, next[0], ctx());
    state = t.state;
    track(t.timers);
    result.moves++;
  }

  result.outcome = def.getResult(state);
  return result;
}
