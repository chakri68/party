import {
  allVoted,
  castVote,
  dropVoter,
  openBallot,
  strictMajority,
  type Ballot,
  type GameContext,
  type GameDefinition,
  type GameEventEnvelope,
  type GameResult,
  type TimerRequest,
} from "@games/game-core";
import { passTheBombManifest } from "../shared/manifest.ts";
import { displayCluster, modesOf, normalizeWord, ordinal, parseTyping, shapeProblem } from "../shared/rules.ts";
import { modesProblem } from "../shared/viable.ts";
import {
  BOOM_MS,
  CATEGORY_LABELS,
  DEFAULT_SETTINGS,
  FUSE_MS,
  FUSE_OPTIONS,
  LIVES_OPTIONS,
  MAX_HOLD_VOTES,
  MAX_WORD,
  MODE_KEYS,
  UNKNOWN_OPTIONS,
  VOTE_CHOICES,
  VOTE_MS,
  type VoteChoice,
  type PassTheBombAction,
  type PassTheBombEvent,
  type PassTheBombPlayerState,
  type PassTheBombPrivateState,
  type PassTheBombPublicState,
  type PassTheBombServerState,
  type PassTheBombSettings,
  type TypingData,
} from "../shared/types.ts";
import { isWord } from "@games/words/dictionary";
import { inCategory } from "./categories.ts";
import { dealPrompt, promptsFor } from "./prompts.ts";
import { CLUSTERS } from "./words.ts";

type State = PassTheBombServerState;
type Player = PassTheBombPlayerState;
type Events = GameEventEnvelope<PassTheBombEvent>[];

const pub = (event: PassTheBombEvent): GameEventEnvelope<PassTheBombEvent> => ({ visibility: { kind: "public" }, event });

const reject = (code: string, message: string): GameResult<State, PassTheBombEvent> => ({
  ok: false,
  error: { code, message },
});

/**
 * One timer, reused: while live it's the fuse, during the boom it's the next
 * round. Setting it again replaces it, so a pass never has to touch it.
 */
const FUSE = "fuse";
/** The room's 4 s on an unknown word. The fuse is cancelled while it runs, and set again after. */
const VOTE = "vote";
/** An alarm this early is a clock hiccup, not the deadline: re-arm it (Dominion's guard). */
const EARLY_MS = 500;

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

const alive = (p: Player) => !p.removed && p.lives > 0;
const seatOf = (state: State, id: string) => state.players.findIndex((p) => p.id === id);

/**
 * A game saved before the modes and the vote (1966614's shape) is missing
 * their fields, and rooms sit in Durable Object storage across a deploy. Fill
 * them in on the way in; a complete state comes back as is. That game never
 * stored when its fuse goes, so `fuseEndsAt` is 0, "unknown": its alarm is
 * still set, and it's the only clock until the next round lights a new one.
 */
function restore(s: State): State {
  const old = s as Partial<State>;
  const complete = old.rejected && old.voteSeq !== undefined && old.vote !== undefined && old.settings?.unknown && old.fuseEndsAt !== undefined;
  if (complete) return s;
  return {
    ...s,
    settings: { ...DEFAULT_SETTINGS, ...s.settings },
    category: old.category ?? null,
    rejected: old.rejected ?? [],
    fuseEndsAt: old.fuseEndsAt ?? 0,
    fuseLeft: old.fuseLeft ?? 0,
    holdVotes: old.holdVotes ?? 0,
    voteSeq: old.voteSeq ?? 0,
    vote: old.vote ?? null,
    lastVote: old.lastVote ?? null,
  };
}

/** A fresh prompt under the game's modes: not the one just played, and not one that's played out. */
function deal(state: State, ctx: GameContext): void {
  const pool = promptsFor(modesOf(state.settings), state.clusters);
  const p = dealPrompt(pool, state.used, { cluster: state.cluster, category: state.category }, ctx.randomInt);
  state.cluster = p.cluster;
  state.category = p.category;
}

/**
 * The next living seat after `from` (or `from` itself, with `self`),
 * preferring someone who's actually here: a bomb handed to a dropped
 * connection just burns down on them. If everyone else is away, so be it.
 */
function nextAlive(state: State, from: number, self = false): Player | null {
  const n = state.players.length;
  const order = Array.from({ length: self ? n : n - 1 }, (_, k) => state.players[(from + (self ? k : k + 1)) % n]!).filter(alive);
  return order.find((p) => !p.away) ?? order[0] ?? null;
}

