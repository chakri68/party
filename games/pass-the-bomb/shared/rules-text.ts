import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, FUSE_MS, FUSE_OPTIONS, LIVES_OPTIONS, type PassTheBombSettings } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const passTheBombRules: string[] = [
  "One of you holds a lit bomb with a few letters on it, like ING or TR.",
  "Type a real English word with those letters in it, together and in that order (SINGER, TRAIN). Get it right and the bomb goes to the next player, with new letters.",
  "Wrong word? Nothing happens. Keep trying: the fuse doesn't care.",
  "No word twice in a game, by anyone. Three letters at least, and no names.",
  "The fuse is different every round and nobody knows how long it is. You'll hear it ticking, that's all.",
  "Whoever's holding it when it goes off loses a life, and starts the next round. Lose them all and you're out.",
  "Last one standing wins.",
];

const FUSE_LABELS = { short: "Short", normal: "Normal", long: "Long" } as const;

/** What the lobby shows (and the host can change) before a game. */
export function passTheBombSettingFields(raw: unknown): SettingField[] {
  const settings: PassTheBombSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<PassTheBombSettings> | null) };
  const [lo, hi] = FUSE_MS[settings.fuse] ?? FUSE_MS.normal;
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
  ];
}
