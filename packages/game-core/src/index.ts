// The game plugin contract (§7). Everything here is runtime-agnostic: it runs in
// the Worker, in the browser and in tests, so it must not touch DOM or Node APIs.

export interface GameManifest {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  /** A short key the shell maps to its own drawing. Never an emoji. */
  icon: string;
}

/**
 * One host-configurable setting, described as data so the lobby can render it
 * without knowing the game. `patch` is what goes to `update-settings`.
 */
export interface SettingField {
  key: string;
  label: string;
  /** Index into `options` of the current value. */
  selected: number;
  options: { label: string; patch: Record<string, unknown> }[];
  /** A short consequence of the current choice, e.g. "13 cards each". */
  hint?: string;
}

export interface GamePlayer {
  id: string;
}

export interface MatchContext {
  roundNumber: number;
  dealerSeat: number;
}

export interface GameContext {
  /** Injected clock — keeps rules deterministic in tests. */
  now: number;
  /** Injected RNG, uniform in [0, maxExclusive). Secure in production. */
  randomInt(maxExclusive: number): number;
}

export interface GameError {
  /** e.g. "not-your-turn", "card-not-owned", "illegal-play" */
  code: string;
  /** Safe to show to the acting player. */
  message: string;
}

export type EventVisibility = { kind: "public" } | { kind: "private"; playerId: string };

export interface GameEventEnvelope<TEvent> {
  visibility: EventVisibility;
  event: TEvent;
}

export type TimerRequest =
  | { kind: "set"; timerId: string; delayMs: number }
  | { kind: "cancel"; timerId: string };

export interface GameTransition<TState, TEvent> {
  state: TState;
  events: GameEventEnvelope<TEvent>[];
  timers?: TimerRequest[];
}

export type GameResult<TState, TEvent> =
  | { ok: true; transition: GameTransition<TState, TEvent> }
  | { ok: false; error: GameError };

export interface GameOutcome {
  winnerIds: string[];
  /** Per-player figure for the results screen, e.g. cards left. */
  standings: { playerId: string; value: number }[];
}

export interface CreateGameOptions {
  /** Test-only. Never reachable from client input. */
  deck?: unknown[];
}

export interface GameDefinition<TState, TAction, TPublicState, TPrivateState, TSettings, TEvent> {
  manifest: GameManifest;

  defaultSettings: TSettings;
  parseSettings(input: unknown): TSettings | null;
  parseAction(input: unknown): TAction | null;

  createGame(
    players: GamePlayer[],
    settings: TSettings,
    match: MatchContext,
    ctx: GameContext,
    options?: CreateGameOptions,
  ): GameTransition<TState, TEvent>;

  handleAction(
    state: TState,
    playerId: string,
    action: TAction,
    ctx: GameContext,
  ): GameResult<TState, TEvent>;

  onTimer?(state: TState, timerId: string, ctx: GameContext): GameTransition<TState, TEvent>;

  onPlayerDisconnected?(state: TState, playerId: string, ctx: GameContext): GameTransition<TState, TEvent>;
  onPlayerReconnected?(state: TState, playerId: string, ctx: GameContext): GameTransition<TState, TEvent>;
  onPlayerRemoved?(state: TState, playerId: string, ctx: GameContext): GameTransition<TState, TEvent>;

  skipTurn?(state: TState, playerId: string, ctx: GameContext): GameTransition<TState, TEvent>;

  getPublicState(state: TState): TPublicState;
  getPrivateState(state: TState, playerId: string): TPrivateState;
  getAwaitedPlayerIds(state: TState): string[];

  /** Non-null exactly when the game is finished. */
  getResult(state: TState): GameOutcome | null;
}

/** What the room runtime holds. `any` is the point: the room can't know game-specific types. */
export type AnyGameDefinition = GameDefinition<any, any, any, any, any, any>;

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/**
 * Uniform integer in [0, maxExclusive) from crypto.getRandomValues, using
 * rejection sampling so large ranges don't skew toward low values.
 */
export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 2 ** 32) {
    throw new RangeError(`bad range: ${maxExclusive}`);
  }
  const limit = 2 ** 32 - (2 ** 32 % maxExclusive);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const x = buf[0]!;
    if (x < limit) return x % maxExclusive;
  }
}

/** Fisher–Yates, in place (§22). */
export function shuffle<T>(items: T[], randomInt: (maxExclusive: number) => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/** Deterministic RNG for tests (mulberry32). Never use for real shuffles. */
export function seededRandomInt(seed: number): (maxExclusive: number) => number {
  let a = seed >>> 0;
  return (maxExclusive) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    return Math.floor(r * maxExclusive);
  };
}
