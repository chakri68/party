import type { GameClientModule } from "@games/ui";
import { ThornsView } from "./view.ts";
import "./styles.css";

const thornsClient: GameClientModule = {
  createView: (api) => new ThornsView(api),
};

export default thornsClient;
