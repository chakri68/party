import {
  type GameContext,
  type GameDefinition,
  type GameEventEnvelope,
  type GameResult,
  type TimerRequest,
} from "@games/game-core";
import { scribblManifest } from "../shared/manifest.ts";
import {
  cleanChat,
  drawerPoints,
  guessPoints,
  hintAt,
  hintCount,
  isClose,
  isLetter,
  normalizeGuess,
  parseDrawOp,
} from "../shared/rules.ts";
import {
  CHAT_KEEP,
  CHOOSE_MS,
  DEFAULT_SETTINGS,
  DRAW_SECONDS_OPTIONS,
  MAX_POINTS,
  MAX_STROKES,
  REVEAL_MS,
  ROUND_OPTIONS,
  WORD_CHOICES,
  type ChatLine,
  type DrawingSnapshot,
  type EndReason,
  type ScribblAction,
  type ScribblEvent,
  type ScribblPlayerState,
  type ScribblPrivateState,
  type ScribblPublicState,
  type ScribblServerState,
  type ScribblSettings,
  type TurnEnd,
  type TurnState,
} from "../shared/types.ts";
import { WORDS } from "../shared/words.ts";

type State = ScribblServerState;
type Player = ScribblPlayerState;
type Events = GameEventEnvelope<ScribblEvent>[];

const pub = (event: ScribblEvent): GameEventEnvelope<ScribblEvent> => ({ visibility: { kind: "public" }, event });
const only = (playerId: string, event: ScribblEvent): GameEventEnvelope<ScribblEvent> => ({
  visibility: { kind: "private", playerId },
  event,
});

const reject = (code: string, message: string): GameResult<State, ScribblEvent> => ({
  ok: false,
  error: { code, message },
});

/** Two timers, reused: the phase's deadline, and the next hint. */
const PHASE = "phase";
const HINT = "hint";

// ---------------------------------------------------------------------------
// Internals. Helpers mutate the state they're given; the public API always
// hands them a fresh clone. `Out` gathers what the transition says besides state.
// ---------------------------------------------------------------------------

interface Out {
  events: Events;
  timers: TimerRequest[];
}

const clone = (state: State): State => structuredClone(state);
const newOut = (): Out => ({ events: [], timers: [] });
const done = (state: State, out: Out) => ({ state, events: out.events, timers: out.timers });

const inGame = (p: Player) => !p.removed;
const drawMs = (state: State) => state.settings.drawSeconds * 1000;

function say(state: State, line: Omit<ChatLine, "id">): void {
  state.chat.push({ id: state.nextChatId++, ...line });
  if (state.chat.length > CHAT_KEEP) state.chat.splice(0, state.chat.length - CHAT_KEEP);
}

/** Three words nobody's seen this game. Once the pool runs dry, it starts over. */
function pickChoices(state: State, ctx: GameContext): string[] {
  let fresh = state.pool.filter((w) => !state.used.includes(w));
  if (fresh.length < Math.min(WORD_CHOICES, state.pool.length)) {
    state.used = [];
    fresh = [...state.pool];
  }
  const picks: string[] = [];
  while (picks.length < WORD_CHOICES && fresh.length) picks.push(fresh.splice(ctx.randomInt(fresh.length), 1)[0]!);
  state.used.push(...picks);
  return picks;
}

function blankTurn(number: number, drawerId: string): TurnState {
  return {
    number,
    drawerId,
    phase: "choosing",
    choices: [],
    word: null,
    endsAt: 0,
    phaseMs: 0,
    revealed: [],
    hintsLeft: 0,
    guessed: [],
    drawerPoints: 0,
    endedBy: null,
    strokes: [],
    nextStrokeId: 0,
    pointCount: 0,
  };
}

function finish(state: State, reason: EndReason, out: Out): void {
  state.phase = "finished";
  state.endReason = reason;
  out.timers.push({ kind: "cancel", timerId: PHASE }, { kind: "cancel", timerId: HINT });
  out.events.push(pub({ type: "game-over", reason }));
}

/**
 * Hands the pencil to the next seat that hasn't drawn this round, rolling
 * into the next round (or the end) when there isn't one. Anyone away when
 * their go comes round misses it: an empty canvas for 80 s helps nobody.
 */
