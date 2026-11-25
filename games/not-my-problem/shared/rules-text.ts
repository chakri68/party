import type { SettingField } from "@games/game-core";
import { ACTION_TEXT, PROBLEM_TEXT, copiesFor, problemCount } from "./cards.ts";
import { DEFAULT_SETTINGS, HAND_SIZE, REACTION_SECONDS_OPTIONS, type ActionKind, type NmpSettings, type ProblemKind } from "./types.ts";

const CARD_ORDER: ActionKind[] = [
  "quick-fix", "blame-game", "not-me", "revenge", "hr-complaint",
  "fake-report", "overtime", "intern", "promotion", "spy",
];
const PROBLEM_ORDER: ProblemKind[] = ["server-down", "data-leak", "angry-client"];

/** Plain-language rules for the lobby's Rules button. */
export const notMyProblemRules: string[] = [
  "You start with five cards and no warnings. Three warnings and you are fired.",
  "On your turn, you can play up to two cards. Then draw one card. Drawing ends your turn.",
  "If you draw a Problem, fix it or pass it to someone else. They can push back, and other players can step in.",
  "If nobody fixes a Problem, the player who holds it gets the warnings on it.",
  "The last player who is not fired wins. If the cards run out first, the player with the fewest warnings wins.",
  ...CARD_ORDER.map((k) => `${ACTION_TEXT[k].name}: ${ACTION_TEXT[k].line}`),
  ...PROBLEM_ORDER.map((k) => `${PROBLEM_TEXT[k].name}: ${PROBLEM_TEXT[k].line}`),
];

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
      selected: Math.max(0, (REACTION_SECONDS_OPTIONS as readonly number[]).indexOf(settings.reactionSeconds)),
      options: REACTION_SECONDS_OPTIONS.map((s) => ({ label: `${s} seconds`, patch: { reactionSeconds: s } })),
      hint: `${problemCount(n)} Problems in ${pile} cards`,
    },
  ];
}
