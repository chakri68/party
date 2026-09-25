import type { GameClientModule } from "@games/ui";
import { CheatView } from "./view.ts";
import "./styles.css";

const cheatClient: GameClientModule = {
  createView: (api) => new CheatView(api),
};

export default cheatClient;
