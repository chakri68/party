import type { GameClientModule } from "@games/ui";
import { BlackjackView } from "./view.ts";
import "./styles.css";

const blackjackClient: GameClientModule = {
  createView: (api) => new BlackjackView(api),
};

export default blackjackClient;
