import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, type WildsSettings } from "./types.ts";

export const MIN_PLAYERS = 2,
  MAX_PLAYERS = 6;

const SUN_LIMITS: { value: WildsSettings["sunLimit"]; label: string }[] = [
  { value: 8, label: "8 (hard)" },
  { value: 10, label: "10" },
  { value: 12, label: "12 (easy)" },
];

const PLAN_SECONDS: WildsSettings["planSeconds"][] = [30, 45, 60];

/** Settings from whatever the room holds. Null: something's off. */
export function parseWildsSettings(input: unknown): WildsSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const raw = { ...DEFAULT_SETTINGS, ...(input as Record<string, unknown>) };
  if (!SUN_LIMITS.some((s) => s.value === raw.sunLimit)) return null;
  if (!PLAN_SECONDS.some((s) => s === raw.planSeconds)) return null;
  return { sunLimit: raw.sunLimit as WildsSettings["sunLimit"], planSeconds: raw.planSeconds as WildsSettings["planSeconds"] };
}

/** What the lobby shows (and the host can change). */
export function wildsSettingFields(raw: unknown, _players: number): SettingField[] {
  const settings = parseWildsSettings(raw) ?? DEFAULT_SETTINGS;
  return [
    {
      key: "sunLimit",
      label: "Sun limit",
      selected: Math.max(0, SUN_LIMITS.findIndex((s) => s.value === settings.sunLimit)),
      options: SUN_LIMITS.map((s) => ({ label: s.label, patch: { sunLimit: s.value } })),
      hint: `The sun goes down after ${settings.sunLimit} rounds.`,
    },
    {
      key: "planSeconds",
      label: "Plan time",
      selected: Math.max(0, PLAN_SECONDS.indexOf(settings.planSeconds)),
      options: PLAN_SECONDS.map((s) => ({ label: `${s} s`, patch: { planSeconds: s } })),
      hint: "Time to plan each round.",
    },
  ];
}

/** Every setting fits every table size. */
export function setupProblem(_settings: WildsSettings, _players: number): string | null {
  return null;
}
