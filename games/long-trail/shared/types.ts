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

// Task 6 fills these in.
export interface LongTrailServerState {}
export interface LongTrailPublicState {}
export interface LongTrailPrivateState {}
export interface LongTrailEvent {}
