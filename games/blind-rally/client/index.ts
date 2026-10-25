import type { GameClientModule } from "@games/ui";
import { BlindRallyView } from "./view.ts";
import "./styles.css";

const blindRallyClient: GameClientModule = {
  createView: (api) => new BlindRallyView(api),
};

export default blindRallyClient;
