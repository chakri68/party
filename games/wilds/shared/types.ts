import type { Ballot, PartyStats } from "@games/game-core";

export type TileId = string; // "q,r"
export type Terrain =
  | "grass" | "forest" | "reeds" | "river" | "bridge" | "broken" | "rock" | "camp" | "gate" | "ruin" | "ash";
export type RuinId = "shrine" | "tower" | "cave";
export type Role = "runner" | "fixer" | "protector" | "guide";
export type Attr = "strength" | "mind" | "stealth";
export type Way = "careful" | "normal" | "bold";
export type ItemId = "torch" | "planks" | "medkit" | "lure";
export type EventId =
  | "quiet-morning" | "old-camp" | "bird-calls" | "clear-sky" | "rain" | "dry-wind"
  | "hungry-spider" | "falling-rocks" | "rotten-bridge" | "echo-reeds" | "stone-hand" | "warm-spring";
export type Phase = "roles" | "plan" | "choice" | "report" | "over";

export interface Tile {
  id: TileId; q: number; r: number; terrain: Terrain;
  open: boolean; fire: number; noise: number; // fire: 0 = not burning, else rounds left
  cache: boolean; nest: boolean; ruin: RuinId | null;
  litThisTurn: boolean; // set by spread, cleared after the island turn
}
export interface Explorer {
  id: string; role: Role | null; tile: TileId; hearts: number; items: ItemId[];
  down: boolean; shield: boolean; left: boolean;
}
export interface Spider { tile: TileId; rest: boolean; still: boolean } // rest: scared last turn; still: Quiet morning
export interface World {
  tiles: Record<TileId, Tile>; order: TileId[]; // order: fixed tile order, also the tie-break
  explorers: Explorer[]; spider: Spider;
  stones: RuinId[]; half: RuinId[]; gateOpen: boolean;
  sun: number; round: number; sunLimit: number;
  speedBonus: number; // Hungry spider: +1 this round
}

export type Card =
  | { kind: "move"; to: TileId }
  | { kind: "look" }
  | { kind: "act"; at: TileId; approach?: 0 | 1 | "force"; way?: Way }
  | { kind: "item"; item: ItemId; at?: TileId; who?: string } // medkit uses who; the rest use at
  | { kind: "help"; who: string }
  | { kind: "guard" };
export type Plan = [Card, Card];

export interface LiveEvent { id: EventId; tiles: TileId[] }
export interface Deck { pile: EventId[]; lastKind: "calm" | "harm" | "bargain" | null }
export interface SpiderMove {
  path: TileId[]; why: "scared" | "noise" | "hunt" | "home" | "rest" | "still"; bites: string[];
}
export interface PendingBargain { tile: TileId; due: number } // the stone hand's noise, on round `due`

export type Step =
  | { t: "move"; who: string; path: TileId[] }
  | { t: "open"; tiles: TileId[] }
  | {
      t: "roll"; who: string; ruin: RuinId; attr: Attr; dice: [number, number]; bonus: number;
      need: 7 | 9; pass: boolean; helpers: string[];
    }
  | { t: "stone"; who: string; ruin: RuinId; how: "roll" | "half" | "force" }
  | { t: "half"; who: string; ruin: RuinId }
  | { t: "damage"; who: string; by: "fire" | "spider" | "rocks" | "ruin"; blocked: boolean }
  | { t: "down"; who: string } | { t: "up"; who: string; by: string | null }
  | { t: "heal"; who: string; by: string; hearts: number }
  | { t: "item"; who: string; item: ItemId; at: TileId | null }
  | { t: "lit"; tile: TileId; by: string | null } | { t: "out"; tiles: TileId[] }
  | { t: "burnt"; tile: TileId; to: "ash" | "broken" }
  | { t: "fire-full" }
  | { t: "bridge"; tile: TileId; fixed: boolean; by: string | null }
  | { t: "spider"; path: TileId[]; why: "scared" | "noise" | "hunt" | "home" | "rest" | "still" }
  | { t: "noise"; tile: TileId; level: number }
  | { t: "cache"; who: string; item: ItemId | null }
  | { t: "gate"; who: string }
  | { t: "guard"; who: string; why: string | null } // why: null for a planned Guard, else the reason it became one
  | { t: "help-nothing"; who: string; target: string }
  | { t: "event"; id: EventId; option: number | null; nothing: boolean };

export interface WildsSettings { sunLimit: 8 | 10 | 12; planSeconds: 30 | 45 | 60 }
export const DEFAULT_SETTINGS: WildsSettings = { sunLimit: 10, planSeconds: 45 };

export type WildsAction =
  | { type: "pick-role"; role: Role }
  | { type: "set-plan"; plan: Plan }
  | { type: "ready" } | { type: "unready" }
  | { type: "vote"; option: number }
  | { type: "next" };

export interface WildsServerState {
  phase: Phase;
  deadline: number;
  settings: WildsSettings;
  world: World;
  board: { camp: TileId; gate: TileId; nest: TileId; ruins: Record<RuinId, TileId> };
  deck: Deck;
  event: LiveEvent | null; // this round's (round 1's card waits here, tiles unpicked, until round 1 opens)
  next: EventId | null; // next round's card: only a Guide sees it
  pending: PendingBargain | null;
  plans: Record<string, Plan>;
  ready: string[];
  ballot: Ballot<string> | null;
  nexts: string[]; // who tapped Next in the report
  arrow: SpiderMove | null; // the spider's move if nothing changes, set as the plan opens
  beatSteps: Step[]; // the beats, held while the choice is open
  lastRound: RoundLog | null;
  end: "win" | "sun" | "down" | null;
  interrupted: boolean;
  stats: PartyStats;
}

export interface RoundLog {
  round: number;
  steps: Step[];
  /** Report lines. Names are tokens like `{{p0}}`, for the client to fill in. */
  lines: string[];
  /** Votes for each option, once the choice has closed. Null when the event had no choice. */
  votes: number[] | null;
}

export type PublicTile =
  | {
      id: TileId; open: true; q: number; r: number; terrain: Terrain; fire: number; noise: number;
      cache: boolean; nest: boolean; ruin: RuinId | null;
    }
  | { id: TileId; open: false; smoke?: true; marker?: "gate" | RuinId };

export interface PublicExplorer {
  id: string; role: Role | null; tile: TileId; hearts: number; items: ItemId[];
  down: boolean; left: boolean; ready: boolean;
}

export interface WildsPublicState {
  phase: Phase;
  deadline: number;
  round: number;
  sun: number;
  sunLimit: number;
  planSeconds: WildsSettings["planSeconds"];
  stones: RuinId[];
  half: RuinId[];
  gateOpen: boolean;
  order: string[];
  tiles: PublicTile[];
  explorers: PublicExplorer[];
  /** Null while the spider is in the fog. */
  spider: { tile: TileId; arrow: SpiderMove | null } | null;
  event: { id: EventId; tiles: TileId[]; options: string[] | null } | null;
  pending: PendingBargain | null;
  /** Who has voted in an open choice. Never what. */
  voted: string[] | null;
  lastRound: RoundLog | null;
  end: "win" | "sun" | "down" | null;
}

export interface WildsPrivateState {
  plan: Plan | null;
  ready: boolean;
  vote: number | null;
  /** Only in a Guide's private state. */
  next?: EventId | null;
}

export type WildsEvent =
  | { type: "phase"; phase: Phase; round: number }
  | { type: "game-over"; interrupted: boolean };
