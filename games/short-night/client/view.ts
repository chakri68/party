import { audio } from "@games/audio";
import { roleReveal } from "@games/hidden-roles/reveal";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { describeNightEntry, describeResult, list, nextPicks, wakingLine } from "../shared/describe.ts";
import { type RoleId, roleById } from "../shared/roles.ts";
import {
  type NightResult,
  NOBODY,
  type Phase,
  type ShortNightEvent,
  type ShortNightPrivateState,
  type ShortNightPublicState,
} from "../shared/types.ts";

type Pub = ShortNightPublicState;
type Priv = ShortNightPrivateState;

/** The last seconds of a ballot tick out loud. */
const TICK_FROM = 5;

const PHASE_LABEL: Record<Phase, string> = {
  reveal: "Your card",
  night: "Night",
  day: "Morning",
  vote: "Vote",
  runoff: "Runoff",
  finished: "Dawn",
};

const TEAM_LABEL = { village: "Village", wolves: "Wolves" } as const;

export class ShortNightView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "short-night" });
  private phaseLabel = h("span", { class: "sn-phase" });
  private stepLabel = h("span", { class: "sn-step" });
  private timer = h("span", { class: "sn-timer", role: "timer" });
  private bar = h("div", { class: "sn-bar" });

  private card: ReturnType<typeof roleReveal> | null = null;
  /** What the card says now, so it's only rebuilt when that changes. */
  private cardKey = "";
  private cardSlot = h("div", { class: "sn-card-slot" });

  private headline = h("p", { class: "sn-headline", role: "status", "aria-live": "polite" });
  private sub = h("p", { class: "sn-sub" });
  private button = h("button", { type: "button", class: "primary sn-action" });
  private panel = h("div", { class: "sn-panel" });
  private night = h("ol", { class: "sn-night", "aria-label": "Night order" });
  private note = h("p", { class: "sn-note", "aria-live": "assertive" });

  /** The picker's choices so far, before they confirm. */
  private chosen: string[] = [];
  /** Confirmed this step. Local, and the same on every phone: only the real picker's goes anywhere. */
  private confirmed = false;
  /** Phase and step the picks belong to; a new one clears them. */
  private stage = "";
  private lastTick = -1;
  private clock: ReturnType<typeof setInterval>;

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(
      h("div", { class: "sn-top" }, this.phaseLabel, this.stepLabel, this.timer),
      h("div", { class: "sn-track", "aria-hidden": "true" }, this.bar),
      this.cardSlot,
      this.headline,
      this.sub,
      this.button,
      this.note,
      this.panel,
      this.night,
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
    if (!props.snapshot && this.props) this.sounds(props.events as ShortNightEvent[], props);
    this.settle(props);
  }

  // ---- helpers ------------------------------------------------------------

  private name(id: string | null | undefined, props: GameViewProps = this.props!): string {
    if (id === NOBODY) return "Nobody";
    return id === props.playerId ? "you" : seatName(props.room, id);
  }

  /** Sentence-start form. */
  private Name(id: string | null | undefined, props: GameViewProps = this.props!): string {
    const n = this.name(id, props);
    return n === "you" ? "You" : n;
  }

  private isHost(): boolean {
    return !!this.props && this.props.room.hostId === this.props.playerId;
  }

  /** A night result, in words, for the card and for the dawn log. */
  private resultText(r: NightResult, holder: string, props: GameViewProps): string {
    return describeResult(r, holder, props.playerId, (id) => this.name(id, props));
  }

  // ---- input --------------------------------------------------------------

  private press() {
    const game = this.props?.game as Pub | undefined;
    const me = this.props?.private as Priv | null | undefined;
    if (!game || !me) return;
    if (game.phase === "reveal" && !me.acked) {
      this.api.act({ type: "ack" });
    } else if (game.phase === "night" && me.role && !this.confirmed && this.chosen.length === this.pickCount(game)) {
      // Everyone confirms; only the card that's awake (and that has a pick) sends it.
      if (me.picking) this.api.act({ type: "pick", targets: this.chosen });
      this.confirmed = true;
      audio.play("card-place");
      if (this.props) this.settle(this.props);
    } else if (game.phase === "day" && this.isHost()) {
      this.api.act({ type: "next" });
    }
  }

  /**
   * How many players this step asks everyone to pick: the awake role's count,
   * or one for a step with no pick. Public, so every phone asks the same.
   */
  private pickCount(game: Pub): number {
    return roleById(game.steps[game.step]!).picks || 1;
  }

  private toggle(id: string) {
    const game = this.props?.game as Pub | undefined;
    if (!game || game.phase !== "night" || this.confirmed) return;
    this.chosen = nextPicks(this.chosen, id, this.pickCount(game));
    this.note.textContent = "";
    if (this.props) this.settle(this.props);
  }

  private vote(choice: string) {
    const me = this.props?.private as Priv | null | undefined;
    if (!me?.choices.includes(choice)) return;
    this.api.act({ type: "vote", choice });
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
    const low = secs <= TICK_FROM && (game.phase === "vote" || game.phase === "runoff");
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
    const stage = `${game.phase}:${game.step}`;
    if (stage !== this.stage) {
      this.stage = stage;
      this.chosen = [];
      this.confirmed = false;
      this.lastTick = -1;
      this.note.textContent = "";
    }
    this.root.dataset.phase = game.phase;
    this.phaseLabel.textContent = PHASE_LABEL[game.phase];
    this.stepLabel.textContent = game.phase === "night" ? `${roleById(game.steps[game.step]!).label} · ${game.step + 1} of ${game.steps.length}` : "";

    this.renderCard(props, game, me);
    this.renderPrompt(props, game, me);
    this.renderPanel(props, game, me);
    this.renderNight(game);
    this.renderClock();
  }

  /** The role card: face down until tapped, and again whenever the tab goes. */
  private renderCard(props: GameViewProps, game: Pub, me: Priv | null) {
    const role = me?.role ?? null;
    const show = !!role && game.phase !== "finished";
    this.cardSlot.hidden = !show;
    if (!show) {
      // Dropped, not kept: a rematch's new card must start face down.
      this.card?.destroy();
      this.card = null;
      this.cardKey = "";
      return;
    }
    const r = roleById(role);
    const result = me!.result ? this.resultText(me!.result, props.playerId, props) : null;
    const key = `${role}|${result ?? ""}`;
    if (key === this.cardKey && this.card) return;
    this.cardKey = key;
    const body = h(
      "div",
      { class: `sn-card team-${r.team}` },
      h("span", { class: "sn-card-kicker" }, "You're the"),
      h("strong", { class: "sn-card-role" }, r.label),
      h("span", { class: "sn-card-team" }, `${TEAM_LABEL[r.team]} team`),
      h("span", { class: "sn-card-blurb" }, r.blurb),
      result ? h("span", { class: "sn-card-result" }, h("b", {}, "Your night: "), result) : null,
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
    let disabled = false;
    switch (game.phase) {
      case "reveal": {
        const left = game.players.filter((p) => !p.left).length - game.acked;
        headline = me?.acked ? "Waiting for the others" : "Check your card";
        sub = me?.acked ? `${left} still looking` : "Tap it, read it, keep it to yourself.";
        if (me?.role && !me.acked) button = "Got it";
        break;
      }
      case "night": {
        // Word for word the same on every phone, picker or not.
        const step = roleById(game.steps[game.step]!);
        const count = this.pickCount(game);
        headline = `${wakingLine(step)}. Everyone picks ${count === 1 ? "a player" : "two players"}.`;
        sub = this.confirmed
          ? "Locked in. Anything you learned is on your card."
          : "Only the picks of the card that's awake count. Pick anyway, so nobody can tell whose turn it is.";
        if (me?.role && !this.confirmed) {
          button = "Confirm";
          disabled = this.chosen.length !== count;
        }
        break;
      }
      case "day":
        headline = "Talk it out";
        sub = "Out loud. Claim what you like; Wolves lie. Then everyone votes.";
        if (this.isHost()) button = "Vote now";
        break;
      case "vote":
      case "runoff":
        headline = game.phase === "runoff" ? `Tied. Runoff: ${list(game.tied.map((id) => this.name(id, props)))}` : "Who's a Wolf?";
        sub = me?.vote
          ? `You voted ${me.vote === NOBODY ? "for nobody" : `for ${this.name(me.vote, props)}`}. You can change it. ${game.voted} of ${game.voters} in.`
          : me?.choices.length
            ? `${game.phase === "runoff" ? "One of them, " : "Anyone but you, or nobody. "}${game.voted} of ${game.voters} in.`
            : `${game.voted} of ${game.voters} in.`;
        break;
      case "finished":
        headline = this.outcome(props, game);
        sub = "";
        break;
    }
    this.headline.textContent = headline;
    this.sub.textContent = sub;
    this.button.hidden = !button;
    this.button.disabled = disabled;
    if (button) this.button.textContent = button;
  }

  private outcome(props: GameViewProps, game: Pub): string {
    if (game.endReason === "last-wolf-left") return "The last Wolf left. No winner.";
    if (game.endReason === "too-few") return "Too few players left. No winner.";
    if (game.endReason === "runoff-left") return "A runoff candidate left. No winner.";
    const team = game.winner === "village" ? "The village wins" : "The Wolves win";
    if (!game.out) return `Nobody was voted out. ${team}.`;
    const role = roleById(game.cards![game.out]!).label;
    const was = game.out === props.playerId ? "You were" : `${this.Name(game.out, props)} was`;
    return `${was} voted out: ${role === "Wolf" ? "a Wolf" : `the ${role}`}. ${team}.`;
  }

  /** The picker, the ballot, or the dawn reveal. Nothing for anyone else. */
  private renderPanel(props: GameViewProps, game: Pub, me: Priv | null) {
    this.panel.dataset.kind = "";
    if (game.phase === "night" && me?.role) {
      // The same list on every phone: everyone but you, in seat order (the server's choices).
      this.panel.dataset.kind = "pick";
      const others = game.players.map((p) => p.id).filter((id) => id !== props.playerId);
      return replaceChildren(
        this.panel,
        h("ul", { class: "sn-list" }, others.map((id) => this.row(props, id, { pressed: this.chosen.includes(id), disabled: this.confirmed, onclick: () => this.toggle(id) }))),
      );
    }
    if ((game.phase === "vote" || game.phase === "runoff") && me) {
      this.panel.dataset.kind = "vote";
      const named = me.choices.filter((c) => c !== NOBODY);
      return replaceChildren(
        this.panel,
        h("ul", { class: "sn-list" }, named.map((id) => this.row(props, id, { pressed: me.vote === id, onclick: () => this.vote(id) }))),
        me.choices.includes(NOBODY)
          ? h("button", { type: "button", class: "sn-nobody", "aria-pressed": String(me.vote === NOBODY), onclick: () => this.vote(NOBODY) }, "Nobody goes")
          : null,
      );
    }
    if (game.phase === "finished" && game.cards) return this.renderDawn(props, game);
    // Everyone's at the table; a plain list, with only who's left marked.
    replaceChildren(this.panel, h("ul", { class: "sn-list" }, game.players.map((p) => this.row(props, p.id, {}))));
  }

  private row(props: GameViewProps, id: string, opts: { pressed?: boolean; disabled?: boolean; onclick?: () => void; extra?: (Node | null)[] }): HTMLElement {
    const game = props.game as Pub;
    const seat = props.room.seats.find((s) => s.id === id);
    const left = game.players.find((p) => p.id === id)?.left;
    const inner = [
      seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
      h("span", { class: "sn-name" }, id === props.playerId ? "You" : seatName(props.room, id)),
      ...(opts.extra ?? []),
      left ? h("span", { class: "sn-tag" }, "left") : null,
    ];
    const cls = ["sn-row", left && "gone", id === props.playerId && "me"].filter(Boolean).join(" ");
    return opts.onclick
      ? h("li", { class: cls }, h("button", { type: "button", class: "sn-pick", "aria-pressed": String(!!opts.pressed), disabled: !!opts.disabled, onclick: opts.onclick }, inner))
      : h("li", { class: cls }, h("div", { class: "sn-pick" }, inner));
  }

  /** Everything, in order: the cards, the night, the votes. */
  private renderDawn(props: GameViewProps, game: Pub) {
    const cards = game.cards!;
    const votesFor = (votes: Record<string, string> | null, id: string) => Object.values(votes ?? {}).filter((v) => v === id).length;
    const ballot = (title: string, votes: Record<string, string> | null) =>
      votes
        ? h(
            "section",
            { class: "sn-dawn-part" },
            h("h3", {}, title),
            Object.keys(votes).length
              ? h(
                  "ul",
                  { class: "sn-votes" },
                  // Seat order, not the order the votes came in.
                  game.players.filter((p) => p.id in votes).map((p) => h("li", {}, `${this.Name(p.id, props)} → ${this.name(votes[p.id], props)}`)),
                )
              : h("p", { class: "sn-muted" }, "Nobody voted."),
          )
        : null;
    replaceChildren(
      this.panel,
      h(
        "section",
        { class: "sn-dawn-part" },
        h("h3", {}, "The cards"),
        h(
          "ul",
          { class: "sn-list" },
          game.players.map((p) => {
            const role = roleById(cards[p.id] as RoleId);
            const n = votesFor(game.votes, p.id);
            return this.row(props, p.id, {
              extra: [
                h("span", { class: `sn-role team-${role.team}${game.out === p.id ? " out" : ""}` }, role.label, game.out === p.id ? " (out)" : null),
                // First-ballot votes, in words: "2×" next to a card read as two cards.
                n ? h("span", { class: "sn-count" }, `${n} ${n === 1 ? "vote" : "votes"}`) : null,
              ],
            });
          }),
        ),
      ),
      h(
        "section",
        { class: "sn-dawn-part" },
        h("h3", {}, "The night"),
        h(
          "ol",
          { class: "sn-log" },
          (game.night ?? []).map((e) => {
            const label = roleById(e.role).label;
            const who = e.holders.length ? list(e.holders.map((id) => this.Name(id, props))) : "Nobody";
            const what = describeNightEntry(e, props.playerId, (id) => this.name(id, props));
            return h("li", {}, h("b", {}, `${label} (${who}): `), what);
          }),
        ),
      ),
      ballot("The vote", game.votes),
      ballot("The runoff", game.runoffVotes),
    );
  }

  /** The published night order, the current step marked. Same on every phone. */
  private renderNight(game: Pub) {
    const show = game.phase === "reveal" || game.phase === "night";
    this.night.hidden = !show;
    if (!show) return;
    replaceChildren(
      this.night,
      game.steps.map((id, i) =>
        h(
          "li",
          { class: game.phase === "night" && i === game.step ? "now" : game.phase === "night" && i < game.step ? "past" : "", "aria-current": game.phase === "night" && i === game.step ? "step" : null },
          roleById(id).label,
        ),
      ),
    );
  }

  // ---- what just happened -------------------------------------------------

  private sounds(events: ShortNightEvent[], props: GameViewProps) {
    const me = props.private as Priv | null;
    const game = props.game as Pub;
    for (const e of events) {
      switch (e.type) {
        case "night-step":
          // Same sound and buzz on every phone: everyone picks every step.
          audio.play("deal");
          audio.buzz(25);
          break;
        case "day":
          audio.play("shuffle");
          break;
        case "vote-open":
          audio.play("your-turn");
          audio.buzz(25);
          break;
        case "game-over": {
          const team = me?.role ? roleById(me.role).team : null;
          const won = !!e.winner && team === e.winner;
          audio.play(won ? "win" : game.winner ? "game-over" : "nudge");
          if (won) audio.buzz([40, 60, 40]);
          break;
        }
      }
    }
  }
}
