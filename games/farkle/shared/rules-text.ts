import type { SettingField } from "@games/game-core";
import { formatPoints } from "./rules.ts";
import { DEFAULT_SETTINGS, ENTRY_OPTIONS, TARGET_OPTIONS, THREE_FARKLE_PENALTY, type FarkleSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const farkleRules: string[] = [
  "On your turn, roll all six dice.",
  "Set aside at least one scoring die or combination from that roll. Only dice from the same roll combine.",
  "Then roll what's left, or bank the turn total into your score.",
  "Roll nothing that scores and it's a farkle: the turn total is gone and the turn's over.",
  "Set aside all six and you've got hot dice: roll all six again and keep adding.",
  "Single 1: 100. Single 5: 50. Three 1s: 1,000. Three of a kind: face × 100. Four of a kind: 1,000. Five: 2,000. Six: 3,000.",
  "Straight 1–6: 1,500. Three pairs: 1,500. Two triples: 2,500.",
  "Bank to the target or past it and everyone else gets one more turn. Highest score wins; ties share it.",
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
      hint: s.target === 10000 ? "The traditional length" : "A party-sized game",
    },
    {
      key: "entry",
      label: "Entry threshold",
      selected: Math.max(0, (ENTRY_OPTIONS as readonly number[]).indexOf(s.entry)),
      options: ENTRY_OPTIONS.map((e) => ({ label: e ? formatPoints(e) : "Off", patch: { entry: e } })),
      hint: s.entry ? `Your first bank must be ${formatPoints(s.entry)} or more` : "Any bank gets you on the board",
    },
    {
      key: "threeFarkles",
      label: "Three farkles",
      selected: s.threeFarkles ? 1 : 0,
      options: [
        { label: "Off", patch: { threeFarkles: false } },
        { label: `−${THREE_FARKLE_PENALTY}`, patch: { threeFarkles: true } },
      ],
      hint: s.threeFarkles ? `Three busts in a row cost ${THREE_FARKLE_PENALTY}` : "Busting costs the turn, nothing more",
    },
  ];
}
