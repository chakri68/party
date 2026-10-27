import type { GameClientModule } from "@games/ui";
import { DontSayItView } from "./view.ts";
import "./styles.css";

const dontSayItClient: GameClientModule = {
  createView: (api) => new DontSayItView(api),
};

export default dontSayItClient;
