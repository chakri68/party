import type { GameDefinition } from "@games/game-core";
import { parseRallySettings, RALLY_DEFAULTS, rallyManifest } from "../shared/rally.ts";
import type {
  BlindRallyAction,
  BlindRallyEvent,
  BlindRallyPrivateState,
  BlindRallyPublicState,
  BlindRallySettings,
  BlindRallyState,
} from "../shared/types.ts";
import { blindRallyGame, newGame } from "./game.ts";

// Rally (rally-spec.md) is Blind Rally's definition with its own manifest,
// settings and a `variant` on the state. Everything that plays differently
// reads that variant where it matters, so the race itself (plausibility,
// checkpoints, resets, drop-outs, ghosts, scoring) is the same code:
//   teams.ts      a car each, the same player in both seats (fitCars, holds)
//   game.ts       no seat picking, no guess pins
//   race.ts       no input relay and no dash: the controls are on the car's own device
//   projection.ts a car of one gets the Navigator's DTO, starting in chase
//   scoring.ts    "Car 2", resets always counted

export const rallyGame: GameDefinition<
  BlindRallyState,
  BlindRallyAction,
  BlindRallyPublicState,
  BlindRallyPrivateState,
  BlindRallySettings,
  BlindRallyEvent
> = {
  ...blindRallyGame,
  manifest: rallyManifest,
  defaultSettings: RALLY_DEFAULTS,
  parseSettings: parseRallySettings,
  createGame: (players, settings, match, ctx) => newGame(rallyManifest, players, settings, match, ctx, "rally"),
};
