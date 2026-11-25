import type { GameClientModule, GameView } from "@games/ui";

/** A stand-in until the real table lands: it only says the game is loading. */
class PlaceholderView implements GameView {
  private root: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.root = document.createElement("p");
    this.root.textContent = "Loading";
    container.append(this.root);
  }

  update(): void {}

  rejected(): void {}

  destroy(): void {
    this.root?.remove();
    this.root = null;
  }
}

const notMyProblemClient: GameClientModule = {
  createView: () => new PlaceholderView(),
};

export default notMyProblemClient;
