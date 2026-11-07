export const COLOURS = ["red", "amber", "blue", "green"] as const;
export type Colour = (typeof COLOURS)[number];
export const POWERS = ["vent", "turbo", "shove", "wrench", "fuse", "heatwave"] as const;
export type PowerKind = (typeof POWERS)[number];
export const POWER_COPIES: Record<PowerKind, number> = { vent: 4, turbo: 3, shove: 3, wrench: 2, fuse: 2, heatwave: 2 };

export const GAUGE_MIN = 18,
  GAUGE_MAX = 30,
  VENT_HEAT = 5,
  HEATWAVE_DROP = 3;
export const REDLINE_BONUS = 10,
  COLOUR_BONUS = 5,
  RAINBOW_BONUS = 5;
export const ROUND_END_MS = 3500;
export const TARGET_OPTIONS = [100, 150, 200] as const;

export type PowerSetting = "off" | "classic";
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
  kind: "shove" | "fuse" | "wrench";
  chooserId: string;
  card: PowerCard;
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
  roundEndsAt: number;
  settings: OverheatSettings;
  winnerIds: string[];
  endReason: EndReason | null;
}

export type OverheatPrivateState = Record<string, never>;

export type OverheatAction =
  | { type: "flip" }
  | { type: "bank" }
  | { type: "target"; targetId: string }
  | { type: "wrench"; targetId: string; mine: number; theirs: number }; // card ids

export type OverheatEvent =
  | { type: "round-start"; round: number; gauge: number; firstPlayerId: string }
  /** A card landed face up for `playerId`. `by` is set when it came from someone's Shove. */
  | { type: "flip"; playerId: string; card: Card; mult: 1 | 2; heat: number; by?: string }
  | { type: "vent"; playerId: string; heat: number }
  | { type: "turbo"; playerId: string }
  | { type: "shove"; playerId: string; targetId: string }
  | { type: "wrench"; playerId: string; targetId: string; gave: EngineCard; got: EngineCard }
  | { type: "fuse"; playerId: string; targetId: string; fuses: number }
  | { type: "fuse-tick"; playerId: string; heat: number; fuses: number }
  | { type: "heatwave"; playerId: string; hit: string[] }
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
