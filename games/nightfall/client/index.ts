import type { GameClientModule } from "@games/ui";
import { NightfallView } from "./view.ts";
import "@games/hidden-roles/reveal.css";
import "./styles.css";

const nightfallClient: GameClientModule = {
  createView: (api) => new NightfallView(api),
};

export default nightfallClient;
