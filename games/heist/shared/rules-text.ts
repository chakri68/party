import type { SettingField } from "@games/game-core";
import { BUDGET, crewSizes, MAX_HEAT, MAX_PLAYERS, MIN_PLAYERS, moleRange, molesFor, setupProblem, TO_WIN } from "./rules.ts";
import { DEFAULT_SETTINGS, type HeistSettings, type MoleShift, type PresetId, TIMERS } from "./types.ts";

/** Plain-language rules for the lobby's Rules button. */
export const heistRules: string[] = [
  "Each player gets a secret card: crew or mole.",
  "Moles know the other moles. Crew players know only their own card.",
  "The game has 5 jobs.",
  "For each job, the leader chooses a team. The job shows the team size. The leader can choose themselves.",
  "Then every player votes Go or No-go.",
  "More than half the players must vote Go. A tie counts as No-go.",
  "When the vote ends, every player sees all the votes.",
  "On a job, each team member plays 1 card face down: Clean or Sabotage.",
  "Every player has both cards. So all screens look the same.",
  "Only a mole's Sabotage card counts. A crew player's Sabotage card counts as Clean.",
  "If the team plays 1 Sabotage card, the job fails.",
  "Every player sees the number of Sabotage cards. Nobody sees who played them.",
  `Each mole has ${BUDGET} Sabotage cards for the whole game. Use them carefully.`,
  "Each failed vote adds 1 heat.",
  `At ${MAX_HEAT} heat, the moles win the job. Heat goes back to 0 after each job.`,
  "After each vote, the next player becomes the leader.",
  `The first side to win ${TO_WIN} jobs wins the game.`,
  "If time runs out, the game chooses for you.",
  "A leader with no team counts as a failed vote. A missing vote counts as No-go. A missing card counts as Clean.",
];

const PRESETS: { id: PresetId; label: string }[] = [
  { id: "beginner", label: "Beginner" },
  { id: "standard", label: "Standard" },
  { id: "fast", label: "Fast" },
];

/**
 * In lobby order. "fewer" only fits from 7, so it shows only there or when it's
 * already set. No "one more": with at least two moles and fewer moles than
 * crew, usual + 1 never fits any table (design ruling 2).
 */
const SHIFTS: MoleShift[] = ["usual", "fewer"];

/** Settings from whatever the room holds. Null: something's off. */
export function parseHeistSettings(input: unknown): HeistSettings | null {
  if (input === undefined || input === null) return { ...DEFAULT_SETTINGS };
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const raw = { ...DEFAULT_SETTINGS, ...(input as Record<string, unknown>) };
  if (!PRESETS.some((p) => p.id === raw.preset)) return null;
  if (!SHIFTS.includes(raw.moles as MoleShift)) return null;
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
    const name = s === "usual" ? "Usual" : "One fewer";
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
      label: "Speed",
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
