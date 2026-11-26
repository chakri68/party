// The view's pure parts: log lines, the hand and why a card can't be played,
// the row tags, the saved turn and the card picks. No DOM here, so tests can
// call them straight.
import { seatName, type GameViewProps } from "@games/ui";
import { aimTargets, cardLabel, isAimed, POWER_LINES, POWER_NAMES } from "../shared/rules.ts";
import {
  HEATWAVE_DROP,
  VENT_HEAT,
  type OverheatAction,
  type OverheatEvent,
  type OverheatPublicState,
  type Pending,
  type PowerCard,
  type PowerKind,
} from "../shared/types.ts";

export const an = (label: string) => (/^[AEIOU]/.test(label) ? `an ${label}` : `a ${label}`);

/** The card's line without its name: "Cool: your heat..." gives "Your heat...". */
export function powerLine(power: PowerKind): string {
  const rest = POWER_LINES[power].slice(POWER_NAMES[power].length + 2);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** "2 cards", "1 card", or null for none. */
export function handBadge(count: number): string | null {
  return count <= 0 ? null : count === 1 ? "1 card" : `${count} cards`;
}

/** What a player's row shows besides the cards: the hand size and the leader mark. */
export function rowTags(game: OverheatPublicState, playerId: string): { hand: string | null; leader: boolean } {
  return { hand: handBadge(game.handCounts?.[playerId] ?? 0), leader: !!game.leaderId && game.leaderId === playerId };
}

/** Seats `chooser` may aim a `kind` card at: the same rule the server uses. */
export function targetsFor(game: OverheatPublicState, chooserId: string, kind: Pending["kind"]): string[] {
  const chooser = game.players.findIndex((p) => p.id === chooserId);
  return aimTargets(game.players, chooser, kind, game.settings.powers === "cutthroat").map((i) => game.players[i]!.id);
}

/** My turn on step "turn" (not a pending choice). */
function myTurn(game: OverheatPublicState, me: string): boolean {
  return game.step === "turn" && game.currentPlayerId === me && game.awaitedId === me;
}

/** A saved or too-hot player's turn: they may play a card or pass. */
export function savedTurn(game: OverheatPublicState, me: string): boolean {
  const p = game.players.find((x) => x.id === me);
  return !!p && !p.removed && p.status !== "flipping" && myTurn(game, me);
}

export interface HandCard {
  card: PowerCard;
  name: string;
  line: string;
  playable: boolean;
  /** Why it can't be played now, on my turn. Null when it can, or when it isn't my turn. */
  reason: string | null;
  action: Extract<OverheatAction, { type: "play" }>;
}

/** Why the card can't be played on my turn: the server's checks (`badPlay`), in its order. */
function playReason(game: OverheatPublicState, me: string, card: PowerCard): string | null {
  const p = game.players.find((x) => x.id === me)!;
  if (game.played) return "One card each turn";
  if (card.power === "block") return "Block works by itself";
  if (p.status !== "flipping" && !isAimed(card.power) && card.power !== "heatwave") return "Only while flipping";
  if (isAimed(card.power) && !targetsFor(game, me, card.power as Pending["kind"]).length) return "No one to aim at";
  return null;
}

/** My hand as the "Your cards" list shows it. Only ever my own cards. */
export function handModel(game: OverheatPublicState, me: string, hand: readonly PowerCard[]): HandCard[] {
  const turn = myTurn(game, me);
  return hand.map((card) => {
    const reason = turn ? playReason(game, me, card) : null;
    return {
      card,
      name: POWER_NAMES[card.power],
      line: powerLine(card.power),
      playable: turn && reason === null,
      reason,
      action: { type: "play", cardId: card.id },
    };
  });
}

// ---- picks ------------------------------------------------------------------------

/** What I have tapped so far for a pending card. */
export interface Pick {
  /** Which pending card the picks belong to. */
  key: string;
  mine: number | null;
  theirs: { targetId: string; id: number } | null;
  targetId: string | null;
}

export const pickKey = (pending: Pending) => `${pending.chooserId}:${pending.card.id}`;
export const emptyPick = (pending: Pending): Pick => ({ key: pickKey(pending), mine: null, theirs: null, targetId: null });

type Choice = Extract<OverheatAction, { type: "target" | "wrench" | "steal" | "dump" }>;
export interface Tap {
  pick: Pick;
  action: Choice | null;
}

/** Whose row's cards I can tap for this card: mine for Swap and Dump, a target's for Swap and Steal. */
export function cardsPickable(kind: Pending["kind"], mineRow: boolean): boolean {
  return mineRow ? kind === "wrench" || kind === "dump" : kind === "wrench" || kind === "steal";
}

/** Whether a target's whole row is the button (a plain player pick). */
export const rowPick = (kind: Pending["kind"]) => kind === "shove" || kind === "fuse" || kind === "audit" || kind === "dump";

function ready(kind: Pending["kind"], pick: Pick): Choice | null {
  if (kind === "wrench" && pick.mine !== null && pick.theirs) {
    return { type: "wrench", targetId: pick.theirs.targetId, mine: pick.mine, theirs: pick.theirs.id };
  }
  if (kind === "dump" && pick.mine !== null && pick.targetId) return { type: "dump", targetId: pick.targetId, mine: pick.mine };
  return null;
}

/** I tapped card `cardId` in `owner`'s row. Tapping a picked card again drops it. */
export function tapCard(pending: Pending, pick: Pick, me: string, owner: string, cardId: number): Tap {
  const kind = pending.kind;
  if (!cardsPickable(kind, owner === me)) return { pick, action: null };
  if (kind === "steal") return { pick, action: { type: "steal", targetId: owner, theirs: cardId } };
  const next: Pick = { ...pick };
  if (owner === me) next.mine = pick.mine === cardId ? null : cardId;
  else next.theirs = pick.theirs?.targetId === owner && pick.theirs.id === cardId ? null : { targetId: owner, id: cardId };
  return { pick: next, action: ready(kind, next) };
}

/** I tapped `targetId`'s row. */
export function tapPlayer(pending: Pending, pick: Pick, me: string, targetId: string): Tap {
  const kind = pending.kind;
  if (targetId === me || !rowPick(kind)) return { pick, action: null };
  if (kind !== "dump") return { pick, action: { type: "target", targetId } };
  const next: Pick = { ...pick, targetId: pick.targetId === targetId ? null : targetId };
  return { pick: next, action: ready(kind, next) };
}

/** The status line and turn word for my pending card. */
export const CHOICE_TEXT: Record<Pending["kind"], { status: string; turn: string }> = {
  shove: { status: "Pick a player to push a card onto.", turn: "Pick a player" },
  fuse: { status: "Pick a player to get the Burn.", turn: "Pick a player" },
  wrench: { status: "Pick one of your cards and one of theirs.", turn: "Pick 2 cards" },
  steal: { status: "Pick a card to take from a player.", turn: "Pick a card" },
  dump: { status: "Pick one of your cards and a player to give it to.", turn: "Pick a card" },
  audit: { status: "Pick a player who saved. They lose their highest card.", turn: "Pick a player" },
};

// ---- log --------------------------------------------------------------------------

export function describe(e: OverheatEvent, props: GameViewProps): string | null {
  const me = props.playerId;
  const who = (id: string | null | undefined) => (id === me ? "You" : seatName(props.room, id));
  const whom = (id: string | null | undefined) => (id === me ? "you" : seatName(props.room, id));
  const whose = (id: string) => (id === me ? "Your" : `${seatName(props.room, id)}'s`);
  switch (e.type) {
    case "round-start":
      return `Round ${e.round}. The heat limit is ${e.gauge}.`;
    case "flip": {
      const x2 = e.mult === 2 ? " (counts double)" : "";
      if (e.by) return `${who(e.by)} pushed ${an(cardLabel(e.card))}${x2} onto ${whom(e.playerId)}.`;
      if (e.card.kind === "power" && !isAimed(e.card.power)) return null;
      return `${who(e.playerId)} flipped ${an(cardLabel(e.card))}${x2}.`;
    }
    case "keep":
      // My own keep says which card, in "keep-card".
      if (e.playerId === me) return null;
      return `${who(e.playerId)} kept a power card. ${who(e.playerId)} has ${handBadge(e.count)}.`;
    case "keep-card":
      return e.playerId === me ? `You kept ${an(cardLabel(e.card))}.` : null;
    case "play":
      return `${who(e.playerId)} played ${an(cardLabel(e.card))}.`;
    case "pass":
      return `${who(e.playerId)} passed.`;
    case "vent":
      return `Cool: −${VENT_HEAT} heat for ${whom(e.playerId)}. Heat is ${e.heat} now.`;
    case "turbo":
      return `Double: the next number card for ${whom(e.playerId)} counts double.`;
    case "shove":
      return null; // The flip that follows says it.
    case "wrench":
      return `${who(e.playerId)} gave ${whom(e.targetId)} ${an(cardLabel(e.gave.card))} and took ${an(cardLabel(e.got.card))}.`;
    case "fuse":
      return `${who(e.playerId)} put a Burn on ${whom(e.targetId)}. Each Burn adds 1 heat at the start of each of ${e.targetId === me ? "your" : "their"} turns.`;
    case "steal":
      return e.kept
        ? `${who(e.playerId)} took ${an(cardLabel(e.card.card))} from ${whom(e.targetId)}.`
        : `${who(e.playerId)} took ${an(cardLabel(e.card.card))} from ${whom(e.targetId)} and threw it away.`;
    case "dump":
      return `${who(e.playerId)} gave ${an(cardLabel(e.card.card))} to ${whom(e.targetId)}.`;
    case "audit":
      return `${who(e.playerId)} played an Audit on ${whom(e.targetId)}. ${who(e.targetId)} lost ${an(cardLabel(e.card.card))}.`;
    case "block":
      return `${whose(e.playerId)} Block stopped it.`;
    case "bounty":
      if (e.targetId === me) return `${who(e.playerId)} made you go too hot. You were the leader, so ${who(e.playerId)} gets ${e.points} points.`;
      return `${who(e.playerId)} made ${whom(e.targetId)} go too hot. ${who(e.targetId)} was the leader, so ${e.playerId === me ? "you get" : `${who(e.playerId)} gets`} ${e.points} points.`;
    case "rescore":
      return `${who(e.playerId)} ${e.playerId === me ? "have" : "has"} ${e.score} points now.`;
    case "fuse-tick":
      return `Burn: +${e.fuses} heat for ${whom(e.playerId)}. Heat is ${e.heat} now.`;
    case "heatwave":
      return `Limit down! The limit is ${HEATWAVE_DROP} lower for ${e.hit.length === 1 ? whom(e.hit[0]) : "every player still flipping"}.`;
    case "fizzle":
      if (e.card?.power === "block") return "A Block works only from a hand. This one does nothing.";
      return e.card ? `Nobody to aim the ${cardLabel(e.card)} at. It does nothing.` : "No cards left to flip.";
    case "bust":
      return `Too hot! ${who(e.playerId)} went over the limit (${e.heat} / ${e.gauge}).`;
    case "redline":
      return `${who(e.playerId)} hit the limit exactly. +10!`;
    case "bank":
      return `${who(e.playerId)} saved ${e.points} points. Score: ${e.score}.`;
    case "reshuffle":
      return "The used cards were shuffled into a new deck.";
    case "round-end":
      return `Round ${e.round} is over.`;
    case "turn-skipped":
      return `The host skipped ${whom(e.playerId)}.`;
    case "player-removed":
      return `${who(e.playerId)} left the game.`;
    case "game-over":
      if (e.reason === "abandoned") return "Everyone else left.";
      if (e.winnerIds.includes(me)) return e.winnerIds.length > 1 ? "You tied for first. You share the win!" : "You have the highest score. You win!";
      return e.winnerIds.length > 1 ? "Players tied for first." : `${who(e.winnerIds[0])} wins.`;
  }
}
