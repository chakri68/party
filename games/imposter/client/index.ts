import type { GameClientModule } from "@games/ui";
import { ImposterView } from "./view.ts";
import "@games/hidden-roles/reveal.css";
import "./styles.css";

const imposterClient: GameClientModule = {
  createView: (api) => new ImposterView(api),
};

export default imposterClient;
