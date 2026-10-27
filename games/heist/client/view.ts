import { audio } from "@games/audio";
import { roleReveal } from "@games/hidden-roles/reveal";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { JOB_NAMES, JOBS, MAX_HEAT } from "../shared/rules.ts";
import type { Card, HeistEvent, HeistPrivateState, HeistPublicState, JobRecord, Phase, ProposalRecord, Vote } from "../shared/types.ts";

type Pub = HeistPublicState;
type Priv = HeistPrivateState;

/** The last seconds of a vote or a job tick out loud. */
const TICK_FROM = 5;

const PHASE_LABEL: Record<Phase, string> = {
  reveal: "Your card",
  propose: "Proposal",
  vote: "Vote",
  job: "On the job",
  finished: "Debrief",
};

/** "A and B", "A, B and C". */
function list(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export class HeistView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "heist" });
  private phaseLabel = h("span", { class: "hz-phase" });
  private jobLabel = h("span", { class: "hz-job" });
  private timer = h("span", { class: "hz-timer", role: "timer" });
  private bar = h("div", { class: "hz-bar" });
  private board = h("div", { class: "hz-board" });

  private card: ReturnType<typeof roleReveal> | null = null;
  private cardKey = "";
  private cardSlot = h("div", { class: "hz-card-slot" });

  private headline = h("p", { class: "hz-headline", role: "status", "aria-live": "polite" });
  private sub = h("p", { class: "hz-sub" });
  private button = h("button", { type: "button", class: "primary hz-action" });
  private note = h("p", { class: "hz-note", "aria-live": "assertive" });
  private panel = h("div", { class: "hz-panel" });
  private last = h("div", { class: "hz-last" });

  /** The leader's picks so far, before they propose. */
  private chosen: string[] = [];
  private stage = "";
  private lastTick = -1;
  private clock: ReturnType<typeof setInterval>;

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(
      h("div", { class: "hz-top" }, this.phaseLabel, this.jobLabel, this.timer),
      h("div", { class: "hz-track", "aria-hidden": "true" }, this.bar),
      this.board,
      this.cardSlot,
      this.headline,
      this.sub,
      this.button,
      this.note,
      this.panel,
      this.last,
    );
    this.button.addEventListener("click", () => this.press());
    this.clock = setInterval(() => this.renderClock(), 200);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    clearInterval(this.clock);
    this.card?.destroy();
    this.root.remove();
  }

  rejected(_clientActionId: string, message: string) {
    this.note.textContent = message;
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    if (!props.snapshot && this.props) this.sounds(props.events as HeistEvent[], props);
    this.settle(props);
  }

  // ---- helpers ------------------------------------------------------------

  private name(id: string | null | undefined, props: GameViewProps = this.props!): string {
    return id === props.playerId ? "you" : seatName(props.room, id);
  }

  private Name(id: string | null | undefined, props: GameViewProps = this.props!): string {
    const n = this.name(id, props);
    return n === "you" ? "You" : n;
  }

  private names(ids: string[], props: GameViewProps = this.props!): string {
    return list(ids.map((id) => this.name(id, props)));
  }

  // ---- input --------------------------------------------------------------

  private press() {
    const game = this.props?.game as Pub | undefined;
    const me = this.props?.private as Priv | null | undefined;
    if (!game || !me) return;
    if (game.phase === "reveal" && !me.acked) {
      this.api.act({ type: "ack" });
    } else if (game.phase === "propose" && this.leading() && this.chosen.length === game.sizes[game.job]) {
      this.api.act({ type: "propose", crew: this.chosen });
      audio.play("card-place");
    }
  }

  private leading(): boolean {
    const game = this.props?.game as Pub | undefined;
    return !!game && game.phase === "propose" && game.leader === this.props!.playerId;
  }

  private toggle(id: string) {
    const game = this.props?.game as Pub | undefined;
    if (!game || !this.leading()) return;
    const want = game.sizes[game.job]!;
    if (this.chosen.includes(id)) this.chosen = this.chosen.filter((x) => x !== id);
    else if (this.chosen.length < want) this.chosen = [...this.chosen, id];
    else if (want === 1) this.chosen = [id];
    else {
      this.note.textContent = `That's ${want}. Tap someone to take them off.`;
      return;
    }
    this.note.textContent = "";
    if (this.props) this.settle(this.props);
  }

  private vote(vote: Vote) {
    const me = this.props?.private as Priv | null | undefined;
    if (!me?.canVote) return;
    this.api.act({ type: "vote", vote });
    audio.play("card-place");
    audio.buzz(15);
  }

  private play(card: Card) {
    const me = this.props?.private as Priv | null | undefined;
    if (!me?.onJob) return;
    // Sent as tapped, by everyone: the server plays a crew Sabotage as Clean, so
    // every phone on the job answers a tap the same way (ruling 4).
    this.note.textContent = "";
    this.api.act({ type: "card", card });
    audio.play("card-place");
    audio.buzz(15);
  }

  // ---- the clock ----------------------------------------------------------

  private renderClock() {
    const game = this.props?.game as Pub | undefined;
    if (!game || game.phase === "finished" || !game.phaseMs) {
      this.timer.textContent = "";
      this.bar.style.transform = "scaleX(0)";
      return;
    }
    const left = Math.max(0, game.deadline - this.api.serverNow());
    const secs = Math.ceil(left / 1000);
    this.timer.textContent = secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : `${secs} s`;
    this.bar.style.transform = `scaleX(${Math.min(1, left / game.phaseMs)})`;
    const low = secs <= TICK_FROM && (game.phase === "vote" || game.phase === "job" || this.leading());
    this.root.classList.toggle("low", low);
    if (low && secs > 0 && secs !== this.lastTick && document.visibilityState === "visible") {
      this.lastTick = secs;
      audio.play("tick");
    }
  }

  // ---- settled state ------------------------------------------------------

  private settle(props: GameViewProps) {
    this.props = props;
    const game = props.game as Pub;
    const me = props.private as Priv | null;
    const stage = `${game.phase}:${game.job}:${game.proposals.length}:${game.leader}`;
    if (stage !== this.stage) {
      this.stage = stage;
      this.chosen = [];
      this.lastTick = -1;
      this.note.textContent = "";
    }
    // A leaver can take a picked player with them.
    this.chosen = this.chosen.filter((id) => game.players.some((p) => p.id === id && !p.left));
    this.root.dataset.phase = game.phase;
    this.phaseLabel.textContent = PHASE_LABEL[game.phase];
    this.jobLabel.textContent = game.phase === "finished" ? "" : `Job ${game.job + 1} of ${JOBS}: ${JOB_NAMES[game.job]}`;

    this.renderBoard(game);
    this.renderCard(props, game, me);
    this.renderPrompt(props, game, me);
    this.renderPanel(props, game, me);
    this.renderLast(props, game);
    this.renderClock();
  }

  /** Five jobs with their crew sizes and results, and the heat. Same on every phone. */
  private renderBoard(game: Pub) {
    const jobs = Array.from({ length: JOBS }, (_, k) => {
      const done = game.jobs[k];
      const now = game.phase !== "finished" && k === game.job;
      const cls = ["hz-pip", done ? `won-${done.winner}` : "", now ? "now" : ""].filter(Boolean).join(" ");
      const label = done
        ? `Job ${k + 1}: ${done.winner === "crew" ? "came off" : done.heat ? "lost to heat" : "sabotaged"}`
        : `Job ${k + 1}: crew of ${game.sizes[k]}`;
      return h("li", { class: cls, "aria-label": label, "aria-current": now ? "step" : null }, done ? (done.winner === "crew" ? "✓" : done.heat ? "♨" : "✗") : String(game.sizes[k]));
    });
    const heat = Array.from({ length: MAX_HEAT }, (_, i) => h("span", { class: i < game.heat ? "hz-heat-dot on" : "hz-heat-dot" }));
    replaceChildren(
      this.board,
      h("ol", { class: "hz-jobs", "aria-label": "Jobs" }, jobs),
      h(
        "div",
        { class: "hz-meta" },
        h("span", { class: "hz-score" }, `Crew ${game.score.crew} · Moles ${game.score.mole}`),
        h("span", { class: "hz-heat", role: "img", "aria-label": `Heat ${game.heat} of ${MAX_HEAT}` }, "Heat ", heat),
        h("span", { class: "hz-moles" }, plural(game.moleCount, "mole")),
      ),
    );
  }

  /** Crew or mole: face down until tapped, and again whenever the tab goes. */
  private renderCard(props: GameViewProps, game: Pub, me: Priv | null) {
    const show = !!me?.alignment && game.phase !== "finished";
    this.cardSlot.hidden = !show;
    if (!show) {
      this.card?.destroy();
      this.card = null;
      this.cardKey = "";
      return;
    }
    const mole = me!.alignment === "mole";
    const others = (me!.moles ?? []).filter((id) => id !== props.playerId);
    const key = `${me!.alignment}|${others.join(",")}|${me!.budget ?? ""}`;
    if (key === this.cardKey && this.card) return;
    this.cardKey = key;
    const body = h(
      "div",
      { class: `hz-card ${mole ? "mole" : "crew"}` },
      h("span", { class: "hz-card-kicker" }, "You're"),
      h("strong", { class: "hz-card-role" }, mole ? "A mole" : "Crew"),
      mole
        ? h("span", { class: "hz-card-blurb" }, others.length ? `The other moles: ${this.names(others, props)}.` : "The other moles have left.")
        : h("span", { class: "hz-card-blurb" }, "Pull off three jobs. Some of your crew are lying."),
      mole ? h("span", { class: "hz-card-result" }, `Sabotage cards left: ${me!.budget}`) : null,
    );
    if (this.card) this.card.update(body);
    else {
      this.card = roleReveal({ title: "Your card", body });
      this.cardSlot.append(this.card.el);
    }
  }

  private renderPrompt(props: GameViewProps, game: Pub, me: Priv | null) {
    let headline = "";
    let sub = "";
    let button: string | null = null;
    const want = game.sizes[game.job] ?? 0;
    switch (game.phase) {
      case "reveal": {
        const left = game.players.filter((p) => !p.left).length - game.acked;
        headline = me?.acked ? "Waiting for the others" : "Check your card";
        sub = me?.acked ? `${left} still looking` : "Tap it, read it, keep it to yourself.";
        if (me?.alignment && !me.acked) button = "Got it";
        break;
      }
      case "propose":
        if (this.leading()) {
          headline = `You lead. Pick a crew of ${want}.`;
          sub = `${this.chosen.length} of ${want} picked. You can pick yourself.`;
          if (this.chosen.length === want) button = "Propose";
        } else {
          headline = `${this.Name(game.leader, props)} is picking a crew of ${want}`;
          sub = "Make your case out loud.";
        }
        break;
      case "vote":
        headline = `Send ${this.names(game.crew, props)}?`;
        sub = me?.vote
          ? `You said ${me.vote === "go" ? "Go" : "No-go"}. You can change it. ${game.voted} of ${game.voters} in.`
          : `More than half must say Go. ${game.voted} of ${game.voters} in.`;
        break;
      case "job":
        if (me?.onJob) {
          // Same words for every card and every player: the screen never says which.
          headline = me.card ? "Card in" : "Play a card";
          sub = me.card ? "You can change it till the clock runs out." : "Face down. Missing cards play as Clean.";
        } else {
          headline = `${this.Name(game.crew[0], props)}${game.crew.length > 1 ? ` and ${game.crew.length - 1} more` : ""} on the job`;
          sub = "Cards are counted when the clock runs out.";
        }
        break;
      case "finished":
        headline = this.outcome(game);
        break;
    }
    this.headline.textContent = headline;
    this.sub.textContent = sub;
    this.button.hidden = !button;
    if (button) this.button.textContent = button;
  }

  private outcome(game: Pub): string {
    if (game.endReason === "too-few") return "Too few players left. No winner.";
    if (game.endReason === "no-moles") return "The last mole left. No winner.";
    if (game.endReason === "no-crew") return "No crew left. No winner.";
    return game.winner === "crew" ? "The crew pulls it off." : "The moles win.";
  }

  private renderPanel(props: GameViewProps, game: Pub, me: Priv | null) {
    this.panel.dataset.kind = "";
    if (this.leading()) {
      this.panel.dataset.kind = "pick";
      const ids = game.players.filter((p) => !p.left).map((p) => p.id);
      return replaceChildren(
        this.panel,
        h("ul", { class: "hz-list" }, ids.map((id) => this.row(props, id, { pressed: this.chosen.includes(id), onclick: () => this.toggle(id) }))),
      );
    }
    if (game.phase === "vote") {
      this.panel.dataset.kind = "vote";
      return replaceChildren(
        this.panel,
        this.crewList(props, game.crew),
        me?.canVote
          ? h(
              "div",
              { class: "hz-choices" },
              h("button", { type: "button", class: "hz-choice go", "aria-pressed": String(me.vote === "go"), onclick: () => this.vote("go") }, "Go"),
              h("button", { type: "button", class: "hz-choice no-go", "aria-pressed": String(me.vote === "no-go"), onclick: () => this.vote("no-go") }, "No-go"),
            )
          : null,
      );
    }
    if (game.phase === "job") {
      this.panel.dataset.kind = "job";
      // Every crew member sees the same two cards, enabled the same way, and the
      // same status line under them (ruling 4). A mole's count is on their card,
      // behind the tap.
      const status = "Cards stay face down. Nobody sees yours.";
      return replaceChildren(
        this.panel,
        this.crewList(props, game.crew),
        me?.onJob
          ? h(
              "div",
              { class: "hz-choices" },
              h(
                "button",
                { type: "button", class: "hz-choice card", "aria-pressed": String(me.card === "clean"), onclick: () => this.play("clean") },
                h("span", { class: "hz-card-name" }, "Clean"),
                h("span", { class: "hz-card-note" }, "Job goes ahead"),
              ),
              h(
                "button",
                { type: "button", class: "hz-choice card", "aria-pressed": String(me.card === "sabotage"), onclick: () => this.play("sabotage") },
                h("span", { class: "hz-card-name" }, "Sabotage"),
                h("span", { class: "hz-card-note" }, "Job fails"),
              ),
            )
          : null,
        me?.onJob ? h("p", { class: "hz-status" }, status) : null,
      );
    }
    if (game.phase === "finished" && game.alignments) return this.renderDebrief(props, game);
    replaceChildren(
      this.panel,
      h("ul", { class: "hz-list" }, game.players.map((p) => this.row(props, p.id, { extra: p.id === game.leader ? h("span", { class: "hz-tag lead" }, "leading") : null }))),
    );
  }

  private crewList(props: GameViewProps, crew: string[]): HTMLElement {
    return h("ul", { class: "hz-list hz-crew", "aria-label": "The crew" }, crew.map((id) => this.row(props, id, {})));
  }

  private row(props: GameViewProps, id: string, opts: { pressed?: boolean; onclick?: () => void; extra?: Node | null }): HTMLElement {
    const game = props.game as Pub;
    const seat = props.room.seats.find((s) => s.id === id);
    const left = game.players.find((p) => p.id === id)?.left;
    const inner = [
      seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
      h("span", { class: "hz-name" }, id === props.playerId ? "You" : seatName(props.room, id)),
      opts.extra ?? null,
      left ? h("span", { class: "hz-tag" }, "left") : null,
    ];
    const cls = ["hz-row", left && "gone", id === props.playerId && "me"].filter(Boolean).join(" ");
    return opts.onclick
      ? h("li", { class: cls }, h("button", { type: "button", class: "hz-pick", "aria-pressed": String(!!opts.pressed), onclick: opts.onclick }, inner))
      : h("li", { class: cls }, h("div", { class: "hz-pick" }, inner));
  }

  /** What just happened: the last vote by name, and the last job's count. */
  private renderLast(props: GameViewProps, game: Pub) {
    const show = game.phase !== "finished" && game.phase !== "reveal" && (game.proposals.length > 0 || game.jobs.length > 0);
    this.last.hidden = !show;
    // Emptied, not just hidden: a rematch mustn't carry the last game's lines.
    if (!show) return replaceChildren(this.last);
    const p = game.proposals.at(-1);
    const j = game.jobs.at(-1);
    replaceChildren(
      this.last,
      j ? h("p", { class: "hz-last-job" }, this.jobLine(j, props)) : null,
      p ? h("section", { class: "hz-dawn-part" }, h("h3", {}, "Last vote"), this.proposalLine(p, props)) : null,
    );
  }

  private jobLine(j: JobRecord, props: GameViewProps): string {
    const name = `Job ${j.job + 1}, ${JOB_NAMES[j.job]}`;
    if (j.heat) return `${name}: lost to heat.`;
    const auto = j.auto ? ` ${plural(j.auto, "card")} auto-played as Clean.` : "";
    const crew = this.names(j.crew, props);
    return j.winner === "crew"
      ? `${name}: came off clean (${crew}).${auto}`
      : `${name}: sabotaged, ${plural(j.sabotaged, "Sabotage card")} (${crew}).${auto}`;
  }

  private proposalLine(p: ProposalRecord, props: GameViewProps): HTMLElement {
    const lead = this.Name(p.leader, props);
    if (p.timedOut) return h("p", { class: "hz-muted" }, `${lead} didn't propose in time. Heat +1.`);
    const voters = Object.entries(p.votes);
    const go = voters.filter(([, v]) => v === "go").length;
    const verdict = p.voided ? "passed, then called off when someone left" : p.passed ? "passed" : "voted down";
    return h(
      "div",
      { class: "hz-proposal" },
      h("p", {}, `${lead} proposed ${this.names(p.crew, props)}: ${verdict}, ${go}–${voters.length - go}.`),
      h(
        "ul",
        { class: "hz-votes" },
        voters.map(([id, v]) => h("li", { class: v }, `${this.Name(id, props)}: ${v === "go" ? "Go" : "No-go"}${p.missed.includes(id) ? " (missed)" : ""}`)),
      ),
    );
  }

  /** Everything: who was what, every job, every proposal. Never a card. */
  private renderDebrief(props: GameViewProps, game: Pub) {
    const al = game.alignments!;
    replaceChildren(
      this.panel,
      h(
        "section",
        { class: "hz-dawn-part" },
        h("h3", {}, "Who was who"),
        h(
          "ul",
          { class: "hz-list" },
          game.players.map((p) =>
            this.row(props, p.id, { extra: h("span", { class: `hz-side ${al[p.id]}` }, al[p.id] === "mole" ? "Mole" : "Crew") }),
          ),
        ),
      ),
      h(
        "section",
        { class: "hz-dawn-part" },
        h("h3", {}, "The jobs"),
        game.jobs.length ? h("ol", { class: "hz-log" }, game.jobs.map((j) => h("li", {}, this.jobLine(j, props)))) : h("p", { class: "hz-muted" }, "None played."),
      ),
      h(
        "section",
        { class: "hz-dawn-part" },
        h("h3", {}, "Every proposal"),
        game.proposals.length
          ? h("ol", { class: "hz-log" }, game.proposals.map((p) => h("li", {}, h("b", {}, `Job ${p.job + 1}. `), this.proposalLine(p, props))))
          : h("p", { class: "hz-muted" }, "None made."),
      ),
    );
  }

  // ---- what just happened -------------------------------------------------

  private sounds(events: HeistEvent[], props: GameViewProps) {
    const me = props.private as Priv | null;
    for (const e of events) {
      switch (e.type) {
        case "propose":
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
        case "job-done":
          audio.play(e.winner === "crew" ? "correct" : "boom");
          break;
        case "voided":
          audio.play("nudge");
          break;
        case "game-over": {
          const won = !!e.winner && me?.alignment === e.winner;
          audio.play(won ? "win" : e.winner ? "game-over" : "nudge");
          if (won) audio.buzz([40, 60, 40]);
          break;
        }
      }
    }
  }
}