function nextTurn(state: State, ctx: GameContext, out: Out): void {
  const n = state.players.length;
  for (;;) {
    if (state.players.filter(inGame).length < 2) return finish(state, "abandoned", out);
    let next = -1;
    for (let step = 1; step <= n; step++) {
      const idx = (state.drawerIndex + step) % n;
      const p = state.players[idx]!;
      if (inGame(p) && !state.drewThisRound.includes(p.id)) {
        next = idx;
        break;
      }
    }
    if (next < 0) {
      if (state.round >= state.settings.rounds) return finish(state, "done", out);
      state.round++;
      state.drewThisRound = [];
      continue;
    }
    const p = state.players[next]!;
    state.drawerIndex = next;
    state.drewThisRound.push(p.id);
    if (p.away) {
      say(state, { kind: "missed", playerId: p.id, text: "", to: null });
      out.events.push(pub({ type: "missed", playerId: p.id }));
      continue;
    }
    state.turn = { ...blankTurn(state.turn.number + 1, p.id), choices: pickChoices(state, ctx), endsAt: ctx.now + CHOOSE_MS, phaseMs: CHOOSE_MS };
    out.timers.push({ kind: "set", timerId: PHASE, delayMs: CHOOSE_MS }, { kind: "cancel", timerId: HINT });
    out.events.push(pub({ type: "turn-started", drawerId: p.id, round: state.round, turn: state.turn.number }));
    return;
  }
}

function startDrawing(state: State, word: string, ctx: GameContext, out: Out): void {
  const t = state.turn;
  const ms = drawMs(state);
  t.phase = "drawing";
  t.word = word;
  t.endsAt = ctx.now + ms;
  t.phaseMs = ms;
  t.hintsLeft = hintCount(word);
  out.timers.push({ kind: "set", timerId: PHASE, delayMs: ms });
  if (t.hintsLeft) out.timers.push({ kind: "set", timerId: HINT, delayMs: hintAt(0, t.hintsLeft, ms) });
  say(state, { kind: "drawing", playerId: t.drawerId, text: "", to: null });
  out.events.push(pub({ type: "drawing", drawerId: t.drawerId }));
}

function endTurn(state: State, by: TurnEnd, ctx: GameContext, out: Out): void {
  const t = state.turn;
  t.phase = "reveal";
  t.endedBy = by;
  t.endsAt = ctx.now + REVEAL_MS;
  t.phaseMs = REVEAL_MS;
  t.hintsLeft = 0;
  out.timers.push({ kind: "set", timerId: PHASE, delayMs: REVEAL_MS }, { kind: "cancel", timerId: HINT });
  say(state, { kind: "word", playerId: null, text: t.word!, to: null });
  out.events.push(pub({ type: "turn-ended", word: t.word!, by }));
}

/** Everyone who's here and could guess, has. Someone has to have, though. */
function everyoneGotIt(state: State): boolean {
  const t = state.turn;
  if (t.phase !== "drawing" || !t.guessed.length) return false;
  return state.players
    .filter((p) => inGame(p) && !p.away && p.id !== t.drawerId)
    .every((p) => t.guessed.some((g) => g.playerId === p.id));
}

function guess(state: State, player: Player, text: string, ctx: GameContext, out: Out): void {
  const t = state.turn;
  const all = { playerId: player.id, text, to: null };
  if (t.phase !== "drawing") return say(state, { kind: "msg", ...all });

  if (t.guessed.some((g) => g.playerId === player.id)) {
    // Already got it: only the people who know the word can read along.
    return say(state, { kind: "secret", ...all, to: [t.drawerId, ...t.guessed.map((g) => g.playerId)] });
  }

  const g = normalizeGuess(text);
  const word = normalizeGuess(t.word!);
  if (g === word) {
    const points = guessPoints(t.endsAt - ctx.now, t.phaseMs);
    const guessers = state.players.filter((p) => inGame(p) && p.id !== t.drawerId).length;
    const cut = drawerPoints(guessers);
    player.score += points;
    t.guessed.push({ playerId: player.id, points });
    t.drawerPoints += cut;
    const drawer = state.players.find((p) => p.id === t.drawerId);
    if (drawer) drawer.score += cut;
    say(state, { kind: "guessed", playerId: player.id, text: "", to: null });
    out.events.push(pub({ type: "guessed", playerId: player.id, points }));
    if (everyoneGotIt(state)) endTurn(state, "all", ctx, out);
    return;
  }

  say(state, { kind: "msg", ...all });
  if (isClose(g, word)) {
    say(state, { kind: "close", playerId: player.id, text, to: [player.id] });
    out.events.push(only(player.id, { type: "close" }));
  }
}

