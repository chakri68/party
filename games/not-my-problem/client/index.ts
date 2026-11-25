import type { GameClientModule } from "@games/ui";
import { NotMyProblemView } from "./view.ts";
import "./styles.css";

const notMyProblemClient: GameClientModule = {
  createView: (api) => new NotMyProblemView(api),
};

export default notMyProblemClient;
