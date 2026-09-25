import type { GameClientModule } from "@games/ui";
import { PassTheBombView } from "./view.ts";
import "./styles.css";

const passTheBombClient: GameClientModule = {
  createView: (api) => new PassTheBombView(api),
};

export default passTheBombClient;
