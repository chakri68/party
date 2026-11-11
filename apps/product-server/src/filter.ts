import { FILTER_WORDS } from "./filter-words.ts";

// Longest first so "motherfucker" wins over "fucker". Letters-only boundary: "class" has no "ass" entry, and
// "Scunthorpe" never matches because the list word must be the whole word.
const WORDS = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${[...FILTER_WORDS].sort((a, b) => b.length - a.length).join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
);

/** Masks listed words with `*`. Output is exactly as long as the input: the runtime doesn't re-clamp it. */
export function maskProfanity(text: string): string {
  return text.replace(WORDS, (m) => "*".repeat(m.length));
}
