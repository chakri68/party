import type { GameClientModule } from "@games/ui";
import { WildsView } from "./view.ts";
import "./styles.css";

const wildsClient: GameClientModule = {
  createView: (api) => new WildsView(api),
};

export default wildsClient;
