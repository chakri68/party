import type { SettingField } from "@games/game-core";
import { deckSettingFields, parseDeckSettings } from "@games/hidden-roles";
import { DECK_RULES, PRESETS, ROLES } from "./roles.ts";
import { DEFAULT_SETTINGS, DISCUSS_OPTIONS, NIGHT_OPTIONS, type NightfallSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const nightfallRules: string[] = [
  "Everyone gets one secret card. Most of you are village; a few are Wolves, and the Wolves know each other.",
  ...ROLES.map((r) => `${r.label}: ${r.blurb}`),
  "Night: every living player picks someone on their phone, whatever their card, so nobody can tell who's really acting. Only the Wolves', the Watcher's and the Keeper's picks count. The night always runs its full time.",
  "The Wolves' most-picked player is taken, unless the Keeper sheltered them. A tie between picks is settled by a coin the server flips. If no Wolf picks, nobody's taken.",
  "Dawn: the village hears who was taken (or that nobody was) and which team they were on. Never their card.",
  "Day: talk it out, then vote. Everyone alive votes for someone else, or skips. Most votes is out, and their team is announced. A tie goes to a 20-second runoff between the tied; still tied, nobody goes.",
  "The village wins when no Wolves are left alive. The Wolves win once they're at least as many as everyone else alive.",
  "Out of the game? Watch, and keep what you know to yourself.",
  "Someone who leaves mid-game is out of both sides' counts from the next phase. If that leaves a side with nobody, the game ends with no winner.",
];

/** Settings from whatever the room holds. Null: something's off. */
export function parseNightfallSettings(input: unknown): NightfallSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const raw = { ...DEFAULT_SETTINGS, ...(input as Record<string, unknown>) };
  const deck = parseDeckSettings(raw, [...ROLES], PRESETS);
  if (!deck) return null;
  const { discussMinutes, nightSeconds } = raw as Record<string, unknown>;
  if (typeof discussMinutes !== "number" || !DISCUSS_OPTIONS.includes(discussMinutes)) return null;
  if (typeof nightSeconds !== "number" || !NIGHT_OPTIONS.includes(nightSeconds)) return null;
  return { ...deck, discussMinutes, nightSeconds };
}

/** What the lobby shows (and the host can change), for this head count. */
export function nightfallSettingFields(raw: unknown, players: number): SettingField[] {
  const settings = parseNightfallSettings(raw) ?? DEFAULT_SETTINGS;
  return [
    ...deckSettingFields(settings, [...ROLES], PRESETS, DECK_RULES, players),
    {
      key: "discussMinutes",
      label: "Talking time",
      selected: Math.max(0, DISCUSS_OPTIONS.indexOf(settings.discussMinutes)),
      options: DISCUSS_OPTIONS.map((n) => ({ label: `${n} min`, patch: { discussMinutes: n } })),
      hint: "Each day. The host can call the vote early",
    },
    {
      key: "nightSeconds",
      label: "Night",
      selected: Math.max(0, NIGHT_OPTIONS.indexOf(settings.nightSeconds)),
      options: NIGHT_OPTIONS.map((n) => ({ label: `${n} s`, patch: { nightSeconds: n } })),
    },
  ];
}
