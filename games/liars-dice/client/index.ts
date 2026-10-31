import type { GameClientModule } from "@games/ui";
import { LiarsDiceView } from "./view.ts";
import "./styles.css";

const liarsDiceClient: GameClientModule = {
  createView: (api) => new LiarsDiceView(api),
};

export default liarsDiceClient;
