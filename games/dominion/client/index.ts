import type { GameClientModule } from "@games/ui";
import { DominionView } from "./view.ts";
import "./styles.css";

const dominionClient: GameClientModule = {
  createView: (api) => new DominionView(api),
};

export default dominionClient;
