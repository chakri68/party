import type { SettingField } from "@games/game-core";
import { POWER_LINES } from "./rules.ts";
import { BOUNTY, CLASSIC_POWERS, DEFAULT_SETTINGS, HAND_MAX, POWERS, TARGET_OPTIONS, type OverheatSettings, type PowerKind } from "./types.ts";

const CUTTHROAT_ONLY: PowerKind[] = POWERS.filter((p) => !(CLASSIC_POWERS as readonly PowerKind[]).includes(p));

/** Plain-language rules for the lobby's Rules button: every mode, each part says which. */
export const overheatRules: string[] = [
  "Each round has a heat limit. Everyone can see it.",
  "On your turn, flip a card or save.",
  "A number card adds its number to your heat and to your points.",
  "If your heat goes over the limit, you are too hot. You get 0 points for the round.",
  "Save to keep your points.",
  "If your heat is exactly the limit, that is Perfect: you get 10 extra points and save.",
  "3 cards of one colour: +5. All 4 colours: +5.",
  "The first player to reach the target score at the end of a round wins.",
  "Power cards: Off has none. Classic has 6 kinds. Cutthroat, the default, has 4 more.",
  ...CLASSIC_POWERS.map((p) => POWER_LINES[p]),
  ...CUTTHROAT_ONLY.map((p) => `${POWER_LINES[p]} (Cutthroat only.)`),
  "Classic: a power card works as soon as you flip it. After you save, other players' cards can't hurt you.",
  `Cutthroat: a power card you flip goes into your hand. You can hold up to ${HAND_MAX}. With a full hand, a new one works at once.`,
  "Cutthroat: on your turn, you may play one card from your hand before you flip or save.",
  "Cutthroat: after you save or go too hot, you still get turns while you hold cards. Play a card or pass.",
  "Cutthroat: Steal, Swap and Audit can reach a player who saved. Their score changes with their cards.",
  `Cutthroat: the player with the top score at the start of a round is the leader. Make the leader go too hot and you get ${BOUNTY} extra points.`,
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
