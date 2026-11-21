// The room runtime (§4, §10–12, §20, §23). Transport- and storage-agnostic so it
// can be tested with fakes; `index.ts` adapts it to PartyServer.

import {
  BOT_MAX_RUN,
  buildRecap,
  emptyPartyLog,
  PARTY_LOG_MAX,
  seededRandomInt,
  stableHash,
  type AnyGameDefinition,
  type CreateGameOptions,
  type GameContext,
  type GameEventEnvelope,
  type GameOutcome,
  type GameTransition,
  type PartyLog,
  type PartyStats,
} from "@games/game-core";
import {
  CHAT_KEEP,
  cleanChatText,
  FATAL_ERRORS,
  GRACE_MS,
  normalizeName,
  NUDGE_AFTER_MS,
  NUDGE_COOLDOWN_MS,
  parseClientMessage,
  PROTOCOL_VERSION,
  safeEqual,
  type ChatMessage,
  type ClientMessage,
  type ErrorCode,
  type Presence,
  type RoomPhase,
  type RoomPublicState,
  type RoomTier,
  type ServerMessage,
  SKIP_AFTER_MS,
} from "@games/protocol";

// ---------------------------------------------------------------------------
// Host interfaces
// ---------------------------------------------------------------------------

/** Per-socket state; lives on the connection so it survives hibernation. */
export interface ConnState {
  hello: boolean;
  playerId: string | null;
}

export interface Conn {
  readonly id: string;
  readonly state: ConnState | null;
  setState(state: ConnState): void;
  send(msg: ServerMessage): void;
  close(code: number, reason: string): void;
}

