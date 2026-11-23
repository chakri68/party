import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, TARGET_OPTIONS, type OverheatSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const overheatRules: string[] = [
  "Each round has a heat limit. Everyone can see it.",
  "On your turn, flip a card or save.",
  "A number card adds its number to your heat and to your points.",
  "If your heat goes over the limit, you are too hot. You get 0 points for the round.",
  "Save to keep your points. After you save, other players' cards can't hurt you.",
  "If your heat is exactly the limit, that is Perfect: you get 10 extra points and save.",
  "3 cards of one colour: +5. All 4 colours: +5.",
  "Power cards: Cool (heat −5), Double (your next number card counts double), Push (a player gets the next card), Swap (swap a card with a player), Burn (a player gets +1 heat at the start of each of their turns), Limit down (the limit goes down by 3 for everyone still flipping).",
  "The first player to reach the target score at the end of a round wins.",
];

/** What the lobby shows (and the host can change) before a game. */
export function overheatSettingFields(raw: unknown, _players: number): SettingField[] {
  const s: OverheatSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<OverheatSettings> | null) };
  return [
    {
      key: "target",
      label: "Target",
      selected: Math.max(0, (TARGET_OPTIONS as readonly number[]).indexOf(s.target)),
      options: TARGET_OPTIONS.map((t) => ({ label: String(t), patch: { target: t } })),
      hint: `First to ${s.target} points at the end of a round`,
    },
    {
      key: "powers",
      label: "Power cards",
      selected: s.powers === "off" ? 0 : 1,
      options: [
        { label: "Off", patch: { powers: "off" } },
        { label: "Classic", patch: { powers: "classic" } },
      ],
      hint: s.powers === "off" ? "Only number cards. Pure luck." : "16 power cards in the deck",
    },
  ];
}
