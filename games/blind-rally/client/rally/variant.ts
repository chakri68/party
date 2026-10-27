import type { Variant } from "../view.ts";
import { RallyGrid } from "./grid.ts";
import "./rally.css";

// Rally on the client: its own lobby (the grid) and one seat for everyone,
// the Navigator's screen with the controls on it (seat.ts, loaded on ready).
export const RALLY: Variant = {
  lobby: (api) => new RallyGrid(api),
  seat: () => import("./seat.ts").then((m) => m.createRallySeat),
};
