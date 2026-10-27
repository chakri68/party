import type { SettingField } from "@games/game-core";
import { BUDGET, crewSizes, MAX_HEAT, MAX_PLAYERS, MIN_PLAYERS, moleRange, molesFor, setupProblem, TO_WIN } from "./rules.ts";
import { DEFAULT_SETTINGS, type HeistSettings, type MoleShift, type PresetId, TIMERS } from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const heistRules: string[] = [
  "Everyone gets a secret card: crew or mole. Moles see who the other moles are; crew know only themselves.",
  `Five jobs. For each, the leader picks a crew of the job's size (themselves allowed), and everyone votes Go or No-go. More than half the table must say Go; a tie fails. When the vote closes, everyone's vote is shown.`,
  "On a job, each crew member plays one card, face down. Everyone gets both cards, Clean and Sabotage, so no screen looks different. A mole's Sabotage counts; anyone else's does nothing and plays as Clean. One Sabotage and the job fails. The table sees how many Sabotage cards went in, never whose.",
  `Each mole gets ${BUDGET} Sabotage cards for the whole game. Spend them wisely.`,
  `Every failed vote adds heat. At ${MAX_HEAT} heat the job is lost to the moles. Heat cools after every job.`,
  "The leader moves one seat on after every proposal, whether it passed or not.",
  `First side to ${TO_WIN} jobs wins.`,
  "Run out of time and the game decides for you: a leader who doesn't propose is a failed vote, a missing vote is No-go, a missing card is Clean.",
];

const PRESETS: { id: PresetId; label: string }[] = [
  { id: "beginner", label: "Beginner" },
  { id: "standard", label: "Standard" },
  { id: "fast", label: "Fast" },
];

/**
 * In lobby order. "more" never fits (design ruling 2) and "fewer" only from 7,
 * so each shows only where it fits or is already set.
 */
const SHIFTS: MoleShift[] = ["usual", "fewer", "more"];
const SHIFT_PARSE: readonly MoleShift[] = ["fewer", "usual", "more"];

/** Settings from whatever the room holds. Null: something's off. */
export function parseHeistSettings(input: unknown): HeistSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const raw = { ...DEFAULT_SETTINGS, ...(input as Record<string, unknown>) };
  if (!PRESETS.some((p) => p.id === raw.preset)) return null;
  if (!SHIFT_PARSE.includes(raw.moles as MoleShift)) return null;
  return { preset: raw.preset as PresetId, moles: raw.moles as MoleShift };
}

const secs = (ms: number) => `${ms / 1000} s`;

/** What the lobby shows (and the host can change), for this head count. */
export function heistSettingFields(raw: unknown, players: number): SettingField[] {
  const settings = parseHeistSettings(raw) ?? DEFAULT_SETTINGS;
  const t = TIMERS[settings.preset];
  // Counts only mean something for a table that can play; below that, no numbers.
  const n = players;
  const sized = n >= MIN_PLAYERS && n <= MAX_PLAYERS;
  const count = (shift: MoleShift) => molesFor({ ...settings, moles: shift }, n);
  const fits = (shift: MoleShift) => sized && setupProblem({ ...settings, moles: shift }, n) === null;
  // "One fewer" only where it fits, unless it's what's set: the row must show it.
  const shifts = SHIFTS.filter((s) => s === "usual" || s === settings.moles || fits(s));
  const label = (s: MoleShift) => {
    const name = s === "usual" ? "Usual" : s === "fewer" ? "One fewer" : "One more";
    return sized ? `${name} (${count(s)})` : name;
  };
  const [lo, hi] = moleRange(n);
  // The lobby prints a setup problem on its own line; the hint doesn't repeat it.
  const hint = !sized
    ? "2 at 5–6 players, 3 at 7–8, 4 at 9–10"
    : !fits(settings.moles)
      ? `Usual is ${count("usual")} for ${n} players`
      : `${count(settings.moles)} of ${n}${lo === hi ? "" : `, ${lo}–${hi} allowed`}. Crews: ${crewSizes(n).join(", ")}`;
  return [
    {
      key: "preset",
      label: "Pace",
      selected: Math.max(0, PRESETS.findIndex((p) => p.id === settings.preset)),
      options: PRESETS.map((p) => ({ label: p.label, patch: { preset: p.id } })),
      hint: `Leader ${secs(t.leaderMs)}, vote ${secs(t.voteMs)}, card ${secs(t.cardMs)}`,
    },
    {
      key: "moles",
      label: "Moles",
      selected: Math.max(0, shifts.indexOf(settings.moles)),
      options: shifts.map((s) => ({ label: label(s), patch: { moles: s } })),
      hint,
    },
  ];
}
