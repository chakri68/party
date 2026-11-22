import type { GameOutcome, Recap } from "@games/game-core";

export const PROTOCOL_VERSION = 12;

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
// Room chat
// ---------------------------------------------------------------------------

export const CHAT_MAX_LENGTH = 200;
/** Lines the server keeps; older ones fall off the top. */
export const CHAT_KEEP = 100;
/** The whole reaction menu. A fixed set, so nobody reacts with a 4KB string. */
export const REACTIONS = ["👍", "😂", "❤️", "😮", "😭", "🔥"] as const;
export type Reaction = (typeof REACTIONS)[number];

export interface ChatMessage {
  id: number;
  from: string;
  /** As they were when they said it, so lines outlive the seat. */
  name: string;
  avatarSeed: string;
  text: string;
  at: number;
  /** Emoji → who reacted with it. Empty lists are dropped. */
  reactions: Partial<Record<Reaction, string[]>>;
}

/** One line, no control characters, capped (by code point, so emoji don't split). Chat's cap unless a clue or definition asks for its own. */
export function cleanChatText(input: string, max = CHAT_MAX_LENGTH): string {
  const flat = input.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
  return [...flat].slice(0, max).join("").trim();
}

export const isReaction = (v: unknown): v is Reaction => (REACTIONS as readonly unknown[]).includes(v);

// ---------------------------------------------------------------------------
// Sound board
// ---------------------------------------------------------------------------

/** One seat: one sound per this long. The tile shows it. */
export const SOUND_COOLDOWN_MS = 3000;
/** The whole room: at most this many sounds in the window. */
export const ROOM_SOUND_LIMIT = { burst: 3, windowMs: 3000 };
export const SOUND_ID_MAX_LENGTH = 48;

const SOUND_ID = /^[a-z][a-z0-9-]{0,15}:[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `<pack>:<id>`, by shape only. Whether the room plays it is the room's call. */
export const isSoundId = (v: unknown): v is string =>
  typeof v === "string" && v.length <= SOUND_ID_MAX_LENGTH && SOUND_ID.test(v);

// ---------------------------------------------------------------------------
// Room state (§20)
// ---------------------------------------------------------------------------

/** "ended": the host ended the party. No more games; the recap stays up until cleanup. */
export type RoomPhase = "lobby" | "playing" | "results" | "ended";

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
  /** The game this player wants next, if any. Cleared when a game starts. */
  suggestion?: string;
  /** A computer player. Always connected and ready; never host. */
  bot?: true;
}

/** Most people who can be in voice at once. */
export const VOICE_CAP = 8;
/**
 * voice-ice-request: at most this many per seat in a window. The server drops
 * the rest, and the client does not send them.
 */
export const ICE_REQUEST_LIMIT = { burst: 3, windowMs: 60_000 };
/** Raw length cap for one voice-signal message. An audio-only SDP is about 3 to 5 KB. */
export const VOICE_SIGNAL_MAX_LENGTH = 6144;

export type VoiceMode = "off" | "global" | "game";

