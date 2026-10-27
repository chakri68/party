import type { GameClientModule } from "@games/ui";
import { BluffView } from "./view.ts";
import "./styles.css";

/** Fake Word and Bluff Definitions: one view, told which game it's drawing. */
export const fakeWord: GameClientModule = {
  createView: (api) => new BluffView(api, "fake-word"),
};

export const bluffDefinitions: GameClientModule = {
  createView: (api) => new BluffView(api, "bluff-definitions"),
};

export default fakeWord;