function finish(state: State, out: Out): void {
  if (state.vote) out.timers.push({ kind: "cancel", timerId: VOTE });
  state.phase = "finished";
  state.typing = "";
  state.vote = null;
  out.timers.push({ kind: "cancel", timerId: FUSE });
  out.events.push(pub({ type: "game-over", winnerId: state.players.find(alive)?.id ?? null }));
}

/** Ends the game if it's down to one, and says whether it did. */
function settled(state: State, out: Out): boolean {
  if (state.players.filter(alive).length > 1) return false;
  finish(state, out);
  return true;
}

function giveBomb(state: State, to: Player, ctx: GameContext): void {
  state.holderId = to.id;
  state.turn++;
  deal(state, ctx);
  state.typing = "";
  state.holdVotes = 0;
  state.lastVote = null;
}

/** Lights (or relights) the fuse with `ms` left. */
function lightFuse(state: State, ms: number, ctx: GameContext, out: Out): void {
  state.fuseEndsAt = ctx.now + ms;
  out.timers.push({ kind: "set", timerId: FUSE, delayMs: ms });
}

/** A fresh fuse, lit in the hands of whoever it last went off on (or the next one along). */
function startRound(state: State, ctx: GameContext, out: Out): void {
  const from = state.blownId ? seatOf(state, state.blownId) : seatOf(state, state.holderId);
  const holder = nextAlive(state, Math.max(from, 0), true);
  if (!holder) return finish(state, out);
  const [lo, hi] = FUSE_MS[state.settings.fuse];
  const fuse = lo + ctx.randomInt(hi - lo + 1);
  state.phase = "live";
  state.round++;
  state.blownId = null;
  giveBomb(state, holder, ctx);
  lightFuse(state, fuse, ctx, out);
  out.events.push(pub({ type: "round-started", round: state.round, holderId: holder.id }));
}

/** Hands the bomb on without touching the fuse. Null if there's nobody to take it. */
function pass(state: State, ctx: GameContext): Player | null {
  const next = nextAlive(state, seatOf(state, state.holderId));
  if (next) giveBomb(state, next, ctx);
  return next;
}

/** A word that counts: it's played, and the bomb moves on, fuse untouched. */
function accept(state: State, playerId: string, word: string, ctx: GameContext, out: Out, voted = false): void {
  state.used.push(word);
  state.lastWord = { playerId, word };
  const to = pass(state, ctx);
  // Only one alive means the game ended already; pass always finds someone.
  out.events.push(pub({ type: "passed", from: playerId, to: to!.id, word, ...(voted && { voted: true as const }) }));
}

// ---------------------------------------------------------------------------
// The room vote (source §4.3)
// ---------------------------------------------------------------------------

/** Everyone's in, or the rest can't change it: a strict majority already rejects, or can't any more. */
function decided(b: Ballot<VoteChoice>): boolean {
  const rejects = b.eligible.filter((id) => b.votes[id] === "reject").length;
  const open = b.eligible.filter((id) => !(id in b.votes)).length;
  return allVoted(b) || rejects * 2 > b.eligible.length || (rejects + open) * 2 <= b.eligible.length;
}

/** Freezes the fuse and asks everyone alive and here, bar the one who played it. */
function openVote(state: State, by: string, word: string, eligible: string[], ctx: GameContext, out: Out): void {
  state.phase = "vote";
  state.voteSeq++;
  state.holdVotes++;
  // An unknown end (a restored game) freezes at the shortest fuse the setting allows.
  state.fuseLeft = state.fuseEndsAt ? Math.max(1, state.fuseEndsAt - ctx.now) : FUSE_MS[state.settings.fuse][0];
  state.vote = { id: state.voteSeq, by, word, ballot: openBallot<VoteChoice>(eligible), deadline: ctx.now + VOTE_MS };
  out.timers.push({ kind: "cancel", timerId: FUSE }, { kind: "set", timerId: VOTE, delayMs: VOTE_MS });
  out.events.push(pub({ type: "vote-opened", ballot: state.vote.id, by, word }));
}

/** Out only on a strict majority to reject; anything less lets it through. The fuse picks up where it stopped. */
function closeVote(state: State, ctx: GameContext, out: Out): void {
  const v = state.vote!;
  const allowed = !strictMajority(v.ballot, "reject");
  const closed = { id: v.id, by: v.by, word: v.word, allowed, votes: { ...v.ballot.votes } };
  state.vote = null;
  state.phase = "live";
  out.timers.push({ kind: "cancel", timerId: VOTE });
  lightFuse(state, state.fuseLeft, ctx, out);
  out.events.push(pub({ type: "vote-closed", ...closed }));
  if (allowed) accept(state, v.by, v.word, ctx, out, true);
  else state.rejected.push(rejectionKey(state.category, v.word));
  // After the pass, which clears the last one: it's news until the next.
  state.lastVote = closed;
}