/** Fills in one more letter, never the last one left. */
function revealLetter(state: State, ctx: GameContext, out: Out): void {
  const t = state.turn;
  if (t.phase !== "drawing" || t.hintsLeft <= 0) return;
  const hidden = [...t.word!].flatMap((ch, i) => (isLetter(ch) && !t.revealed.includes(i) ? [i] : []));
  if (hidden.length > 1) {
    t.revealed.push(hidden[ctx.randomInt(hidden.length)]!);
    out.events.push(pub({ type: "hint" }));
  }
  t.hintsLeft--;
  if (t.hintsLeft > 0) {
    const total = hintCount(t.word!);
    const startedAt = t.endsAt - t.phaseMs;
    const at = startedAt + hintAt(total - t.hintsLeft, total, t.phaseMs);
    out.timers.push({ kind: "set", timerId: HINT, delayMs: Math.max(0, at - ctx.now) });
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): ScribblSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<ScribblSettings>) };
  if (!ROUND_OPTIONS.includes(s.rounds) || !DRAW_SECONDS_OPTIONS.includes(s.drawSeconds)) return null;
  return { rounds: s.rounds, drawSeconds: s.drawSeconds };
}

function parseAction(input: unknown): ScribblAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (a.type === "choose" && Number.isInteger(a.index) && (a.index as number) >= 0 && (a.index as number) < WORD_CHOICES) {
    return { type: "choose", index: a.index as number };
  }
  if (a.type === "guess" && typeof a.text === "string" && a.text.length <= 200) {
    const text = cleanChat(a.text);
    return text ? { type: "guess", text } : null;
  }
  return null;
}