export interface RoomStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(at: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

/** What a free room can't do. A host without these has no paywall. */
export interface TierLimits {
  premiumGameIds: string[];
  freeMaxPlayers: number;
}

export interface RoomGrant {
  tier: RoomTier;
  /** Per-room secret that seats its holder as owner, like the global owner key. */
  hostKey: string | null;
}

/** What a room starts as, from a link: a game, with some computers already seated. */
export interface RoomSetup {
  gameId: string;
  computers?: number;
}

export interface RoomHost {
  storage: RoomStorage;
  connections(): Iterable<Conn>;
  now(): number;
  randomInt(maxExclusive: number): number;
  /** ≥128 bits, URL-safe. */
  randomToken(): string;
  /** §41 debug messages. Only ever true under `wrangler dev`. */
  devTools: boolean;
  /** Where unexpected errors go. Never to clients. */
  logError(err: unknown): void;
  /** Does this key match the owner's? Constant-time, please. */
  isOwnerKey(key: string): boolean;
  /** Games only start with an owner seated (on in prod; tests may turn it off). */
  ownerRequired: boolean;
  /** Absent = nothing locked, no cap. */
  tierLimits?: TierLimits;
  /** Optional text filter (e.g. profanity) for names and chat. Absent = identity. */
  filterText?: (text: string) => string;
}

// ---------------------------------------------------------------------------
// Persisted data
// ---------------------------------------------------------------------------

interface SeatData {
  id: string;
  name: string;
  avatarSeed: string;
  resumeToken: string;
  ready: boolean;
  presence: Presence;
  joinedAt: number;
  owner: boolean;
  suggestion?: string;
  /** A computer player: always connected and ready, no resume token, never host. */
  bot?: true;
}

interface RoomData {
  code: string;
  createdAt: number;
  phase: RoomPhase;
  stateVersion: number;
  hostId: string | null;
  seats: SeatData[];
  gameId: string;
  settings: unknown;
  /** `carry` is tagged with its game, so picking another one can't inherit it. */
  match: { roundNumber: number; nextDealerSeat: number; carry?: { gameId: string; data: unknown } };
  game: { gameId: string; state: unknown } | null;
  awaiting: string[];
  awaitingSince: number | null;
  /** Room-wide nudge rate limit (§12.2). */
  lastNudgeAt: number;
  /** Timer table (§4): key → due time. The one DO alarm tracks the earliest. */
  timers: Record<string, number>;
  /** Optional: rooms stored before chat existed don't have it. */
  chat?: { nextId: number; messages: ChatMessage[] };
  /** Optional: rooms stored before tiers existed are "pass" with no host key. */
  tier?: RoomTier;
  hostKey?: string | null;
  /** The night so far, for the recap. Optional: rooms stored before it existed start one on their next game. */
  party?: PartyLog;
  /**
   * The seat that made the latest bot moves, how many in a row, and whether it
   * has been skipped once already. A person's move or another seat's clears it.
   */
  botRun?: { seatId: string; moves: number; skipped: boolean };
}

const STORAGE_KEY = "room";
const CLEANUP_TIMER = "cleanup";
const GAME_TIMER_PREFIX = "game:";
const GRACE_TIMER_PREFIX = "grace:";
/** A computer player's next move. The game never sees these. */
const BOT_TIMER_PREFIX = "bot:";
// Computer players pause long enough that a person can follow each move.
/** A bot's think time before a normal move: this much, plus up to `SPAN` more. */
const BOT_THINK_MS = 1600;
const BOT_THINK_SPAN_MS = 1001;
/** Think time shrinks by 4 / bots once more than 4 bots are in the game, but never below this. */
const BOT_THINK_TABLE = 4;
const BOT_THINK_FLOOR_MS = 1000;
/** A bot that moved last and has a forced next step waits this much, plus up to `SPAN` more. */
const BOT_FOLLOW_MS = 900;
const BOT_FOLLOW_SPAN_MS = 401;
const BOT_STUCK_MESSAGE = "A computer player got stuck, so the game ended.";
export const CLEANUP_AFTER_MS = 6 * 60 * 60 * 1000;

/** Flood guards: this many per window, per seat. Emotes are meant to be mashed. */
const CHAT_LIMIT = { burst: 5, windowMs: 5_000 };
const EMOTE_LIMIT = { burst: 10, windowMs: 3_000 };
/** Room for 25 Hz input plus edge sends. Scribbl flushes at 25 Hz too. */
const STREAM_LIMIT = { burst: 40, windowMs: 1_000 };

/** Computer players' names, taken in order, skipping any a seat already uses. */
const BOT_NAMES = ["Asha", "Ravi", "Meera", "Arjun", "Priya", "Kiran", "Neha", "Vikram", "Divya", "Rahul", "Anjali", "Sanjay"];

const CLOSE_NORMAL = 1000;
const CLOSE_POLICY = 4000;

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export class RoomRuntime {
  private data: RoomData | null = null;
  /** Serialises handlers: every await point is otherwise a chance to interleave. */
  private queue: Promise<unknown> = Promise.resolve();
  /** "kind:seat" → recent send times. In memory: an eviction forgiving a spammer is fine. */
  private sendTimes = new Map<string, number[]>();
  /** Why a game just ended early; the next commit sends it to every seat after its update. */
  private gameEndedNotice: string | null = null;

  private readonly code: string;
  private readonly host: RoomHost;
  private readonly games: Record<string, AnyGameDefinition>;
  private readonly defaultGameId: string;

  constructor(code: string, host: RoomHost, games: Record<string, AnyGameDefinition>, defaultGameId: string) {
    this.code = code;
    this.host = host;
    this.games = games;
    this.defaultGameId = defaultGameId;
  }

  private run<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  /**
   * A handler that throws may have half-mutated `data`. Storage only ever holds
   * fully committed transitions, so reloading from it is a free rollback.
   */
  private async recover(err: unknown): Promise<void> {
    this.host.logError(err);
    this.gameEndedNotice = null;
    this.data = (await this.host.storage.get<RoomData>(STORAGE_KEY)) ?? null;
  }

  // ---- lifecycle ----------------------------------------------------------

  load(): Promise<void> {
    return this.run(async () => {
      this.data = (await this.host.storage.get<RoomData>(STORAGE_KEY)) ?? null;
      if (!this.data) return;
      // After an eviction, sockets may be gone while storage still says "connected".
      const live = new Set(this.liveConns().map((c) => c.state?.playerId));
      let changed = false;
      for (const seat of this.data.seats) {
        if (!seat.bot && seat.presence === "connected" && !live.has(seat.id)) {
          seat.presence = "reconnecting";
          this.setTimer(GRACE_TIMER_PREFIX + seat.id, this.host.now() + GRACE_MS);
          changed = true;
        }
      }
      if (changed) await this.commit([]);
    });
  }

  /** Claims this room code. False if it's already taken (§10). */
  claim(grant: RoomGrant = { tier: "pass", hostKey: null }, setup?: RoomSetup): Promise<boolean> {
    return this.run(async () => {
      if (this.data) return false;
      const def = this.games[this.defaultGameId]!;
      this.data = {
        code: this.code,
        createdAt: this.host.now(),
        phase: "lobby",
        stateVersion: 0,
        hostId: null,
        seats: [],
        gameId: def.manifest.id,
        settings: def.defaultSettings,
        match: { roundNumber: 0, nextDealerSeat: 0 },
        game: null,
        awaiting: [],
        awaitingSince: null,
        lastNudgeAt: 0,
        timers: {},
        tier: grant.tier,
        hostKey: grant.hostKey,
      };
      if (setup) this.applySetup(setup);
      // Covers the room nobody ever joins.
      this.setTimer(CLEANUP_TIMER, this.host.now() + CLEANUP_AFTER_MS);
      await this.persist();
      return true;
    });
  }

  /**
   * Start the new room on the asked game with computers seated. A bad setup
   * (unknown game, no computers in it, locked for this tier) is ignored: the
   * room stays the normal empty one. Needs `this.data`, for the tier rules.
   */
  private applySetup(setup: RoomSetup): void {
    const data = this.data!;
    const def = this.games[setup.gameId];
    if (!def?.bot || this.lockedGameIds().includes(setup.gameId)) return;
    const m = def.manifest;
    const most = this.maxSeats(def) - 1;
    if (most < 1) return;
    const asked = Number.isInteger(setup.computers) ? setup.computers! : Math.max(1, (m.bestMinPlayers ?? m.minPlayers) - 1);
    data.gameId = m.id;
    data.settings = def.defaultSettings;
    for (let i = Math.min(Math.max(asked, 1), most); i > 0; i--) data.seats.push(this.seatBot());
  }

  /** A new computer seat, named from the list. The caller adds it to the room. */
  private seatBot(): SeatData {
    const data = this.data!;
    const taken = new Set(data.seats.map((s) => s.name.toLowerCase()));
    const name = BOT_NAMES.find((n) => !taken.has(n.toLowerCase())) ?? `Computer ${data.seats.length + 1}`;
    return {
      id: "bot-" + this.host.randomToken().slice(0, 8),
      name,
      avatarSeed: "bot-" + name,
      resumeToken: "",
      ready: true,
      presence: "connected",
      joinedAt: this.host.now(),
      owner: false,
      bot: true,
    };
  }

  /** free → pass, in place. Never the other way: a lapsed pass can't close an open room. */
  upgrade(): Promise<void> {
    return this.run(async () => {
      if (!this.data || this.tier() === "pass") return;
      this.data.tier = "pass";
      await this.commit([]);
    });
  }

  /** Constant-time. False when the room has no host key. */
  hostKeyMatches(key: string): boolean {
    const hk = this.data?.hostKey;
    return !!hk && safeEqual(key, hk);
  }

  onConnect(conn: Conn): Promise<void> {
    return this.run(async () => {
      conn.setState({ hello: false, playerId: null });
      if (!this.data) return this.fatal(conn, "room-not-found", "That room doesn't exist.");
      if (CLEANUP_TIMER in this.data.timers) {
        this.clearTimer(CLEANUP_TIMER);
        await this.persist();
      }
    });
  }

  onMessage(conn: Conn, raw: string): Promise<void> {
    return this.run(async () => {
      const msg = parseClientMessage(raw);
      if (!msg) return this.error(conn, "bad-message", "That message is not valid.");
      if (msg.type === "ping") {
        return conn.send({ type: "pong", timestamp: msg.timestamp, serverTime: this.host.now() });
      }
      if (!this.data) return this.fatal(conn, "room-not-found", "That room doesn't exist.");
      if (msg.type === "hello") return this.onHello(conn, msg.protocolVersion);
      if (!conn.state?.hello) return this.fatal(conn, "protocol-mismatch", "Please refresh the page.");

      try {
        if (msg.type === "join") return await this.onJoin(conn, msg);
        const seat = this.seatOf(conn);
        if (!seat) return this.error(conn, "not-joined", "Join the room first.");
        await this.onSeatedMessage(conn, seat, msg);
      } catch (err) {
        await this.recover(err);
        this.error(conn, "server-error", "Something went wrong. Please try again.");
      }
    });
  }

  onClose(conn: Conn): Promise<void> {
    return this.run(async () => {
      try {
        await this.handleClose(conn);
      } catch (err) {
        await this.recover(err);
      }
    });
  }

  private async handleClose(conn: Conn): Promise<void> {
    if (!this.data) return;
    const playerId = conn.state?.playerId;
    const others = this.liveConns().filter((c) => c.id !== conn.id);
    const seat = this.data.seats.find((s) => s.id === playerId);

    // A replaced tab closing mustn't mark the player as gone.
    if (seat && seat.presence === "connected" && !others.some((c) => c.state?.playerId === seat.id)) {
      seat.presence = "reconnecting";
      this.setTimer(GRACE_TIMER_PREFIX + seat.id, this.host.now() + GRACE_MS);
      const events = this.applyGameHook((def, st) => def.onPlayerDisconnected?.(st, seat.id, this.ctx()));
      await this.commit(events, others);
    }
    if (!others.some((c) => c.state?.playerId)) {
      this.setTimer(CLEANUP_TIMER, this.host.now() + CLEANUP_AFTER_MS);
      await this.persist();
    }
  }

  onAlarm(): Promise<void> {
    return this.run(async () => {
      try {
        await this.handleAlarm();
      } catch (err) {
        await this.recover(err);
        throw err; // Durable Objects retry failed alarms with backoff.
      }
    });
  }

  private async handleAlarm(): Promise<void> {
    if (!this.data) return;
    const now = this.host.now();
    const due = Object.entries(this.data.timers)
      .filter(([, at]) => at <= now)
      .sort((a, b) => a[1] - b[1]);
    const events: GameEventEnvelope<unknown>[] = [];
    // A bot timer that found nothing to do changes nothing: no update for it.
    let changed = false;
    for (const [key, at] of due) {
      if (!this.data) return;
      // An earlier timer in this alarm (a bot's move, say) may have cleared or re-set this one.
      if (this.data.timers[key] !== at) continue;
      delete this.data.timers[key];
      if (key === CLEANUP_TIMER) {
        // Nobody's been here for hours: forget the room and free its code.
        this.data = null;
        await this.host.storage.deleteAll();
        return;
      }
      if (key.startsWith(GRACE_TIMER_PREFIX)) {
        changed = true;
        this.onGraceExpired(key.slice(GRACE_TIMER_PREFIX.length));
      }
      if (key.startsWith(GAME_TIMER_PREFIX)) {
        changed = true;
        const timerId = key.slice(GAME_TIMER_PREFIX.length);
        events.push(...this.applyGameHook((def, st) => def.onTimer?.(st, timerId, this.ctx()), true));
      }
      if (key.startsWith(BOT_TIMER_PREFIX)) {
        const out = this.onBotTimer(key.slice(BOT_TIMER_PREFIX.length));
        if (out) {
          changed = true;
          events.push(...out);
        }
      }
    }
    // Still persist: the fired timers are gone, and the alarm moves to the next one.
    if (changed) await this.commit(events);
    else await this.persist();
  }

  // ---- messages -----------------------------------------------------------

  private onHello(conn: Conn, version: number): void {
    if (version !== PROTOCOL_VERSION) {
      return this.fatal(conn, "protocol-mismatch", "A new version is out. Please refresh the page.");
    }
    conn.setState({ hello: true, playerId: conn.state?.playerId ?? null });
  }

  private filterText(text: string): string {
    return this.host.filterText ? this.host.filterText(text) : text;
  }

  private async onJoin(conn: Conn, msg: Extract<ClientMessage, { type: "join" }>): Promise<void> {
    const data = this.data!;
    const name = this.filterText(normalizeName(msg.name));
    if (!name) return this.error(conn, "invalid-name", "Enter your name first.");

    let seat = msg.resumeToken
      ? data.seats.find((s) => s.presence !== "left" && s.resumeToken === msg.resumeToken)
      : undefined;
    let events: GameEventEnvelope<unknown>[] = [];
    // Re-checked on every join, so the flag can't outlive the key it came from.
    const owner = !!msg.ownerKey && (this.host.isOwnerKey(msg.ownerKey) || this.hostKeyMatches(msg.ownerKey));

    if (seat) {
      // Newest connection wins (§11). The old one is told not to come back.
      for (const other of this.liveConns()) {
        if (other.id !== conn.id && other.state?.playerId === seat.id) {
          other.setState({ hello: true, playerId: null });
          this.fatal(other, "replaced-by-new-connection", "This room is open in another tab.");
        }
      }
      const wasAway = seat.presence !== "connected";
      seat.name = name;
      seat.avatarSeed = msg.avatarSeed;
      seat.presence = "connected";
      seat.owner = owner;
      this.clearTimer(GRACE_TIMER_PREFIX + seat.id);
      if (wasAway) events = this.applyGameHook((def, st) => def.onPlayerReconnected?.(st, seat!.id, this.ctx()));
      // A room whose host timed out while nobody else was around gets one now.
      this.ensureHost();
    } else {
      const def = this.games[data.gameId]!;
      const late = data.phase === "playing";
      if (late && !def.manifest.lateJoin) {
        return this.fatal(conn, "game-in-progress", "A game is already going on. Try again after this round.");
      }
      // An ended party is only a recap to look at: nobody's dealt in, so no cap.
      if (data.phase !== "ended" && this.activeSeats().length >= this.maxSeats(def)) {
        // A person always gets in: the newest computer gives up its seat. Not mid-game.
        const bot = late ? undefined : this.newestBot();
        if (!bot) return this.fatal(conn, "room-full", "This room is full.");
        data.seats = data.seats.filter((s) => s !== bot);
      }
      seat = {
        id: this.host.randomToken().slice(0, 12),
        name,
        avatarSeed: msg.avatarSeed,
        resumeToken: this.host.randomToken(),
        ready: false,
        presence: "connected",
        joinedAt: this.host.now(),
        owner,
      };
      data.seats.push(seat);
      data.hostId ??= seat.id;
      if (late) events = this.applyGameHook((def, st) => def.onPlayerJoined?.(st, seat!.id, this.ctx()));
    }

    conn.setState({ hello: true, playerId: seat.id });
    conn.send({ type: "welcome", playerId: seat.id, resumeToken: seat.resumeToken });
    await this.commit(events, undefined, conn.id);
    conn.send({ type: "chat", messages: data.chat?.messages ?? [], replace: true });
  }

  private async onSeatedMessage(conn: Conn, seat: SeatData, msg: ClientMessage): Promise<void> {
    const data = this.data!;
    const isHost = data.hostId === seat.id;
    const hostOnly = (): boolean => {
      if (!isHost) this.error(conn, "not-host", "Only the host can do that.");
      return isHost;
    };
    const inPhase = (...phases: RoomPhase[]): boolean => {
      const ok = phases.includes(data.phase);
      if (!ok) this.error(conn, "wrong-phase", "You can't do that right now.");
      return ok;
    };

    switch (msg.type) {
      case "ready":
        if (!inPhase("lobby", "results")) return;
        seat.ready = msg.ready;
        return this.commit([]);

      case "select-game": {
        if (!hostOnly() || !inPhase("lobby", "results")) return;
        const def = this.games[msg.gameId];
        if (!def) return this.error(conn, "unknown-game", "That game does not exist.");
        if (this.lockedGameIds().includes(msg.gameId)) return this.needsPass(conn);
        if (!this.botsAllowed(def)) return this.botsBlock(conn);
        data.gameId = msg.gameId;
        data.settings = def.defaultSettings;
        return this.commit([]);
      }

      case "suggest-game": {
        if (!inPhase("lobby", "results")) return;
        if (msg.gameId !== null && !this.games[msg.gameId]) return this.error(conn, "unknown-game", "That game does not exist.");
        if ((seat.suggestion ?? null) === msg.gameId) return;
        if (!this.allow("suggest", seat.id, EMOTE_LIMIT)) return this.error(conn, "rate-limited", "You are sending too fast. Wait a second.");
        if (msg.gameId === null) delete seat.suggestion;
        else seat.suggestion = msg.gameId;
        return this.commit([]);
      }

      case "update-settings": {
        if (!hostOnly() || !inPhase("lobby", "results")) return;
        // A patch, merged over what's stored: two changes sent before the first
        // update lands would otherwise each carry the other's stale value.
        const patch = msg.settings;
        const ok = typeof patch === "object" && patch !== null && !Array.isArray(patch);
        const settings = ok ? this.games[data.gameId]!.parseSettings({ ...(data.settings as object), ...patch }) : null;
        if (settings === null) return this.error(conn, "invalid-settings", "Those settings aren't valid.");
        data.settings = settings;
        return this.commit([]);
      }

      case "start-game":
        if (!hostOnly() || !inPhase("lobby", "results")) return;
        return this.startGame(conn);

      case "game-action": {
        if (data.phase !== "playing" || !data.game) {
          return conn.send({
            type: "action-rejected",
            clientActionId: msg.clientActionId,
            code: "wrong-phase",
            message: "No game is running.",
          });
        }
        const def = this.games[data.game.gameId]!;
        const action = def.parseAction(msg.action);
        const result = action === null
          ? { ok: false as const, error: { code: "bad-action", message: "That action isn't valid." } }
          : def.handleAction(data.game.state, seat.id, action, this.ctx());
        if (!result.ok) {
          return conn.send({ type: "action-rejected", clientActionId: msg.clientActionId, ...result.error });
        }
        const events = this.applyTransition(result.transition, true);
        // A person moved: any bot's run of moves in a row is broken.
        delete data.botRun;
        return this.commit(events);
      }

      case "stream": {
        // Best-effort (§35): anything out of place is dropped without a word.
        if (data.phase !== "playing" || !data.game) return;
        if (!this.allow("stream", seat.id, STREAM_LIMIT)) return;
        const out = this.games[data.game.gameId]!.onStream?.(data.game.state, seat.id, msg.data, this.ctx());
        if (!out) return;
        data.game.state = out.state;
        // Not a transition: no version bump, no update. Persisted all the same,
        // so a snapshot after an eviction still has the drawing, unless the
        // game would rather the relay didn't wait on the write.
        if (out.persist !== false) await this.persist();
        for (const c of this.liveConns()) {
          const pid = c.state?.playerId;
          if (!pid) continue;
          if (out.relay !== undefined && pid !== seat.id) c.send({ type: "stream", from: seat.id, data: out.relay });
          for (const r of out.relays ?? []) {
            if (r.to.includes(pid)) c.send({ type: "stream", from: seat.id, data: r.data });
          }
        }
        return;
      }

      case "chat": {
        const text = this.filterText(cleanChatText(msg.text));
        if (!text) return;
        // Otherwise the room's chat is a way to hand out the game's answers.
        if (data.phase === "playing" && data.game && this.games[data.game.gameId]!.manifest.ownChat) {
          return this.error(conn, "wrong-phase", "This game has its own chat.");
        }
        if (!this.allow("chat", seat.id, CHAT_LIMIT)) return this.error(conn, "rate-limited", "You are sending too fast. Wait a second.");
        const now = this.host.now();
        const chat = (data.chat ??= { nextId: 0, messages: [] });
        const line: ChatMessage = {
          id: chat.nextId++,
          from: seat.id,
          name: seat.name,
          avatarSeed: seat.avatarSeed,
          text,
          at: now,
          reactions: {},
        };
        chat.messages.push(line);
        if (chat.messages.length > CHAT_KEEP) chat.messages.splice(0, chat.messages.length - CHAT_KEEP);
        await this.persist();
        return this.broadcastChat([line]);
      }

      case "emote": {
        // Over the limit just drops: a toast per extra tap would be worse than the spam.
        if (!this.allow("emote", seat.id, EMOTE_LIMIT)) return;
        for (const c of this.liveConns()) {
          if (c.state?.playerId) c.send({ type: "emote", from: seat.id, emoji: msg.emoji });
        }
        return;
      }

      case "react": {
        const line = data.chat?.messages.find((m) => m.id === msg.messageId);
        if (!line) return; // scrolled off the top, most likely: nothing to say
        const who = line.reactions[msg.emoji] ?? [];
        const next = who.includes(seat.id) ? who.filter((id) => id !== seat.id) : [...who, seat.id];
        if (next.length) line.reactions[msg.emoji] = next;
        else delete line.reactions[msg.emoji];
        await this.persist();
        return this.broadcastChat([line]);
      }

      case "return-to-lobby":
        // Mid-game too: the host can bail on a game that's dragging.
        if (!hostOnly() || !inPhase("playing", "results")) return;
        this.endGameToLobby(null);
        return this.commit([]);

      case "end-party": {
        if (!hostOnly() || !inPhase("lobby", "results")) return;
        const party = (data.party ??= emptyPartyLog());
        party.endedAt = this.host.now();
        data.phase = "ended";
        data.game = null;
        // As "Back to lobby" does: seats only kept so the game could name them go now.
        data.seats = data.seats.filter((s) => s.presence === "connected" || s.presence === "reconnecting");
        this.ensureHost();
        for (const key of Object.keys(data.timers)) if (key.startsWith(GAME_TIMER_PREFIX)) this.clearTimer(key);
        this.resetReady();
        this.setAwaiting([]);
        return this.commit([]);
      }

      case "leave": {
        conn.setState({ hello: true, playerId: null });
        conn.close(CLOSE_NORMAL, "left");
        return this.commit(this.removeSeat(seat));
      }

      case "nudge": {
        if (!inPhase("playing")) return;
        const now = this.host.now();
        const targets = data.awaiting.filter((id) => id !== seat.id && !this.isBot(id));
        if (!targets.length || data.awaitingSince === null || now - data.awaitingSince < NUDGE_AFTER_MS) {
          return this.error(conn, "too-early", "Wait a little before you remind them.");
        }
        if (now - (data.lastNudgeAt ?? 0) < NUDGE_COOLDOWN_MS) {
          return this.error(conn, "rate-limited", "Someone just reminded them. Wait a little.");
        }
        data.lastNudgeAt = now;
        for (const c of this.liveConns()) {
          const pid = c.state?.playerId;
          if (pid && targets.includes(pid)) c.send({ type: "nudged", byPlayerId: seat.id });
        }
        return this.persist();
      }

      case "skip-turn": {
        if (!hostOnly() || !inPhase("playing")) return;
        const target = data.seats.find((s) => s.id === msg.playerId);
        if (!target || !data.awaiting.includes(target.id)) {
          return this.error(conn, "not-available", "It isn't their turn.");
        }
        // Idle players get a minute; a dropped connection can be skipped straight away.
        const idleFor = this.host.now() - (data.awaitingSince ?? this.host.now());
        if (target.presence === "connected" && idleFor < SKIP_AFTER_MS) {
          return this.error(conn, "too-early", "Wait a little before you skip this player.");
        }
        const events = this.applyGameHook((def, st) => def.skipTurn?.(st, target.id, this.ctx()), true);
        if (!events.length) return this.error(conn, "not-available", "This game can't skip turns.");
        return this.commit(events);
      }

      case "remove-player": {
        if (!hostOnly()) return;
        const target = data.seats.find((s) => s.id === msg.playerId && s.presence !== "left");
        if (!target || target.id === seat.id) return this.error(conn, "not-available", "You can't remove them.");
        // Mid-game, only once the grace period has run out (§12.1).
        if (data.phase === "playing" && target.presence !== "disconnected") {
          return this.error(conn, "too-early", "This player may come back. Wait until the player shows as disconnected.");
        }
        for (const c of this.liveConns()) {
          if (c.state?.playerId === target.id) {
            c.setState({ hello: true, playerId: null });
            this.fatal(c, "removed", "The host removed you from this room.");
          }
        }
        return this.commit(this.removeSeat(target));
      }

      case "add-bot": {
        if (!hostOnly() || !inPhase("lobby", "results")) return;
        const def = this.games[data.gameId]!;
        if (!def.bot) return this.error(conn, "not-available", "This game can't have computers.");
        // Not "room-full": that one is fatal and would close the host's socket.
        if (this.activeSeats().length >= this.maxSeats(def)) return this.error(conn, "not-available", "The table is full.");
        data.seats.push(this.seatBot());
        return this.commit([]);
      }

      case "remove-bots":
        if (!hostOnly() || !inPhase("lobby", "results")) return;
        data.seats = data.seats.filter((s) => !s.bot);
        return this.commit([]);

      case "debug-start":
        if (!this.host.devTools) return this.error(conn, "not-available", "Debug tools are off.");
        if (!hostOnly() || !inPhase("lobby", "results")) return;
        return this.startGame(conn, { seed: msg.seed, deck: msg.deck });

      case "hello":
      case "join":
      case "ping":
        return; // handled before seating
    }
  }

  private async startGame(conn: Conn, debug?: { seed?: number; deck?: string[] }): Promise<void> {
    const data = this.data!;
    const def = this.games[data.gameId]!;
    if (this.lockedGameIds().includes(data.gameId)) return this.needsPass(conn);
    // Only a room stored before bots could get here: picking the game is refused already.
    if (!this.botsAllowed(def)) return this.botsBlock(conn);

    // Seats whose owner wandered off in the lobby don't get dealt in.
    data.seats = data.seats.filter((s) => s.presence === "connected");
    this.ensureHost();

    // The whole point of the owner key: no owner at the table, no game. The copy
    // stays vague on purpose; nobody needs to know why.
    if (!this.ownerHere()) {
      this.error(conn, "cannot-start", "Can't start yet.");
      return this.commit([]);
    }

    const n = data.seats.length;
    if (n < def.manifest.minPlayers || n > def.manifest.maxPlayers) {
      this.error(conn, "not-enough-players", `${def.manifest.name} needs ${def.manifest.minPlayers}–${def.manifest.maxPlayers} players.`);
      return this.commit([]);
    }

    const settings = def.parseSettings(data.settings) ?? def.defaultSettings;
    const problem = def.setupProblem?.(settings, n) ?? null;
    if (problem) {
      this.error(conn, "bad-setup", problem);
      return this.commit([]);
    }

    // A debug seed makes the whole deal reproducible, dealer included.
    const ctx = debug?.seed === undefined
      ? this.ctx()
      : { now: this.host.now(), randomInt: seededRandomInt(debug.seed), hostId: data.hostId };
    if (data.match.roundNumber === 0 || debug?.seed !== undefined) data.match.nextDealerSeat = ctx.randomInt(n);
    const dealerSeat = data.match.nextDealerSeat % n;
    data.match.roundNumber++;
    data.match.nextDealerSeat = (dealerSeat + 1) % n;

    const carry = data.match.carry?.gameId === def.manifest.id ? data.match.carry.data : undefined;
    const options: CreateGameOptions | undefined = debug?.deck ? { deck: debug.deck } : undefined;
    let transition: GameTransition<unknown, unknown>;
    try {
      transition = def.createGame(
        data.seats.map((s) => ({ id: s.id })),
        settings,
        { roundNumber: data.match.roundNumber, dealerSeat, ...(carry !== undefined && { carry }) },
        ctx,
        options,
      );
    } catch (err) {
      if (!debug) throw err;
      // A bad debug deck is the developer's typo, not a server fault; say what's wrong.
      await this.recover(err);
      return this.error(conn, "bad-message", err instanceof Error ? err.message : "Bad debug deck.");
    }
    data.phase = "playing";
    data.game = { gameId: def.manifest.id, state: null };
    (data.party ??= emptyPartyLog()).startedAt ??= this.host.now();
    this.resetReady();
    // Suggestions are for the next pick; once a game starts they've done their job.
    for (const s of data.seats) delete s.suggestion;
    delete data.botRun;
    const events = this.applyTransition(transition, true);
    return this.commit(events);
  }

  /**
   * Ends a game early, back to the lobby, with no recap entry: the host's "Back
   * to lobby", a stuck computer, or nobody left to play for. `message` goes to
   * everyone seated when they should be told why.
   */
  private endGameToLobby(message: string | null): void {
    const data = this.data!;
    data.phase = "lobby";
    data.game = null;
    // An abandoned game's timers would otherwise fire into the lobby.
    for (const key of Object.keys(data.timers)) {
      if (key.startsWith(GAME_TIMER_PREFIX) || key.startsWith(BOT_TIMER_PREFIX)) this.clearTimer(key);
    }
    // Disconnected seats were only kept for the game; their grace is long spent.
    data.seats = data.seats.filter((s) => s.presence === "connected" || s.presence === "reconnecting");
    this.ensureHost();
    this.resetReady();
    this.setAwaiting([]);
    delete data.botRun;
    // Sent after the commit's update, so the client reads it as the reason, not "the host ended it".
    if (message) this.gameEndedNotice = message;
  }

  // ---- computer players ---------------------------------------------------

  /** Some person in the room is connected. Bots only play while someone is. */
  private personWatching(): boolean {
    return this.data!.seats.some((s) => !s.bot && s.presence === "connected");
  }

  /** What a bot may see: the projections a seated person gets, nothing more. */
  private botDecide(seatId: string): unknown {
    const game = this.data!.game!;
    const def = this.games[game.gameId]!;
    // Copies, as the wire would carry them: a bot that changes its view can't change the game.
    const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    const view = {
      playerId: seatId,
      public: copy(def.getPublicState(game.state)),
      private: copy(def.getPrivateState(game.state, seatId)),
    };
    // Fixed for one game (the room's code and game number), so asking again gives the same answer.
    const gameKey = `${this.data!.code}:${this.data!.match.roundNumber}`;
    return def.bot!.decide(view, {
      randomInt: (max) => this.host.randomInt(max),
      chance: (key) => stableHash(`${gameKey}:${seatId}:${key}`) % 100,
    });
  }

  /**
   * Runs as part of every commit while a game is playing. Gives each bot that
   * is awaited, or wants to make a move, a timer for it. Only asks: the move
   * itself waits for the timer, so a person's update is never held up by one.
   */
  private scheduleBots(): void {
    const data = this.data!;
    if (data.phase !== "playing" || !data.game) return;
    // Only computers are left: nobody to play for.
    const people = data.seats.filter((s) => !s.bot);
    if (people.length < data.seats.length && people.every((s) => s.presence === "left")) return this.endGameToLobby(null);
    if (!this.personWatching() || !this.games[data.game.gameId]!.bot) return;

    const botSeats = data.seats.filter((s) => s.bot && s.presence !== "left");
    for (const seat of botSeats) {
      const key = BOT_TIMER_PREFIX + seat.id;
      if (key in data.timers) continue;
      let wants = data.awaiting.includes(seat.id);
      if (!wants) {
        try {
          wants = this.botDecide(seat.id) !== null;
        } catch (err) {
          // Not awaited, so there's nothing to be stuck on. The game moving on asks again.
          this.host.logError(err);
        }
      }
      if (!wants) continue;
      // This bot moved last and still has a move (a second draw, say): it's a forced step, not a new think.
      if (data.botRun?.seatId === seat.id) {
        this.setTimer(key, this.host.now() + BOT_FOLLOW_MS + this.host.randomInt(BOT_FOLLOW_SPAN_MS));
        continue;
      }
      // Feels human at a small table; quicker when many bots move in a row.
      const think = (BOT_THINK_MS + this.host.randomInt(BOT_THINK_SPAN_MS)) * Math.min(1, BOT_THINK_TABLE / botSeats.length);
      this.setTimer(key, this.host.now() + Math.max(BOT_THINK_FLOOR_MS, Math.round(think)));
    }
  }

  /**
   * A bot's think time is up: it asks again, now, and makes its move. Null
   * when nothing changed (it has nothing to do now), so there's nothing to send.
   */
  private onBotTimer(seatId: string): GameEventEnvelope<unknown>[] | null {
    const data = this.data!;
    if (data.phase !== "playing" || !data.game) return null;
    const seat = data.seats.find((s) => s.id === seatId);
    if (!seat?.bot || seat.presence === "left") return null;
    // Paused. A person coming back commits, and that schedules the bot again.
    if (!this.personWatching()) return null;
    const def = this.games[data.game.gameId]!;
    if (!def.bot) return null;

    // A throw here must never reach the alarm's rollback: it would just retry forever.
    let result: ReturnType<AnyGameDefinition["handleAction"]> | null;
    try {
      const action = this.botDecide(seatId);
      result = action === null ? null : def.handleAction(data.game.state, seatId, action, this.ctx());
    } catch (err) {
      this.host.logError(err);
      return this.botStuck(seatId, "threw");
    }
    if (!result) return data.awaiting.includes(seatId) ? this.botStuck(seatId, "null") : null;
    if (!result.ok) return this.botStuck(seatId, `rejected (${result.error.code})`);

    const events = this.applyTransition(result.transition, true);
    const run = data.botRun?.seatId === seatId ? data.botRun : { seatId, moves: 0, skipped: false };
    run.moves++;
    data.botRun = run;
    if (data.phase === "playing" && run.moves > BOT_MAX_RUN) return [...events, ...this.botStuck(seatId, "run")];
    return events;
  }

  /**
   * Skip the bot once, when it's awaited; if it's stuck again before anyone else
   * moves, or stuck off its turn, end the game.
   */
  private botStuck(seatId: string, reason: string): GameEventEnvelope<unknown>[] {
    const data = this.data!;
    this.host.logError(new Error(`Computer player stuck: game ${data.game?.gameId}, seat ${seatId}, ${reason}`));
    // Only a seat whose turn it is can be skipped; off-turn, a skip could undo a move (a cast vote).
    if (!data.botRun?.skipped && data.awaiting.includes(seatId)) {
      const moves = data.botRun?.seatId === seatId ? data.botRun.moves : 0;
      data.botRun = { seatId, moves, skipped: true };
      try {
        const events = this.applyGameHook((def, st) => def.skipTurn?.(st, seatId, this.ctx()), true);
        if (events.length) return events;
      } catch (err) {
        this.host.logError(err);
      }
    }
    this.endGameToLobby(BOT_STUCK_MESSAGE);
    return [];
  }

  // ---- game plumbing ------------------------------------------------------

  private ctx(): GameContext {
    return { now: this.host.now(), randomInt: (max) => this.host.randomInt(max), hostId: this.data!.hostId };
  }

  /** Runs an optional hook against the live game and applies whatever it returns. */
  private applyGameHook(
    fn: (def: AnyGameDefinition, state: unknown) => GameTransition<unknown, unknown> | undefined,
    acted = false,
  ): GameEventEnvelope<unknown>[] {
    const data = this.data!;
    if (data.phase !== "playing" || !data.game) return [];
    const t = fn(this.games[data.game.gameId]!, data.game.state);
    return t ? this.applyTransition(t, acted) : [];
  }

  /**
   * `acted`: the game moved on (a play, a skip, a removal), so the idle clock
   * restarts even if the same player is awaited again, e.g. after everyone
   * else auto-passed.
   */
  private applyTransition(t: GameTransition<unknown, unknown>, acted = false): GameEventEnvelope<unknown>[] {
    const data = this.data!;
    const game = data.game!;
    const def = this.games[game.gameId]!;
    game.state = t.state;

    for (const req of t.timers ?? []) {
      const key = GAME_TIMER_PREFIX + req.timerId;
      if (req.kind === "set") this.setTimer(key, this.host.now() + req.delayMs);
      else this.clearTimer(key);
    }

    const outcome = def.getResult(game.state);
    if (outcome) {
      data.phase = "results";
      this.logGame(def, game.state, outcome);
      if (def.carryOver) data.match.carry = { gameId: game.gameId, data: def.carryOver(game.state) };
      this.resetReady();
      this.setAwaiting([]);
      // A bot timer left over would otherwise fire into the next game.
      for (const key of Object.keys(data.timers)) {
        if (key.startsWith(GAME_TIMER_PREFIX) || key.startsWith(BOT_TIMER_PREFIX)) this.clearTimer(key);
      }
    } else {
      this.setAwaiting(def.getAwaitedPlayerIds(game.state), acted);
    }
    return t.events;
  }

  /**
   * Notes a finished game for the recap. Only seated people count: computer
   * players (bot seats, and anyone the game names without a seat) can win a
   * game but not an award.
   */
  private logGame(def: AnyGameDefinition, state: unknown, outcome: GameOutcome): void {
    const data = this.data!;
    const party = (data.party ??= emptyPartyLog());
    const seats = new Map(data.seats.map((s) => [s.id, s]));
    const human = (id: string) => seats.has(id) && !seats.get(id)!.bot && !(outcome.names && id in outcome.names);
    const fromStandings = outcome.standings.map((s) => s.playerId).filter(human);
    const players = fromStandings.length ? fromStandings : data.seats.filter((s) => !s.bot).map((s) => s.id);
    const stats: PartyStats = {};
    for (const [id, counts] of Object.entries(def.partyStats?.(state) ?? {})) if (human(id)) stats[id] = { ...counts };
    party.games.push({
      gameId: def.manifest.id,
      endedAt: this.host.now(),
      players,
      winnerIds: outcome.winnerIds.filter(human),
      ...(outcome.loserIds && { loserIds: outcome.loserIds.filter(human) }),
      stats,
    });
    if (party.games.length > PARTY_LOG_MAX) party.games.splice(0, party.games.length - PARTY_LOG_MAX);
    for (const id of players) party.names[id] = seats.get(id)!.name;
  }

  private setAwaiting(ids: string[], restart = false): void {
    const data = this.data!;
    const same = ids.length === data.awaiting.length && ids.every((id, i) => id === data.awaiting[i]);
    if (same && !restart) return;
    data.awaiting = ids;
    data.awaitingSince = ids.length ? this.host.now() : null;
  }

  private resetReady(): void {
    // Computers are always ready.
    for (const s of this.data!.seats) s.ready = !!s.bot;
  }

  private activeSeats(): SeatData[] {
    return this.data!.seats.filter((s) => s.presence !== "left");
  }

  /**
   * Host migration (§24). The host keeps the role through their grace period;
   * once they're disconnected or gone, it passes to the longest-seated connected
   * player. If nobody's connected, it stays put until someone returns. A
   * computer is never host: with no person to pass it to, nobody is.
   */
  private ensureHost(): void {
    const data = this.data!;
    const host = data.seats.find((s) => s.id === data.hostId);
    if (host && (host.presence === "connected" || host.presence === "reconnecting")) return;
    const people = this.activeSeats().filter((s) => !s.bot);
    const next = people.filter((s) => s.presence === "connected").sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) data.hostId = next.id;
    else if (!host || host.presence === "left") data.hostId = people[0]?.id ?? null;
  }

  private isBot(id: string): boolean {
    return !!this.data!.seats.find((s) => s.id === id)?.bot;
  }

  /** The most recently added computer, the first to give up its seat. */
  private newestBot(): SeatData | undefined {
    let newest: SeatData | undefined;
    for (const s of this.data!.seats) if (s.bot && (!newest || s.joinedAt >= newest.joinedAt)) newest = s;
    return newest;
  }

  /** False when computers are seated and this game can't have them. */
  private botsAllowed(def: AnyGameDefinition): boolean {
    return !!def.bot || !this.data!.seats.some((s) => s.bot);
  }

  private botsBlock(conn: Conn): void {
    this.error(conn, "not-available", "Remove computers to play this");
  }

  private onGraceExpired(playerId: string): void {
    const data = this.data!;
    const seat = data.seats.find((s) => s.id === playerId);
    if (!seat || seat.presence !== "reconnecting") return;
    if (data.phase === "playing") {
      // Seat and hand stay; the host can now remove them (§12.1).
      seat.presence = "disconnected";
      this.ensureHost();
    } else {
      this.removeSeat(seat);
    }
  }

  /**
   * Takes a player out of the room. Outside a game the seat just goes; mid-game
   * it's kept as "left" so standings can still name them, and the game decides
   * what their absence means (ghost cards, for Sevens).
   */
  private removeSeat(seat: SeatData): GameEventEnvelope<unknown>[] {
    const data = this.data!;
    this.clearTimer(GRACE_TIMER_PREFIX + seat.id);
    let events: GameEventEnvelope<unknown>[] = [];
    if (data.phase === "playing") {
      seat.presence = "left";
      seat.resumeToken = "";
      seat.ready = false;
      events = this.applyGameHook((def, st) => def.onPlayerRemoved?.(st, seat.id, this.ctx()), true);
    } else {
      data.seats = data.seats.filter((s) => s !== seat);
    }
    this.ensureHost();
    return events;
  }

  // ---- timers -------------------------------------------------------------

  private setTimer(key: string, at: number): void {
    this.data!.timers[key] = at;
  }

  private clearTimer(key: string): void {
    delete this.data!.timers[key];
  }

  // ---- output -------------------------------------------------------------

  private async persist(): Promise<void> {
    if (!this.data) return;
    await this.host.storage.put(STORAGE_KEY, this.data);
    const next = Math.min(...Object.values(this.data.timers));
    if (Number.isFinite(next)) await this.host.storage.setAlarm(next);
    else await this.host.storage.deleteAlarm();
  }

  /**
   * One accepted transition → bump the version, persist, then send exactly one
   * `update` per player (§19). `snapshotFor` gets a full snapshot instead.
   */
  private async commit(events: GameEventEnvelope<unknown>[], conns?: Conn[], snapshotFor?: string): Promise<void> {
    const data = this.data!;
    if (data.phase === "playing") this.scheduleBots();
    data.stateVersion++;
    await this.persist();

    const room = this.publicState();
    const def = data.game ? this.games[data.game.gameId]! : null;
    for (const conn of conns ?? this.liveConns()) {
      const playerId = conn.state?.playerId;
      if (!playerId) continue;
      const inGame = def && data.game && data.seats.some((s) => s.id === playerId);
      const snapshot = conn.id === snapshotFor;
      conn.send({
        type: "update",
        stateVersion: data.stateVersion,
        snapshot,
        room,
        private: inGame ? def.getPrivateState(data.game!.state, playerId) : null,
        events: snapshot
          ? []
          : events
              .filter((e) => e.visibility.kind === "public" || e.visibility.playerId === playerId)
              .map((e) => e.event),
        ...(snapshot && def?.getStreamSnapshot && { stream: def.getStreamSnapshot(data.game!.state) }),
      });
    }
    const notice = this.gameEndedNotice;
    this.gameEndedNotice = null;
    if (notice) for (const c of this.liveConns()) if (this.seatOf(c)) this.error(c, "game-ended", notice);
  }

  /** Sliding-window rate limit. Records the send when it's allowed. */
  private allow(kind: string, seatId: string, limit: { burst: number; windowMs: number }): boolean {
    const key = `${kind}:${seatId}`;
    const now = this.host.now();
    const recent = (this.sendTimes.get(key) ?? []).filter((t) => now - t < limit.windowMs);
    if (recent.length >= limit.burst) return false;
    this.sendTimes.set(key, [...recent, now]);
    return true;
  }

  /** Like streams, chat rides outside the versioned updates: no bump, just the lines. */
  private broadcastChat(messages: ChatMessage[]): void {
    for (const c of this.liveConns()) if (c.state?.playerId) c.send({ type: "chat", messages, replace: false });
  }

  private publicState(): RoomPublicState {
    const data = this.data!;
    const def = data.game ? this.games[data.game.gameId]! : null;
    return {
      code: data.code,
      phase: data.phase,
      hostId: data.hostId,
      seats: data.seats.map(({ resumeToken: _secret, owner: _owner, ...pub }) => pub),
      gameId: data.gameId,
      settings: data.settings,
      roundNumber: data.match.roundNumber,
      awaitingPlayerIds: data.awaiting,
      awaitingSince: data.awaitingSince,
      game: def ? def.getPublicState(data.game!.state) : null,
      result: def ? def.getResult(data.game!.state) : null,
      canStart: this.ownerHere(),
      setupProblem: this.setupProblem(),
      tier: this.tier(),
      lockedGameIds: this.lockedGameIds(),
      botGameIds: Object.keys(this.games).filter((id) => this.games[id]!.bot),
      maxSeats: this.games[data.gameId] ? this.maxSeats(this.games[data.gameId]!) : 0,
      recap: data.phase === "ended" ? buildRecap(data.party ?? emptyPartyLog(), this.host.now()) : null,
    };
  }

  /** The selected game's seat count, cut to the free cap in a free room. */
  private maxSeats(def: AnyGameDefinition): number {
    const freeCap = this.tier() === "free" ? this.host.tierLimits?.freeMaxPlayers ?? Infinity : Infinity;
    return Math.min(def.manifest.maxPlayers, freeCap);
  }

  private tier(): RoomTier {
    return this.data?.tier ?? "pass";
  }

  private lockedGameIds(): string[] {
    const limits = this.host.tierLimits;
    if (!limits || this.tier() !== "free") return [];
    return limits.premiumGameIds.filter((id) => id in this.games);
  }

  private needsPass(conn: Conn): void {
    this.error(conn, "needs-pass", "This game needs Host Pass.");
  }

  /**
   * What `startGame` would refuse over, asked of the selected game, not the one
   * last played. Outside the game's head count the lobby already says "needs
   * N–M players", and a deck built for one player is nonsense anyway.
   */
  private setupProblem(): string | null {
    const data = this.data!;
    const def = this.games[data.gameId];
    if (!def?.setupProblem) return null;
    const n = data.seats.filter((s) => s.presence === "connected").length;
    if (n < def.manifest.minPlayers || n > def.manifest.maxPlayers) return null;
    return def.setupProblem(def.parseSettings(data.settings) ?? def.defaultSettings, n);
  }

  private ownerHere(): boolean {
    return !this.host.ownerRequired || this.data!.seats.some((s) => s.owner && s.presence === "connected");
  }

  private liveConns(): Conn[] {
    return [...this.host.connections()];
  }

  private seatOf(conn: Conn): SeatData | undefined {
    const id = conn.state?.playerId;
    return id ? this.data?.seats.find((s) => s.id === id) : undefined;
  }

  private error(conn: Conn, code: ErrorCode, message: string): void {
    conn.send({ type: "error", code, message, fatal: FATAL_ERRORS.has(code) });
  }

  private fatal(conn: Conn, code: ErrorCode, message: string): void {
    this.error(conn, code, message);
    conn.close(CLOSE_POLICY, code);
  }
}
