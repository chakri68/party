import { editDistance, normalizeGuess } from "@games/words";
import type { AutoGroup, GroupMember, Merge, PublicGroup } from "./types.ts";

// ---------------------------------------------------------------------------
// Matching
//
// normalizeGuess strips spaces and punctuation, so the article has to go
// first, while there are still words: "The Moon" → "moon", "theatre" stays.
// Plurals are trickier than "drop s/es": "cakes" minus "es" is "cak", and
// "glass" minus "s" is "glas". So each answer gets a few candidate singulars
// and two answers match when any candidates meet: "cakes" {cakes, cake, cak},
// "cake" {cake}. Every candidate keeps at least 3 letters.
// ---------------------------------------------------------------------------

const ARTICLE = /^(?:a|an|the)\s+(?=\S)/;

/** "  The Pizzas! " → "pizzas". Blank in, blank out. */
export function normalizeAnswer(text: string): string {
  const words = text.trim().toLowerCase().replace(/\s+/g, " ");
  return normalizeGuess(words.replace(ARTICLE, ""));
}

/** The answer itself plus the singulars it might be. */
export function answerForms(norm: string): string[] {
  const forms = new Set([norm]);
  const stem = (cut: number, add = "") => {
    const s = norm.slice(0, norm.length - cut) + add;
    if (s.length >= 3) forms.add(s);
  };
  if (norm.endsWith("s") && !norm.endsWith("ss")) stem(1);
  if (norm.endsWith("es")) stem(2);
  if (norm.endsWith("ies")) stem(3, "y");
  return [...forms];
}

/** One typo apart, both long enough that a typo isn't half the word. */
const NEAR_MIN = 5;

/** The same answer once articles and plurals are set aside: "the pizzas" and "pizza". */
export function exactAnswer(a: string, b: string): boolean {
  if (!a || !b) return false;
  const fb = answerForms(b);
  return answerForms(a).some((x) => fb.includes(x));
}

/** One typo apart, both 5+ letters: "pepperoni" and "peperoni". Also "horse" and "house". */
export function nearAnswer(a: string, b: string): boolean {
  if (!a || !b) return false;
  const fb = answerForms(b);
  return answerForms(a).some((x) => fb.some((y) => x.length >= NEAR_MIN && y.length >= NEAR_MIN && editDistance(x, y, 1) <= 1));
}

/** Two normalized answers count as the same, one way or the other. */
export function sameAnswer(a: string, b: string): boolean {
  return exactAnswer(a, b) || nearAnswer(a, b);
}

/** Union-find over `n` items; `join(i, j)` says whether i and j belong together. Roots are the lowest index. */
function components(n: number, join: (i: number, j: number) => boolean): number[][] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!join(i, j)) continue;
      const [ri, rj] = [root(i), root(j)];
      if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
    }
  }
  const out = new Map<number, number[]>();
  for (let i = 0; i < n; i++) out.set(root(i), [...(out.get(root(i)) ?? []), i]);
  return [...out.values()];
}

/**
 * Groups players by answer, exact matches only (articles and plurals aside),
 * chaining them. Blank answers are left out. `entries` in seat order; groups
 * come back in order of their first member, ids from that member. Typo-level
 * matches are `nearMerges`, so the host can split them back out.
 */
export function groupAnswers(entries: readonly GroupMember[]): AutoGroup[] {
  const live = entries.map((e) => ({ id: e.id, norm: normalizeAnswer(e.text) })).filter((e) => e.norm);
  return components(live.length, (i, j) => exactAnswer(live[i]!.norm, live[j]!.norm)).map((idx) => {
    const members = idx.map((i) => live[i]!.id);
    return { id: `g-${members[0]}`, members };
  });
}

/**
 * The machine's own merges: groups one typo apart fold into the earliest of
 * them. Marked `auto`, and they split like the host's ("horse" isn't "house").
 */
export function nearMerges(groups: readonly AutoGroup[], answers: Readonly<Record<string, string>>): Merge[] {
  const norms = groups.map((g) => g.members.map((id) => normalizeAnswer(answers[id] ?? "")));
  const near = (i: number, j: number) => norms[i]!.some((a) => norms[j]!.some((b) => nearAnswer(a, b)));
  return components(groups.length, near).flatMap(([first, ...rest]) =>
    rest.map((i) => ({ from: groups[i]!.id, into: groups[first!]!.id, auto: true as const })),
  );
}