/** Injected word lists (tests, dev tools): non-empty strings. */
function normalizePool(input: unknown[]): string[] {
  const words = input.filter((w): w is string => typeof w === "string").map((w) => cleanChat(w).toLowerCase()).filter((w) => normalizeGuess(w));
  if (!words.length || words.length !== input.length) throw new Error("A word list must be plain words, e.g. [\"cat\", \"hot dog\"].");
  return [...new Set(words)];
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const scribblGame: GameDefinition<
  ScribblServerState,
  ScribblAction,
  ScribblPublicState,
  ScribblPrivateState,
  ScribblSettings,
  ScribblEvent
> = {
  manifest: scribblManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = scribblManifest;
    if (n < minPlayers || n > maxPlayers) {
      throw new Error(`scribbl: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    }
    const state: State = {
      phase: "playing",
      settings,
      players: players.map((p) => ({ id: p.id, score: 0, removed: false, away: false })),
      round: 1,
      // The dealer's left draws first.
      drawerIndex: ((match.dealerSeat % n) + n) % n,
      drewThisRound: [],
      turn: blankTurn(0, players[0]!.id),
      pool: options?.deck ? normalizePool(options.deck) : [...WORDS],
      used: [],
      chat: [],
      nextChatId: 0,
      endReason: null,
    };
    const out = newOut();
    nextTurn(state, ctx, out);
    return done(state, out);
  },

  handleAction(prev, playerId, action, ctx) {
    if (prev.phase !== "playing") return reject("game-finished", "The game is over.");
    const me = prev.players.find((p) => p.id === playerId);
    if (!me || me.removed) return reject("not-in-game", "You're not in this game.");
    const t = prev.turn;

    if (action.type === "choose") {
      if (t.phase !== "choosing" || t.drawerId !== playerId) return reject("not-choosing", "It's not your pick.");
      const word = t.choices[action.index];
      if (!word) return reject("bad-choice", "That word isn't on offer.");
      const state = clone(prev);
      const out = newOut();
      startDrawing(state, word, ctx, out);
      return { ok: true, transition: done(state, out) };
    }

    if (t.phase === "drawing" && t.drawerId === playerId) return reject("drawing", "No typing while you draw. Nice try.");
    const state = clone(prev);
    const out = newOut();
    guess(state, state.players.find((p) => p.id === playerId)!, action.text, ctx, out);
    return { ok: true, transition: done(state, out) };
  },

  onTimer(prev, timerId, ctx) {
    if (prev.phase !== "playing") return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    const t = state.turn;
    if (timerId === HINT) revealLetter(state, ctx, out);
    else if (timerId === PHASE) {
      if (t.phase === "choosing") startDrawing(state, t.choices[ctx.randomInt(t.choices.length)]!, ctx, out);
      else if (t.phase === "drawing") endTurn(state, "time", ctx, out);
      else nextTurn(state, ctx, out);
    }
    return done(state, out);
  },

  onPlayerDisconnected(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    state.players[idx]!.away = true;
    // They were the last one holding things up.
    if (everyoneGotIt(state)) endTurn(state, "all", ctx, out);
    return done(state, out);
  },

  onPlayerReconnected(prev, playerId) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (idx < 0 || !prev.players[idx]!.away) return { state: prev, events: [] };
    const state = clone(prev);
    state.players[idx]!.away = false;
    return { state, events: [] };
  },

  onPlayerRemoved(prev, playerId, ctx) {
    const idx = prev.players.findIndex((p) => p.id === playerId);
    if (prev.phase !== "playing" || idx < 0 || prev.players[idx]!.removed) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    state.players[idx]!.removed = true;
    const t = state.turn;
    if (state.players.filter(inGame).length < 2) finish(state, "abandoned", out);
    else if (t.drawerId === playerId && t.phase === "choosing") nextTurn(state, ctx, out);
    else if (t.drawerId === playerId && t.phase === "drawing") endTurn(state, "left", ctx, out);
    else if (everyoneGotIt(state)) endTurn(state, "all", ctx, out);
    return done(state, out);
  },

  onStream(state, playerId, data) {
    const op = parseDrawOp(data);
    const t = state.turn;
    if (!op || state.phase !== "playing" || t.phase !== "drawing" || t.drawerId !== playerId || op.turn !== t.number) {
      return null;
    }
    // Copy-on-write down to the one stroke that changes: this runs on every
    // chunk of every line, so no structuredClone of the whole drawing.
    let { strokes, nextStrokeId, pointCount } = t;
    switch (op.op) {
      case "start": {
        const n = op.points.length / 2;
        if (op.id !== nextStrokeId || strokes.length >= MAX_STROKES || pointCount + n > MAX_POINTS) return null;
        strokes = [...strokes, { id: op.id, color: op.color, size: op.size, points: op.points }];
        nextStrokeId++;
        pointCount += n;
        break;
      }
      case "add": {
        const last = strokes.at(-1);
        const n = op.points.length / 2;
        if (!last || last.id !== op.id || pointCount + n > MAX_POINTS) return null;
        strokes = [...strokes.slice(0, -1), { ...last, points: last.points.concat(op.points) }];
        pointCount += n;
        break;
      }
      // Ink spent stays spent: undo and clear don't refill the point budget.
      case "undo":
        if (!strokes.length) return null;
        strokes = strokes.slice(0, -1);
        break;
      case "clear":
        if (!strokes.length) return null;
        strokes = [];
        break;
    }
    return { state: { ...state, turn: { ...t, strokes, nextStrokeId, pointCount } }, relay: op };
  },

  getStreamSnapshot(state): DrawingSnapshot {
    return { turn: state.turn.number, strokes: state.turn.strokes, nextId: state.turn.nextStrokeId };
  },

  getPublicState(state) {
    const t = state.turn;
    const finished = state.phase === "finished";
    const showWord = finished || t.phase === "reveal";
    return {
      round: state.round,
      rounds: state.settings.rounds,
      turn: t.number,
      drawerId: t.drawerId,
      phase: finished ? "finished" : t.phase,
      endsAt: t.endsAt,
      phaseMs: t.phaseMs,
      hint: t.phase === "drawing" && !finished
        ? [...t.word!].map((ch, i) => (!isLetter(ch) || t.revealed.includes(i) ? ch : null))
        : null,
      word: showWord ? t.word : null,
      endedBy: t.endedBy,
      players: state.players.map((p) => {
        const g = t.guessed.find((x) => x.playerId === p.id);
        const scored = t.phase !== "choosing";
        return {
          id: p.id,
          score: p.score,
          removed: p.removed,
          guessed: !!g,
          turnPoints: !scored ? null : p.id === t.drawerId ? t.drawerPoints : (g?.points ?? 0),
        };
      }),
      endReason: state.endReason,
    };
  },

  getPrivateState(state, playerId) {
    const t = state.turn;
    const playing = state.phase === "playing";
    const drawing = playing && t.phase === "drawing";
    const drawer = t.drawerId === playerId;
    const knows = drawer || t.guessed.some((g) => g.playerId === playerId);
    return {
      choices: playing && drawer && t.phase === "choosing" ? t.choices : null,
      word: knows ? t.word : null,
      canDraw: drawing && drawer,
      canChat: playing && !(drawing && drawer),
      chat: state.chat.filter((l) => l.to === null || l.to.includes(playerId)),
    };
  },

  // Nobody's ever "holding things up": the clock is. No nudges, no skips.
  getAwaitedPlayerIds() {
    return [];
  },

  getResult(state) {
    if (state.phase !== "finished") return null;
    const standing = [...state.players].sort((a, b) => Number(a.removed) - Number(b.removed) || b.score - a.score);
    const top = Math.max(...state.players.filter(inGame).map((p) => p.score));
    return {
      // Called off early, the scoreboard's just a scoreboard.
      winnerIds: state.endReason === "done" && top > 0 ? state.players.filter((p) => inGame(p) && p.score === top).map((p) => p.id) : [],
      standings: standing.map((p) => ({ playerId: p.id, value: p.score, label: `${p.score} ${p.score === 1 ? "point" : "points"}` })),
    };
  },
};
