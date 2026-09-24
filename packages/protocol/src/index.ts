import type { GameOutcome } from "@games/game-core";

export const PROTOCOL_VERSION = 1;

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

export type Presence = "connected" | "reconnecting" | "disconnected";

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
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: "hello"; protocolVersion: number }
  | { type: "join"; name: string; avatarSeed: string; resumeToken?: string }
  | { type: "ready"; ready: boolean }
  | { type: "select-game"; gameId: string }
  | { type: "update-settings"; settings: unknown }
  | { type: "start-game" }
  | { type: "game-action"; clientActionId: string; action: unknown }
  | { type: "nudge" }
  | { type: "skip-turn"; playerId: string }
  | { type: "remove-player"; playerId: string }
  | { type: "return-to-lobby" }
  | { type: "leave" }
  | { type: "ping"; timestamp: number };

export type ServerMessage =
  | { type: "welcome"; playerId: string; resumeToken: string }
  | {
      type: "update";
      stateVersion: number;
      snapshot: boolean;
      room: RoomPublicState;
      private: unknown | null;
      events: unknown[];
    }
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
  | "wrong-phase";

/** Codes after which the server closes the socket and the client must not auto-reconnect. */
export const FATAL_ERRORS: ReadonlySet<ErrorCode> = new Set([
  "room-not-found",
  "room-full",
  "game-in-progress",
  "replaced-by-new-connection",
  "protocol-mismatch",
]);

// ---------------------------------------------------------------------------
// Validation at the network boundary
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 256): v is string => typeof v === "string" && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Parses untrusted input into a ClientMessage, or null. Game payloads stay `unknown`. */
export function parseClientMessage(raw: string): ClientMessage | null {
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
      return {
        type: "join",
        name: m.name,
        avatarSeed: m.avatarSeed,
        ...(m.resumeToken !== undefined && { resumeToken: m.resumeToken as string }),
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
    case "skip-turn":
    case "remove-player":
      return isStr(m.playerId, 64) ? { type: m.type, playerId: m.playerId } : null;
    case "ping":
      return isNum(m.timestamp) ? { type: "ping", timestamp: m.timestamp } : null;
    case "start-game":
    case "nudge":
    case "return-to-lobby":
    case "leave":
      return { type: m.type };
    default:
      return null;
  }
}
