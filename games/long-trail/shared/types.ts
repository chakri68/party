import type { Ballot, PartyStats } from "@games/game-core";
import type { Armed, Used } from "./events.ts";
import type { JobInfo } from "./info.ts";
import type { ChoiceEvent, Danger, LegKind } from "./pack.ts";
import type { DayLog, Recap } from "./recap.ts";
import type { EndView } from "./scoring.ts";
import type { Caravan } from "./travel.ts";

export type SettingId = "trade-route"; // monsoon, space-convoy later
export type Length = "short" | "normal" | "epic";
export interface LongTrailSettings {
  setting: SettingId;
  length: Length;
}
export const DEFAULT_SETTINGS: LongTrailSettings = { setting: "trade-route", length: "normal" };

export type Pace = "slow" | "steady" | "hard";
export type Rations = "full" | "half" | "none";
export type Health = 0 | 1 | 2 | 3; // dead, badly hurt, sick, well
export type Supply = "food" | "water" | "medicine" | "animals";
export type JobId = "guide" | "healer" | "trader" | "quartermaster" | "scout" | "driver" | "cook" | "lookout";
export type ArmableJob = "guide" | "scout" | "quartermaster" | "lookout";
export type Grade = "broke" | "fair" | "rich" | "legendary";
export type Phase = "reveal" | "plan" | "vote" | "choice" | "summary" | "recap" | "over";

export interface Stock {
  food: number;
  water: number;
  medicine: number;
  coins: number;
  animals: number;
  cargo: Record<string, number>; // good id -> units
}
/** item: a good or a Supply. qty > 0 buys, qty < 0 sells (goods only). */
export interface Trade {
  item: string;
  qty: number;
}
export interface Plan {
  pace: Pace;
  rations: Rations;
  rest: boolean;
  fork: string | null; // next stop id, only at a fork
  doses: string[]; // player ids getting medicine today
  trades: Trade[]; // only at a market stop
}
export type Goal =
  | { kind: "coins"; atLeast: number }
  | { kind: "protect"; target: string }
  | { kind: "arrive-by"; share: number } // day <= ceil(share * deadline)
  | { kind: "visit"; stop: string }
  | { kind: "cargo"; good: string; atLeast: number }
  | { kind: "never-starve" } // no day on "none" rations
  | { kind: "nobody-dies" }
  | { kind: "grade"; atLeast: Grade };

export type LongTrailAction =
  | { type: "ack" }
  | { type: "propose"; plan: Plan }
  | { type: "vote"; vote: "go" | "no-go" }
  | { type: "choose"; option: 0 | 1 }
  | { type: "arm"; on: boolean } // the actor's own armable job
  | { type: "next" }; // summary and recap

export type Vote = "go" | "no-go";
/** Days of food or water left at the current plan: >= 6, 3-5, 1-2, 0. */
export type Band = "plenty" | "some" | "low" | "out";

/** Fixed per phase, no speed preset. */
export const TIMERS: Record<Exclude<Phase, "over">, number> = {
  reveal: 30_000,
  plan: 45_000,
  vote: 25_000,
  choice: 20_000,
  summary: 5_000,
  recap: 20_000,
};

export interface LongTrailPlayer {
  id: string;
  left: boolean;
  away: boolean;
}
export interface ChoiceBallot {
  eligible: string[];
  votes: Record<string, 0 | 1>;
}
/** A day that waits on a choice vote: the log so far and the stock it started with. */
export interface DayDraft {
  log: DayLog;
  before: Stock;
}

export interface LongTrailServerState {
  phase: Phase;
  deadline: number;
  phaseMs: number;
  settings: LongTrailSettings;
  players: LongTrailPlayer[];
  /** In the game, alive or dead. A removed player's traveller is taken out. */
  travellers: string[];
  caravan: Caravan;
  dangers: Record<string, Danger>; // leg key `${from}>${to}`
  jobs: Record<string, JobId>;
  goals: Record<string, Goal>;
  goalText: Record<string, string>;
  armed: Armed;
  used: Used;
  perksUsedThisLeg: { driver: boolean; cook: boolean };
  leader: number; // seat
  proposalNo: 1 | 2;
  plan: Plan | null; // the proposal being voted on
  lastPlan: Plan | null; // yesterday's, for the open plan
  ballot: Ballot<Vote> | null;
  choiceBallot: ChoiceBallot | null;
  choice: ChoiceEvent | null;
  acks: string[]; // reveal Got it, summary and recap Next
  drawn: string[]; // event card ids, so the deck runs through before repeating
  proposals: DayLog["proposals"]; // today's, closed
  draft: DayDraft | null;
  fired: ArmableJob[]; // abilities that fired on the last day played
  log: DayLog[];
  lastDay: DayLog | null;
  recap: Recap | null;
  end: EndView | null;
  interrupted: boolean;
  stats: PartyStats;
}

export interface PublicStop {
  id: string;
  name: string;
  next: string[]; // stop ids; two at a fork
  market: boolean;
}

export interface LongTrailPublicState {
  phase: Phase;
  deadline: number;
  phaseMs: number;
  settings: LongTrailSettings;
  players: { id: string; left: boolean; job: JobId }[];
  leader: string;
  proposalNo: 1 | 2;
  day: number;
  deadlineDay: number;
  route: { start: string; end: string; stops: PublicStop[] };
  at: string;
  leg: { to: string; km: number; kind: LegKind; kmLeft: number } | null; // null while halted at `at`
  visited: string[];
  stock: { food: Band; water: Band; medicine: number; coins: number; animals: number; cargo: Record<string, number> };
  capacity: number; // cargo units the animals can carry at a normal pace
  prices: { goods: Record<string, number>; supplies: Partial<Record<Supply, number>> } | null; // halted at a market
  travellers: { id: string; health: Health }[];
  openPlan: Plan; // what Skip or a timeout proposes, and where the plan form starts
  plan: Plan | null;
  votes: { voted: string[]; of: number } | null; // the open plan or choice vote
  proposals: DayLog["proposals"]; // today's closed votes, by name
  choice: { id: string; text: string; options: [string, string] } | null;
  fired: ArmableJob[];
  lastDay: DayLog | null;
  acked: string[];
  recap: Recap | null; // from the recap phase on
  goals: Record<string, Goal> | null; // from the recap phase on
  interrupted: boolean;
}

export interface LongTrailPrivateState {
  job: JobId | null;
  info: JobInfo | null;
  goal: Goal | null;
  goalText: string | null;
  ability: { job: ArmableJob; armed: boolean; used: boolean; canArm: boolean } | null;
  vote: Vote | null;
  choiceVote: 0 | 1 | null;
  acked: boolean;
}

export type LongTrailEvent =
  | { type: "plan"; leader: string; proposalNo: 1 | 2 }
  | { type: "proposed"; by: string; plan: Plan }
  | { type: "vote-closed"; passed: boolean; votes: Record<string, Vote> }
  | { type: "choice"; id: string }
  | { type: "day-done"; day: number }
  | { type: "recap" }
  | { type: "game-over"; interrupted: boolean };
