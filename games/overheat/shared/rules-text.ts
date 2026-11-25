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

/** Rules the lobby shows when Cutthroat is picked. */
export const cutthroatRules: string[] = [
  ...overheatRules.slice(0, 6),
  "In Cutthroat, you may keep up to 3 power cards in your hand. Play one on your turn, before you flip or save.",
  "Cool, Double, Push, Swap, Burn and Limit down work as in Classic.",
  "Steal: take a number card from a player. Dump: give your last card to a player. Audit: a player loses their best card. Block: cancel a card played on you.",
  "If you make the leader go too hot, you get 5 bonus points.",
  overheatRules[overheatRules.length - 1]!,
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
      selected: s.powers === "off" ? 0 : s.powers === "classic" ? 1 : 2,
      options: [
        { label: "Off", patch: { powers: "off" } },
        { label: "Classic", patch: { powers: "classic" } },
        { label: "Cutthroat", patch: { powers: "cutthroat" } },
      ],
      hint:
        s.powers === "off"
          ? "Only number cards. Pure luck."
          : s.powers === "classic"
            ? "16 power cards in the deck"
            : "26 power cards. Keep them and play them on others.",
    },
  ];
}
