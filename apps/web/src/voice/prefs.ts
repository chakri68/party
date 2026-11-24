// Voice settings saved on this device: one set for every room, plus per room
// whether I was in voice and with what mic choice, my volume for each person
// and who I muted for me.
// Nothing here goes to the server.

import { readLocal, writeLocal } from "../identity.ts";

export interface VoicePrefs {
  micDeviceId: string | null;
  outputDeviceId: string | null;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  mode: "open" | "ptt";
  deafenAlsoMutes: boolean;
  relayOnly: boolean;
  /** Lower game sound while other people talk. */
  duck: boolean;
  /** Keep the screen on while in voice (costs battery, so it can be turned off). */
  keepScreenOn: boolean;
}

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  micDeviceId: null,
  outputDeviceId: null,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  mode: "open",
  deafenAlsoMutes: false,
  relayOnly: false,
  duck: true,
  keepScreenOn: true,
};

/** The mic choice a reload keeps: talking, Mute (mic still on), or Turn off mic / Listen only. */
export type RoomMic = "on" | "muted" | "off";

/** One room's voice settings. `volumes` and `blocked` are by seat id. */
export interface RoomVoice {
  on: boolean;
  mic: RoomMic;
  volumes: Record<string, number>;
  blocked: string[];
}

export interface KeyValue {
  read(k: string): string | null;
  write(k: string, v: string | null): void;
}

const PREFS_KEY = "voice";
const ROOM_PREFIX = "voice-room:";
/** Room codes with saved settings, oldest write first. */
const INDEX_KEY = "voice-rooms";
const MAX_ROOMS = 10;

const DEFAULT_STORE: KeyValue = { read: readLocal, write: writeLocal };

function parse(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const idOrNull = (v: unknown, d: string | null) => (typeof v === "string" || v === null ? v : d);

function readPrefs(raw: Record<string, unknown>): VoicePrefs {
  const d = DEFAULT_VOICE_PREFS;
  return {
    micDeviceId: idOrNull(raw.micDeviceId, d.micDeviceId),
    outputDeviceId: idOrNull(raw.outputDeviceId, d.outputDeviceId),
    echoCancellation: bool(raw.echoCancellation, d.echoCancellation),
    noiseSuppression: bool(raw.noiseSuppression, d.noiseSuppression),
    autoGainControl: bool(raw.autoGainControl, d.autoGainControl),
    mode: raw.mode === "open" || raw.mode === "ptt" ? raw.mode : d.mode,
    deafenAlsoMutes: bool(raw.deafenAlsoMutes, d.deafenAlsoMutes),
    relayOnly: bool(raw.relayOnly, d.relayOnly),
    duck: bool(raw.duck, d.duck),
    keepScreenOn: bool(raw.keepScreenOn, d.keepScreenOn),
  };
}

function readRoom(raw: Record<string, unknown>): RoomVoice {
  const volumes: Record<string, number> = {};
  if (typeof raw.volumes === "object" && raw.volumes !== null) {
    for (const [id, v] of Object.entries(raw.volumes)) if (typeof v === "number" && Number.isFinite(v)) volumes[id] = v;
  }
  const blocked = Array.isArray(raw.blocked) ? raw.blocked.filter((id): id is string => typeof id === "string") : [];
  const mic: RoomMic = raw.mic === "muted" || raw.mic === "off" ? raw.mic : "on";
  return { on: bool(raw.on, false), mic, volumes, blocked };
}

export function voicePrefs(store: KeyValue = DEFAULT_STORE) {
  const get = (): VoicePrefs => readPrefs(parse(store.read(PREFS_KEY)));
  const room = (code: string): RoomVoice => readRoom(parse(store.read(ROOM_PREFIX + code)));

  /** Marks `code` as the newest room and forgets rooms past the cap. */
  const touch = (code: string): void => {
    let codes: string[] = [];
    try {
      const v: unknown = JSON.parse(store.read(INDEX_KEY) ?? "[]");
      if (Array.isArray(v)) codes = v.filter((c): c is string => typeof c === "string");
    } catch {
      // A bad index starts over.
    }
    // Already the newest: nothing to write (a volume slider writes often).
    if (codes[codes.length - 1] === code) return;
    codes = codes.filter((c) => c !== code);
    codes.push(code);
    while (codes.length > MAX_ROOMS) store.write(ROOM_PREFIX + codes.shift()!, null);
    store.write(INDEX_KEY, JSON.stringify(codes));
  };

  return {
    get,
    set(patch: Partial<VoicePrefs>): VoicePrefs {
      const next = readPrefs({ ...get(), ...patch });
      store.write(PREFS_KEY, JSON.stringify(next));
      return next;
    },
    room,
    setRoom(code: string, patch: Partial<RoomVoice>): RoomVoice {
      const next = readRoom({ ...room(code), ...patch });
      store.write(ROOM_PREFIX + code, JSON.stringify(next));
      touch(code);
      return next;
    },
  };
}
