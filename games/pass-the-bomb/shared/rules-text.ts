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
  "1 player holds the bomb. The bomb shows a few letters, like ING or TR.",
  "Type a real English word with those letters. The letters must be together and in the same order.",
  "For example: SINGER has ING. TRAIN has TR.",
  "If your word is right, the bomb goes to the next player. The bomb gets new letters.",
  "If your word is wrong, nothing happens. Try again. The timer keeps running.",
  "You can use each word only once in a game.",
  "Each word must have 3 letters or more. You can't use names.",
  "The fuse is the bomb's timer. The fuse has a new length every round.",
  "Nobody knows the length of the fuse. You only hear the bomb ticking.",
  "The bomb blows up at the end of the fuse. The player with the bomb loses 1 life.",
  "That player starts the next round.",
  "If you lose all your lives, you are out of the game.",
  "The last player in the game wins.",
  "The host can add extra rules before the game:",
  "End: the letters must come at the END of your word.",
  "Backwards: the bomb shows the letters BACKWARDS. GNI means ING.",
  `Length: your word must have ${LENGTH_MIN} to ${LENGTH_MAX} letters.`,
  "Topic: your word must belong to the TOPIC on the bomb.",
  "The host can also turn on voting for new words.",
  "Sometimes your word fits, but the game does not know the word. Then the other players vote on the word.",
  "The vote lasts 4 seconds. The timer stops during the vote.",
  "More than half the players must say no. Then the game rejects the word.",
  "You get 2 votes in each turn.",
];

const FUSE_LABELS = { short: "Short", normal: "Normal", long: "Long" } as const;
const UNKNOWN_LABELS: Record<UnknownWords, string> = { vote: "Players vote", strict: "Rejected", allow: "Allowed" };
const UNKNOWN_HINTS: Record<UnknownWords, string> = {
  vote: "For a new word, other players get 4 s to vote",
  strict: "The game takes dictionary words only",
  allow: "The game takes any word with the letters",
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
  const thin = viable && viable.answers < THIN_ANSWERS ? `Only about ${viable.answers} words fit these rules` : null;
  const unknown = UNKNOWN_OPTIONS.includes(settings.unknown) ? settings.unknown : DEFAULT_SETTINGS.unknown;
  return [
    {
      key: "lives",
      label: "Lives",
      selected: Math.max(0, LIVES_OPTIONS.indexOf(settings.lives)),
      options: LIVES_OPTIONS.map((n) => ({ label: String(n), patch: { lives: n } })),
      hint: settings.lives === 1 ? "The bomb blows up once and you are out" : `You are out after ${settings.lives} blasts`,
    },
    {
      key: "fuse",
      label: "Fuse",
      selected: Math.max(0, FUSE_OPTIONS.indexOf(settings.fuse)),
      options: FUSE_OPTIONS.map((f) => ({ label: FUSE_LABELS[f], patch: { fuse: f } })),
      hint: `${lo / 1000} to ${hi / 1000} s each round`,
    },
    modeField(settings, "ending", "Letters are", "Anywhere", "At the end", modes.ending ? "ING at the end: RUNNING is fine, SINGER is not" : "ING anywhere: SINGER or RUNNING"),
    modeField(settings, "reverse", "Bomb shows", "Normal letters", "Backwards letters", modes.reverse ? "The bomb shows GNI, you type ING" : "The bomb shows ING, you type ING"),
    modeField(settings, "length", "Word length", "3 or more", `${LENGTH_MIN} to ${LENGTH_MAX}`, modes.length ? `Words must have ${LENGTH_MIN} to ${LENGTH_MAX} letters` : "3 letters or more"),
    modeField(
      settings,
      "category",
      "Words from",
      "Anywhere",
      "A topic",
      thin ?? (modes.category ? "One topic at a time: animals, food, body, home, nature or jobs" : "Any word in the dictionary"),
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
