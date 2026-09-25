import type { GameOutcome } from "@games/game-core";

export const PROTOCOL_VERSION = 4;

// ---------------------------------------------------------------------------
// Room codes (§10)
// ---------------------------------------------------------------------------

/** No 0/O/1/I, so codes survive being read aloud across a noisy room. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 4;

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

export const MAX_NAME_LENGTH = 20;

export function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
}

// ---------------------------------------------------------------------------
// Room state (§20)
// ---------------------------------------------------------------------------

export type RoomPhase = "lobby" | "playing" | "results";

/**
 * connected → reconnecting (socket dropped, grace running) → disconnected (grace
 * expired, §12). "left" = walked out or removed mid-game; the seat lingers only so
 * the final standings can still name them.
 */
export type Presence = "connected" | "reconnecting" | "disconnected" | "left";

// ---------------------------------------------------------------------------
// Timing (§12). Shared so clients and server agree on when buttons appear.
// ---------------------------------------------------------------------------

export const GRACE_MS = 60_000;
export const NUDGE_AFTER_MS = 30_000;
export const SKIP_AFTER_MS = 60_000;
export const NUDGE_COOLDOWN_MS = 10_000;

export interface SeatPublic {
  id: string;
  name: string;
  avatarSeed: string;
  ready: boolean;
  presence: Presence;
  joinedAt: number;
}

export interface RoomPublicState {
  code: string;
  phase: RoomPhase;
  hostId: string | null;
  seats: SeatPublic[];
  gameId: string;
  settings: unknown;
  roundNumber: number;
  /** Player ids the active game is waiting on. Empty outside `playing`. */
  awaitingPlayerIds: string[];
  /** Server time the awaited set last changed (§12.2). */
  awaitingSince: number | null;
  /** The active game's public projection, present in `playing` and `results`. */
  game: unknown | null;
  result: GameOutcome | null;
  /**
   * Server-side start conditions beyond player count are met (today: the owner
   * is here). Deliberately vague on the wire, since it ends up in the UI.
   */
  canStart: boolean;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: "hello"; protocolVersion: number }
  | { type: "join"; name: string; avatarSeed: string; resumeToken?: string; ownerKey?: string }
  | { type: "ready"; ready: boolean }
  | { type: "select-game"; gameId: string }
  | { type: "update-settings"; settings: unknown }
  | { type: "start-game" }
  | { type: "game-action"; clientActionId: string; action: unknown }
  /** Ephemeral game data (§35): no version, no reply, relayed to the others if the game takes it. */
  | { type: "stream"; data: unknown }
  | { type: "nudge" }
  | { type: "skip-turn"; playerId: string }
  | { type: "remove-player"; playerId: string }
  | { type: "return-to-lobby" }
  | { type: "leave" }
  | { type: "ping"; timestamp: number }
  /**
   * Dev only (§41), refused unless the server runs with DEV_TOOLS=1. Starts a
   * game from a seed (reproducible deal) or an exact deck order.
   */
  | { type: "debug-start"; seed?: number; deck?: string[] };

export type ServerMessage =
  | { type: "welcome"; playerId: string; resumeToken: string }
  | {
      type: "update";
      stateVersion: number;
      snapshot: boolean;
      room: RoomPublicState;
      private: unknown | null;
      events: unknown[];
      /** Snapshots only: the game's stream history (see `getStreamSnapshot`). */
      stream?: unknown;
    }
  | { type: "stream"; from: string; data: unknown }
  | { type: "action-rejected"; clientActionId: string; code: string; message: string }
  | { type: "nudged"; byPlayerId: string }
  | { type: "error"; code: ErrorCode; message: string; fatal: boolean }
  | { type: "pong"; timestamp: number; serverTime: number };

export type ErrorCode =
  | "room-not-found"
  | "room-full"
  | "game-in-progress"
  | "replaced-by-new-connection"
  | "protocol-mismatch"
  | "bad-message"
  | "not-joined"
  | "not-host"
  | "invalid-name"
  | "not-enough-players"
  | "unknown-game"
  | "invalid-settings"
  | "wrong-phase"
  | "removed"
  | "too-early"
  | "rate-limited"
  | "not-available"
  | "server-error"
  | "cannot-start";

/** Codes after which the server closes the socket and the client must not auto-reconnect. */
export const FATAL_ERRORS: ReadonlySet<ErrorCode> = new Set([
  "room-not-found",
  "room-full",
  "game-in-progress",
  "replaced-by-new-connection",
  "protocol-mismatch",
  "removed",
]);

// ---------------------------------------------------------------------------
// Validation at the network boundary
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 256): v is string => typeof v === "string" && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Nothing legitimate comes close; this just stops a client from making us parse megabytes. */
export const MAX_MESSAGE_LENGTH = 8192;

/** Parses untrusted input into a ClientMessage, or null. Game payloads stay `unknown`. */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_MESSAGE_LENGTH) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m) || !isStr(m.type, 32)) return null;

  switch (m.type) {
    case "hello":
      return isNum(m.protocolVersion) ? { type: "hello", protocolVersion: m.protocolVersion } : null;
    case "join":
      if (!isStr(m.name, 100) || !isStr(m.avatarSeed, 64)) return null;
      if (m.resumeToken !== undefined && !isStr(m.resumeToken, 128)) return null;
      if (m.ownerKey !== undefined && !isStr(m.ownerKey, 256)) return null;
      return {
        type: "join",
        name: m.name,
        avatarSeed: m.avatarSeed,
        ...(m.resumeToken !== undefined && { resumeToken: m.resumeToken as string }),
        ...(m.ownerKey !== undefined && { ownerKey: m.ownerKey as string }),
      };
    case "ready":
      return typeof m.ready === "boolean" ? { type: "ready", ready: m.ready } : null;
    case "select-game":
      return isStr(m.gameId, 64) ? { type: "select-game", gameId: m.gameId } : null;
    case "update-settings":
      return { type: "update-settings", settings: m.settings };
    case "game-action":
      return isStr(m.clientActionId, 64)
        ? { type: "game-action", clientActionId: m.clientActionId, action: m.action }
        : null;
    case "stream":
      return { type: "stream", data: m.data };
    case "skip-turn":
    case "remove-player":
      return isStr(m.playerId, 64) ? { type: m.type, playerId: m.playerId } : null;
    case "ping":
      return isNum(m.timestamp) ? { type: "ping", timestamp: m.timestamp } : null;
    case "debug-start": {
      if (m.seed !== undefined && !isNum(m.seed)) return null;
      if (m.deck !== undefined && !(Array.isArray(m.deck) && m.deck.length <= 256 && m.deck.every((c) => isStr(c, 16)))) {
        return null;
      }
      return {
        type: "debug-start",
        ...(m.seed !== undefined && { seed: m.seed as number }),
        ...(m.deck !== undefined && { deck: m.deck as string[] }),
      };
    }
    case "start-game":
    case "nudge":
    case "return-to-lobby":
    case "leave":
      return { type: m.type };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Owner key
// ---------------------------------------------------------------------------

/** Constant-time string compare, so response timing doesn't leak the key. */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  // Out-of-range charCodeAt is NaN, and NaN | 0 is 0: short strings just pad.
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}
