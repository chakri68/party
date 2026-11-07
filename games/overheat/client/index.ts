import type { GameClientModule } from "@games/ui";
import { OverheatView } from "./view.ts";
import "./styles.css";

const overheatClient: GameClientModule = {
  createView: (api) => new OverheatView(api),
};

export default overheatClient;