/** The most common spelling, ignoring case; a tie goes to whoever's listed first. */
export function groupLabel(texts: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const t of texts) counts.set(t.toLowerCase(), (counts.get(t.toLowerCase()) ?? 0) + 1);
  let best = "";
  let top = 0;
  for (const t of texts) {
    const n = counts.get(t.toLowerCase())!;
    if (n > top) [best, top] = [t, n];
  }
  return best;
}

// ---------------------------------------------------------------------------
// The host's tidy-up
// ---------------------------------------------------------------------------

/** Groups still standing on their own: not merged into anything. */
export function topLevel(groups: readonly AutoGroup[], merges: readonly Merge[]): AutoGroup[] {
  return groups.filter((g) => !merges.some((m) => m.from === g.id));
}

/** A group's own members, then everything merged into it, oldest merge first. */
function membersOf(id: string, groups: readonly AutoGroup[], merges: readonly Merge[]): string[] {
  const own = groups.find((g) => g.id === id)?.members ?? [];
  return [...own, ...merges.filter((m) => m.into === id).flatMap((m) => membersOf(m.from, groups, merges))];
}

/** Null when the merge is fine, or why not. */
export function mergeProblem(groups: readonly AutoGroup[], merges: readonly Merge[], from: string, into: string): string | null {
  const top = topLevel(groups, merges).map((g) => g.id);
  if (from === into) return "Pick two different groups.";
  if (!top.includes(from) || !top.includes(into)) return "That group isn't there any more.";
  return null;
}

/** Drops merges that point at groups a rebuild lost, and anything hanging off them. */
export function pruneMerges(groups: readonly AutoGroup[], merges: readonly Merge[]): Merge[] {
  const ids = new Set(groups.map((g) => g.id));
  return merges.filter((m) => ids.has(m.from) && ids.has(m.into));
}

/** Undoes every merge into `group`. What was merged in comes back as it was. */
export function splitGroup(merges: readonly Merge[], group: string): Merge[] {
  return merges.filter((m) => m.into !== group);
}

/** The groups as they stand, members with what they typed. In the order the machine made them. */
export function viewGroups(groups: readonly AutoGroup[], merges: readonly Merge[], answers: Readonly<Record<string, string>>): PublicGroup[] {
  return topLevel(groups, merges).map((g) => {
    const members = membersOf(g.id, groups, merges).map((id) => ({ id, text: answers[id] ?? "" }));
    return {
      id: g.id,
      label: groupLabel(members.map((m) => m.text)),
      members,
      merged: merges.some((m) => m.into === g.id),
    };
  });
}

/** Biggest first; equal sizes keep their order. */
export function biggestFirst<G extends { members: unknown[] }>(groups: readonly G[]): G[] {
  return [...groups].sort((a, b) => b.members.length - a.members.length);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface RoundScore {
  /** Ids of the group(s) that scored. */
  winners: string[];
  /** Score change per player, floor applied. Everyone in `scores` gets an entry. */
  points: Record<string, number>;
  loneId: string | null;
}

/**
 * Everyone in the biggest group scores 1; groups tied for biggest all score.
 * A group of one never scores. With `lone`, if exactly one answer is alone
 * in its group, its owner loses a point, never going below 0.
 */
export function scoreRound(groups: readonly { id: string; members: readonly { id: string }[] }[], lone: boolean, scores: Readonly<Record<string, number>>): RoundScore {
  const points: Record<string, number> = Object.fromEntries(Object.keys(scores).map((id) => [id, 0]));
  const top = Math.max(0, ...groups.map((g) => g.members.length));
  const winners = top >= 2 ? groups.filter((g) => g.members.length === top).map((g) => g.id) : [];
  for (const g of groups) {
    if (!winners.includes(g.id)) continue;
    for (const m of g.members) points[m.id] = 1;
  }
  let loneId: string | null = null;
  if (lone) {
    const singles = groups.filter((g) => g.members.length === 1);
    if (singles.length === 1) {
      loneId = singles[0]!.members[0]!.id;
      points[loneId] = (scores[loneId] ?? 0) > 0 ? -1 : 0;
    }
  }
  return { winners, points, loneId };
}
