import type { GameClientModule } from "@games/ui";
import { ShortNightView } from "./view.ts";
import "@games/hidden-roles/reveal.css";
import "./styles.css";

const shortNightClient: GameClientModule = {
  createView: (api) => new ShortNightView(api),
};

export default shortNightClient;
