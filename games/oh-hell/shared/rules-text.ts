import type { SettingField } from "@games/game-core";
import { biggestHand, buildSchedule } from "./rules.ts";
import { DEFAULT_SETTINGS, type BiggestSetting, type OhHellSettings, type ScheduleShape } from "./types.ts";

/** Plain-language rules for the lobby's Rules button. Also known as Oh Pshaw, or Up and Down the River. */
export const ohHellRules: string[] = [
  "Each round, every player gets the same number of cards.",
  "The number of cards goes up and down over the game: 1, 2, 3 … then back down.",
  "After the deal, the game turns 1 card face up.",
  "The suit of this card is trump for the round. Trump is the suit that beats all other suits.",
  "A trick is 1 card from each player. The best card wins the trick.",
  "Before play, each player bids. To bid, you say how many tricks you will win.",
  "The player left of the dealer bids first. The dealer bids last.",
  "The dealer must choose a bid that makes the total different from the cards in hand. So at least 1 player will be wrong.",
  "The player left of the dealer plays the first card.",
  "You must play the same suit as the first card if you can. This is called following suit.",
  "If you can't follow suit, play any card. You can play a trump.",
  "The highest trump wins the trick.",
  "If nobody plays a trump, the highest card of the first suit wins the trick.",
  "Aces are high.",
  "The winner of a trick plays the first card of the next trick.",
  "If you win exactly your bid, you score 10 points plus your bid.",
  "If you win more or fewer tricks than your bid, you score 0.",
  "After the last round, the player with the most points wins.",
];

const SHAPES: readonly ScheduleShape[] = ["up-down", "down", "up"];
const BIGGEST: readonly BiggestSetting[] = [7, 10, "max"];

/** What the lobby shows (and the host can change) before a game. */
export function ohHellSettingFields(raw: unknown, players: number): SettingField[] {
  const s: OhHellSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<OhHellSettings> | null) };
  const n = Math.min(Math.max(players, 3), 7);
  const big = biggestHand(s.biggest, n);
  const rounds = buildSchedule(s.schedule, big).length;
  const capped = s.biggest !== "max" && big < s.biggest;
  const shapeHint = s.schedule === "up-down" ? `1 → ${big} → 1` : s.schedule === "down" ? `${big} → 1` : `1 → ${big}`;
  return [
    {
      key: "schedule",
      label: "Schedule",
      selected: Math.max(0, SHAPES.indexOf(s.schedule)),
      options: [
        { label: "Up and down", patch: { schedule: "up-down" } },
        { label: "Down only", patch: { schedule: "down" } },
        { label: "Up only", patch: { schedule: "up" } },
      ],
      hint: `Cards per hand: ${shapeHint}`,
    },
    {
      key: "biggest",
      label: "Biggest hand",
      selected: Math.max(0, BIGGEST.indexOf(s.biggest)),
      options: BIGGEST.map((b) => ({
        label: b === "max" ? `Max (${biggestHand("max", n)})` : `${b} cards`,
        patch: { biggest: b },
      })),
      hint: `${rounds} rounds${capped ? ` · max ${big} for ${n} players` : ""}`,
    },
    {
      key: "dealerRule",
      label: "Dealer rule",
      selected: s.dealerRule ? 0 : 1,
      options: [
        { label: "On", patch: { dealerRule: true } },
        { label: "Off", patch: { dealerRule: false } },
      ],
      hint: s.dealerRule ? "The dealer can't make the total bid equal the cards. 1 player will be wrong." : "The total bid can be any number",
    },
    {
      key: "missing",
      label: "Wrong bid",
      selected: s.missing === "zero" ? 0 : 1,
      options: [
        { label: "Scores 0", patch: { missing: "zero" } },
        { label: "Lose the difference", patch: { missing: "difference" } },
      ],
      hint: s.missing === "zero" ? "Only an exact bid scores" : "Bid 2, win 4: you lose 2 points",
    },
  ];
}
