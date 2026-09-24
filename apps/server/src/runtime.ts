// The room runtime (§4, §10–12, §20, §23). Transport- and storage-agnostic so it
// can be tested with fakes; `index.ts` adapts it to PartyServer.

import type { AnyGameDefinition, GameContext, GameEventEnvelope, GameTransition } from "@games/game-core";
import {
  FATAL_ERRORS,
  normalizeName,
  parseClientMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorCode,
  type Presence,
  type RoomPhase,
  type RoomPublicState,
  type ServerMessage,
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

export interface RoomHost {
  storage: RoomStorage;
  connections(): Iterable<Conn>;
  now(): number;
  randomInt(maxExclusive: number): number;
  /** ≥128 bits, URL-safe. */
  randomToken(): string;
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
  match: { roundNumber: number; nextDealerSeat: number };
  game: { gameId: string; state: unknown } | null;
  awaiting: string[];
  awaitingSince: number | null;
  /** Timer table (§4): key → due time. The one DO alarm tracks the earliest. */
  timers: Record<string, number>;
}

const STORAGE_KEY = "room";
const CLEANUP_TIMER = "cleanup";
const GAME_TIMER_PREFIX = "game:";
export const CLEANUP_AFTER_MS = 6 * 60 * 60 * 1000;

const CLOSE_NORMAL = 1000;
const CLOSE_POLICY = 4000;

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export class RoomRuntime {
  private data: RoomData | null = null;
  /** Serialises handlers: every await point is otherwise a chance to interleave. */
  private queue: Promise<unknown> = Promise.resolve();

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

  // ---- lifecycle ----------------------------------------------------------

  load(): Promise<void> {
    return this.run(async () => {
      this.data = (await this.host.storage.get<RoomData>(STORAGE_KEY)) ?? null;
      if (!this.data) return;
      // After an eviction, sockets may be gone while storage still says "connected".
      const live = new Set(this.liveConns().map((c) => c.state?.playerId));
      let changed = false;
      for (const seat of this.data.seats) {
        if (seat.presence === "connected" && !live.has(seat.id)) {
          seat.presence = "reconnecting";
          changed = true;
        }
      }
      if (changed) await this.commit([]);
    });
  }

  /** Claims this room code. False if it's already taken (§10). */
  claim(): Promise<boolean> {
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
        timers: {},
      };
      // Covers the room nobody ever joins.
      this.setTimer(CLEANUP_TIMER, this.host.now() + CLEANUP_AFTER_MS);
      await this.persist();
      return true;
    });
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
      if (!msg) return this.error(conn, "bad-message", "Malformed message.");
      if (msg.type === "ping") {
        return conn.send({ type: "pong", timestamp: msg.timestamp, serverTime: this.host.now() });
      }
      if (!this.data) return this.fatal(conn, "room-not-found", "That room doesn't exist.");
      if (msg.type === "hello") return this.onHello(conn, msg.protocolVersion);
      if (!conn.state?.hello) return this.fatal(conn, "protocol-mismatch", "Please refresh the page.");
      if (msg.type === "join") return this.onJoin(conn, msg);

      const seat = this.seatOf(conn);
      if (!seat) return this.error(conn, "not-joined", "Join the room first.");
      await this.onSeatedMessage(conn, seat, msg);
    });
  }

  onClose(conn: Conn): Promise<void> {
    return this.run(async () => {
      if (!this.data) return;
      const playerId = conn.state?.playerId;
      const others = this.liveConns().filter((c) => c.id !== conn.id);
      const seat = this.data.seats.find((s) => s.id === playerId);

      // A replaced tab closing mustn't mark the player as gone.
      if (seat && !others.some((c) => c.state?.playerId === seat.id)) {
        seat.presence = "reconnecting";
        const events = this.applyGameHook((def, st) => def.onPlayerDisconnected?.(st, seat.id, this.ctx()));
        await this.commit(events, others);
      }
      if (!others.some((c) => c.state?.playerId)) {
        this.setTimer(CLEANUP_TIMER, this.host.now() + CLEANUP_AFTER_MS);
        await this.persist();
      }
    });
  }

  onAlarm(): Promise<void> {
    return this.run(async () => {
      if (!this.data) return;
      const now = this.host.now();
      const due = Object.entries(this.data.timers)
        .filter(([, at]) => at <= now)
        .sort((a, b) => a[1] - b[1]);
      for (const [key] of due) {
        delete this.data.timers[key];
        if (key === CLEANUP_TIMER) {
          // Nobody's been here for hours: forget the room and free its code.
          this.data = null;
          await this.host.storage.deleteAll();
          return;
        }
        if (key.startsWith(GAME_TIMER_PREFIX)) {
          const timerId = key.slice(GAME_TIMER_PREFIX.length);
          this.applyGameHook((def, st) => def.onTimer?.(st, timerId, this.ctx()));
        }
      }
      await this.commit([]);
    });
  }

  // ---- messages -----------------------------------------------------------

  private onHello(conn: Conn, version: number): void {
    if (version !== PROTOCOL_VERSION) {
      return this.fatal(conn, "protocol-mismatch", "A new version is out. Please refresh the page.");
    }
    conn.setState({ hello: true, playerId: conn.state?.playerId ?? null });
  }

  private async onJoin(conn: Conn, msg: Extract<ClientMessage, { type: "join" }>): Promise<void> {
    const data = this.data!;
    const name = normalizeName(msg.name);
    if (!name) return this.error(conn, "invalid-name", "Pick a name first.");

    let seat = msg.resumeToken ? data.seats.find((s) => s.resumeToken === msg.resumeToken) : undefined;
    let events: GameEventEnvelope<unknown>[] = [];

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
      if (wasAway) events = this.applyGameHook((def, st) => def.onPlayerReconnected?.(st, seat!.id, this.ctx()));
    } else {
      if (data.phase === "playing") {
        return this.fatal(conn, "game-in-progress", "A game is already underway. Try again after this round.");
      }
      const def = this.games[data.gameId]!;
      if (data.seats.length >= def.manifest.maxPlayers) {
        return this.fatal(conn, "room-full", "This room is full.");
      }
      seat = {
        id: this.host.randomToken().slice(0, 12),
        name,
        avatarSeed: msg.avatarSeed,
        resumeToken: this.host.randomToken(),
        ready: false,
        presence: "connected",
        joinedAt: this.host.now(),
      };
      data.seats.push(seat);
      data.hostId ??= seat.id;
    }

    conn.setState({ hello: true, playerId: seat.id });
    conn.send({ type: "welcome", playerId: seat.id, resumeToken: seat.resumeToken });
    await this.commit(events, undefined, conn.id);
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
        if (!def) return this.error(conn, "unknown-game", "Unknown game.");
        data.gameId = msg.gameId;
        data.settings = def.defaultSettings;
        return this.commit([]);
      }

      case "update-settings": {
        if (!hostOnly() || !inPhase("lobby", "results")) return;
        const settings = this.games[data.gameId]!.parseSettings(msg.settings);
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
        const events = this.applyTransition(result.transition);
        return this.commit(events);
      }

      case "return-to-lobby":
        if (!hostOnly() || !inPhase("playing", "results")) return;
        data.phase = "lobby";
        data.game = null;
        this.resetReady();
        this.setAwaiting([]);
        return this.commit([]);

      case "leave":
        // Leaving mid-game needs removal + ghost cards; that lands with Phase 2.
        if (!inPhase("lobby", "results")) return;
        data.seats = data.seats.filter((s) => s.id !== seat.id);
        if (data.hostId === seat.id) data.hostId = this.pickHost();
        conn.setState({ hello: true, playerId: null });
        conn.close(CLOSE_NORMAL, "left");
        return this.commit([]);

      case "nudge":
      case "skip-turn":
      case "remove-player":
        return this.error(conn, "wrong-phase", "Not available yet.");

      case "hello":
      case "join":
      case "ping":
        return; // handled before seating
    }
  }

  private async startGame(conn: Conn): Promise<void> {
    const data = this.data!;
    const def = this.games[data.gameId]!;

    // Seats whose owner wandered off in the lobby don't get dealt in.
    data.seats = data.seats.filter((s) => s.presence === "connected");
    if (data.hostId && !data.seats.some((s) => s.id === data.hostId)) data.hostId = this.pickHost();

    const n = data.seats.length;
    if (n < def.manifest.minPlayers || n > def.manifest.maxPlayers) {
      this.error(conn, "not-enough-players", `${def.manifest.name} needs ${def.manifest.minPlayers}–${def.manifest.maxPlayers} players.`);
      return this.commit([]);
    }

    const ctx = this.ctx();
    if (data.match.roundNumber === 0) data.match.nextDealerSeat = ctx.randomInt(n);
    const dealerSeat = data.match.nextDealerSeat % n;
    data.match.roundNumber++;
    data.match.nextDealerSeat = (dealerSeat + 1) % n;

    const settings = def.parseSettings(data.settings) ?? def.defaultSettings;
    const transition = def.createGame(
      data.seats.map((s) => ({ id: s.id })),
      settings,
      { roundNumber: data.match.roundNumber, dealerSeat },
      ctx,
    );
    data.phase = "playing";
    data.game = { gameId: def.manifest.id, state: null };
    this.resetReady();
    const events = this.applyTransition(transition);
    return this.commit(events);
  }

  // ---- game plumbing ------------------------------------------------------

  private ctx(): GameContext {
    return { now: this.host.now(), randomInt: (max) => this.host.randomInt(max) };
  }

  /** Runs an optional hook against the live game and applies whatever it returns. */
  private applyGameHook(
    fn: (def: AnyGameDefinition, state: unknown) => GameTransition<unknown, unknown> | undefined,
  ): GameEventEnvelope<unknown>[] {
    const data = this.data!;
    if (data.phase !== "playing" || !data.game) return [];
    const t = fn(this.games[data.game.gameId]!, data.game.state);
    return t ? this.applyTransition(t) : [];
  }

  private applyTransition(t: GameTransition<unknown, unknown>): GameEventEnvelope<unknown>[] {
    const data = this.data!;
    const game = data.game!;
    const def = this.games[game.gameId]!;
    game.state = t.state;

    for (const req of t.timers ?? []) {
      const key = GAME_TIMER_PREFIX + req.timerId;
      if (req.kind === "set") this.setTimer(key, this.host.now() + req.delayMs);
      else this.clearTimer(key);
    }

    if (def.getResult(game.state)) {
      data.phase = "results";
      this.resetReady();
      this.setAwaiting([]);
      for (const key of Object.keys(data.timers)) if (key.startsWith(GAME_TIMER_PREFIX)) this.clearTimer(key);
    } else {
      this.setAwaiting(def.getAwaitedPlayerIds(game.state));
    }
    return t.events;
  }

  private setAwaiting(ids: string[]): void {
    const data = this.data!;
    const same = ids.length === data.awaiting.length && ids.every((id, i) => id === data.awaiting[i]);
    if (same) return;
    data.awaiting = ids;
    data.awaitingSince = ids.length ? this.host.now() : null;
  }

  private resetReady(): void {
    for (const s of this.data!.seats) s.ready = false;
  }

  /** Longest-seated connected player, else longest-seated anyone (§24). */
  private pickHost(): string | null {
    const seats = [...this.data!.seats].sort((a, b) => a.joinedAt - b.joinedAt);
    return (seats.find((s) => s.presence === "connected") ?? seats[0])?.id ?? null;
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
      });
    }
  }

  private publicState(): RoomPublicState {
    const data = this.data!;
    const def = data.game ? this.games[data.game.gameId]! : null;
    return {
      code: data.code,
      phase: data.phase,
      hostId: data.hostId,
      seats: data.seats.map(({ resumeToken: _secret, ...pub }) => pub),
      gameId: data.gameId,
      settings: data.settings,
      roundNumber: data.match.roundNumber,
      awaitingPlayerIds: data.awaiting,
      awaitingSince: data.awaitingSince,
      game: def ? def.getPublicState(data.game!.state) : null,
      result: def ? def.getResult(data.game!.state) : null,
    };
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
