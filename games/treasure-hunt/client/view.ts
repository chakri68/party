import { h, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import type { THPublic } from "../shared/types.ts";
import { GodotBridge } from "./godot/bridge.ts";
import { StageLoader } from "./godot/loader.ts";

// The whole game is the Godot map in an iframe; this file is the frame
// around it and the only one that talks to the bridge.
//
//   generating  the map loads (StageLoader). Godot's ready() gets the
//               session ({layout}); its world-ready gets act("ready"), once
//               per seed. Then "Waiting for N players" until the round starts.
//   exploring   the map fills the game area, under one strip: the help line,
//               and End for the host.
//
// Phones and tablets (a coarse pointer and no fine one) never boot Godot.
// They get a plain message and still send ready, so nobody waits on them.

const HELP = "Click to look around. WASD to move. E to get in or out.";
const PHONE = "Treasure Hunt needs a computer with a keyboard and mouse.";

/** A touch screen with no mouse or trackpad to go with it. */
function touchOnly(): boolean {
  return matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
}

const waitingText = (n: number) => (n === 0 ? "Starting the round" : `Waiting for ${n} ${n === 1 ? "player" : "players"}`);

export class TreasureHuntView implements GameView {
  private api: GameClientApi;
  private game: THPublic | null = null;
  private playerId = "";
  private hostId: string | null = null;
  private desktop = !touchOnly();

  private bridge: GodotBridge;
  private loader: StageLoader;
  private stage = h("div", { class: "th-stage" });
  private help = h("p", { class: "th-help" }, HELP);
  private end = h("button", { type: "button", class: "th-end", hidden: true }, "End");
  private bar = h("div", { class: "th-bar", hidden: true }, this.help, this.end);
  private wait = h("p", { class: "th-wait", role: "status", "aria-live": "polite", hidden: true });
  private msg = h("p", { class: "th-msg", role: "alert" });
  private root: HTMLElement;

  /** The seed Godot last said world-ready for. */
  private builtSeed: number | null = null;
  /** The seed we last sent act("ready") for. */
  private readySeed: number | null = null;

  constructor(api: GameClientApi) {
    this.api = api;
    this.loader = new StageLoader(() => this.bridge.retry());
    this.bridge = new GodotBridge({
      ready: () => this.loader.started(),
      progress: (loaded, total) => this.loader.progress(loaded, total),
      started: () => this.loader.started(),
      failed: (why) => {
        this.loader.el.hidden = false;
        this.loader.failed(why);
      },
      status: (s) => {
        if (s.kind !== "world-ready" || !this.game) return;
        this.builtSeed = this.game.layout.seed;
        this.render();
      },
    });
    this.end.addEventListener("click", () => this.api.act({ type: "end" }));
    this.root = this.desktop
      ? h("div", { class: "treasure-hunt" }, this.bar, h("div", { class: "th-view" }, this.stage, this.loader.el, this.wait, this.msg))
      : h("div", { class: "treasure-hunt th-phone" }, h("p", { class: "th-phone-text" }, PHONE), this.msg);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
    if (this.desktop) void this.bridge.mount(this.stage);
  }

  destroy() {
    this.bridge.dispose();
    this.root.remove();
  }

  rejected(_clientActionId: string, message: string) {
    this.msg.textContent = message;
  }

  update(props: GameViewProps) {
    this.game = props.game as THPublic;
    this.playerId = props.playerId;
    this.hostId = props.room.hostId;
    if (this.desktop) this.bridge.setSession({ layout: this.game.layout });
    this.render();
  }

  private render() {
    const game = this.game;
    if (!game) return;
    const seed = game.layout.seed;
    // Phones are "ready" at once: there is nothing for them to load.
    const loaded = !this.desktop || this.builtSeed === seed;
    if (game.phase === "generating" && loaded && this.readySeed !== seed) {
      this.readySeed = seed;
      this.api.act({ type: "ready" });
    }
    if (!this.desktop) return;

    this.loader.el.hidden = loaded;
    const waiting = game.phase === "generating" && loaded;
    this.wait.hidden = !waiting;
    if (waiting) {
      const n = game.players.filter((p) => p.id !== this.playerId && !p.ready && !p.removed).length;
      this.wait.textContent = waitingText(n);
    }
    this.bar.hidden = game.phase !== "exploring";
    this.end.hidden = this.hostId !== this.playerId;
    if (game.phase === "exploring" && loaded) this.msg.textContent = "";
  }
}
