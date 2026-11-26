import type { PartyStats } from "@games/game-core";

export const COLOURS = ["red", "amber", "blue", "green"] as const;
export type Colour = (typeof COLOURS)[number];
export const POWERS = ["vent", "turbo", "shove", "wrench", "fuse", "heatwave", "steal", "dump", "audit", "block"] as const;
export type PowerKind = (typeof POWERS)[number];
/** The six powers Classic has. Classic never deals the Cutthroat-only cards. */
export const CLASSIC_POWERS = ["vent", "turbo", "shove", "wrench", "fuse", "heatwave"] as const satisfies readonly PowerKind[];
/** Classic copies. The Cutthroat-only cards have none here. */
export const POWER_COPIES: Record<PowerKind, number> = {
  vent: 4, turbo: 3, shove: 3, wrench: 2, fuse: 2, heatwave: 2, steal: 0, dump: 0, audit: 0, block: 0,
};
export const CUTTHROAT_COPIES: Record<PowerKind, number> = {
  vent: 4, turbo: 3, shove: 3, wrench: 2, fuse: 2, heatwave: 2, steal: 3, dump: 2, audit: 2, block: 3,
};
/** Most power cards a player can hold in Cutthroat. */
export const HAND_MAX = 3;
/** Points for making the leader go too hot in Cutthroat. */
export const BOUNTY = 5;

export const GAUGE_MIN = 18,
  GAUGE_MAX = 30,
  VENT_HEAT = 5,
  HEATWAVE_DROP = 3;
export const REDLINE_BONUS = 10,
  COLOUR_BONUS = 5,
  RAINBOW_BONUS = 5;
export const ROUND_END_MS = 3500;
export const TARGET_OPTIONS = [100, 150, 200] as const;

export type PowerSetting = "off" | "classic" | "cutthroat";
export interface OverheatSettings {
  target: number;
  powers: PowerSetting;
}
export const DEFAULT_SETTINGS: OverheatSettings = { target: 150, powers: "classic" };

export interface NumberCard {
  kind: "number";
  id: number;
  colour: Colour;
  value: number;
}
export interface PowerCard {
  kind: "power";
  id: number;
  power: PowerKind;
}
export type Card = NumberCard | PowerCard;

/** mult 2 = the Turbo'd card: double heat and double points. */
export interface EngineCard {
  card: NumberCard;
  mult: 1 | 2;
}

export type Status = "flipping" | "banked" | "busted" | "out";

export interface OverheatPlayerState {
  id: string;
  score: number;
  removed: boolean;
  status: Status;
  engine: EngineCard[];
  heat: number;
  gauge: number;
  fuses: number;
  turbo: boolean;
  flipped: boolean;
  redline: boolean;
  /** What this round added to score: bank total, 0 on bust. */
  roundPoints: number;
}

export interface Pending {
  kind: "shove" | "fuse" | "wrench" | "steal" | "dump" | "audit";
  chooserId: string;
  card: PowerCard;
  /**
   * The choice comes from a card played from a hand (or a Push from one).
   * Once it resolves, the turn stays with the turn owner if they still flip.
   */
  fromHand: boolean;
  /**
   * A Push turned this card up for the chooser: who pushed it. If the card
   * makes the chooser go too hot, they get the credit (the chooser gets it for
   * anyone else). Missing otherwise.
   */
  by?: string;
}

export type Step = "turn" | "choosing" | "round-end";
export type EndReason = "target" | "abandoned";

export interface OverheatServerState {
  phase: "playing" | "finished";
  step: Step;
  settings: OverheatSettings;
  players: OverheatPlayerState[];
  round: number;
  gauge: number;
  firstIndex: number;
  turnIndex: number;
  pending: Pending | null;
  deck: Card[];
  discard: Card[];
  /** Cutthroat: each player's power cards. Missing in games stored before hands. */
  hands: Record<string, PowerCard[]>;
  /** The turn owner has played a hand card this turn. */
  played: boolean;
  /** Top score at the start of the round, if one player has it (Cutthroat). */
  leaderId: string | null;
  /** Party recap counts. Never in a view. */
  stats: PartyStats;
  roundEndsAt: number;
  winnerIds: string[];
  endReason: EndReason | null;
}

