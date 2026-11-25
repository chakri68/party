/** Every action card kind, in the order the rules list them. */
export const ACTION_KINDS = [
  "quick-fix", "blame-game", "not-me", "revenge", "hr-complaint",
  "fake-report", "overtime", "intern", "promotion", "spy",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
/** Every Problem kind, in the order the rules list them. */
export const PROBLEM_KINDS = ["server-down", "data-leak", "angry-client"] as const;
export type ProblemKind = (typeof PROBLEM_KINDS)[number];
/** `id` is `${kind}-${n}`, n from 1. */
export interface ActionCard { id: string; kind: ActionKind }
export interface ProblemCard { id: string; kind: ProblemKind }
export type PileCard = ActionCard | ProblemCard;

/** Cards played in your own turn, before you draw. */
export const PROACTIVE: readonly ActionKind[] = ["overtime", "intern", "promotion", "spy"];
export const REACTION_SECONDS_OPTIONS = [5, 8, 12] as const;
export interface NmpSettings { reactionSeconds: number }
export const DEFAULT_SETTINGS: NmpSettings = { reactionSeconds: 8 };

export const TURN_MS = 25_000;
export const PROBLEM_MS = 15_000;
export const MAX_WARNINGS = 3;
export const MAX_TRANSFERS = 4;
export const ACTION_BUDGET = 2;
export const HAND_SIZE = 5;

export type Step = "action" | "problem" | "target" | "hr" | "challenge" | "finished";

export function isProblem(c: PileCard): c is ProblemCard {
  return (PROBLEM_KINDS as readonly string[]).includes(c.kind);
}

export interface NmpPublicPlayer {
  id: string; warnings: number; handCount: number; shield: boolean; overtime: boolean;
  fired: boolean; firedOrder: number | null; removed: boolean; away: boolean; passed: boolean;
}
export interface PublicProblem {
  cardId: string; kind: ProblemKind; ownerId: string; lastMovedFromId: string | null; attemptsLeft: number;
}
export type PublicMove =
  | { kind: "blame"; actorId: string; targetId: string }
  | { kind: "not-me"; actorId: string }
  | { kind: "revenge"; actorId: string; targetId: string };

export type NmpEvent =
  | { type: "turn"; playerId: string; round: number }
  | { type: "played"; playerId: string; kind: ActionKind; targetId?: string }
  | { type: "drew"; playerId: string; problem: ProblemKind | null }
  | { type: "drew-card"; card: ActionCard }
  | { type: "spied"; fromId: string; toId: string; card?: ActionCard }
  | { type: "moved"; problemKind: ProblemKind; fromId: string; toId: string }
  | { type: "fixed"; playerId: string; by: "quick-fix" | "report" }
  | { type: "warned"; playerId: string; amount: number; shielded: boolean }
  | { type: "fired"; playerId: string; order: number }
  | { type: "report"; playerId: string }
  | { type: "challenged"; challengerId: string; ownerId: string; card: ActionCard; lied: boolean }
  | { type: "passed"; playerId: string }
  | { type: "removed"; playerId: string }
  | { type: "game-over"; winnerIds: string[] };

export interface NmpPublicState {
  players: NmpPublicPlayer[]; step: Step; token: number; round: number;
  turnPlayerId: string | null; actionsLeft: number; drawCount: number; discardCount: number;
  problem: PublicProblem | null;
  /** The current transfer attempt, in order. */
  moves: PublicMove[];
  /** A Fake Report waiting on challenges. */
  report: { ownerId: string } | null;
  deadline: number | null; windowMs: number | null;
  /** The latest public event, for the feed line. */
  lastEvent: NmpEvent | null;
  winnerIds: string[];
}
export interface NmpPrivateState {
  hand: ActionCard[];
  token: number;
  /** Card ids this player may play right now, and the seats each may target. null = no target needed. */
  playable: { cardId: string; targets: string[] | null }[];
  canDraw: boolean; canAccept: boolean; canPass: boolean; canChallenge: boolean;
  /** The face-down card, owner only. */
  myReportCard: ActionCard | null;
}
export type NmpAction =
  | { type: "play"; token: number; cardId: string; targetId?: string }
  | { type: "draw"; token: number }
  | { type: "fix"; token: number; cardId: string }
  | { type: "blame"; token: number; cardId: string; targetId: string }
  | { type: "fake-report"; token: number; cardId: string; faceDownId: string }
  | { type: "accept"; token: number }
  | { type: "not-me"; token: number; cardId: string }
  | { type: "revenge"; token: number; cardId: string; targetId: string }
  | { type: "hr"; token: number; cardId: string }
  | { type: "challenge"; token: number }
  | { type: "pass"; token: number };
