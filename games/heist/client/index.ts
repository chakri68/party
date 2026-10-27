import type { GameClientModule } from "@games/ui";
import { HeistView } from "./view.ts";
import "@games/hidden-roles/reveal.css";
import "./styles.css";

const heistClient: GameClientModule = {
  createView: (api) => new HeistView(api),
};

export default heistClient;
