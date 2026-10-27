import type { SettingField } from "@games/game-core";
import { DEFAULT_SETTINGS, type FaceOffSettings, TARGET_OPTIONS } from "./types.ts";

/** Plain-language rules for the lobby's Rules button (§25). */
export const faceOffRules: string[] = [
  "Everyone holds a category, face up: \"a breakfast food\", \"something with wheels\".",
  "Every few seconds two players are called out. Each says, out loud, something from the other's card.",
  "Said it? Buzz. First buzz claims the point.",
  "Everyone else has 6 seconds to confirm it or overturn it. Overturned, the point goes to the other one. No votes: it stands.",
  "The loser draws a new card. Nobody buzzes in 8 seconds: nobody scores and both draw.",
  "Either of you can call a redo, once: no score, same two, again.",
  "First to the target wins. After 5 minutes the highest score wins; ties share.",
];

/** What the lobby shows (and the host can change) before a game. */
export function faceOffSettingFields(raw: unknown): SettingField[] {
  const settings: FaceOffSettings = { ...DEFAULT_SETTINGS, ...(raw as Partial<FaceOffSettings> | null) };
  return [
    {
      key: "target",
      label: "First to",
      selected: Math.max(0, TARGET_OPTIONS.indexOf(settings.target)),
      options: TARGET_OPTIONS.map((n) => ({ label: `${n} points`, patch: { target: n } })),
      hint: "Or 5 minutes, whichever comes first",
    },
  ];
}