/** A no is a no for that word under that category (or none): "arm" isn't an animal, but it's still a body part. */
const rejectionKey = (category: string | null, word: string) => (category ? `${category}:${word}` : word);

/** Someone on the ballot left or dropped: they stop counting, and that may settle it. */
function loseVoter(state: State, playerId: string, ctx: GameContext, out: Out): void {
  if (!state.vote?.ballot.eligible.includes(playerId)) return;
  dropVoter(state.vote.ballot, playerId);
  if (decided(state.vote.ballot)) closeVote(state, ctx, out);
}

function explode(state: State, out: Out): void {
  const holder = state.players[seatOf(state, state.holderId)]!;
  holder.lives--;
  if (!holder.lives) state.outOrder.push(holder.id);
  state.phase = "boom";
  state.blownId = holder.id;
  state.typing = "";
  out.events.push(pub({ type: "boom", playerId: holder.id, lives: holder.lives }));
  if (!settled(state, out)) out.timers.push({ kind: "set", timerId: FUSE, delayMs: BOOM_MS });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function parseSettings(input: unknown): PassTheBombSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const s = { ...DEFAULT_SETTINGS, ...(input as Partial<PassTheBombSettings>) };
  if (!LIVES_OPTIONS.includes(s.lives) || !FUSE_OPTIONS.includes(s.fuse) || !UNKNOWN_OPTIONS.includes(s.unknown)) return null;
  if (MODE_KEYS.some((k) => typeof s[k] !== "boolean")) return null;
  const modes = modesOf(s);
  // A combination with nothing to deal never reaches a game.
  if (modesProblem(modes)) return null;
  return { lives: s.lives, fuse: s.fuse, ...modes, unknown: s.unknown };
}

function parseAction(input: unknown): PassTheBombAction | null {
  if (typeof input !== "object" || input === null) return null;
  const a = input as Record<string, unknown>;
  if (a.type === "word" && typeof a.text === "string" && a.text.length <= MAX_WORD * 2) {
    const text = normalizeWord(a.text);
    return text ? { type: "word", text } : null;
  }
  if (a.type === "vote" && Number.isInteger(a.ballot) && VOTE_CHOICES.includes(a.choice as VoteChoice)) {
    return { type: "vote", ballot: a.ballot as number, choice: a.choice as VoteChoice };
  }
  return null;
}

/** Injected cluster lists (tests, dev tools): short lowercase letter runs. */
function normalizeClusters(input: unknown[]): string[] {
  const ok = input.every((c) => typeof c === "string" && /^[a-z]{1,4}$/.test(c));
  if (!input.length || !ok) throw new Error("A cluster list must be short lowercase letter runs, e.g. [\"ing\", \"tr\"].");
  return [...new Set(input as string[])];
}