export interface OverheatPublicState {
  players: OverheatPlayerState[]; // every per-player field is public
  step: Step | "finished";
  round: number;
  gauge: number;
  currentPlayerId: string | null;
  pending: Pending | null;
  awaitedId: string | null;
  deckCount: number;
  discardCount: number;
  /** How many cards each player holds. The cards stay hidden. */
  handCounts: Record<string, number>;
  leaderId: string | null;
  played: boolean;
  roundEndsAt: number;
  settings: OverheatSettings;
  winnerIds: string[];
  endReason: EndReason | null;
}

/** Your own hand. Empty outside Cutthroat. */
export interface OverheatPrivateState {
  hand: PowerCard[];
}

export type OverheatAction =
  | { type: "flip" }
  | { type: "bank" }
  | { type: "play"; cardId: number }
  | { type: "pass" }
  | { type: "target"; targetId: string }
  | { type: "wrench"; targetId: string; mine: number; theirs: number } // card ids
  | { type: "steal"; targetId: string; theirs: number }
  | { type: "dump"; targetId: string; mine: number };

export type OverheatEvent =
  | { type: "round-start"; round: number; gauge: number; firstPlayerId: string }
  /** A card landed face up for `playerId`. `by` is set when it came from someone's Shove. */
  | { type: "flip"; playerId: string; card: Card; mult: 1 | 2; heat: number; by?: string }
  /** A power went into a hand. Public: only who and the new hand size. */
  | { type: "keep"; playerId: string; count: number }
  /** The same, with the card. Only that player sees it. */
  | { type: "keep-card"; playerId: string; card: PowerCard }
  /** A card played from a hand, shown to all. */
  | { type: "play"; playerId: string; card: PowerCard }
  | { type: "pass"; playerId: string }
  | { type: "vent"; playerId: string; heat: number }
  | { type: "turbo"; playerId: string }
  | { type: "shove"; playerId: string; targetId: string }
  | { type: "wrench"; playerId: string; targetId: string; gave: EngineCard; got: EngineCard }
  | { type: "fuse"; playerId: string; targetId: string; fuses: number }
  | { type: "fuse-tick"; playerId: string; heat: number; fuses: number }
  | { type: "heatwave"; playerId: string; hit: string[] }
  /** `kept` false: the thief was not flipping, so the card went to the discard. */
  | { type: "steal"; playerId: string; targetId: string; card: EngineCard; kept: boolean }
  | { type: "dump"; playerId: string; targetId: string; card: EngineCard }
  /** `score` is the target's score after the card is gone. */
  | { type: "audit"; playerId: string; targetId: string; card: EngineCard; score: number }
  /** `playerId`'s Block cancelled `card`, played by `byId`. */
  | { type: "block"; playerId: string; byId: string; card: PowerCard }
  /** `playerId`'s card made the leader `targetId` go too hot: `points` added to their score. */
  | { type: "bounty"; playerId: string; targetId: string; points: number }
  /** A saved player's row changed: their round points and score now. */
  | { type: "rescore"; playerId: string; roundPoints: number; score: number }
  /** An aimed card with no valid target, or a Shove/Flip with no cards left. */
  | { type: "fizzle"; playerId: string; card: PowerCard | null }
  | { type: "bust"; playerId: string; heat: number; gauge: number }
  | { type: "redline"; playerId: string }
  | { type: "bank"; playerId: string; points: number; score: number; redline: boolean }
  | { type: "reshuffle"; deckCount: number }
  | { type: "round-end"; round: number }
  | { type: "turn-skipped"; playerId: string }
  | { type: "player-removed"; playerId: string }
  | { type: "game-over"; winnerIds: string[]; reason: EndReason };
