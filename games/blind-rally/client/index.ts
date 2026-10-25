import type { GameClientModule } from "@games/ui";
import { loadFonts } from "./role.ts";
import { BlindRallyView } from "./view.ts";
import "./styles.css";

const blindRallyClient: GameClientModule = {
  createView: (api) => {
    loadFonts();
    return new BlindRallyView(api);
  },
};

export default blindRallyClient;
