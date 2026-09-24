import type { GameClientModule } from "@games/ui";
import { CrazyEightsView } from "./view.ts";
import "./styles.css";

const crazyEightsClient: GameClientModule = {
  createView: (api) => new CrazyEightsView(api),
};

export default crazyEightsClient;
