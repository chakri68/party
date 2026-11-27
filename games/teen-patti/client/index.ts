import type { GameClientModule } from "@games/ui";
import { TeenPattiView } from "./view.ts";
import "./styles.css";

const teenPattiClient: GameClientModule = {
  createView: (api) => new TeenPattiView(api),
};

export default teenPattiClient;
