// What can go on the bomb under a set of modes, and dealing one. Server only:
// it needs the dictionary. shared/viable.ts is the lobby's summary of it.

import { allWords } from "@games/words/dictionary";
import { CATEGORIES, LENGTH_MAX, LENGTH_MIN, MIN_ANSWERS, MIN_WORD, type BombModes, type Category } from "../shared/types.ts";
import { CATEGORY_WORDS } from "./categories.ts";
import { CLUSTERS } from "./words.ts";

/** A cluster (effective, not as shown), its category in category mode, and every word that answers it. */
export interface Prompt {
  cluster: string;
  category: Category | null;
  answers: readonly string[];
}

/** Does `word` answer `cluster` under the shape modes? Category membership is the caller's. */
export function fits(word: string, cluster: string, modes: Pick<BombModes, "ending" | "length">): boolean {
  if (word.length < MIN_WORD) return false;
  if (modes.length && (word.length < LENGTH_MIN || word.length > LENGTH_MAX)) return false;
  return modes.ending ? word.endsWith(cluster) : word.includes(cluster);
}

/** Every 2- and 3-letter run in a list's words: category mode's clusters. */
function runsIn(words: readonly string[]): string[] {
  const runs = new Set<string>();
  for (const w of words) {
    for (let n = 2; n <= 3; n++) for (let i = 0; i + n <= w.length; i++) runs.add(w.slice(i, i + n));
  }
  return [...runs].sort();
}

const cache = new Map<string, readonly Prompt[]>();

/**
 * Every prompt with at least MIN_ANSWERS answers under these modes, built on
 * first use and kept for the isolate. `reverse` doesn't come into it: it
 * changes what's shown, not what's needed. `clusters` is ignored in category
 * mode, where each category supplies its own.
 */
export function promptsFor(modes: BombModes, clusters: readonly string[] = CLUSTERS): readonly Prompt[] {
  const key = `${+modes.ending}${+modes.length}${+modes.category}|${modes.category ? "" : clusters.join(",")}`;
  let pool = cache.get(key);
  if (pool) return pool;
  const out: Prompt[] = [];
  if (modes.category) {
    for (const category of CATEGORIES) {
      const words = CATEGORY_WORDS[category];
      for (const cluster of runsIn(words)) {
        const answers = words.filter((w) => fits(w, cluster, modes));
        if (answers.length >= MIN_ANSWERS) out.push({ cluster, category, answers });
      }
    }
  } else {
    const words = allWords();
    for (const cluster of clusters) {
      const answers = words.filter((w) => fits(w, cluster, modes));
      if (answers.length >= MIN_ANSWERS) out.push({ cluster, category: null, answers });
    }
  }
  pool = out;
  cache.set(key, pool);
  return pool;
}

/** How many of a prompt's answers nobody has played yet. Cheap when the game is young. */
function unused(p: Prompt, used: readonly string[], usedSet: () => Set<string>): number {
  if (p.answers.length - used.length >= MIN_ANSWERS) return MIN_ANSWERS;
  const set = usedSet();
  return p.answers.reduce((n, w) => n + (set.has(w) ? 0 : 1), 0);
}

/**
 * The next prompt: one with MIN_ANSWERS unused answers if any has, else the
 * ones with the most left, else anything (a long game in a thin combination
 * can play a pool dry; the fuse still blows, and the room can still vote a
 * word in). Category first, uniformly, then a prompt within it, so a list
 * with many usable runs doesn't crowd the rest out. Never the current prompt
 * when there's a choice.
 */
export function dealPrompt(
  pool: readonly Prompt[],
  used: readonly string[],
  current: { cluster: string; category: Category | null },
  randomInt: (n: number) => number,
): Prompt {
  if (!pool.length) throw new Error("pass-the-bomb: no prompts to deal");
  let set: Set<string> | null = null;
  const usedSet = () => (set ??= new Set(used));
  const left = pool.map((p) => unused(p, used, usedSet));
  let candidates = pool.filter((_, i) => left[i]! >= MIN_ANSWERS);
  if (!candidates.length) {
    const most = Math.max(...left);
    candidates = most > 0 ? pool.filter((_, i) => left[i] === most) : [...pool];
  }
  if (candidates.length > 1) {
    const other = candidates.filter((p) => p.cluster !== current.cluster || p.category !== current.category);
    if (other.length) candidates = other;
  }
  const categories = [...new Set(candidates.map((p) => p.category))];
  if (categories.length > 1) {
    const category = categories[randomInt(categories.length)];
    candidates = candidates.filter((p) => p.category === category);
  }
  return candidates[randomInt(candidates.length)]!;
}
