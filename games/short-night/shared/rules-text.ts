import type { SettingField } from "@games/game-core";
import { deckSettingFields, parseDeckSettings } from "@games/hidden-roles";
import { DECK_RULES, deckOf, nightSteps, PRESETS, ROLES } from "./roles.ts";
import { DEFAULT_SETTINGS, DISCUSS_OPTIONS, type ShortNightSettings, STEP_OPTIONS } from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const shortNightRules: string[] = [
  "Each player gets 1 secret card. Most players are in the Village team. The deck has 1 to 3 Wolves.",
  "Then there is 1 night. The night has a short step for each card with a night power.",
  "The steps go in this order: Wolf, Lamplighter, Matchmaker, Bellringer, Eavesdropper, Wanderer. Only the cards in the deck get a step.",
  "Every step lasts its full time. So nobody learns anything from the timer.",
  "In every step, every player chooses on their phone. Only the choices of the card in that step count. So nobody can tell whose turn it is.",
  ...ROLES.map((r) => `${r.label}: ${r.blurb}`),
  "\"Reads as a wolf\" means a Wolf or the Stray. The Lamplighter, Matchmaker, Bellringer and Eavesdropper see Wolves and the Stray the same way.",
  "The Wanderer sees the real card. A Wolf with no other Wolves also sees the real card.",
  "Everything you learn at night is true. The cards never change.",
  "Then everyone talks out loud for a few minutes. You can say anything. Wolves will lie.",
  "Then everyone votes for 1 other player, or for nobody.",
  "If nobody gets a vote, nobody is out. If \"nobody\" gets more votes than every player, nobody is out.",
  "If 2 or more players tie, everyone votes again for 10 seconds. If they still tie, nobody is out.",
  "If the vote puts a Wolf out, the Village team wins. If not, the Wolves win.",
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
      hint: "The host can start the vote early",
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
