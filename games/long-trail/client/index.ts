import type { GameClientModule } from "@games/ui";
import { LongTrailView } from "./view.ts";
import "./styles.css";

const longTrailClient: GameClientModule = {
  createView: (api) => new LongTrailView(api),
};

export default longTrailClient;
