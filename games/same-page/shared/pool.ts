import { CATEGORIES } from "@games/face-off/shared";
import { PROMPTS } from "./prompts.ts";
import type { Prompt } from "./types.ts";

/** Prompt text to id: "The best biscuit" → "the-best-biscuit". */
export const promptId = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Every prompt a match can draw: ours, then Face-Off's categories as "Name …".
 * Face-Off's ids get a "name-" prefix, so the two lists can't collide.
 */
export const PROMPT_POOL: readonly Prompt[] = [
  ...PROMPTS.map((text) => ({ id: promptId(text), text })),
  ...CATEGORIES.map((c) => ({ id: `name-${promptId(c)}`, text: `Name ${c}` })),
];
