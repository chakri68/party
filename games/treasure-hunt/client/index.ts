import type { GameClientModule } from "@games/ui";
import { TreasureHuntView } from "./view.ts";
import "./styles.css";

const treasureHuntClient: GameClientModule = {
  createView: (api) => new TreasureHuntView(api),
};

export default treasureHuntClient;
