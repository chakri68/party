import type { SettingField } from "@games/game-core";
import { biggestHand, buildSchedule } from "./rules.ts";
import { DEFAULT_SETTINGS, type BiggestSetting, type OhHellSettings, type ScheduleShape } from "./types.ts";

/** Plain-language rules for the lobby's Rules button. Also known as Oh Pshaw, or Up and Down the River. */
export const ohHellRules: string[] = [
  "Each round everyone gets the same number of cards. The hand size goes up and down over the game: 1, 2, 3 … then back down.",
  "After the deal, the next card is turned up. Its suit is trump for the round.",
  "Starting left of the dealer, everyone bids how many tricks they'll take. The dealer goes last and can't pick the number that makes the bids add up to the cards in hand, so someone has to miss.",
  "Left of the dealer leads. You must follow the suit led if you can. If you can't, play anything, trump included.",
  "The highest trump takes the trick. No trump? The highest card of the suit led. Aces are high. Whoever takes it leads next.",
  "Take exactly what you bid and score 10 plus your bid. One more or one fewer scores nothing.",
  "After the last round, the highest total wins.",
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
        label: b === "max" ? `Most the deck allows (${biggestHand("max", n)})` : `${b} cards`,
        patch: { biggest: b },
      })),
      hint: `${rounds} rounds${capped ? ` · capped at ${big} for ${n} players` : ""}`,
    },
    {
      key: "dealerRule",
      label: "Dealer's restriction",
      selected: s.dealerRule ? 0 : 1,
      options: [
        { label: "On", patch: { dealerRule: true } },
        { label: "Off", patch: { dealerRule: false } },
      ],
      hint: s.dealerRule ? "Bids can't add up to the cards in hand: someone has to miss" : "Everyone can make it, in theory",
    },
    {
      key: "missing",
      label: "Missing a bid",
      selected: s.missing === "zero" ? 0 : 1,
      options: [
        { label: "Scores 0", patch: { missing: "zero" } },
        { label: "Costs the difference", patch: { missing: "difference" } },
      ],
      hint: s.missing === "zero" ? "Exactly right or nothing" : "Bid 2, take 4: minus 2",
    },
  ];
}
