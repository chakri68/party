import { audio } from "@games/audio";
import { h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { EVENTS } from "../shared/events.ts";
import { N } from "../shared/numbers.ts";
import { RUINS } from "../shared/ruins.ts";
import type { RuinId, TileId, WildsEvent, WildsPrivateState, WildsPublicState } from "../shared/types.ts";
import { ARROW_LABEL, BoardView, hasArrow } from "./board.ts";
import { PlanTray } from "./plan.ts";

type Pub = WildsPublicState;
type Priv = WildsPrivateState;

/** The last seconds of the plan tick out loud. */
const TICK_FROM = 5;

const ROLE_NAME = { runner: "Runner", fixer: "Fixer", protector: "Protector", guide: "Guide" } as const;
const STONE_ICON = "M12 3 L19 12 L12 21 L5 12 Z";

export class WildsView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "wilds" });
  private roundLabel = h("span", { class: "wd-round" });
  private sunLabel = h("span", { class: "wd-sun" });
  private stones = h("span", { class: "wd-stones" });
  private timer = h("span", { class: "wd-timer", role: "timer" });
  private eventBox = h("section", { class: "wd-event", "aria-label": "This round's event" });
  private boardWrap = h("div", { class: "wd-board-wrap" });
  private legend = h("p", { class: "wd-legend" });
  private team = h("ul", { class: "wd-team", "aria-label": "Explorers" });
  private note = h("p", { class: "wd-note", "aria-live": "assertive" });
  private panel = h("div", { class: "wd-panel" });

  private board: BoardView;
  private tray: PlanTray;
  private turn: string | null | undefined = undefined;
  private lastTick = -1;
  private stage = "";
  private clock: ReturnType<typeof setInterval>;

  constructor(api: GameClientApi) {
    this.api = api;
    this.board = new BoardView((t) => this.tapTile(t));
    this.tray = new PlanTray(api);
    this.tray.onChange = () => this.props && this.settle(this.props);
    this.boardWrap.append(this.board.svg);
    this.root.append(
      h("div", { class: "wd-top" }, this.roundLabel, this.sunLabel, this.stones, this.timer),
      this.eventBox,
      this.boardWrap,
      this.legend,
      this.team,
      this.note,
      this.panel,
    );
    this.clock = setInterval(() => this.renderClock(), 250);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    clearInterval(this.clock);
    this.root.remove();
  }

  rejected(_clientActionId: string, message: string) {
    this.tray.rejected(message);
    if (this.props) this.settle(this.props);
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    if (!props.snapshot && this.props) this.sounds(props.events as WildsEvent[]);
    this.settle(props);
  }

  // ---- helpers ------------------------------------------------------------

  private get game(): Pub {
    return this.props!.game as Pub;
  }
  private get me(): Priv | null {
    return (this.props?.private as Priv | null) ?? null;
  }
  private name = (id: string): string => (this.props ? seatName(this.props.room, id) : id);
  private planning(): boolean {
    const g = this.game;
    const self = g.explorers.find((e) => e.id === this.props!.playerId && !e.left);
    return g.phase === "plan" && !!self && !self.down && !this.me?.ready;
  }

  private tapTile(t: TileId) {
    if (this.game.phase === "plan") this.tray.tap(t);
  }

  // ---- the clock ----------------------------------------------------------

  private renderClock() {
    const g = this.props?.game as Pub | undefined;
    if (!g || g.phase === "over" || !g.deadline) {
      this.timer.textContent = "";
      return;
    }
    const secs = Math.ceil(Math.max(0, g.deadline - this.api.serverNow()) / 1000);
    this.timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    const low = secs <= TICK_FROM && this.planning();
    this.root.classList.toggle("low", low);
    if (low && secs > 0 && secs !== this.lastTick && document.visibilityState === "visible") {
      this.lastTick = secs;
      audio.play("tick");
    }
  }

  // ---- settled state ------------------------------------------------------

  private settle(props: GameViewProps) {
    this.props = props;
    const g = this.game;
    const stage = `${g.phase}:${g.round}`;
    if (stage !== this.stage) {
      this.stage = stage;
      this.lastTick = -1;
      this.note.textContent = "";
    }
    this.root.dataset.phase = g.phase;
    this.tray.setNames(this.name);
    this.board.setPeople(this.name, props.playerId);
    this.renderTop();
    this.renderEvent();
    this.renderTeam();
    this.renderPanel();
    this.renderBoard();
    this.renderTurn();
    this.renderClock();
  }

  private renderTurn() {
    const turn = this.planning() ? `Plan your ${N.actions} actions` : null;
    if (turn === this.turn) return;
    this.turn = turn;
    this.api.setTurn(turn);
  }

  private renderTop() {
    const g = this.game;
    this.roundLabel.textContent = g.phase === "roles" ? "Roles" : `Round ${g.round}`;
    this.sunLabel.textContent = `Sun ${g.sun} / ${g.sunLimit}`;
    const ruins = Object.keys(RUINS) as RuinId[];
    this.stones.setAttribute("role", "img");
    this.stones.setAttribute("aria-label", `Key stones: ${g.stones.length} of ${ruins.length}`);
    this.stones.innerHTML = ruins
      .map((r) => {
        const cls = g.stones.includes(r) ? "found" : g.half.includes(r) ? "half" : "";
        return `<svg class="wd-stone ${cls}" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="${STONE_ICON}"/></svg>`;
      })
      .join("");
  }

  private renderEvent() {
    const g = this.game;
    const ev = g.event ? EVENTS[g.event.id] : null;
    const next = this.me?.next ? EVENTS[this.me.next] : null;
    this.eventBox.hidden = !ev && !next;
    replaceChildren(
      this.eventBox,
      ev ? h("h2", {}, ev.title) : null,
      ev ? h("p", {}, ev.text) : null,
      ev && g.event!.tiles.length ? h("p", { class: "wd-hint" }, "Marked tiles have a dashed line.") : null,
      next ? h("p", { class: "wd-guide" }, `Only you see this: next round is ${next.title}.`) : null,
    );
  }

  private renderTeam() {
    const g = this.game;
    const me = this.props!.playerId;
    replaceChildren(
      this.team,
      g.order.map((id) => {
        const e = g.explorers.find((x) => x.id === id);
        if (!e) return null;
        const hearts = h(
          "span",
          { class: "wd-hearts", "aria-label": e.down ? "Down" : `${e.hearts} of ${N.hearts} Hearts` },
          Array.from({ length: N.hearts }, (_, i) => h("span", { class: i < e.hearts ? "on" : "", "aria-hidden": "true" })),
        );
        return h(
          "li",
          { class: ["wd-explorer", e.down && "down", id === me && "me"].filter(Boolean).join(" ") },
          h("span", { class: `wd-dot wd-role-${e.role ?? "none"}`, "aria-hidden": "true" }),
          h("span", { class: "wd-who" }, h("b", {}, id === me ? "You" : this.name(id)), h("small", {}, e.role ? ROLE_NAME[e.role] : "")),
          e.down ? h("span", { class: "wd-tag" }, "Down") : hearts,
          g.phase === "plan" && !e.down ? h("span", { class: `wd-ready${e.ready ? " on" : ""}` }, e.ready ? "Ready" : "Planning") : null,
        );
      }),
    );
  }

  private renderPanel() {
    const g = this.game;
    this.panel.dataset.kind = g.phase;
    if (g.phase === "plan") return replaceChildren(this.panel, this.tray.render(g, this.me, this.props!.playerId));
    replaceChildren(this.panel);
  }

  private renderBoard() {
    this.legend.hidden = !hasArrow(this.game);
    if (!this.legend.hidden && !this.legend.firstChild) {
      this.legend.innerHTML = `<svg viewBox="0 0 24 8" width="24" height="8" aria-hidden="true"><path d="M1 4 L17 4" class="wd-legend-line"/><path d="M16 0 L23 4 L16 8 Z" class="wd-legend-head"/></svg>`;
      this.legend.append(` Where the spider goes ${ARROW_LABEL.toLowerCase()}.`);
    }
    // The tray only hears about the plan phase, so outside it there's nothing to light up.
    if (this.game.phase !== "plan") return void this.board.render(this.game, new Map(), new Map());
    const t = this.tray.targets();
    this.board.render(this.game, t.highlight, t.offReason, t.marks);
  }

  // ---- what just happened -------------------------------------------------

  private sounds(events: WildsEvent[]) {
    for (const e of events) {
      if (e.type === "phase" && e.phase === "plan") {
        audio.play("your-turn");
        audio.buzz(25);
      }
    }
  }
}
