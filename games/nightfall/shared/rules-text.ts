import type { SettingField } from "@games/game-core";
import { deckSettingFields, parseDeckSettings } from "@games/hidden-roles";
import { DECK_RULES, PRESETS, ROLES } from "./roles.ts";
import { DEFAULT_SETTINGS, DISCUSS_OPTIONS, NIGHT_OPTIONS, type NightfallSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const nightfallRules: string[] = [
  "Each player gets 1 secret card. Most players are in the Village team. A few players are Wolves. The Wolves know each other.",
  ...ROLES.map((r) => `${r.label}: ${r.blurb}`),
  "Night: every player in the game chooses 1 player on their phone. Everyone chooses, so nobody can tell who has a power.",
  "At night, only the choices of the Wolves, the Watcher and the Keeper count. The night always lasts its full time.",
  "The Wolves attack the player most Wolves chose. That player is out of the game.",
  "The Keeper can save that player. If the Keeper protected the same player, the player stays in.",
  "If the Wolves' choices are tied, the game picks 1 of those players at random. If no Wolf chooses, the Wolves attack nobody.",
  "Dawn means morning. At dawn, everyone hears who the Wolves attacked. Everyone also hears that player's team. The game keeps that player's card secret.",
  "Day: first, everyone talks. Then every player in the game votes for another player, or skips.",
  "The player with the most votes is out. Everyone sees that player's team.",
  "If 2 or more players tie, everyone votes again for 20 seconds. You can vote only for the tied players. If they still tie, nobody is out.",
  "The Village team wins when no Wolves are left. The Wolves win when there are as many Wolves as other players, or more.",
  "If you are out, you can still watch. Do not tell anyone what you know.",
  "A player can leave during the game. From the next part of the game, that player does not count. If a team has no players left, the game ends. Nobody wins.",
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
      hint: "Time to talk each day. The host can start the vote early",
    },
    {
      key: "nightSeconds",
      label: "Night",
      selected: Math.max(0, NIGHT_OPTIONS.indexOf(settings.nightSeconds)),
      options: NIGHT_OPTIONS.map((n) => ({ label: `${n} s`, patch: { nightSeconds: n } })),
      hint: "Each night always lasts this long",
    },
  ];
}
