import type { GameClientModule } from "@games/ui";
import { ChainWordsView } from "./view.ts";
import "./styles.css";

const chainWordsClient: GameClientModule = {
  createView: (api) => new ChainWordsView(api),
};

export default chainWordsClient;
