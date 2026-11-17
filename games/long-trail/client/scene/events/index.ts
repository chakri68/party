// The event scenes: what plays on screen for an event or a choice. The stage
// draws the backdrop, then a scene's `back`, the caravan (with the scene's
// `pose`), then the scene's `front`.
import type { EventOutcome } from "../../../shared/events.ts";
import type { SceneId } from "../../../shared/pack.ts";
import type { View } from "../backdrop.ts";
import type { Terrain } from "../model.ts";
import { calm } from "./calm.ts";
import { camelTrouble } from "./camel-trouble.ts";
import { fire } from "./fire.ts";
import { leak } from "./leak.ts";
import { robbers } from "./robbers.ts";
import { rocks } from "./rocks.ts";
import { sick } from "./sick.ts";
import { storm } from "./storm.ts";
import { thief } from "./thief.ts";
import { turnBack } from "./turn-back.ts";
import { visitor } from "./visitor.ts";
import { waterFound } from "./water-found.ts";
import { water } from "./water.ts";

export interface Stagehand {
  c: CanvasRenderingContext2D;
  v: View;
  t: number; // 0..1 through the beat
  loop: boolean; // situation: t loops, so the scene must look the same at t = 0 and t = 1
  /** What the event did. Null in a situation loop (nothing has happened yet) and for the mildest version. */
  outcome: EventOutcome | null;
  caravan: { x0: number; x1: number }; // where the caravan stands, css px: the rear sprite's feet and the lead's. It faces right.
  /** The first traveller in `outcome.healthChanges` whose health went down (to < from), else null. Null in a loop. */
  target: { id: string; x: number } | null;
  terrain?: Terrain; // the ground drawn under the scene; storm turns to snow on "mountain"
  camels?: number; // camels at the start of the beat; camel-trouble draws no camel when there are none
  camelX?: number[]; // feet x of each camel, index 0 = the lead camel
  walkers?: { id: string; x: number }[]; // feet x of each traveller on foot (not riding)
}
export interface Pose {
  crouch?: boolean;
  dx?: number; // css px
  facing?: 1 | -1;
  hideCamel?: number; // index of a camel not to draw, 0 = the lead camel
  night?: boolean;
  down?: string; // the walker drawn lying on the ground (drawTraveller's `down`)
  move?: { id: string; x: number; facing: 1 | -1; crouch: boolean }; // one walker drawn here instead of in line
}
export interface EventScene {
  still: number; // the t drawn under reduced motion
  /** Changes how the caravan is drawn this frame: crouch, offset, turn round, hide a camel, lay one walker down, move one. */
  pose?(h: Stagehand): Pose;
  /** Draws behind the caravan. */
  back?(h: Stagehand): void;
  /** Draws in front of the caravan. */
  front?(h: Stagehand): void;
}

export const SCENES: Record<SceneId, EventScene> = {
  calm,
  storm,
  robbers,
  fire,
  water,
  rocks,
  "camel-trouble": camelTrouble,
  sick,
  visitor,
  "water-found": waterFound,
  "turn-back": turnBack,
  thief,
  leak,
};
