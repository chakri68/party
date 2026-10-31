/** A die face. With wild ones on, 1 counts as every face (except when the bid is on 1s). */
export type Face = 1 | 2 | 3 | 4 | 5 | 6;

export const FACES: readonly Face[] = [1, 2, 3, 4, 5, 6];

export const STARTING_DICE_OPTIONS = [3, 4, 5] as const;
export type StartingDice = (typeof STARTING_DICE_OPTIONS)[number];

/**
 * How long the reveal stays up before the next round rolls, unless everyone taps
 * first. The flip-and-count takes ~3 s of it; the verdict gets the rest.
 */
export const REVEAL_MS = 7000;

export interface LiarsDiceSettings {
  /** 1s count as any face, with the half/double rule for bidding on or off them. */
  wildOnes: boolean;
  /** The exact-count call is allowed. */
  spotOn: boolean;
  /** Dice each player starts with. Spot on never takes anyone above this. */
  startingDice: StartingDice;
}

export const DEFAULT_SETTINGS: LiarsDiceSettings = { wildOnes: true, spotOn: true, startingDice: 5 };

/** "At least `quantity` dice showing `face`, under all the cups." */
export interface Bid {
  playerId: string;
  quantity: number;
  face: Face;
}

export type CallKind = "liar" | "spot-on";

/** A call, after the cups come up. All public: every die was shown. */
export interface Reveal {
  call: CallKind;
  callerId: string;
  /** The standing bid that got called. */
  bid: Bid;
  /** Everyone's dice at the moment of the call, by player. */
  dice: Record<string, Face[]>;
  /** How many dice matched the bid (wild 1s included where they count). */
  count: number;
  /** Whether 1s counted as the bid face here. False for a bid on 1s, or with wild ones off. */
  wild: boolean;
  /** Liar: the bid fell short. Spot on: the count was exact. */
  success: boolean;
  /** Who loses a die. Null when a spot on hit (nobody does). */
  loserId: string | null;
  /** Who gets a die back: the spot-on caller, if under the cap. */
  gainerId: string | null;
  /** The loser's last die went: they're out. */
  eliminatedId: string | null;
}

export interface LiarsDicePlayerState {
  id: string;
  /** How many dice they have. Zero means out. */
  count: number;
  /** This round's roll (secret until a call), or the last one through a reveal. */
  dice: Face[];
  /** Host removed them; their dice left the table. */
  removed: boolean;
  away: boolean;
}

/**
 * "bidding": waiting on the current player. "reveal": a call's been made and
 * every die is face up; a timer (or everyone tapping ready) rolls the next round.
 */
export type Phase = "bidding" | "reveal" | "over";

export interface LiarsDiceServerState {
  phase: Phase;
  settings: LiarsDiceSettings;
  players: LiarsDicePlayerState[];
  round: number;
  /** Whose turn to bid or call. During a reveal: who starts the next round. */
  turnIndex: number;
  /** Standing bid. Null before the round's opening bid. */
  bid: Bid | null;
  /** This round's bids, oldest first. */
  history: Bid[];
  /** The most recent call, kept up until the next one. */
  reveal: Reveal | null;
  revealEndsAt: number;
  /** Tapped "Next round" during this reveal. */
  ready: string[];
  /** Ids in the order they ran out of dice. */
  outOrder: string[];
  winnerId: string | null;
  /** Test-only dice, used up first, in seat order, round after round. Never public. */
  rigged: Face[];
}

export interface LiarsDicePublicPlayer {
  id: string;
  diceCount: number;
  removed: boolean;
  /** No dice left. */
  out: boolean;
  /** Tapped "Next round" (reveal only). */
  ready: boolean;
}

export interface LiarsDicePublicState {
  phase: Phase;
  players: LiarsDicePublicPlayer[];
  round: number;
  /** Who's bidding. Null outside "bidding". */
  currentPlayerId: string | null;
  /** Who starts the next round, during a reveal. */
  nextStarterId: string | null;
  totalDice: number;
  bid: Bid | null;
  history: Bid[];
  reveal: Reveal | null;
  /** While revealing: when the next round rolls on its own (server clock). */
  revealEndsAt: number | null;
  revealMs: number;
  settings: LiarsDiceSettings;
  winnerId: string | null;
  outOrder: string[];
}

export interface LiarsDicePrivateState {
  /** Your dice, low to high. Empty once you're out. */
  dice: Face[];
  canBid: boolean;
  canCallLiar: boolean;
  canSpotOn: boolean;
  canReady: boolean;
}

export type LiarsDiceAction =
  | { type: "bid"; quantity: number; face: Face }
  | { type: "liar" }
  | { type: "spot-on" }
  /** During a reveal: skip the wait. */
  | { type: "ready" };

export type RollReason = "start" | "next" | "void";

export type LiarsDiceEvent =
  /** A new round: everyone's cup shakes. Counts only; the faces go privately. */
  | { type: "rolled"; round: number; counts: Record<string, number>; starterId: string; reason: RollReason }
  | { type: "you-rolled"; dice: Face[] }
  | { type: "bid"; playerId: string; quantity: number; face: Face }
  | ({ type: "called" } & Reveal)
  | { type: "ready"; playerId: string }
  | { type: "turn-skipped"; playerId: string }
  | { type: "player-removed"; playerId: string; voided: boolean }
  | { type: "game-over"; winnerId: string | null };
