import { h, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import type { BlindRallyEvent, BlindRallyPrivateState, BlindRallyPublicState } from "../shared/types.ts";
import type { RoleProps, RoleView, RoleViewFactory } from "./role.ts";
import { TeamsScreen } from "./teams.ts";

/**
 * Phase screens and role dispatch. Before your seat is set, and for spares
 * all race long, it's the teams screen. Once you're seated and ready (or the
 * race is on), it's your seat's screen, loaded on demand: `driver/` or
 * `navigator/`, never both.
 *
 * Both layers stay in the DOM, stacked. Un-readying shows the teams screen
 * over the seat without tearing it down, so a Navigator's Godot doesn't boot
 * twice because someone fat-fingered Ready.
 */
export class BlindRallyView implements GameView {
  private api: GameClientApi;
  private root = h("div", { class: "blind-rally" });
  private seatLayer = h("div", { class: "br-layer br-seat-layer" });
  private teams: TeamsScreen;

  private role: RoleView | null = null;
  /** "driver:2" or "navigator:2:pine_panic": which seat `role` is for, loaded or loading. */
  private roleKey: string | null = null;
  private last: RoleProps | null = null;

  constructor(api: GameClientApi) {
    this.api = api;
    this.teams = new TeamsScreen(api);
    this.root.append(this.seatLayer, this.teams.el);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
    // The lobby's Start game sits at the bottom of a long page; the teams screen starts at its top.
    window.scrollTo(0, 0);
  }

  destroy() {
    this.dropRole();
    this.teams.destroy();
    this.root.remove();
  }

  rejected(_clientActionId: string, message: string) {
    if (this.onSeat()) this.role?.rejected(message);
    else this.teams.rejected(message);
  }

  stream(_from: string, data: unknown) {
    // Streams before the seat's chunk lands are dropped: they're 40 ms stale by the next one.
    this.role?.stream(_from, data);
  }

  update(props: GameViewProps) {
    const game = props.game as BlindRallyPublicState;
    const priv = props.private as BlindRallyPrivateState;
    this.teams.update(props.room, game, props.playerId);

    if (!priv.role) {
      this.dropRole();
      this.last = null;
    } else {
      // A Navigator's key names the track too: Godot boots one course, so a new
      // track (which un-readies everyone) means a fresh Godot on the next ready.
      const key = `${priv.role}:${priv.teamId}${priv.role === "navigator" ? `:${priv.session.trackId}` : ""}`;
      const roleProps: RoleProps = { room: props.room, game, private: priv, playerId: props.playerId, events: props.events as BlindRallyEvent[] };
      this.last = roleProps;
      const me = game.players.find((p) => p.id === props.playerId);
      // Ready means "load my seat": the Navigator's engine boots while the rest ready up.
      if (key !== this.roleKey) {
        this.dropRole();
        if (me?.ready || game.phase !== "teams") this.loadRole(key, priv.role);
      }
      this.role?.update(roleProps);
    }
    this.show(this.onSeat());
  }

  /** Seated, and either ready or past the teams phase. */
  private onSeat(): boolean {
    const p = this.last;
    if (!p) return false;
    const me = p.game.players.find((q) => q.id === p.playerId);
    return p.game.phase !== "teams" || !!me?.ready;
  }

  private show(seat: boolean) {
    this.root.classList.toggle("on-seat", seat && !!this.role);
    this.seatLayer.inert = !seat;
    this.teams.el.inert = seat && !!this.role;
  }

  private loadRole(key: string, role: "driver" | "navigator") {
    this.roleKey = key;
    const load: Promise<RoleViewFactory> = role === "driver"
      ? import("./driver/driver.ts").then((m) => m.createDriverView)
      : import("./navigator/host.ts").then((m) => m.createNavigatorView);
    void load.then((create) => {
      if (this.roleKey !== key) return; // reseated mid-load
      this.role = create(this.api);
      this.role.mount(this.seatLayer);
      if (this.last) this.role.update(this.last);
      this.show(this.onSeat());
    });
  }

  private dropRole() {
    this.role?.destroy();
    this.role = null;
    this.roleKey = null;
    this.seatLayer.replaceChildren();
  }
}
