import type { GameClientModule } from "@games/ui";
import { FarkleView } from "./view.ts";
import "./styles.css";

const farkleClient: GameClientModule = {
  createView: (api) => new FarkleView(api),
};

export default farkleClient;
