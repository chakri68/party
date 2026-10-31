import type { SettingField } from "@games/game-core";
import { formatPoints } from "./rules.ts";
import { DEFAULT_SETTINGS, ENTRY_OPTIONS, TARGET_OPTIONS, THREE_FARKLE_PENALTY, type FarkleSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const farkleRules: string[] = [
  "On your turn, roll all 6 dice.",
  "Keep at least 1 die that scores from that roll.",
  "You can join dice into a scoring set. The dice must come from the same roll.",
  "Then roll the other dice again.",
  "Or bank: add your points for this turn to your score. Your turn ends.",
  "If no dice score on a roll, that is a farkle. You lose your points for this turn. Your turn ends.",
  "If all 6 dice score, you have hot dice. Roll all 6 dice again and keep adding points.",
  "One 1: 100. One 5: 50. Three 1s: 1,000. Three of a kind: the face × 100.",
  "Four of a kind: 1,000. Five of a kind: 2,000. Six of a kind: 3,000.",
  "1 to 6 in a row: 1,500. Three pairs: 1,500. Two sets of three: 2,500.",
  "A player banks and reaches the target. Then every other player gets 1 more turn.",
  "The highest score wins. If players tie, they share the win.",
];

/** What the lobby shows (and the host can change) before a game. */
export function farkleSettingFields(raw: unknown, _players: number): SettingField[] {
  const s: FarkleSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<FarkleSettings> | null) };
  return [
    {
      key: "target",
      label: "Target",
      selected: Math.max(0, (TARGET_OPTIONS as readonly number[]).indexOf(s.target)),
      options: TARGET_OPTIONS.map((t) => ({ label: formatPoints(t), patch: { target: t } })),
      hint: s.target === 10000 ? "The normal game length" : "A shorter game",
    },
    {
      key: "entry",
      label: "Points to start",
      selected: Math.max(0, (ENTRY_OPTIONS as readonly number[]).indexOf(s.entry)),
      options: ENTRY_OPTIONS.map((e) => ({ label: e ? formatPoints(e) : "Off", patch: { entry: e } })),
      hint: s.entry ? `You must bank ${formatPoints(s.entry)} or more first` : "Every score counts from the start",
    },
    {
      key: "threeFarkles",
      label: "Three farkles",
      selected: s.threeFarkles ? 1 : 0,
      options: [
        { label: "Off", patch: { threeFarkles: false } },
        { label: `−${THREE_FARKLE_PENALTY}`, patch: { threeFarkles: true } },
      ],
      hint: s.threeFarkles ? `3 farkles in a row: you lose ${THREE_FARKLE_PENALTY}` : "A farkle loses only the points for that turn",
    },
  ];
}
