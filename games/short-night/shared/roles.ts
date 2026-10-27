// The cards, the night order and the decks. Client-safe: the lobby lists the
// deck and the night banner names each step, and both are public anyway.

import { deckFor, deckProblem, type Deck, type DeckRules, type Preset, type RoleSpec } from "@games/hidden-roles";
import type { ShortNightSettings } from "./types.ts";

export type Team = "village" | "wolves";
export type RoleId = "wolf" | "villager" | "lamplighter" | "matchmaker" | "bellringer" | "gossip" | "wanderer" | "stray";

/** How many other players a role picks at night. 0: it just reads its result. */
export type Picks = 0 | 1 | 2;

export interface Role extends RoleSpec {
  id: RoleId;
  team: Team;
  /** Null: no night step. */
  picks: Picks | null;
  /** One line, for the card and the rules. */
  blurb: string;
}

/** Deck order, which is also the lobby's row order. Acting roles in night order. */
export const ROLES: readonly Role[] = [
  { id: "wolf", label: "Wolf", team: "wolves", max: 3, picks: 0, blurb: "Wake first and meet the other Wolves. Alone, you learn one Villager." },
  { id: "lamplighter", label: "Lamplighter", team: "village", max: 1, picks: 1, blurb: "Pick a player. Learn whether they're village or wolf." },
  { id: "matchmaker", label: "Matchmaker", team: "village", max: 1, picks: 2, blurb: "Pick two players. Learn whether they're on the same side." },
  { id: "bellringer", label: "Bellringer", team: "village", max: 1, picks: 0, blurb: "Learn how many of your two neighbours are wolves." },
  { id: "gossip", label: "Gossip", team: "village", max: 1, picks: 0, blurb: "Hear two names. At least one of them is a wolf." },
  { id: "wanderer", label: "Wanderer", team: "village", max: 1, picks: 1, blurb: "Pick a player. Learn one card they don't hold." },
  { id: "stray", label: "Stray", team: "village", max: 1, picks: null, blurb: "You're village, but every check above sees you as a wolf." },
  { id: "villager", label: "Villager", team: "village", max: 10, picks: null, blurb: "No night. Just your wits." },
];

export const roleById = (id: RoleId): Role => ROLES.find((r) => r.id === id)!;
export const isRoleId = (v: unknown): v is RoleId => typeof v === "string" && ROLES.some((r) => r.id === v);

/** The fixed night order. Steps for roles not in the deck are skipped (the deck's public). */
export const NIGHT_ORDER: readonly RoleId[] = ROLES.filter((r) => r.picks !== null).map((r) => r.id);

/** What team checks see: the Stray reads as a wolf. */
export const readsAsWolf = (role: RoleId): boolean => role === "wolf" || role === "stray";

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;

export const DECK_RULES: DeckRules = { size: (n) => n, requireTeams: ["wolves", "village"] };

export const wolvesFor = (n: number): number => (n >= 6 ? 2 : 1);

/** Wolves, then as many of `extras` as fit, in order, then Villagers. */
function fill(n: number, extras: RoleId[]): Deck {
  const wolves = wolvesFor(n);
  const room = Math.max(0, n - wolves);
  const deck: Deck = { wolf: wolves };
  const used = extras.slice(0, room);
  for (const id of used) deck[id] = 1;
  if (room > used.length) deck.villager = room - used.length;
  return deck;
}

export const PRESETS: Preset[] = [
  { id: "beginner", label: "Beginner", deck: (n) => fill(n, ["lamplighter"]) },
  { id: "standard", label: "Standard", deck: (n) => fill(n, ["lamplighter", "matchmaker", "gossip"]) },
  { id: "full", label: "Full", deck: (n) => fill(n, ["lamplighter", "matchmaker", "gossip", "bellringer", "wanderer", "stray"]) },
];

export function deckOf(settings: ShortNightSettings, players: number): Deck {
  return deckFor(settings, [...ROLES], PRESETS, players);
}

/** Why this deck can't deal this table, or null. The kit's checks, then ours. */
export function setupProblem(settings: ShortNightSettings, players: number): string | null {
  const deck = deckOf(settings, players);
  const problem = deckProblem(deck, [...ROLES], DECK_RULES, players);
  if (problem) return problem;
  // One non-wolf is a lone villager the wolves can just outvote.
  if (players - (deck.wolf ?? 0) < 2) return "Needs at least two non-wolf cards";
  return null;
}

/** The steps tonight: each acting role the deck holds, in night order. */
export function nightSteps(deck: Deck): RoleId[] {
  return NIGHT_ORDER.filter((id) => (deck[id] ?? 0) > 0);
}
