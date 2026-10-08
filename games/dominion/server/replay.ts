// Replays (§18): a finished match rebuilt from its setup and input log, with
// the same rules code that played it. Pure and DOM-free, so the browser can
// load it lazily and the tests can check it reproduces the match exactly.
//
// A run walks the log once, in slices, remembering where every turn starts
// and keeping a full checkpoint at each round. Any turn is then at most one
// round's worth of steps away.

import type { GameContext } from "@games/game-core";
import type { DominionSettings, DominionState, LogEntry, MatchSetup } from "../shared/types.ts";
import { dominionGame as game, initialState } from "./game.ts";

const noRandom = () => {
  // Randomness is drawn only when a match is created, and the setup holds it.
  throw new Error("replay: nothing after setup should draw randomness");
};

/** One input, applied as it was the first time. Unchanged state if it no longer applies. */
export function replayStep(state: DominionState, entry: LogEntry, setup: MatchSetup): DominionState {
  const ctx: GameContext = { now: setup.startedAt + (entry[entry.length - 1] as number), randomInt: noRandom };
  switch (entry[0]) {
    case 0: {
      const id = state.factions[entry[1]]?.id;
      const r = id ? game.handleAction(state, id, entry[2], ctx) : null;
      return r?.ok ? r.transition.state : state;
    }
    case 1: {
      // The computer thinks again, exactly as it did: its stream and memory are in the state.
      let s = state;
      for (let k = 0; k < entry[1]; k++) s = game.onTimer!(s, "bot", ctx).state;
      return s;
    }
    case 2:
      return game.onTimer!(state, "turn", ctx).state;
    case 3:
      return game.skipTurn!(state, state.factions[entry[1]]!.id, ctx).state;
    case 4:
      return game.onPlayerRemoved!(state, state.factions[entry[1]]!.id, ctx).state;
  }
}

export interface TurnMark {
  /** Log entries applied before this turn starts. */
  entry: number;
  round: number;
  /** The game's turn counter; -1 for the final position. */
  turn: number;
  /** Seat whose turn it is. */
  player: string;
}

export class ReplayRun {
  readonly setup: MatchSetup;
  /** The log with every computer tick its own step. */
  readonly log: LogEntry[];
  /** Every turn start, in order, plus the final position as the last mark. */
  readonly turns: TurnMark[] = [];
  private readonly checkpoints = new Map<number, DominionState>();
  private walker: DominionState;
  private applied = 0;

  constructor(setup: MatchSetup, settings: DominionSettings, log: LogEntry[]) {
    this.setup = setup;
    // Runs of computer ticks, one step per tick, so turns inside them show.
    this.log = log.flatMap((e): LogEntry[] => (e[0] === 1 ? Array.from({ length: e[1] }, () => [1, 1, e[2]]) : [e]));
    this.walker = initialState(setup, settings, { now: setup.startedAt, randomInt: noRandom }).state;
    this.mark();
  }

  get done(): boolean {
    return this.applied >= this.log.length;
  }

  /** Share of the log walked so far, 0–1. */
  get progress(): number {
    return this.log.length ? this.applied / this.log.length : 1;
  }

  /** Walk the log for about `budgetMs`. Returns true once it's all indexed. */
  index(budgetMs = 12): boolean {
    const until = performance.now() + budgetMs;
    while (!this.done && performance.now() < until) {
      this.walker = replayStep(this.walker, this.log[this.applied]!, this.setup);
      this.applied++;
      this.mark();
    }
    return this.done;
  }

  /** The position at the start of turn mark `k` (the last mark: the end of the match). */
  stateAt(k: number): DominionState {
    const target = this.turns[k]!;
    // Nearest checkpoint at or before it, or the last position shown if that's
    // closer (playing forward), then step on from there.
    let from = 0;
    for (const [entry] of this.checkpoints) if (entry <= target.entry && entry > from) from = entry;
    let s = this.checkpoints.get(from)!;
    if (this.cache && this.cache.entry <= target.entry && this.cache.entry > from) {
      from = this.cache.entry;
      s = this.cache.state;
    }
    for (let i = from; i < target.entry; i++) s = replayStep(s, this.log[i]!, this.setup);
    this.cache = { entry: target.entry, state: s };
    return s;
  }

  private cache: { entry: number; state: DominionState } | null = null;

  /** The finished position, once indexed. */
  final(): DominionState {
    return this.walker;
  }

  /** Notes a new turn (or the end) as soon as the walker reaches it. */
  private mark(): void {
    const s = this.walker;
    const last = this.turns.at(-1);
    const turn = s.phase === "finished" ? -1 : s.turn;
    if (last?.turn === turn) return;
    this.turns.push({ entry: this.applied, round: s.round, turn, player: turn === -1 ? "" : s.factions[s.current]!.id });
    // A checkpoint each round keeps any turn a few steps away.
    if (!last || s.round !== last.round || turn === -1) this.checkpoints.set(this.applied, s);
  }
}
