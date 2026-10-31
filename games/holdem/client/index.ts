import type { GameClientModule } from "@games/ui";
import { HoldemView } from "./view.ts";
import "./styles.css";

const holdemClient: GameClientModule = {
  createView: (api) => new HoldemView(api),
};

export default holdemClient;
