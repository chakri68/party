import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, type Length, type LongTrailSettings, type SettingId } from "./types.ts";

export const MIN_PLAYERS = 3,
  MAX_PLAYERS = 8;

const SETTINGS: { id: SettingId; label: string; hint: string }[] = [
  { id: "trade-route", label: "Trade route", hint: "Camels, desert and markets. Sell goods for a better grade." },
];

const LENGTHS: { id: Length; label: string; hint: string }[] = [
  { id: "short", label: "Short", hint: "5 stops, about 15 min" },
  { id: "normal", label: "Normal", hint: "8 stops, about 25 min" },
  { id: "epic", label: "Epic", hint: "12 stops, about 45 min" },
];

/** Settings from whatever the room holds. Null: something's off. */
export function parseLongTrailSettings(input: unknown): LongTrailSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const raw = { ...DEFAULT_SETTINGS, ...(input as Record<string, unknown>) };
  if (!SETTINGS.some((s) => s.id === raw.setting)) return null;
  if (!LENGTHS.some((l) => l.id === raw.length)) return null;
  return { setting: raw.setting as SettingId, length: raw.length as Length };
}

/** What the lobby shows (and the host can change). */
export function longTrailSettingFields(raw: unknown, _players: number): SettingField[] {
  const settings = parseLongTrailSettings(raw) ?? DEFAULT_SETTINGS;
  const setting = SETTINGS.find((s) => s.id === settings.setting)!;
  const length = LENGTHS.find((l) => l.id === settings.length)!;
  return [
    {
      key: "setting",
      label: "Setting",
      selected: Math.max(0, SETTINGS.findIndex((s) => s.id === settings.setting)),
      options: SETTINGS.map((s) => ({ label: s.label, patch: { setting: s.id } })),
      hint: setting.hint,
    },
    {
      key: "length",
      label: "Length",
      selected: Math.max(0, LENGTHS.findIndex((l) => l.id === settings.length)),
      options: LENGTHS.map((l) => ({ label: l.label, patch: { length: l.id } })),
      hint: length.hint,
    },
  ];
}

/** Every setting fits every table size in v1. */
export function setupProblem(_settings: LongTrailSettings, _players: number): string | null {
  return null;
}
