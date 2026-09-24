import type { GameClientModule } from "@games/ui";
import { OldMaidView } from "./view.ts";
import "./styles.css";

const oldMaidClient: GameClientModule = {
  createView: (api) => new OldMaidView(api),
};

export default oldMaidClient;
