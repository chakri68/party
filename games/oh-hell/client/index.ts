import type { GameClientModule } from "@games/ui";
import { OhHellView } from "./view.ts";
import "./styles.css";

const ohHellClient: GameClientModule = {
  createView: (api) => new OhHellView(api),
};

export default ohHellClient;
