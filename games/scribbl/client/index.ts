import type { GameClientModule } from "@games/ui";
import { ScribblView } from "./view.ts";
import "./styles.css";

const scribblClient: GameClientModule = {
  createView: (api) => new ScribblView(api),
};

export default scribblClient;
