import type { GameBot } from "@games/game-core";
import type { Card, CheatAction, CheatPrivateState, CheatPublicState, Rank } from "../shared/types.ts";
import { MAX_PLAY } from "../shared/types.ts";

/** About 1 play in this many is a random one, as a person's slip would be. */
const RANDOM_MOVE_ODDS = 10;
/** Percent of plays that put down two cards when it must lie. */
const TWO_CARD_LIE = 25;
/** Percent of honest plays that get one junk card added. */
const TACK_ON = 15;
/** A bot with this many cards or fewer plays honest when it can. */
const NEAR_OUT = 2;
/** Percent chance that someone at the table calls a play: usually, and when 3 or 4 cards were claimed. */
const CALL_BASE = 12;
const CALL_BIG_CLAIM = 30;
/** From this many cards in the pile, the call rate is halved: the pile is costly to take. */
const BIG_PILE = 16;

/** The hand grouped by rank, as lists of cards. */
function byRank(hand: readonly Card[]): Map<Rank, Card[]> {
  const groups = new Map<Rank, Card[]>();
  for (const card of hand) {
    const group = groups.get(card.rank);
    if (group) group.push(card);
    else groups.set(card.rank, [card]);
  }
  return groups;
}

/**
 * Cheat: play the cards you were asked for when you hold them, else lie with
 * the cards you need least. Call a play that cannot be true or that wins the
 * game, and call the rest now and then; pass otherwise.
 */
export const cheatBot: GameBot<CheatPublicState, CheatPrivateState, CheatAction> = {
  decide({ playerId, public: pub, private: priv }, ctx) {
    if (priv.canCall) return decideCall(playerId, pub, priv, ctx.chance);
    if (!priv.canPlay || pub.currentPlayerId !== playerId || priv.hand.length === 0) return null;

    const groups = byRank(priv.hand);
    const allowed = pub.claims;
    const honestRanks = allowed.filter((r) => groups.has(r));
    const hand = priv.hand;
    const ids = (cards: Card[]) => cards.map((c) => c.id);
    // Cards of the rarest ranks first: a pair is worth more later than a single.
    const leastUsed = (skip: ReadonlySet<string>): Card[] =>
      hand.filter((c) => !skip.has(c.id)).sort((a, b) => groups.get(a.rank)!.length - groups.get(b.rank)!.length);
    const lie = (count: number): CheatAction => {
      const cards = leastUsed(new Set()).slice(0, count);
      return { type: "play", cardIds: ids(cards), claim: allowed[ctx.randomInt(allowed.length)]! };
    };

    const nearlyOut = hand.length <= NEAR_OUT;
    if (honestRanks.length === 0) return lie(hand.length > 1 && ctx.randomInt(100) < TWO_CARD_LIE ? 2 : 1);

    if (!nearlyOut && ctx.randomInt(RANDOM_MOVE_ODDS) === 0) {
      // A slip: one to three cards at random, with any claim that is allowed.
      const count = 1 + ctx.randomInt(Math.min(3, hand.length));
      const pool = [...hand];
      const cards: Card[] = [];
      for (let i = 0; i < count; i++) cards.push(pool.splice(ctx.randomInt(pool.length), 1)[0]!);
      return { type: "play", cardIds: ids(cards), claim: allowed[ctx.randomInt(allowed.length)]! };
    }

    // The allowed rank held most; ties go to the first (lowest) one.
    const claim = honestRanks.reduce((best, r) => (groups.get(r)!.length > groups.get(best)!.length ? r : best));
    const cards = groups.get(claim)!.slice(0, MAX_PLAY);
    if (!nearlyOut && cards.length < MAX_PLAY && ctx.randomInt(100) < TACK_ON) {
      const junk = leastUsed(new Set(ids(cards))).find((c) => c.rank !== claim);
      if (junk) cards.push(junk);
    }
    return { type: "play", cardIds: ids(cards), claim };
  },
};

/** Off turn: answer the play on top, once. Only when the view says the seat may. */
function decideCall(
  playerId: string,
  pub: CheatPublicState,
  priv: CheatPrivateState,
  chance: (key: string) => number,
): CheatAction | null {
  const last = pub.lastPlay;
  if (!last || last.playerId === playerId) return null;
  const owner = pub.players.find((p) => p.id === last.playerId);
  const mine = priv.hand.filter((c) => c.rank === last.claim).length;
  // The owner has no cards left: the play stands and wins, unless it is called.
  if (!owner || owner.cardCount === 0) return { type: "call" };
  // More of the rank claimed than all the decks hold.
  if (last.count + mine > 4 * pub.decks) return { type: "call" };

  let rate = last.count >= 3 ? CALL_BIG_CLAIM : CALL_BASE;
  if (pub.pileCount >= BIG_PILE) rate = rate / 2;
  // The rate is for the whole table: each seat that could call takes its share, at least 1 percent.
  const callers = pub.players.filter((p) => !p.removed && p.id !== last.playerId).length;
  rate = Math.max(1, Math.round(rate / Math.max(1, callers)));
  // Names this window, so asking again gives the same answer.
  const key = `call:${pub.pileCount}:${last.playerId}:${last.claim}:${last.count}:${owner.cardCount}:${priv.hand.length}`;
  return chance(key) < rate ? { type: "call" } : { type: "pass" };
}
