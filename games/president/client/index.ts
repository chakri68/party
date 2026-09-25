import type { GameClientModule } from "@games/ui";
import { PresidentView } from "./view.ts";
import "./styles.css";

const presidentClient: GameClientModule = {
  createView: (api) => new PresidentView(api),
};

export default presidentClient;
