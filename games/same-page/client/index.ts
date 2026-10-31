import type { GameClientModule } from "@games/ui";
import { SamePageView } from "./view.ts";
import "./styles.css";

const samePageClient: GameClientModule = {
  createView: (api) => new SamePageView(api),
};

export default samePageClient;
