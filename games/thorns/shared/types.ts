export type Disc = "rose" | "thorn";

/** Everyone starts with three roses and one thorn. */
export const START_ROSES = 3;
export const START_DISCS = START_ROSES + 1;

export const POINTS_OPTIONS = [2, 3] as const;
export type PointsToWin = (typeof POINTS_OPTIONS)[number];

export interface ThornsSettings {
  pointsToWin: PointsToWin;
}

export const DEFAULT_SETTINGS: ThornsSettings = { pointsToWin: 2 };

/** How long the result stays up before the next round, unless everyone taps Ready first. */
export const RESULT_MS = 3000;
/** Extra result time per disc flipped automatically, so the show isn't cut short. */
export const FLIP_PACE_MS = 650;

/**
 * "placing-first": everyone puts a disc down at once. "turns": place or bid.
 * "bidding": raise or pass. "flipping": the challenger turns discs over.
 * "result": a beat to take it in. "over": someone won.
 */
export type Phase = "placing-first" | "turns" | "bidding" | "flipping" | "result" | "over";

export type EndReason = "points" | "last-standing" | "abandoned";

export interface ThornsPlayerState {
  id: string;
  /** Roses owned, in hand or on the mat. */
  roses: number;
  /** Still owns their thorn, in hand or on the mat. */
  thorn: boolean;
  /** Face down on their mat, bottom first. */
  stack: Disc[];
  points: number;
  /** Raised and then passed this round, or passed outright. */
  passed: boolean;
  /** Tapped Ready during the result. */
  ready: boolean;
  removed: boolean;
  away: boolean;
  /** The challenge that cost them a disc, while its result is up. Theirs alone to know. */
  lostDisc: Disc | null;
}

export interface Flip {
  owner: string;
  disc: Disc;
}

export interface Challenge {
  challengerId: string;
  amount: number;
  /** In the order they turned over: the challenger's own stack first, top down. */
  flips: Flip[];
}

export interface RoundResult {
  outcome: "success" | "failure";
  challengerId: string;
  amount: number;
  /** Whose thorn ended it. */
  thornOwnerId: string | null;
  /** Who starts the next round (null when the game's over). */
  nextStartId: string | null;
  /** The challenger ran out of discs. */
  eliminated: boolean;
}

export interface ThornsServerState {
  phase: Phase;
  settings: ThornsSettings;
  players: ThornsPlayerState[];
  round: number;
  /** Who starts this round's turns. */
  startIndex: number;
  /** Whose turn it is in "turns" and "bidding". */
  turnIndex: number;
  bid: { amount: number; bidderId: string } | null;
  challenge: Challenge | null;
  result: RoundResult | null;
  resultEndsAt: number;
  resultMs: number;
  winnerId: string | null;
  endReason: EndReason | null;
}

export interface ThornsPublicPlayer {
  id: string;
  /** Discs owned: the only hint of what someone has left. Never which. */
  discs: number;
  /** Discs face down on their mat. */
  height: number;
  points: number;
  /** Lost every disc. */
  out: boolean;
  removed: boolean;
  passed: boolean;
  ready: boolean;
}

export interface ThornsPublicState {
  phase: Phase;
  round: number;
  pointsToWin: number;
  players: ThornsPublicPlayer[];
  /** Whose move in "turns" and "bidding"; the challenger while flipping. */
  currentPlayerId: string | null;
  startId: string | null;
  /** Discs on every mat. The most anyone can bid. */
  tableTotal: number;
  bid: { amount: number; bidderId: string } | null;
  /** Lowest bid the current player could make. */
  minBid: number;
  /** Public: every flip is face up for everyone. */
  challenge: Challenge | null;
  result: RoundResult | null;
  resultEndsAt: number;
  resultMs: number;
  winnerId: string | null;
  endReason: EndReason | null;
}

export interface ThornsPrivateState {
  /** Roses first, then the thorn if it's in hand. */
  hand: Disc[];
  /** Your own mat, bottom first. */
  stack: Disc[];
  canPlace: boolean;
  canBid: boolean;
  canPass: boolean;
  /** Mats you could flip from right now. */
  canFlip: string[];
  canReady: boolean;
  /** What your failed challenge cost you, while the result is up. */
  lostDisc: Disc | null;
}

export type ThornsAction =
  | { type: "place"; disc: Disc }
  | { type: "bid"; amount: number }
  | { type: "pass" }
  /** The owner's top unflipped disc. Your own stack flips by itself. */
  | { type: "flip"; owner: string }
  | { type: "ready" };

export type ThornsEvent =
  | { type: "round-start"; round: number; startId: string }
  | { type: "placed"; playerId: string; height: number }
  /** Private: which disc you put down. */
  | { type: "you-placed"; disc: Disc }
  | { type: "bid"; playerId: string; amount: number }
  | { type: "passed"; playerId: string }
  | { type: "challenge"; challengerId: string; amount: number }
  | { type: "flipped"; challengerId: string; owner: string; disc: Disc; count: number }
  | { type: "success"; challengerId: string; points: number }
  | { type: "failure"; challengerId: string; thornOwnerId: string; discsLeft: number; eliminated: boolean }
  /** Private, to the challenger alone. */
  | { type: "you-lost"; lostDisc: Disc }
  | { type: "ready"; playerId: string }
  | { type: "round-void"; playerId: string }
  | { type: "turn-skipped"; playerId: string }
  | { type: "player-removed"; playerId: string }
  | { type: "game-over"; winnerId: string | null; reason: EndReason };
