// The cards and the decks. Client-safe: the lobby lists the deck, and it's
// public anyway.

import { deckFor, deckProblem, type Deck, type DeckRules, type Preset, type RoleSpec } from "@games/hidden-roles";
import type { NightfallSettings } from "./types.ts";

export type Team = "village" | "wolves";
export type RoleId = "wolf" | "watcher" | "keeper" | "villager";

export interface Role extends RoleSpec {
  id: RoleId;
  team: Team;
  /** Whether its night pick reaches the server. Everyone picks on the phone. */
  acts: boolean;
  /** One line, for the card and the rules. */
  blurb: string;
}

/** Deck order, which is also the lobby's row order. */
export const ROLES: readonly Role[] = [
  { id: "wolf", label: "Wolf", team: "wolves", max: 5, acts: true, blurb: "Each night, vote with the other Wolves on someone to take." },
  { id: "watcher", label: "Watcher", team: "village", max: 1, acts: true, blurb: "Each night, pick a player. At dawn, learn whether they're a Wolf." },
  { id: "keeper", label: "Keeper", team: "village", max: 1, acts: true, blurb: "Each night, shelter one player, yourself included. Never the same one two nights running." },
  { id: "villager", label: "Villager", team: "village", max: 11, acts: false, blurb: "No night power. Talk, listen, vote." },
];

export const roleById = (id: RoleId): Role => ROLES.find((r) => r.id === id)!;
export const isRoleId = (v: unknown): v is RoleId => typeof v === "string" && ROLES.some((r) => r.id === v);
export const teamOf = (id: RoleId): Team => roleById(id).team;

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 12;

export const DECK_RULES: DeckRules = { size: (n) => n, requireTeams: ["wolves", "village"], teamLabels: { wolves: "Wolf", village: "Village" }, minPlayers: MIN_PLAYERS };

export const wolvesFor = (n: number): number => (n >= 10 ? 3 : n >= 7 ? 2 : 1);

/**
 * Wolves, then as many of `extras` as fit, then Villagers. Every preset fits
 * from five up; below that the lobby still builds a deck (the Custom option
 * copies it), so no count may go negative.
 */
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
  { id: "beginner", label: "Beginner", deck: (n) => fill(n, []) },
  { id: "standard", label: "Standard", deck: (n) => fill(n, ["watcher"]) },
  { id: "full", label: "Full", deck: (n) => fill(n, ["watcher", "keeper"]) },
];

export function deckOf(settings: NightfallSettings, players: number): Deck {
  return deckFor(settings, [...ROLES], PRESETS, players);
}

/** Why this deck can't deal this table, or null. The kit's checks, then ours. */
export function setupProblem(settings: NightfallSettings, players: number): string | null {
  const deck = deckOf(settings, players);
  const problem = deckProblem(deck, [...ROLES], DECK_RULES, players);
  if (problem) return problem;
  const wolves = deck.wolf ?? 0;
  if (players - wolves < 2) return "Needs at least two non-wolf cards";
  // At parity the Wolves have already won.
  if (wolves >= players - wolves) return "Wolves must be fewer than everyone else";
  return null;
}
