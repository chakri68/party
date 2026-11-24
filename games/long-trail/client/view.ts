import { audio } from "@games/audio";
import { avatar, countdown, faceColor, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { packFor, stopById, type LegKind, type RouteDef, type SettingPack } from "../shared/pack.ts";
import type { LongTrailEvent, LongTrailPrivateState, LongTrailPublicState, Phase, Plan } from "../shared/types.ts";
import { BAND_BARS, BAND_LABEL, goalLine, HEALTH_LABEL, infoLines } from "./format.ts";
import { planCard, PlanForm } from "./plan.ts";
import { sceneModel } from "./scene/model.ts";
import { TrailScene } from "./scene/stage.ts";
import { dayReport, proposalsPart, recapView } from "./report.ts";

type Pub = LongTrailPublicState;
type Priv = LongTrailPrivateState;

/** The last seconds of a timed choice tick out loud. */
const TICK_FROM = 5;

const PHASE_LABEL: Record<Phase, string> = {
  reveal: "Your job",
  plan: "Plan",
  vote: "Vote",
  choice: "Choice",
  summary: "Day report",
  recap: "The trip",
  over: "Done",
};
const KIND_LABEL: Record<LegKind, string> = { desert: "desert", mountain: "mountains", river: "river", plain: "plains" };

type StripNode = { kind: "stop"; id: string; state: "reached" | "here" | "ahead" } | { kind: "fork"; ids: [string, string]; pick: string | null };

export class LongTrailView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "long-trail" });
  private dayLabel = h("span", { class: "lt-day" });
  private phaseLabel = h("span", { class: "lt-phase" });
  private timer = countdown();
  private bar = h("div", { class: "lt-bar" });
  private scene = new TrailScene();
  private strip = h("div", { class: "lt-strip" });
  private stock = h("div", { class: "lt-stock" });
  private party = h("ul", { class: "lt-party", "aria-label": "Travellers" });
  private you = h("section", { class: "lt-you", "aria-label": "You" });
  private headline = h("p", { class: "lt-headline", role: "status", "aria-live": "polite" });
  private sub = h("p", { class: "lt-sub" });
  private note = h("p", { class: "lt-note", "aria-live": "assertive" });
  private panel = h("div", { class: "lt-panel" });
  private button = h("button", { type: "button", class: "primary lt-action" });

  private form = new PlanForm();
  private stage = "";
  /** The goal starts open only in the reveal, so a reload mid-game does not show it to a neighbour. */
  private goalOpen: boolean | null = null;
  /** Yesterday's report under the plan and vote. Null: the default for this day. */
  private reportOpen: boolean | null = null;
  private turn: string | null | undefined = undefined;
  private lastTick = -1;
  private clock: ReturnType<typeof setInterval>;

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(
      h("div", { class: "lt-top" }, this.dayLabel, this.phaseLabel, this.timer.el),
      h("div", { class: "lt-track", "aria-hidden": "true" }, this.bar),
      this.scene.el,
      this.strip,
      this.stock,
      this.party,
      this.you,
      h("div", { class: "lt-prompt" }, this.headline, this.sub, this.note),
      this.panel,
      this.button,
    );
    this.button.addEventListener("click", () => this.press());
    this.clock = setInterval(() => this.renderClock(), 200);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    clearInterval(this.clock);
    this.scene.destroy();
    this.root.remove();
  }

  rejected(_clientActionId: string, message: string) {
    this.note.textContent = message;
    // A refused proposal: Propose works again.
    this.form.unlock();
    if (this.props) this.settle(this.props);
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    if (!props.snapshot && this.props) this.sounds(props.events as LongTrailEvent[], props);
    this.settle(props);
  }

  // ---- helpers ------------------------------------------------------------

  private get game(): Pub {
    return this.props!.game as Pub;
  }
  private get me(): Priv | null {
    return (this.props?.private as Priv | null) ?? null;
  }
  private world(): { pack: SettingPack; route: RouteDef } {
    const pack = packFor(this.game.settings.setting);
    return { pack, route: pack.routes[this.game.settings.length] };
  }
  private name = (id: string): string => (id === this.props!.playerId ? "You" : seatName(this.props!.room, id));
  private leading(): boolean {
    return this.game.phase === "plan" && this.game.leader === this.props!.playerId;
  }
  /** The day on screen: after travel the server has already moved on to the next day. */
  private shownDay(): number {
    const g = this.game;
    return g.phase === "choice" || g.phase === "summary" ? Math.max(1, g.day - 1) : g.day;
  }

  // ---- input --------------------------------------------------------------

  private press() {
    const g = this.game;
    const me = this.me;
    if (!me) return;
    if (g.phase === "reveal" && !me.acked) this.api.act({ type: "ack" });
    else if ((g.phase === "summary" || g.phase === "recap") && !me.acked) this.api.act({ type: "next" });
    else return;
    audio.play("card-place");
  }

  private propose(plan: Plan) {
    this.note.textContent = "";
    this.api.act({ type: "propose", plan });
    audio.play("card-place");
  }

  private vote(vote: "go" | "no-go") {
    this.api.act({ type: "vote", vote });
    audio.play("card-place");
    audio.buzz(15);
  }

  private choose(option: 0 | 1) {
    this.api.act({ type: "choose", option });
    audio.play("card-place");
    audio.buzz(15);
  }

  private arm(on: boolean) {
    this.api.act({ type: "arm", on });
    audio.play(on ? "deal" : "pass");
  }

  // ---- the clock ----------------------------------------------------------

  private renderClock() {
    const g = this.props?.game as Pub | undefined;
    if (!g || g.phase === "over" || !g.phaseMs) {
      this.timer.set(null);
      this.bar.style.transform = "scaleX(0)";
      return;
    }
    const left = Math.max(0, g.deadline - this.api.serverNow());
    const secs = Math.ceil(left / 1000);
    const me = this.me;
    // Red only when this player has something to do now.
    const mine = this.leading() || (g.phase === "vote" && !me?.vote) || (g.phase === "choice" && me?.choiceVote === null);
    this.timer.set(left, { lowAt: mine ? undefined : 0 });
    this.bar.style.transform = `scaleX(${Math.min(1, left / g.phaseMs)})`;
    const low = secs <= TICK_FROM && mine;
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
    const stage = `${g.phase}:${g.day}:${g.proposalNo}:${g.leader}`;
    this.goalOpen ??= g.phase === "reveal";
    if (stage !== this.stage) {
      if (g.phase === "reveal") this.goalOpen = true;
      else if (this.stage.startsWith("reveal")) this.goalOpen = false;
      if (this.stage.split(":")[1] !== String(g.day)) this.reportOpen = null;
      this.stage = stage;
      this.form.reset();
      this.lastTick = -1;
      this.note.textContent = "";
    }
    this.root.dataset.phase = g.phase;
    this.root.dataset.leading = String(this.leading());
    const pre = g.phase === "reveal";
    this.dayLabel.textContent = g.phase === "recap" || g.phase === "over" ? "" : `Day ${this.shownDay()} of ${g.deadlineDay}`;
    this.phaseLabel.textContent = PHASE_LABEL[g.phase];
    const done = g.phase === "recap" || g.phase === "over";
    // The recap lists the route, so the strip goes with the stock.
    this.strip.hidden = pre || done;
    this.scene.el.hidden = pre || done;
    this.stock.hidden = pre || done;
    if (!this.strip.hidden) this.renderStrip();
    if (!this.scene.el.hidden) this.renderScene(props);
    if (!this.stock.hidden) this.renderStock();
    this.renderParty();
    this.renderYou();
    this.renderPrompt();
    this.renderPanel();
    this.renderTurn();
    this.renderClock();
  }

  private renderTurn() {
    const g = this.game;
    const me = this.me;
    let turn: string | null = null;
    if (me?.job) {
      if (g.phase === "reveal" && !me.acked) turn = "Read your job";
      else if (this.leading()) turn = "Plan the day";
      else if (g.phase === "vote" && !me.vote) turn = "Vote";
      else if (g.phase === "choice" && me.choiceVote === null) turn = "Choose";
    }
    if (turn === this.turn) return;
    this.turn = turn;
    this.api.setTurn(turn);
  }

  /** The trail scene: public state, the pack and the leader's draft only. */
  private renderScene(props: GameViewProps) {
    const g = this.game;
    const { pack, route } = this.world();
    const colorOf = (id: string) => {
      const seat = props.room.seats.find((s) => s.id === id);
      return seat?.avatarSeed ? faceColor(seat.avatarSeed) : null;
    };
    this.scene.update(sceneModel({ game: g, pack, route, draft: this.leading() ? this.form.plan(g) : null, colorOf }), { snapshot: props.snapshot });
  }

  /** The stops so far, where the caravan is, and what lies ahead. Forks show both ways. */
  private stripNodes(route: RouteDef, pick: string | null): StripNode[] {
    const g = this.game;
    const nodes: StripNode[] = g.visited.map((id) => ({ kind: "stop", id, state: id === g.at && !g.leg ? "here" : "reached" }));
    let cur = g.at;
    if (g.leg) {
      nodes.push({ kind: "stop", id: g.leg.to, state: "ahead" });
      cur = g.leg.to;
    }
    for (let guard = 0; guard < 40; guard++) {
      const next = stopById(route, cur).next;
      if (next.length === 0) break;
      if (next.length === 1) {
        cur = next[0]!.to;
        nodes.push({ kind: "stop", id: cur, state: "ahead" });
        continue;
      }
      const ids: [string, string] = [next[0]!.to, next[1]!.to];
      nodes.push({ kind: "fork", ids, pick: cur === g.at && !g.leg ? pick : null });
      const meet = stopById(route, ids[0]).next[0]?.to;
      if (!meet) break;
      cur = meet;
      nodes.push({ kind: "stop", id: cur, state: "ahead" });
    }
    return nodes;
  }

  private renderStrip() {
    const g = this.game;
    const { route } = this.world();
    // Only a real choice shows on the strip: the leader's draft, or the plan up for a vote.
    const pick = this.leading() ? this.form.plan(g).fork : g.phase === "vote" ? (g.plan?.fork ?? null) : null;
    const nodes = this.stripNodes(route, pick);
    const hereIdx = nodes.findIndex((n) => n.kind === "stop" && (n.state === "here" || (g.leg && n.id === g.leg.to)));
    const cells: HTMLElement[] = [];
    nodes.forEach((n, i) => {
      if (i > 0) {
        // The line into this node: filled up to where the caravan is, part filled on the current leg.
        const fill = i < hereIdx ? 1 : i === hereIdx ? (g.leg ? (g.leg.km - g.leg.kmLeft) / g.leg.km : 1) : 0;
        const line = h("span", { class: "lt-link" }, h("span", { class: "lt-link-fill" }));
        (line.firstChild as HTMLElement).style.width = `${Math.round(fill * 100)}%`;
        cells.push(line);
      }
      if (n.kind === "stop") {
        const s = stopById(route, n.id);
        cells.push(h("span", { class: `lt-node ${n.state}${s.market ? " market" : ""}`, title: s.name }));
      } else {
        cells.push(
          h(
            "span",
            { class: "lt-fork", title: n.ids.map((id) => stopById(route, id).name).join(" or ") },
            n.ids.map((id) => h("span", { class: `lt-node ahead${n.pick === id ? " pick" : ""}` })),
          ),
        );
      }
    });
    const where = g.leg
      ? `To ${stopById(route, g.leg.to).name}: ${g.leg.kmLeft} km left, ${KIND_LABEL[g.leg.kind]}`
      : `At ${stopById(route, g.at).name}${g.prices ? ", market" : ""}`;
    const names = nodes.map((n) => (n.kind === "stop" ? stopById(route, n.id).name : n.ids.map((id) => stopById(route, id).name).join(" or "))).join(", ");
    replaceChildren(
      this.strip,
      h("div", { class: "lt-route", role: "img", "aria-label": `Route: ${names}` }, cells),
      h("p", { class: "lt-where" }, where),
    );
  }

  private meter(label: string, band: Pub["stock"]["food"]): HTMLElement {
    const on = BAND_BARS[band];
    return h(
      "span",
      { class: `lt-meter ${band}`, role: "img", "aria-label": `${label}: ${BAND_LABEL[band]}` },
      h("b", {}, label),
      h("span", { class: "lt-bars", "aria-hidden": "true" }, [0, 1, 2, 3].map((i) => h("span", { class: i < on ? "on" : "" }))),
      h("span", { class: "lt-band" }, BAND_LABEL[band]),
    );
  }

  private renderStock() {
    const g = this.game;
    const { pack } = this.world();
    const L = pack.labels;
    const load = Object.values(g.stock.cargo).reduce((a, b) => a + b, 0);
    replaceChildren(
      this.stock,
      h("div", { class: "lt-stock-row" }, this.meter(L.food, g.stock.food), this.meter(L.water, g.stock.water), h("span", { class: "lt-count" }, h("b", {}, L.medicine), ` ${g.stock.medicine}`)),
      h(
        "div",
        { class: "lt-stock-row small" },
        h("span", { class: "lt-count" }, h("b", {}, L.coins), ` ${g.stock.coins}`),
        h("span", { class: "lt-count" }, h("b", {}, L.animals), ` ${g.stock.animals}`),
        pack.goods.map((gd) => h("span", { class: "lt-count" }, `${gd.name} ${g.stock.cargo[gd.id] ?? 0}`)),
        h("span", { class: `lt-count${load > g.capacity ? " warn" : ""}` }, h("b", {}, L.cargo), ` ${load}/${g.capacity}`),
      ),
    );
  }

  private renderParty() {
    const g = this.game;
    const props = this.props!;
    const { pack } = this.world();
    const showLead = g.phase !== "reveal" && g.phase !== "recap" && g.phase !== "over";
    const rows = g.players.map((p) => {
      const seat = props.room.seats.find((s) => s.id === p.id);
      const t = g.travellers.find((x) => x.id === p.id);
      const health = t?.health ?? 0;
      const pips = h(
        "span",
        { class: "lt-pips", "aria-hidden": "true" },
        [1, 2, 3].map((i) => h("span", { class: i <= health ? "on" : "" })),
      );
      const cls = ["lt-traveller", p.left && "gone", health === 0 && "dead", p.id === props.playerId && "me"].filter(Boolean).join(" ");
      return h(
        "li",
        { class: cls },
        seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
        h("span", { class: "lt-who" }, h("b", {}, this.name(p.id)), h("small", {}, pack.jobs[p.job].name)),
        showLead && g.leader === p.id ? h("span", { class: "lt-tag lead" }, "Leader") : null,
        p.left ? h("span", { class: "lt-tag" }, "Left") : h("span", { class: `lt-health h${health}` }, pips, HEALTH_LABEL[health]),
      );
    });
    replaceChildren(this.party, rows);
  }

  private renderYou() {
    const g = this.game;
    const me = this.me;
    this.you.hidden = !me?.job || g.phase === "recap" || g.phase === "over";
    if (this.you.hidden) return replaceChildren(this.you);
    const { pack, route } = this.world();
    const job = pack.jobs[me!.job!];
    const info = me!.info ? infoLines(me!.info, pack, route, this.name, g.choice?.options ?? []) : [];
    const a = me!.ability;
    const armPhase = g.phase === "plan" || g.phase === "vote";
    let abilityRow: HTMLElement;
    if (!a) abilityRow = h("p", { class: "lt-ability" }, job.ability);
    else {
      const state = a.used ? "Used." : a.armed ? "Ready. It works the next time it can." : "";
      abilityRow = h(
        "div",
        { class: "lt-ability-row" },
        h("p", { class: "lt-ability" }, job.ability, state ? h("b", {}, ` ${state}`) : null),
        a.canArm && armPhase
          ? h("button", { type: "button", class: "lt-toggle", "aria-pressed": String(a.armed), onclick: () => this.arm(!a.armed) }, a.armed ? "Cancel" : "Get ready")
          : null,
      );
    }
    const goal = h(
      "details",
      { class: "lt-goal", open: !!this.goalOpen },
      h("summary", {}, "Your secret goal"),
      h("p", {}, me!.goalText ? goalLine(me!.goalText, me!.goal, this.name, g.deadlineDay) : "No goal."),
    );
    goal.addEventListener("toggle", () => (this.goalOpen = goal.open));
    replaceChildren(
      this.you,
      h("h2", {}, `You: ${job.name}`),
      g.phase === "reveal" ? h("p", { class: "lt-hint" }, job.info) : null,
      info.length ? h("ul", { class: "lt-info" }, info.map((l) => h("li", {}, l))) : null,
      abilityRow,
      goal,
    );
  }

  private renderPrompt() {
    const g = this.game;
    const me = this.me;
    const lead = this.name(g.leader);
    let headline = "";
    let sub = "";
    let button: string | null = null;
    const waiting = () => `${g.players.filter((p) => !p.left).length - g.acked.length} still to tap.`;
    switch (g.phase) {
      case "reveal":
        headline = me?.acked ? "Waiting for the others" : "Read your job and your goal";
        sub = me?.acked ? waiting() : "Keep your goal secret.";
        if (me?.job && !me.acked) button = "Got it";
        break;
      case "plan":
        headline = this.leading() ? "You lead today. Plan the day." : `${lead} is planning the day`;
        sub = g.proposalNo === 2 ? "Second plan. If this one fails too, the caravan keeps its pace and rations, takes the safer way at a fork, and makes no trades." : "Talk about it out loud.";
        break;
      case "vote":
        headline = g.leader === this.props!.playerId ? "Vote on your plan" : `Vote on ${lead}'s plan`;
        sub = `${g.votes?.voted.length ?? 0} of ${g.votes?.of ?? 0} voted. More Go than No-go passes.`;
        break;
      case "choice":
        headline = "Choose together";
        sub = `${g.votes?.voted.length ?? 0} of ${g.votes?.of ?? 0} chose. A tie goes to the leader.`;
        break;
      case "summary":
        headline = `Day ${g.lastDay?.day ?? this.shownDay()}`;
        sub = me?.acked ? waiting() : "";
        if (me?.job && !me.acked) button = "Next";
        break;
      case "recap":
        headline = this.ending();
        sub = me?.acked ? waiting() : "";
        if (me?.job && !me.acked) button = "Done";
        break;
      case "over":
        headline = g.interrupted ? "The game ended early." : this.ending();
        break;
    }
    this.headline.textContent = headline;
    this.sub.textContent = sub;
    this.button.hidden = !button;
    if (button) this.button.textContent = button;
  }

  private ending(): string {
    const g = this.game;
    const r = g.recap;
    if (!r) return "The trip is over.";
    if (r.cause === "arrived") return `The caravan arrived on day ${r.route.at(-1)?.day ?? g.day}`;
    return r.cause === "all-dead" ? "Everyone died on the trail" : "The caravan did not arrive in time";
  }

  private renderPanel() {
    const g = this.game;
    const me = this.me;
    const { pack, route } = this.world();
    this.panel.dataset.kind = g.phase;
    switch (g.phase) {
      case "plan":
        if (this.leading())
          return replaceChildren(
            this.panel,
            this.form.render({ game: g, pack, route, me: this.props!.playerId, name: this.name, changed: () => this.settle(this.props!), propose: (p) => this.propose(p) }),
            proposalsPart(g.proposals, pack, route, this.name),
            this.yesterday(),
          );
        return replaceChildren(this.panel, proposalsPart(g.proposals, pack, route, this.name), this.yesterday());
      case "vote": {
        const mine = me?.vote ?? null;
        return replaceChildren(
          this.panel,
          g.plan ? planCard(g.plan, pack, route, this.name, g.leader === this.props!.playerId ? "Your plan" : `${this.name(g.leader)}'s plan`) : null,
          me?.job
            ? h(
                "div",
                { class: "lt-choices" },
                h("button", { type: "button", class: "lt-choice go", "aria-pressed": String(mine === "go"), onclick: () => this.vote("go") }, "Go"),
                h("button", { type: "button", class: "lt-choice no-go", "aria-pressed": String(mine === "no-go"), onclick: () => this.vote("no-go") }, "No-go"),
              )
            : null,
          mine ? h("p", { class: "lt-hint" }, `You said ${mine === "go" ? "Go" : "No-go"}. You can change it.`) : null,
          this.votedPart(),
          proposalsPart(g.proposals, pack, route, this.name),
          this.yesterday(),
        );
      }
      case "choice": {
        const c = g.choice;
        const mine = me?.choiceVote ?? null;
        return replaceChildren(
          this.panel,
          c
            ? h(
                "div",
                { class: "lt-event-card" },
                h("p", {}, c.text),
                h(
                  "div",
                  { class: "lt-choices stack" },
                  c.options.map((label, i) =>
                    h("button", { type: "button", class: "lt-choice", "aria-pressed": String(mine === i), disabled: !me?.job, onclick: () => this.choose(i as 0 | 1) }, label),
                  ),
                ),
              )
            : null,
          this.votedPart(),
        );
      }
      case "summary":
        return replaceChildren(
          this.panel,
          g.lastDay ? dayReport(g.lastDay, g.fired, pack, route, this.name) : null,
          g.lastDay ? proposalsPart(g.lastDay.proposals, pack, route, this.name) : null,
        );
      case "recap":
      case "over":
        return replaceChildren(this.panel, g.recap ? recapView(g.recap, g.goals, pack, g.deadlineDay, this.name, (id) => seatName(this.props!.room, id)) : null);
      default:
        return replaceChildren(this.panel);
    }
  }

  /** The last day's report stays to hand: the summary only shows for a few seconds. */
  private yesterday(): HTMLElement | null {
    const g = this.game;
    const d = g.lastDay;
    if (!d) return null;
    const { pack, route } = this.world();
    const box = h(
      "details",
      { class: "lt-yesterday", open: this.reportOpen ?? !this.leading() },
      h("summary", {}, `Day ${d.day} report`),
      dayReport(d, g.fired, pack, route, this.name),
    );
    box.addEventListener("toggle", () => (this.reportOpen = box.open));
    return box;
  }

  /** Who has voted so far, never how. */
  private votedPart(): HTMLElement | null {
    const v = this.game.votes;
    if (!v || !v.voted.length) return null;
    return h("p", { class: "lt-hint" }, `Voted: ${v.voted.map(this.name).join(", ")}.`);
  }

  // ---- what just happened -------------------------------------------------

  private sounds(events: LongTrailEvent[], props: GameViewProps) {
    for (const e of events) {
      switch (e.type) {
        case "plan":
          if (e.leader === props.playerId) {
            audio.play("your-turn");
            audio.buzz(25);
          }
          break;
        case "proposed":
          audio.play("deal");
          audio.buzz(15);
          break;
        case "vote-closed":
          audio.play(e.passed ? "correct" : "pass");
          break;
        case "choice":
          audio.play("nudge");
          audio.buzz(20);
          break;
        case "day-done":
          audio.play("shuffle");
          break;
        case "recap":
          audio.play("win");
          break;
      }
    }
  }
}