export interface VoiceMember {
  id: string;
  selfMuted: boolean;
  hostMuted: boolean;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** What a room may do. Rooms without a paywall are always "pass". */
export type RoomTier = "free" | "pass";

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
  /**
   * The selected game's objection to its settings at the current head count
   * (connected seats, the ones a start would deal in), shown as-is. Null when
   * it has none or doesn't check.
   */
  setupProblem: string | null;
  tier: RoomTier;
  /** New people can't join. Seats already in, the owner, and seats dropped for being away still can. */
  locked: boolean;
  /** The host paused the game. Only in `playing`. */
  paused: boolean;
  /** Game ids this room can't select at its tier. Empty on master. */
  lockedGameIds: string[];
  /**
   * Voice chat for the room. "off" once the party has ended, "global" otherwise.
   * "game" is for a later phase.
   */
  voice: { mode: VoiceMode };
  /** Game ids that can have computer players. */
  botGameIds: string[];
  /** The host's switch for the sound board. Off: the room drops every sound. */
  sounds: boolean;
  /** How many seats the selected game has here: its max, or less in a free room. */
  maxSeats: number;
  /** The night's recap, in `ended`. Null there too when no game finished. */
  recap: Recap | null;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: "hello"; protocolVersion: number }
  | { type: "join"; name: string; avatarSeed: string; resumeToken?: string; ownerKey?: string }
  | { type: "ready"; ready: boolean }
  | { type: "select-game"; gameId: string }
  /** Anyone: back a game for the host to pick. Null takes it back. */
  | { type: "suggest-game"; gameId: string | null }
  /** A partial patch; the room merges it over the current settings. */
  | { type: "update-settings"; settings: unknown }
  | { type: "start-game" }
  | { type: "game-action"; clientActionId: string; action: unknown }
  /** Ephemeral game data (§35): no version, no reply, relayed to the others if the game takes it. */
  | { type: "stream"; data: unknown }
  | { type: "nudge" }
  | { type: "chat"; text: string }
  /** Toggles: reacting twice with the same emoji takes it back. */
  | { type: "react"; messageId: number; emoji: Reaction }
  /** A floating emoji for the whole room. Not kept anywhere. */
  | { type: "emote"; emoji: Reaction }
  /** Plays a board sound for the room. Dropped without a word when not allowed. */
  | { type: "sound"; id: string }
  /** Host only, in the lobby, playing or results: the sound board on or off for everyone. */
  | { type: "room-sounds"; on: boolean }
  | { type: "skip-turn"; playerId: string }
  | { type: "remove-player"; playerId: string }
  /** Host only, in the lobby or on results: seats a computer player. `remove-player` takes one out. */
  | { type: "add-bot" }
  /** Host only, in the lobby or on results: takes every computer player out. */
  | { type: "remove-bots" }
  /** Host only, in the lobby, playing or results: locks the room against new people, or unlocks it. */
  | { type: "lock-room"; locked: boolean }
  /** Host only: hands the host role to another seat. */
  | { type: "transfer-host"; playerId: string }
  /** Host only, while playing: starts the same game again from the start. */
  | { type: "restart-game" }
  /** Host only, while playing: pauses the game or resumes it. */
  | { type: "pause-game"; paused: boolean }
  /** Joins room voice. `muted` is whether the mic starts off. */
  | { type: "voice-join"; muted: boolean }
  | { type: "voice-leave" }
  | { type: "voice-self-mute"; muted: boolean }
  /** A WebRTC offer, answer or ICE batch for one other seat. Relayed, never stored. */
  | { type: "voice-signal"; to: string; session: string; data: unknown }
  | { type: "voice-ice-request" }
  | { type: "return-to-lobby" }
  /** Host only, in the lobby or on results: ends the room for everyone and shows the recap. */
  | { type: "end-party" }
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
  /**
   * Room chat, outside the versioned updates. `replace`: the full history (on
   * join); otherwise new or changed lines, matched by id.
   */
  | { type: "chat"; messages: ChatMessage[]; replace: boolean }
  /** Echoed to the sender too, so everyone sees the same thing. */
  | { type: "emote"; from: string; emoji: Reaction }
  /** A board sound, for every seated connection, the sender too. `by` is null when the room sends one itself. */
  | { type: "sound"; id: string; by: string | null }
  | { type: "voice-state"; members: VoiceMember[] }
  | { type: "voice-signal"; from: string; session: string; data: unknown }
  | { type: "voice-ice"; iceServers: IceServer[]; expiresAt: number }
  | { type: "error"; code: ErrorCode; message: string; fatal: boolean }
  | { type: "pong"; timestamp: number; serverTime: number };

export type ErrorCode =
  | "room-not-found"
  | "room-full"
  | "game-in-progress"
  | "room-locked"
  | "replaced-by-new-connection"
  | "protocol-mismatch"
  | "bad-message"
  | "not-joined"
  | "not-host"
  | "invalid-name"
  | "not-enough-players"
  | "bad-setup"
  | "unknown-game"
  | "invalid-settings"
  | "wrong-phase"
  | "removed"
  | "too-early"
  | "rate-limited"
  | "not-available"
  | "server-error"
  | "cannot-start"
  | "needs-pass"
  | "voice-full"
  /** The game was ended for everyone (a computer player got stuck); back in the lobby. */
  | "game-ended";

/** Codes after which the server closes the socket and the client must not auto-reconnect. */
export const FATAL_ERRORS: ReadonlySet<ErrorCode> = new Set([
  "room-not-found",
  "room-full",
  "game-in-progress",
  "room-locked",
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
    case "suggest-game":
      return m.gameId === null || isStr(m.gameId, 64) ? { type: "suggest-game", gameId: m.gameId } : null;
    case "update-settings":
      return { type: "update-settings", settings: m.settings };
    case "game-action":
      return isStr(m.clientActionId, 64)
        ? { type: "game-action", clientActionId: m.clientActionId, action: m.action }
        : null;
    case "stream":
      return { type: "stream", data: m.data };
    case "chat":
      return isStr(m.text, CHAT_MAX_LENGTH * 4) ? { type: "chat", text: m.text } : null;
    case "react":
      return isNum(m.messageId) && isReaction(m.emoji) ? { type: "react", messageId: m.messageId, emoji: m.emoji } : null;
    case "emote":
      return isReaction(m.emoji) ? { type: "emote", emoji: m.emoji } : null;
    case "sound":
      return isSoundId(m.id) ? { type: "sound", id: m.id } : null;
    case "room-sounds":
      return typeof m.on === "boolean" ? { type: "room-sounds", on: m.on } : null;
    case "lock-room":
      return typeof m.locked === "boolean" ? { type: "lock-room", locked: m.locked } : null;
    case "pause-game":
      return typeof m.paused === "boolean" ? { type: "pause-game", paused: m.paused } : null;
    case "voice-join":
    case "voice-self-mute":
      return typeof m.muted === "boolean" ? { type: m.type, muted: m.muted } : null;
    case "voice-signal":
      if (raw.length > VOICE_SIGNAL_MAX_LENGTH) return null;
      return isStr(m.to, 64) && isStr(m.session, 64) && m.session !== "" && isObj(m.data)
        ? { type: "voice-signal", to: m.to, session: m.session, data: m.data }
        : null;
    case "skip-turn":
    case "remove-player":
    case "transfer-host":
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
    case "end-party":
    case "leave":
    case "add-bot":
    case "remove-bots":
    case "restart-game":
    case "voice-leave":
    case "voice-ice-request":
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
