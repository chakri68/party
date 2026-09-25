import { ACE, KING, SUITS, type Card, type ClaimRule, type DeckSetting, type Rank, type Suit } from "./types.ts";

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

const FACE_LABELS: Record<number, string> = { 1: "A", 11: "J", 12: "Q", 13: "K" };
const FACE_NAMES: Record<number, string> = { 1: "Ace", 11: "Jack", 12: "Queen", 13: "King" };
const NUMBER_NAMES = ["", "", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

export function formatRank(rank: Rank): string {
  return FACE_LABELS[rank] ?? String(rank);
}

export function rankName(rank: Rank): string {
  return FACE_NAMES[rank] ?? NUMBER_NAMES[rank] ?? String(rank);
}

/** "Aces", "Sixes", "Kings": what the claim sounds like out loud. */
export function rankPlural(rank: Rank): string {
  const name = rankName(rank);
  return name === "Six" ? "Sixes" : `${name}s`;
}

/** "one Seven", "three Sevens". */
export function claimText(count: number, rank: Rank): string {
  const n = ["zero", "one", "two", "three", "four"][count] ?? String(count);
  return `${n} ${count === 1 ? rankName(rank) : rankPlural(rank)}`;
}

/** "hearts-8" for the first deck, "hearts-8~1" for the second. */
export function formatCardId(suit: Suit, rank: Rank, copy = 0): string {
  return `${suit}-${formatRank(rank)}${copy ? `~${copy}` : ""}`;
}

export function parseCardId(id: string): Card | null {
  const m = /^([a-z]+)-(A|J|Q|K|10|[2-9])(?:~([1-9]))?$/.exec(id);
  if (!m) return null;
  const suit = m[1] as Suit;
  if (!SUITS.includes(suit)) return null;
  const label = m[2]!;
  const rank = label === "A" ? 1 : label === "J" ? 11 : label === "Q" ? 12 : label === "K" ? 13 : Number(label);
  return { id, suit, rank, copy: m[3] ? Number(m[3]) : 0 };
}

export function makeCard(suit: Suit, rank: Rank, copy = 0): Card {
  return { id: formatCardId(suit, rank, copy), suit, rank, copy };
}

/** `decks` × 52 cards, in deck/suit/rank order. */
export function makeDeck(decks = 1): Card[] {
  const deck: Card[] = [];
  for (let copy = 0; copy < decks; copy++) {
    for (const suit of SUITS) for (let r = 1; r <= 13; r++) deck.push(makeCard(suit, r, copy));
  }
  return deck;
}

/** Rank, then suit: you're hunting for sets, so a rank's cards sit together. */
export function compareCards(a: Card, b: Card): number {
  return a.rank - b.rank || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || a.copy - b.copy;
}

/**
 * "auto": one deck up to six players, two beyond. Seven hands of seven is a
 * short game; the second deck also means four of a kind no longer proves a lie.
 */
export function resolveDecks(setting: DeckSetting, players: number): number {
  if (setting !== "auto") return setting;
  return players <= 6 ? 1 : 2;
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

/** K → A: the sequence wraps. */
export function nextRank(rank: Rank): Rank {
  return rank === KING ? ACE : rank + 1;
}

export function prevRank(rank: Rank): Rank {
  return rank === ACE ? KING : rank - 1;
}

/**
 * What the next play may claim. The first play of the game is always Aces.
 * "near" allows the last claim again, or one either side of it.
 */
export function allowedClaims(lastClaim: Rank | null, rule: ClaimRule): Rank[] {
  if (lastClaim === null) return [ACE];
  if (rule === "strict") return [nextRank(lastClaim)];
  return [prevRank(lastClaim), lastClaim, nextRank(lastClaim)];
}

/** A play is honest when every card is what it's claimed to be. */
export function isHonest(cards: readonly Pick<Card, "rank">[], claim: Rank): boolean {
  return cards.every((c) => c.rank === claim);
}
