import type { GameClientModule } from "@games/ui";
import { SevensView } from "./view.ts";
import "./styles.css";

const sevensClient: GameClientModule = {
  createView: (api) => new SevensView(api),
};

export default sevensClient;
