import type { GameClientModule } from "@games/ui";
import { GoFishView } from "./view.ts";
import "./styles.css";

const goFishClient: GameClientModule = {
  createView: (api) => new GoFishView(api),
};

export default goFishClient;
