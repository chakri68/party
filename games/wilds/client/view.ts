import { audio } from "@games/audio";
import { countdown, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { EVENTS } from "../shared/events.ts";
import { N } from "../shared/numbers.ts";
import { ROLE_ATTRS } from "../shared/roll.ts";
import { RUINS } from "../shared/ruins.ts";
import type {
  Attr, ItemId, PendingBargain, Role, RuinId, TileId, WildsEvent, WildsPrivateState, WildsPublicState,
} from "../shared/types.ts";
import { ARROW_LABEL, BoardView, hasArrow, mapKey } from "./board.ts";
import { ATTR_NAME, ITEM_NAME, PlanTray, signed } from "./plan.ts";
import { animate, buildFrames, fillNames, fitFrames, Playback, rollBox, voteResult, type Frame } from "./report.ts";

type Pub = WildsPublicState;
type Priv = WildsPrivateState;

/** The last seconds of the plan tick out loud. */
const TICK_FROM = 5;

const ROLE_NAME = { runner: "Runner", fixer: "Fixer", protector: "Protector", guide: "Guide" } as const;
const STONE_ICON = "M12 3 L19 12 L12 21 L5 12 Z";
const ROLES: Role[] = ["runner", "fixer", "protector", "guide"];
const ATTRS: Attr[] = ["strength", "mind", "stealth"];
/** The playback gets at most this share of the report's time. The rest is for reading the lines. */
const PLAYBACK_SHARE = 0.5;
const MIN_PLAYBACK_MS = 2000;

// ---- words for the screens (tested in test/report.test.ts) ----------------------

/** Each role's power in one line (spec §3.2). */
export const ROLE_POWER: Record<Role, string> = {
  runner: `Your Move goes up to ${N.runnerMove} tiles, not ${N.move}.`,
  fixer: "Act on a broken bridge next to you to fix it. No item needed.",
  protector: "Your Guard also protects everyone on your tile.",
  guide: `You see next round's event one round early (only on your phone). Your Look reaches ${N.guideLook} tiles, not ${N.look}.`,
};

/** "Strength 0 · Mind +1 · Stealth +2". */
export const roleStats = (r: Role): string =>
  ATTRS.map((a) => `${ATTR_NAME[a]} ${ROLE_ATTRS[r][a] === 0 ? "0" : signed(ROLE_ATTRS[r][a])}`).join(" · ");

export const ITEM_USE: Record<ItemId, string> = {
  torch: `Burn a forest or bridge next to you, or make the spider run ${N.scaredStep} tiles away. You keep it.`,
  planks: "Make a broken bridge or a river next to you into a bridge.",
  medkit: `${signed(N.medkit)} Hearts for you or a friend next to you.`,
  lure: `Put ${N.lureNoise} noise on an open tile up to ${N.lureRange} tiles away. Noise pulls the spider.`,
};

/** The last word on the board once the game is over. The shell's results say the rest. */
export const END_LINE = {
  win: "Everyone made it to the gate.",
  sun: "The sun went down.",
  down: "Everyone was down.",
} as const;

export const votedLine = (voted: number, of: number): string => `${voted} of ${of} have voted.`;

/** The waiting stone hand, from this round. */
export function pendingLine(p: PendingBargain, round: number): string {
  const n = p.due - round;
  if (n <= 0) return "The stone hand: noise on this bridge at the end of this round.";
  return `The stone hand: noise on this bridge in ${n} ${n === 1 ? "round" : "rounds"}.`;
}

/** A plain heart, for the Hearts on each explorer. */
const HEART_ICON = "M12 21 C5 15.5 2 12 2 8.2 C2 5.3 4.3 3 7 3 C9 3 10.8 4.1 12 5.8 C13.2 4.1 15 3 17 3 C19.7 3 22 5.3 22 8.2 C22 12 19 15.5 12 21 Z";

const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class WildsView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "wilds" });
  private roundLabel = h("span", { class: "wd-round" });
  private sunLabel = h("span", { class: "wd-sun" });
  private stones = h("span", { class: "wd-stones" });
  private timer = countdown();
  private eventBox = h("section", { class: "wd-event", "aria-label": "This round's event" });
  private pendingBar = h("p", { class: "wd-pending-bar" });
  private boardWrap = h("div", { class: "wd-board-wrap" });
  private legend = h("p", { class: "wd-legend" });
  private caption = h("div", { class: "wd-caption" });
  private team = h("ul", { class: "wd-team", "aria-label": "Explorers" });
  private note = h("p", { class: "wd-note", "aria-live": "assertive" });
  private panel = h("div", { class: "wd-panel" });

  private board: BoardView;
  private tray: PlanTray;
  private turn: string | null | undefined = undefined;
  private lastTick = -1;
  private stage = "";
  private clock: ReturnType<typeof setInterval>;

  private playback: Playback;
  /** The board as the plan closed: where this round's playback starts. */
  private before: Pub | null = null;
  /** The round whose report has started (or was skipped), so it plays once. */
  private played = -1;
  /** You tapped Next in this report. */
  private nextSent = false;

  constructor(api: GameClientApi) {
    this.api = api;
    this.board = new BoardView((t) => this.tapTile(t));
    this.tray = new PlanTray(api);
    this.tray.onChange = () => this.props && this.settle(this.props);
    this.playback = new Playback((f) => this.showFrame(f));
    this.boardWrap.append(this.board.svg);
    // Tap anywhere on the playback to jump to the end.
    this.boardWrap.addEventListener("click", () => this.playback.skip());
    this.caption.addEventListener("click", () => this.playback.skip());
    // Phones: one column, the plan right under the map. Wide screens: the map on the
    // left, the event, plan and team on the right, so nothing sits below the fold.
    this.root.append(
      h("div", { class: "wd-top" }, this.roundLabel, this.sunLabel, h("span", { class: "wd-stones-wrap" }, h("span", { class: "wd-stones-label", "aria-hidden": "true" }, "Stones"), this.stones), this.timer.el),
      this.eventBox,
      this.pendingBar,
      h("div", { class: "wd-main" }, this.boardWrap, this.legend, mapKey(), this.caption),
      h("div", { class: "wd-side" }, this.note, this.panel, this.team),
    );
    this.clock = setInterval(() => this.renderClock(), 250);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    clearInterval(this.clock);
    this.playback.destroy();
    this.root.remove();
  }

  whenIdle(): Promise<void> {
    return this.playback.idle();
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
  /** The board as drawn: a playback frame, or the game as it is. */
  private get shown(): Pub {
    return this.playback.frame?.pub ?? this.game;
  }
  private planning(): boolean {
    const g = this.game;
    const self = g.explorers.find((e) => e.id === this.props!.playerId && !e.left);
    return g.phase === "plan" && !!self && !self.down && !this.me?.ready;
  }

  private tapTile(t: TileId) {
    if (this.game.phase === "plan") this.tray.tap(t);
  }

  private voter(): boolean {
    const g = this.game;
    const self = g.explorers.find((e) => e.id === this.props!.playerId && !e.left);
    return g.phase === "choice" && !!self && !(g.voted ?? []).includes(self.id);
  }

  private picker(): boolean {
    const g = this.game;
    const self = g.explorers.find((e) => e.id === this.props!.playerId && !e.left);
    return g.phase === "roles" && !!self && !self.role;
  }

  // ---- the clock ----------------------------------------------------------

  private renderClock() {
    const g = this.props?.game as Pub | undefined;
    if (!g || g.phase === "over" || !g.deadline) {
      this.timer.set(null);
      return;
    }
    const left = Math.max(0, g.deadline - this.api.serverNow());
    const secs = Math.ceil(left / 1000);
    this.timer.set(left);
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
      this.nextSent = false;
    }
    this.root.dataset.phase = g.phase;
    if (g.phase === "plan") this.before = g;
    this.startReport(props);
    this.tray.setNames(this.name);
    this.board.setPeople(this.name, props.playerId);
    this.renderAll();
    this.renderTurn();
    this.renderClock();
  }

  private renderAll() {
    this.renderTop();
    this.renderEvent();
    this.renderTeam();
    this.renderPanel();
    this.renderBoard();
    this.renderCaption();
  }

  private renderTurn() {
    const turn = this.planning() ? `Plan your ${N.actions} actions` : this.picker() ? "Pick your role" : this.voter() ? "Vote" : null;
    if (turn === this.turn) return;
    this.turn = turn;
    this.api.setTurn(turn);
  }

  private renderTop() {
    const g = this.shown;
    this.roundLabel.textContent = g.phase === "roles" ? "Roles" : `Round ${g.round}`;
    // Force on the last round can push the sun past the limit. It never reads "9 / 8".
    this.sunLabel.textContent = `Sun ${Math.min(g.sun, g.sunLimit)} / ${g.sunLimit}`;
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
    const p = g.phase === "over" ? null : this.shown.pending;
    this.pendingBar.hidden = !p;
    if (p) {
      this.pendingBar.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path class="wd-pending-swatch" d="M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z"/></svg>`;
      this.pendingBar.append(` ${pendingLine(p, this.game.round)}`);
    }
    replaceChildren(
      this.eventBox,
      ev ? h("h2", {}, ev.title) : null,
      ev ? h("p", {}, ev.text) : null,
      ev && g.event!.tiles.length ? h("p", { class: "wd-hint" }, "Marked tiles have a dashed line.") : null,
      next ? h("p", { class: "wd-guide" }, `Only you see this: next round is ${next.title}.`) : null,
    );
  }

  private renderTeam() {
    const g = this.shown;
    const me = this.props!.playerId;
    replaceChildren(
      this.team,
      g.order.map((id) => {
        const e = g.explorers.find((x) => x.id === id);
        if (!e) return null;
        const hearts = h("span", { class: "wd-hearts", role: "img", "aria-label": e.down ? "Down" : `${e.hearts} of ${N.hearts} Hearts` });
        hearts.innerHTML = Array.from(
          { length: N.hearts },
          (_, i) => `<svg class="${i < e.hearts ? "on" : ""}" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="${HEART_ICON}"/></svg>`,
        ).join("");
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
    if (g.phase === "roles") return replaceChildren(this.panel, this.rolesPanel());
    if (g.phase === "choice") return replaceChildren(this.panel, this.choicePanel());
    if (g.phase === "report" || (g.phase === "over" && g.lastRound)) return replaceChildren(this.panel, this.reportPanel());
    replaceChildren(this.panel);
  }

  // ---- roles ----------------------------------------------------------------

  private rolesPanel(): HTMLElement {
    const g = this.game;
    const meId = this.props!.playerId;
    const self = g.explorers.find((e) => e.id === meId && !e.left);
    const live = g.explorers.filter((e) => !e.left);
    const waiting = live.filter((e) => !e.role);
    const pick = (r: Role) => () => {
      this.api.act({ type: "pick-role", role: r });
      audio.play("card-place");
    };
    return h(
      "div",
      { class: "wd-roles" },
      h("h2", {}, "Pick your role"),
      h("p", { class: "wd-hint" }, "Two players can pick the same role. No role is needed to win."),
      h(
        "div",
        { class: "wd-role-list" },
        ROLES.map((r) => {
          const by = live.filter((e) => e.role === r).map((e) => (e.id === meId ? "You" : this.name(e.id)));
          return h(
            "button",
            { type: "button", class: "wd-role", "aria-pressed": String(self?.role === r), disabled: !self, onclick: pick(r) },
            h("span", { class: "wd-role-head" }, h("span", { class: `wd-dot wd-role-${r}`, "aria-hidden": "true" }), h("b", {}, ROLE_NAME[r])),
            h("small", { class: "wd-role-stats" }, roleStats(r)),
            h("span", { class: "wd-role-power" }, ROLE_POWER[r]),
            by.length ? h("small", { class: "wd-role-by" }, `Picked by: ${by.join(", ")}`) : null,
          );
        }),
      ),
      self?.role && self.items.length
        ? h(
            "div",
            { class: "wd-items" },
            h("p", {}, h("b", {}, self.items.length === 1 ? "Your item" : "Your items")),
            self.items.map((i) => h("p", {}, h("b", {}, `${ITEM_NAME[i]}: `), ITEM_USE[i])),
          )
        : null,
      waiting.length
        ? h("p", { class: "wd-hint" }, `Waiting for ${waiting.map((e) => (e.id === meId ? "you" : this.name(e.id))).join(", ")}. No pick in time means a random role.`)
        : null,
    );
  }

  // ---- choice ---------------------------------------------------------------

  private choicePanel(): HTMLElement {
    const g = this.game;
    const card = g.event ? EVENTS[g.event.id] : null;
    const options = g.event?.options ?? [];
    const mine = this.me?.vote ?? null;
    const inGame = g.explorers.filter((e) => !e.left).length;
    const can = g.explorers.some((e) => e.id === this.props!.playerId && !e.left);
    return h(
      "div",
      { class: "wd-choice" },
      h("h2", {}, "Vote"),
      h("p", { class: "wd-hint" }, "Most votes wins. You can change your vote until time runs out."),
      h(
        "div",
        { class: "wd-options" },
        options.map((o, i) =>
          h(
            "button",
            {
              type: "button",
              class: "wd-option",
              "aria-pressed": String(mine === i),
              disabled: !can,
              onclick: () => {
                this.api.act({ type: "vote", option: i });
                audio.play("card-place");
              },
            },
            o,
          ),
        ),
      ),
      card ? h("p", { class: "wd-hint" }, card.kind === "bargain" ? "A tie means Refuse." : "A tie goes to the first option.") : null,
      h("p", { class: "wd-count", "aria-live": "polite" }, votedLine(g.voted?.length ?? 0, inGame)),
    );
  }

  // ---- report ---------------------------------------------------------------

  /** Plays a new round's report once, from the board as the plan closed. */
  private startReport(props: GameViewProps) {
    const g = this.game;
    if (this.playback.running && g.phase !== "report" && g.phase !== "over") this.playback.skip();
    if (g.phase !== "report" || !g.lastRound || g.lastRound.round === this.played) return;
    this.played = g.lastRound.round;
    const start = this.before;
    this.before = null;
    if (props.snapshot || !start || start.round !== g.lastRound.round || reducedMotion()) return;
    const frames = buildFrames(start, g, g.lastRound.steps, this.name);
    const budget = Math.max(MIN_PLAYBACK_MS, (g.deadline - this.api.serverNow()) * PLAYBACK_SHARE);
    this.playback.play(fitFrames(frames, budget));
  }

  private showFrame(f: Frame | null) {
    if (!this.props) return;
    this.renderAll();
    if (!f) return;
    animate(this.board.svg, f);
    if (f.roll) audio.play("deal");
  }

  private renderCaption() {
    const f = this.playback.frame;
    this.caption.hidden = !f;
    if (!f) return replaceChildren(this.caption);
    replaceChildren(
      this.caption,
      h("p", { class: "wd-caption-text" }, f.caption || "\u00a0"),
      f.roll ? rollBox(f.roll) : null,
    );
  }

  private reportPanel(): HTMLElement {
    const g = this.game;
    if (this.playback.running) {
      return h(
        "div",
        { class: "wd-report" },
        h("button", { type: "button", class: "link", onclick: () => this.playback.skip() }, "Skip to the end"),
      );
    }
    const r = g.lastRound;
    const lines = (r?.lines ?? []).map((l) => fillNames(l, this.name));
    const vote = voteResult(g);
    const self = g.explorers.some((e) => e.id === this.props!.playerId && !e.left);
    return h(
      "div",
      { class: "wd-report" },
      h("h2", {}, r ? `Round ${r.round}` : "The round"),
      g.end ? h("p", { class: `wd-end ${g.end}` }, END_LINE[g.end]) : null,
      vote ? h("p", { class: "wd-hint" }, vote) : null,
      lines.length ? h("ul", { class: "wd-lines" }, lines.map((l) => h("li", {}, l))) : h("p", { class: "wd-lines-empty" }, "A quiet round."),
      g.phase === "report" && self
        ? h(
            "button",
            {
              type: "button",
              class: "primary wd-wide",
              disabled: this.nextSent,
              onclick: () => {
                this.nextSent = true;
                this.api.act({ type: "next" });
                this.renderPanel();
              },
            },
            this.nextSent ? "Waiting for the others" : "Next",
          )
        : null,
    );
  }

  // ---- the board --------------------------------------------------------------

  private renderBoard() {
    if (this.playback.running) {
      this.legend.hidden = true;
      return void this.board.render(this.shown, new Map(), new Map());
    }
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
      if (e.type === "phase" && (e.phase === "plan" || e.phase === "choice")) {
        audio.play("your-turn");
        audio.buzz(25);
      }
    }
  }
}
