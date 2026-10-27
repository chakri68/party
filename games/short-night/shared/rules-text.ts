import type { SettingField } from "@games/game-core";
import { deckSettingFields, parseDeckSettings } from "@games/hidden-roles";
import { DECK_RULES, deckOf, nightSteps, PRESETS, ROLES } from "./roles.ts";
import { DEFAULT_SETTINGS, DISCUSS_OPTIONS, type ShortNightSettings, STEP_OPTIONS } from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const shortNightRules: string[] = [
  "Everyone gets one secret card. Most of you are village; one or two are Wolves.",
  "Then one night. Every role that acts gets its own short step, in this order: Wolf, Lamplighter, Matchmaker, Bellringer, Eavesdropper, Wanderer. Only the roles in the deck get a step, and every step runs its full time, so the clock gives nothing away.",
  "Everyone picks on every step, whatever their card: only the picks of the card that's awake count. That way nobody can tell whose turn it really is.",
  ...ROLES.map((r) => `${r.label}: ${r.blurb}`),
  "\"Reads as a wolf\" means a Wolf or the Stray: the Lamplighter, Matchmaker, Bellringer and Eavesdropper can't tell them apart. The Wanderer and a lone Wolf see the real card.",
  "Whatever you learn at night is true, and stays true: nobody's card ever changes.",
  "Then talk, out loud, for a few minutes. Claim what you like. Wolves lie.",
  "Then everyone votes for one other player, or for nobody. Nobody wins only with more votes than every player. A tie between players goes to a 10-second runoff; still tied, nobody goes.",
  "Vote out a Wolf and the village wins. Anything else, the Wolves win.",
];

/** Settings from whatever the room holds. Null: something's off. */
export function parseShortNightSettings(input: unknown): ShortNightSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const raw = { ...DEFAULT_SETTINGS, ...(input as Record<string, unknown>) };
  const deck = parseDeckSettings(raw, [...ROLES], PRESETS);
  if (!deck) return null;
  const { discussMinutes, stepSeconds } = raw as Record<string, unknown>;
  if (typeof discussMinutes !== "number" || !DISCUSS_OPTIONS.includes(discussMinutes)) return null;
  if (typeof stepSeconds !== "number" || !STEP_OPTIONS.includes(stepSeconds)) return null;
  return { ...deck, discussMinutes, stepSeconds };
}

/** What the lobby shows (and the host can change), for this head count. */
export function shortNightSettingFields(raw: unknown, players: number): SettingField[] {
  const settings = parseShortNightSettings(raw) ?? DEFAULT_SETTINGS;
  const steps = nightSteps(deckOf(settings, players)).length;
  return [
    ...deckSettingFields(settings, [...ROLES], PRESETS, DECK_RULES, players),
    {
      key: "discussMinutes",
      label: "Talking time",
      selected: Math.max(0, DISCUSS_OPTIONS.indexOf(settings.discussMinutes)),
      options: DISCUSS_OPTIONS.map((n) => ({ label: `${n} min`, patch: { discussMinutes: n } })),
      hint: "The host can call the vote early",
    },
    {
      key: "stepSeconds",
      label: "Night step",
      selected: Math.max(0, STEP_OPTIONS.indexOf(settings.stepSeconds)),
      options: STEP_OPTIONS.map((n) => ({ label: `${n} s`, patch: { stepSeconds: n } })),
      hint: `${steps} ${steps === 1 ? "step" : "steps"}, ${steps * settings.stepSeconds} s of night`,
    },
  ];
}
