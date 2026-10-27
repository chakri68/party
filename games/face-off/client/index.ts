import type { GameClientModule } from "@games/ui";
import { FaceOffView } from "./view.ts";
import "./styles.css";

const faceOffClient: GameClientModule = {
  createView: (api) => new FaceOffView(api),
};

export default faceOffClient;
