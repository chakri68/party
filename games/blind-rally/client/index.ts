import type { GameClientModule } from "@games/ui";
import { BlindRallyView } from "./view.ts";
import { RALLY } from "./rally/variant.ts";
import "./styles.css";

const blindRallyClient: GameClientModule = {
  createView: (api) => new BlindRallyView(api),
};

/** Rally (rally-spec.md): the same view, its own lobby and seat. */
export const rally: GameClientModule = {
  createView: (api) => new BlindRallyView(api, RALLY),
};

export default blindRallyClient;
