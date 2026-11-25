import type { SettingField } from "@games/game-core";
import { ACTION_TEXT, PROBLEM_TEXT, copiesFor, problemCount } from "./cards.ts";
import {
  ACTION_KINDS,
  DEFAULT_SETTINGS,
  HAND_SIZE,
  PROBLEM_KINDS,
  REACTION_SECONDS_OPTIONS,
  type NmpSettings,
} from "./types.ts";

/** The quick-start rules, without the card list. The in-game Rules sheet lists the cards in groups. */
export const notMyProblemQuickRules: string[] = [
  "You start with five cards and no warnings.",
  "Three warnings and you are fired.",
  "On your turn, you can play up to two cards. Then draw one card.",
  "Drawing ends your turn.",
  "If you draw a Problem, fix it or pass it to someone else.",
  "They can send it back, and other players can play cards too.",
  "If nobody fixes a Problem, the player who holds it gets the warnings on it.",
  "The last player who is not fired wins.",
  "If the cards run out first, the player with the fewest warnings wins.",
];

/** Plain-language rules for the lobby's Rules button. */
export const notMyProblemRules: string[] = [
  ...notMyProblemQuickRules,
  ...ACTION_KINDS.map((k) => `${ACTION_TEXT[k].name}: ${ACTION_TEXT[k].line}`),
  ...PROBLEM_KINDS.map((k) => `${PROBLEM_TEXT[k].name}: ${PROBLEM_TEXT[k].line}`),
];

function optionIndex(seconds: number): number {
  const options = REACTION_SECONDS_OPTIONS as readonly number[];
  const i = options.indexOf(seconds);
  return i >= 0 ? i : options.indexOf(DEFAULT_SETTINGS.reactionSeconds);
}

/** What the lobby shows (and the host can change) before a game. */
export function notMyProblemSettingFields(raw: unknown, players: number): SettingField[] {
  const settings: NmpSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<NmpSettings> | null) };
  const n = Math.max(players, 3);
  const actions = Object.values(copiesFor(n)).reduce((a, b) => a + b, 0);
  const pile = actions + problemCount(n) - HAND_SIZE * n;
  return [
    {
      key: "reactionSeconds",
      label: "Time to react",
      selected: optionIndex(settings.reactionSeconds),
      options: REACTION_SECONDS_OPTIONS.map((s) => ({ label: `${s} seconds`, patch: { reactionSeconds: s } })),
      hint: `${problemCount(n)} Problems in ${pile} cards`,
    },
  ];
}