function vote(prev: State, playerId: string, ballot: number, choice: VoteChoice, ctx: GameContext): GameResult<State, PassTheBombEvent> {
  if (prev.phase !== "vote" || !prev.vote || prev.vote.id !== ballot) return reject("no-vote", "That vote's over.");
  if (ctx.now >= prev.vote.deadline) return reject("time-up", "Too late, it's counted.");
  const state = clone(prev);
  const out = newOut();
  const error = castVote(state.vote!.ballot, playerId, choice, VOTE_CHOICES);
  if (error) return { ok: false, error };
  if (decided(state.vote!.ballot)) closeVote(state, ctx, out);
  return { ok: true, transition: done(state, out) };
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const passTheBombGame: GameDefinition<
  PassTheBombServerState,
  PassTheBombAction,
  PassTheBombPublicState,
  PassTheBombPrivateState,
  PassTheBombSettings,
  PassTheBombEvent
> = {
  manifest: passTheBombManifest,
  defaultSettings: DEFAULT_SETTINGS,
  parseSettings,
  parseAction,

  createGame(players, settings, match, ctx, options) {
    const n = players.length;
    const { minPlayers, maxPlayers } = passTheBombManifest;
    if (n < minPlayers || n > maxPlayers) {
      throw new Error(`pass-the-bomb: needs ${minPlayers}–${maxPlayers} players, got ${n}`);
    }
    const dealer = ((match.dealerSeat % n) + n) % n;
    const state: State = {
      phase: "live",
      settings,
      players: players.map((p) => ({ id: p.id, lives: settings.lives, removed: false, away: false })),
      round: 0,
      turn: 0,
      // The dealer's left lights the first one.
      holderId: players[(dealer + 1) % n]!.id,
      cluster: "",
      category: null,
      blownId: null,
      lastWord: null,
      used: [],
      rejected: [],
      fuseEndsAt: 0,
      fuseLeft: 0,
      holdVotes: 0,
      voteSeq: 0,
      vote: null,
      lastVote: null,
      outOrder: [],
      clusters: options?.deck ? normalizeClusters(options.deck) : [...CLUSTERS],
      typing: "",
    };
    const out = newOut();
    startRound(state, ctx, out);
    return done(state, out);
  },

  handleAction(saved, playerId, action, ctx) {
    const prev = restore(saved);
    if (prev.phase === "finished") return reject("game-finished", "The game is over.");
    const me = prev.players.find((p) => p.id === playerId);
    if (!me || !alive(me)) return reject("not-in-game", "You're out. Heckle freely.");
    if (action.type === "vote") return vote(prev, playerId, action.ballot, action.choice, ctx);
    if (prev.phase === "vote") return reject("voting", "Hang on, the room's deciding.");
    if (prev.phase !== "live") return reject("not-live", "Hang on, the next round's coming.");
    if (prev.holderId !== playerId) return reject("not-holding", "You're not holding the bomb.");
    // The fuse is out; the alarm just hasn't landed yet (source §4.4: late loses).
    if (prev.fuseEndsAt && ctx.now >= prev.fuseEndsAt) return reject("time-up", "Too late.");

    const word = action.text;
    const problem = shapeProblem(word, prev.cluster, modesOf(prev.settings));
    if (problem) return reject("bad-word", problem);
    if (prev.used.includes(word)) return reject("used", "Already played this game.");

    const state = clone(prev);
    const out = newOut();
    const known = state.category ? inCategory(state.category, word) : isWord(word);
    if (!known) {
      // Only an unknown word can have been voted down, and only for the category it was up for.
      if (state.rejected.includes(rejectionKey(state.category, word))) return reject("not-a-word", "The room already said no to that one.");
      const unknown = state.category ? `Not on the ${CATEGORY_LABELS[state.category].toLowerCase()} list.` : "Not in the dictionary.";
      const mode = state.settings.unknown;
      if (mode === "strict") return reject("not-a-word", unknown);
      if (mode === "vote") {
        if (state.holdVotes >= MAX_HOLD_VOTES) return reject("not-a-word", `${unknown} No more votes this turn.`);
        const eligible = state.players.filter((p) => alive(p) && !p.away && p.id !== playerId).map((p) => p.id);
        // Nobody to ask (two of you, one away): it goes through.
        if (eligible.length) {
          openVote(state, playerId, word, eligible, ctx, out);
          return { ok: true, transition: done(state, out) };
        }
      }
    }
    accept(state, playerId, word, ctx, out);
    return { ok: true, transition: done(state, out) };
  },

  onTimer(saved, timerId, ctx) {
    const prev = restore(saved);
    if (prev.phase === "finished") return { state: prev, events: [] };
    if (timerId === VOTE) {
      if (prev.phase !== "vote" || !prev.vote) return { state: prev, events: [] };
      const early = prev.vote.deadline - ctx.now;
      if (early > EARLY_MS) return { state: prev, events: [], timers: [{ kind: "set", timerId: VOTE, delayMs: early }] };
      const state = clone(prev);
      const out = newOut();
      closeVote(state, ctx, out);
      return done(state, out);
    }
    // A fuse alarm that slipped past the cancel while the room votes: the fuse is frozen.
    if (timerId !== FUSE || prev.phase === "vote") return { state: prev, events: [] };
    const early = prev.fuseEndsAt - ctx.now;
    if (prev.phase === "live" && early > EARLY_MS) return { state: prev, events: [], timers: [{ kind: "set", timerId: FUSE, delayMs: early }] };
    const state = clone(prev);
    const out = newOut();
    if (state.phase === "live") explode(state, out);
    else startRound(state, ctx, out);
    return done(state, out);
  },

  onPlayerDisconnected(saved, playerId, ctx) {
    const prev = restore(saved);
    const idx = seatOf(prev, playerId);
    if (prev.phase === "finished" || idx < 0) return { state: prev, events: [] };
    // Holding it doesn't get you out of it: the fuse keeps burning, and the
    // host can skip a dropped holder straight away (§12.2). Voting, though,
    // is for who's here.
    const state = clone(prev);
    const out = newOut();
    state.players[idx]!.away = true;
    loseVoter(state, playerId, ctx, out);
    return done(state, out);
  },

  onPlayerReconnected(prev, playerId) {
    const idx = seatOf(prev, playerId);
    if (idx < 0 || !prev.players[idx]!.away) return { state: prev, events: [] };
    const state = clone(prev);
    state.players[idx]!.away = false;
    return { state, events: [] };
  },

  onPlayerRemoved(saved, playerId, ctx) {
    const prev = restore(saved);
    const idx = seatOf(prev, playerId);
    if (prev.phase === "finished" || idx < 0 || prev.players[idx]!.removed) return { state: prev, events: [] };
    const state = clone(prev);
    const out = newOut();
    state.players[idx]!.removed = true;
    if (settled(state, out)) return done(state, out);
    if (state.vote?.by === playerId) {
      // Their word goes with them; the fuse picks up again, in the next hands.
      out.timers.push({ kind: "cancel", timerId: VOTE });
      out.events.push(pub({ type: "vote-called-off", ballot: state.vote.id }));
      state.vote = null;
      state.phase = "live";
      lightFuse(state, state.fuseLeft, ctx, out);
    } else {
      loseVoter(state, playerId, ctx, out);
    }
    // Walking out with it lit passes it on, fuse and all.
    const to = state.phase === "live" && state.holderId === playerId ? pass(state, ctx) : null;
    out.events.push(pub({ type: "left", playerId, to: to?.id ?? null }));
    return done(state, out);
  },

  skipTurn(prev, playerId, ctx) {
    if (prev.phase !== "live" || prev.holderId !== playerId) return { state: prev, events: [] };
    const state = clone(prev);
    const to = pass(state, ctx)!;
    return { state, events: [pub({ type: "skipped", from: playerId, to: to.id })] };
  },

  onStream(state, playerId, data) {
    const typing = parseTyping(data);
    if (!typing || state.phase !== "live" || state.holderId !== playerId || typing.turn !== state.turn) return null;
    return { state: { ...state, typing: typing.text }, relay: typing };
  },

  getStreamSnapshot(state): TypingData {
    return { turn: state.turn, text: state.typing };
  },

  getPublicState(saved) {
    const state = restore(saved);
    return {
      phase: state.phase,
      round: state.round,
      turn: state.turn,
      holderId: state.holderId,
      cluster: displayCluster(state.cluster, modesOf(state.settings)),
      modes: modesOf(state.settings),
      category: state.category,
      unknown: state.settings.unknown,
      // Who's voted, never how, until it closes.
      vote: state.vote && {
        id: state.vote.id,
        by: state.vote.by,
        word: state.vote.word,
        voters: state.vote.ballot.eligible,
        voted: state.vote.ballot.eligible.filter((id) => id in state.vote!.ballot.votes),
        deadline: state.vote.deadline,
        ms: VOTE_MS,
      },
      lastVote: state.lastVote,
      blownId: state.blownId,
      lastWord: state.lastWord,
      usedCount: state.used.length,
      maxLives: state.settings.lives,
      players: state.players.map((p) => ({ id: p.id, lives: p.lives, removed: p.removed })),
      outOrder: state.outOrder,
    };
  },

  getPrivateState(state, playerId) {
    const ballot = state.phase === "vote" ? state.vote?.ballot : undefined;
    return {
      holding: state.phase === "live" && state.holderId === playerId,
      canVote: !!ballot?.eligible.includes(playerId),
      myVote: ballot?.votes[playerId] ?? null,
    };
  },

  // The holder's who everyone's waiting on. Mostly the fuse sorts them out;
  // a dropped one can be skipped by the host. A vote waits on its own timer.
  getAwaitedPlayerIds(state) {
    return state.phase === "live" ? [state.holderId] : [];
  },

  getResult(state) {
    if (state.phase !== "finished") return null;
    const winner = state.players.find(alive);
    // Last one standing, then the rest by how long they lasted, then leavers.
    const rank = (p: Player) => {
      const out = state.outOrder.indexOf(p.id);
      return alive(p) ? -1 : out >= 0 ? state.outOrder.length - out : 1000;
    };
    return {
      winnerIds: winner ? [winner.id] : [],
      standings: [...state.players]
        .sort((a, b) => rank(a) - rank(b))
        .map((p) => {
          const out = state.outOrder.indexOf(p.id);
          const label = alive(p)
            ? `${p.lives} ${p.lives === 1 ? "life" : "lives"} left`
            : out < 0
              ? "left"
              : out === 0
                ? "first out"
                : `out ${ordinal(out + 1)}`;
          return { playerId: p.id, value: p.lives, label };
        }),
    };
  },
};
