import type { SettingField } from "@games/game-core";
import { modesOf } from "./rules.ts";
import {
  DEFAULT_SETTINGS,
  FUSE_MS,
  FUSE_OPTIONS,
  LENGTH_MAX,
  LENGTH_MIN,
  LIVES_OPTIONS,
  UNKNOWN_OPTIONS,
  type BombModes,
  type PassTheBombSettings,
  type UnknownWords,
} from "./types.ts";
import { modesProblem, THIN_ANSWERS, VIABLE, viabilityKey } from "./viable.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const passTheBombRules: string[] = [
  "One of you holds a lit bomb with a few letters on it, like ING or TR.",
  "Type a real English word with those letters in it, together and in that order (SINGER, TRAIN). Get it right and the bomb goes to the next player, with new letters.",
  "Wrong word? Nothing happens. Keep trying: the fuse doesn't care.",
  "No word twice in a game, by anyone. Three letters at least, and no names.",
  "The fuse is different every round and nobody knows how long it is. You'll hear it ticking, that's all.",
  "Whoever's holding it when it goes off loses a life, and starts the next round. Lose them all and you're out.",
  "Last one standing wins.",
  `The host can add modes: the letters at the END of the word, the letters shown BACKWARDS (GNI means ING), ${LENGTH_MIN} to ${LENGTH_MAX} letters only, or words from a CATEGORY shown on the bomb.`,
  "A word that fits but the game doesn't know goes to a room vote, if the host left it on. Four seconds, fuse frozen. It's out only if more than half the room says reject. Two votes per turn holding it.",
];

const FUSE_LABELS = { short: "Short", normal: "Normal", long: "Long" } as const;
const UNKNOWN_LABELS: Record<UnknownWords, string> = { vote: "Room votes", strict: "Rejected", allow: "Allowed" };
const UNKNOWN_HINTS: Record<UnknownWords, string> = {
  vote: "Not in the dictionary? Everyone else gets 4 s to say no",
  strict: "Not in the dictionary, not a word",
  allow: "Anything that fits goes",
};

/** A two-way toggle for one mode, flagging the side that would leave nothing to play. */
function modeField(
  settings: PassTheBombSettings,
  key: keyof BombModes,
  label: string,
  off: string,
  on: string,
  hint: string,
): SettingField {
  const modes = modesOf(settings);
  const option = (value: boolean, text: string) => {
    const blocked = modesProblem({ ...modes, [key]: value }) !== null;
    return { label: blocked ? `${text} (too few words)` : text, patch: { [key]: value } };
  };
  return { key, label, selected: modes[key] ? 1 : 0, options: [option(false, off), option(true, on)], hint };
}

/** What the lobby shows (and the host can change) before a game. */
export function passTheBombSettingFields(raw: unknown): SettingField[] {
  const settings: PassTheBombSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<PassTheBombSettings> | null) };
  const [lo, hi] = FUSE_MS[settings.fuse] ?? FUSE_MS.normal;
  const modes = modesOf(settings);
  const viable = VIABLE[viabilityKey(modes)];
  const thin = viable && viable.answers < THIN_ANSWERS ? `Thin: about ${viable.answers} words fit all of that` : null;
  const unknown = UNKNOWN_OPTIONS.includes(settings.unknown) ? settings.unknown : DEFAULT_SETTINGS.unknown;
  return [
    {
      key: "lives",
      label: "Lives",
      selected: Math.max(0, LIVES_OPTIONS.indexOf(settings.lives)),
      options: LIVES_OPTIONS.map((n) => ({ label: String(n), patch: { lives: n } })),
      hint: settings.lives === 1 ? "One bang and you're out" : `Out on your ${settings.lives === 2 ? "second" : "third"} bang`,
    },
    {
      key: "fuse",
      label: "Fuse",
      selected: Math.max(0, FUSE_OPTIONS.indexOf(settings.fuse)),
      options: FUSE_OPTIONS.map((f) => ({ label: FUSE_LABELS[f], patch: { fuse: f } })),
      hint: `Anywhere from ${lo / 1000} to ${hi / 1000} s a round`,
    },
    modeField(settings, "ending", "Letters go", "Anywhere", "At the end", modes.ending ? "ING at the end: RUNNING, not SINGER" : "ING: SINGER or RUNNING"),
    modeField(settings, "reverse", "Bomb shows", "Letters as they are", "Letters backwards", modes.reverse ? "The bomb shows GNI, you type ING" : "The bomb shows ING, you type ING"),
    modeField(settings, "length", "Word length", "3 or more", `${LENGTH_MIN} to ${LENGTH_MAX}`, modes.length ? `${LENGTH_MIN} to ${LENGTH_MAX} letters, no more, no less` : "Three letters at least"),
    modeField(
      settings,
      "category",
      "Words from",
      "Anywhere",
      "A category",
      thin ?? (modes.category ? "Animals, food, body, home, nature or jobs, one at a time" : "Any word in the dictionary"),
    ),
    {
      key: "unknown",
      label: "Unknown words",
      selected: UNKNOWN_OPTIONS.indexOf(unknown),
      options: UNKNOWN_OPTIONS.map((u) => ({ label: UNKNOWN_LABELS[u], patch: { unknown: u } })),
      hint: UNKNOWN_HINTS[unknown],
    },
  ];
}
