import { audio } from "@games/audio";
import { roleReveal } from "@games/hidden-roles/reveal";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { type RoleId, roleById, type Team } from "../shared/roles.ts";
import {
  type DayRecord,
  type NightfallEvent,
  type NightfallPrivateState,
  type NightfallPublicState,
  type NightRecord,
  type Phase,
  SKIP,
} from "../shared/types.ts";

type Pub = NightfallPublicState;
type Priv = NightfallPrivateState;

/** The last seconds of a ballot tick out loud. */
const TICK_FROM = 5;

const PHASE_LABEL: Record<Phase, string> = {
  reveal: "Your card",
  night: "Night",
  day: "Day",
  vote: "Vote",
  runoff: "Vote again",
  finished: "The end",
};

const TEAM_LABEL: Record<Team, string> = { village: "Village", wolves: "Wolves" };

/** "A and B", "A, B and C". */
const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export class NightfallView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "nightfall" });
  private phaseLabel = h("span", { class: "nf-phase" });
  private roundLabel = h("span", { class: "nf-round" });
  private timer = h("span", { class: "nf-timer", role: "timer" });
  private bar = h("div", { class: "nf-bar" });

  private card: ReturnType<typeof roleReveal> | null = null;
  /** What the card says now, so it's only rebuilt when that changes. */
  private cardKey = "";
  private cardSlot = h("div", { class: "nf-card-slot" });

  private outNote = h("p", { class: "nf-out" }, "You're out. Don't tell anyone what you know.");
  private news = h("p", { class: "nf-news", "aria-live": "polite" });
  private headline = h("p", { class: "nf-headline", role: "status", "aria-live": "polite" });
  private sub = h("p", { class: "nf-sub" });
  private button = h("button", { type: "button", class: "primary nf-action" });
  private note = h("p", { class: "nf-note", "aria-live": "assertive" });
  private panel = h("div", { class: "nf-panel" });
  private history = h("section", { class: "nf-history" });

  /** Tonight's choice so far, before Confirm. */
  private chosen: string | null = null;
  /** Confirmed tonight. Local, and the same on every phone: only an acting card's goes anywhere. */
  private confirmed = false;
  /** Phase and round the pick belongs to; a new one clears it. */
  private stage = "";
  private lastTick = -1;
  private clock: ReturnType<typeof setInterval>;

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(
      h("div", { class: "nf-top" }, this.phaseLabel, this.roundLabel, this.timer),
      h("div", { class: "nf-track", "aria-hidden": "true" }, this.bar),
      this.cardSlot,
      this.outNote,
      this.news,
      this.headline,
      this.sub,
      this.button,
      this.note,
      this.panel,
      this.history,
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
    if (!props.snapshot && this.props) this.sounds(props.events as NightfallEvent[], props);
    this.settle(props);
  }

  // ---- helpers ------------------------------------------------------------

  private name(id: string | null | undefined, props: GameViewProps = this.props!): string {
    if (id === SKIP) return "nobody";
    return id === props.playerId ? "you" : seatName(props.room, id);
  }

  /** Sentence-start form. */
  private Name(id: string | null | undefined, props: GameViewProps = this.props!): string {
    const n = this.name(id, props);
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  private isHost(): boolean {
    return !!this.props && this.props.room.hostId === this.props.playerId;
  }

  private living(game: Pub): string[] {
    return game.players.filter((p) => !p.dead && !p.left).map((p) => p.id);
  }

  private alive(game: Pub, me: Priv | null, props: GameViewProps): boolean {
    return !!me?.role && this.living(game).includes(props.playerId);
  }

  // ---- input --------------------------------------------------------------

  private press() {
    const game = this.props?.game as Pub | undefined;
    const me = this.props?.private as Priv | null | undefined;
    if (!game || !me) return;
    if (game.phase === "reveal" && !me.acked) {
      this.api.act({ type: "ack" });
    } else if (game.phase === "night" && me.picking && !this.confirmed && this.chosen) {
      // Everyone confirms; only an acting card sends it (ruling 6). A pick the
      // card can't make goes too: the server takes it as no pick, and this
      // phone says nothing different (ruling 4).
      if (me.role && roleById(me.role).acts) this.api.act({ type: "pick", target: this.chosen });
      this.confirmed = true;
      this.saveLock(this.props!, game, this.chosen);
      audio.play("card-place");
      if (this.props) this.settle(this.props);
    } else if (game.phase === "day" && this.isHost()) {
      this.api.act({ type: "next" });
    }
  }

  private toggle(id: string) {
    const game = this.props?.game as Pub | undefined;
    if (!game || game.phase !== "night" || this.confirmed) return;
    this.chosen = this.chosen === id ? null : id;
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

  // ---- tonight's lock, kept across a reload -------------------------------

  /** Room, match and night: a rematch's night 1 isn't this one's. */
  private lockKey(props: GameViewProps, game: Pub): string {
    return `nightfall:lock:${props.room.code}:${props.room.roundNumber}:${game.round}`;
  }

  /** Storage can be off (private mode, blocked site data); then a reload just unlocks. */
  private saveLock(props: GameViewProps, game: Pub, target: string | null) {
    try {
      if (target) sessionStorage.setItem(this.lockKey(props, game), target);
      else sessionStorage.removeItem(this.lockKey(props, game));
    } catch {
      // Nothing kept.
    }
  }

  private loadLock(props: GameViewProps, game: Pub): string | null {
    try {
      return sessionStorage.getItem(this.lockKey(props, game));
    } catch {
      return null;
    }
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
    const stage = `${game.phase}:${game.round}`;
    if (stage !== this.stage) {
      this.stage = stage;
      this.chosen = null;
      this.confirmed = false;
      this.lastTick = -1;
      this.note.textContent = "";
    }
    // The player picked left. The server dropped every pick aimed at them, so
    // every phone that picked them asks again, whatever the card: public state only.
    if (game.phase === "night" && this.chosen && !this.living(game).includes(this.chosen)) {
      this.chosen = null;
      this.confirmed = false;
      this.saveLock(props, game, null);
      this.note.textContent = "The player you chose left. Choose again.";
    }
    // A reload mid-night comes back locked in on every phone that confirmed.
    // The server keeps an acting card's pick; every phone, decoys included,
    // keeps its own in this tab, so nothing new goes anywhere public.
    if (game.phase === "night" && !this.confirmed) {
      const kept = me?.pick ?? this.loadLock(props, game);
      if (kept && (kept === SKIP || this.living(game).includes(kept))) {
        this.chosen = kept;
        this.confirmed = true;
      }
    }
    this.root.dataset.phase = game.phase;
    this.phaseLabel.textContent = PHASE_LABEL[game.phase];
    this.roundLabel.textContent = game.round && game.phase !== "finished" ? `${game.phase === "night" ? "Night" : "Day"} ${game.round}` : "";
    const dead = !!game.players.find((p) => p.id === props.playerId)?.dead;
    this.outNote.hidden = !me?.role || !dead || game.phase === "finished";

    this.renderCard(props, game, me);
    this.renderNews(props, game);
    this.renderPrompt(props, game, me);
    this.renderPanel(props, game, me);
    this.renderHistory(props, game);
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
    const lines = this.cardLines(props, me!);
    const key = `${role}|${lines.join("|")}`;
    if (key === this.cardKey && this.card) return;
    this.cardKey = key;
    const body = h(
      "div",
      { class: "nf-card" },
      h("span", { class: "nf-card-kicker" }, "You're"),
      h("strong", { class: "nf-card-role" }, r.id === "wolf" ? "a Wolf" : r.id === "villager" ? "a Villager" : `the ${r.label}`),
      h("span", { class: "nf-card-team" }, `${TEAM_LABEL[r.team]} team`),
      h("span", { class: "nf-card-blurb" }, r.blurb),
      lines.length ? h("ul", { class: "nf-card-info" }, lines.map((l) => h("li", {}, l))) : null,
    );
    if (this.card) this.card.update(body);
    else {
      this.card = roleReveal({ title: "Your card", body });
      this.cardSlot.append(this.card.el);
    }
  }

  /** What only this card knows, for inside the face-down card. */
  private cardLines(props: GameViewProps, me: Priv): string[] {
    const lines: string[] = [];
    if (me.pack) {
      const others = me.pack.filter((id) => id !== props.playerId);
      lines.push(others.length ? `Wolves: you and ${list(others.map((id) => this.name(id, props)))}.` : "You're the only Wolf.");
      for (const [w, t] of Object.entries(me.packPicks ?? {})) if (w !== props.playerId) lines.push(`Tonight ${this.name(w, props)} picked ${this.name(t, props)}.`);
    }
    if (me.role === "keeper" && me.lastShelter) lines.push(`Last night you protected ${this.name(me.lastShelter, props)}. You can't protect them tonight.`);
    for (const r of me.readings ?? []) lines.push(`Night ${r.night}: ${this.Name(r.target, props)} ${r.wolf ? "is a Wolf" : "is not a Wolf"}.`);
    if (me.pick) lines.push(me.pick === SKIP ? "Your choice tonight does not count for your card." : `Your choice tonight: ${this.name(me.pick, props)}.`);
    return lines;
  }

  /** The morning's news by day, the verdict's by night. Public. */
  private renderNews(props: GameViewProps, game: Pub) {
    let text = "";
    const dawn = game.dawns.at(-1);
    const day = game.days.at(-1);
    if ((game.phase === "day" || game.phase === "vote" || game.phase === "runoff") && dawn && dawn.night === game.round) {
      text = dawn.died
        ? `Dawn: the Wolves attacked ${this.name(dawn.died, props)} in the night. ${TEAM_LABEL[dawn.team!]} team.`
        : "Dawn: everyone was safe in the night.";
    } else if (game.phase === "night" && day && day.day === game.round - 1) {
      text = this.verdictText(day, props);
    }
    this.news.textContent = text;
    this.news.hidden = !text;
  }

  private verdictText(day: DayRecord, props: GameViewProps): string {
    if (!day.out) return day.tied.length ? `Day ${day.day}: still a tie. Nobody is out.` : `Day ${day.day}: nobody is out.`;
    const was = day.out === props.playerId ? "are" : "is";
    return `Day ${day.day}: ${this.Name(day.out, props)} ${was} out. ${TEAM_LABEL[day.team!]} team.`;
  }

  private renderPrompt(props: GameViewProps, game: Pub, me: Priv | null) {
    let headline = "";
    let sub = "";
    let button: string | null = null;
    let disabled = false;
    const alive = this.alive(game, me, props);
    switch (game.phase) {
      case "reveal": {
        const left = this.living(game).length - game.acked;
        headline = me?.acked ? "Waiting for the others" : "Check your card";
        sub = me?.acked ? `${left} still reading` : "Tap your card and read it. Keep it secret.";
        if (me?.role && !me.acked) button = "Got it";
        break;
      }
      case "night":
        // Word for word the same on every living phone, whatever the card (ruling 3).
        headline = alive ? "Night. Everyone chooses 1 player." : "Night. The other players are choosing.";
        if (alive) {
          sub = this.confirmed
            ? "Done. Wait for the night to end."
            : "Only Wolves, the Watcher and the Keeper count. Choose anyway, so nobody can tell.";
          if (!this.confirmed) {
            button = "Confirm";
            disabled = !this.chosen;
          }
        }
        break;
      case "day":
        headline = "Talk now";
        sub = alive ? "Talk out loud. Wolves will lie. Then everyone votes." : "The other players are talking. Then they vote.";
        if (this.isHost()) button = "Vote now";
        break;
      case "vote":
      case "runoff":
        headline = game.phase === "runoff" ? `Tie. Vote again: ${list(game.tied.map((id) => this.name(id, props)))}` : "Who is out?";
        sub = me?.vote
          ? `You voted ${me.vote === SKIP ? "to skip" : `for ${this.name(me.vote, props)}`}. You can change it. ${game.voted} of ${game.voters} have voted.`
          : me?.choices.length
            ? `${game.phase === "runoff" ? "Choose one of them, " : "Choose another player, "}or skip. ${game.voted} of ${game.voters} have voted.`
            : `${game.voted} of ${game.voters} in.`;
        break;
      case "finished":
        headline = this.outcome(game);
        break;
    }
    this.headline.textContent = headline;
    this.sub.textContent = sub;
    this.button.hidden = !button;
    this.button.disabled = disabled;
    if (button) this.button.textContent = button;
  }

  private outcome(game: Pub): string {
    if (game.endReason === "abandoned") return "A team left the game. Nobody wins.";
    return game.winner === "village" ? "No Wolves left. The village wins." : "The Wolves equal the other players. Wolves win.";
  }

  /** The night picker, the ballot, the end, or just the table. */
  private renderPanel(props: GameViewProps, game: Pub, me: Priv | null) {
    this.panel.dataset.kind = "";
    if (game.phase === "night" && me?.picking) {
      // The same list on every living phone: every living player, you too, in seat order.
      this.panel.dataset.kind = "pick";
      return replaceChildren(
        this.panel,
        h(
          "ul",
          { class: "nf-list" },
          this.living(game).map((id) => this.row(props, id, { pressed: this.chosen === id, disabled: this.confirmed, onclick: () => this.toggle(id) })),
        ),
      );
    }
    if ((game.phase === "vote" || game.phase === "runoff") && me?.choices.length) {
      this.panel.dataset.kind = "vote";
      const named = me.choices.filter((c) => c !== SKIP);
      return replaceChildren(
        this.panel,
        h("ul", { class: "nf-list" }, named.map((id) => this.row(props, id, { pressed: me.vote === id, onclick: () => this.vote(id) }))),
        h("button", { type: "button", class: "nf-skip", "aria-pressed": String(me.vote === SKIP), onclick: () => this.vote(SKIP) }, "Skip"),
      );
    }
    if (game.phase === "finished" && game.cards) return this.renderEnd(props, game);
    replaceChildren(this.panel, h("ul", { class: "nf-list" }, game.players.map((p) => this.row(props, p.id, {}))));
  }

  private row(props: GameViewProps, id: string, opts: { pressed?: boolean; disabled?: boolean; onclick?: () => void; extra?: Node | null }): HTMLElement {
    const game = props.game as Pub;
    const seat = props.room.seats.find((s) => s.id === id);
    const p = game.players.find((x) => x.id === id);
    const tag = p?.dead ? `out · ${TEAM_LABEL[p.team!]}` : p?.left ? "left" : null;
    const inner = [
      seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
      h("span", { class: "nf-name" }, id === props.playerId ? "You" : seatName(props.room, id)),
      opts.extra ?? null,
      tag && !opts.extra ? h("span", { class: "nf-tag" }, tag) : null,
    ];
    const cls = ["nf-row", (p?.dead || p?.left) && "gone", id === props.playerId && "me"].filter(Boolean).join(" ");
    return opts.onclick
      ? h("li", { class: cls }, h("button", { type: "button", class: "nf-pick", "aria-pressed": String(!!opts.pressed), disabled: !!opts.disabled, onclick: opts.onclick }, inner))
      : h("li", { class: cls }, h("div", { class: "nf-pick" }, inner));
  }

  /** The public record so far: each dawn and each day, newest last. */
  private renderHistory(props: GameViewProps, game: Pub) {
    const show = game.phase !== "reveal" && game.phase !== "finished" && game.dawns.length > 0;
    this.history.hidden = !show;
    // Emptied, not just hidden: a rematch mustn't carry the last game's record.
    if (!show) return replaceChildren(this.history);
    const items: HTMLElement[] = [];
    for (const dawn of game.dawns) {
      items.push(h("li", {}, dawn.died ? `Night ${dawn.night}: ${this.Name(dawn.died, props)} attacked. ${TEAM_LABEL[dawn.team!]}.` : `Night ${dawn.night}: nobody attacked.`));
      const day = game.days.find((d) => d.day === dawn.night);
      if (day) {
        items.push(
          h(
            "li",
            {},
            this.verdictText(day, props),
            this.votesLine(day.votes, props),
            day.runoffVotes ? h("span", { class: "nf-votes" }, " Runoff:", this.votesLine(day.runoffVotes, props) ?? " no votes.") : null,
          ),
        );
      }
    }
    replaceChildren(this.history, h("h3", {}, "So far"), h("ol", { class: "nf-log" }, items));
  }

  private votesLine(votes: Record<string, string> | null, props: GameViewProps): HTMLElement | null {
    const entries = Object.entries(votes ?? {});
    if (!entries.length) return null;
    return h("span", { class: "nf-votes" }, ` ${entries.map(([v, c]) => `${this.Name(v, props)} → ${this.name(c, props)}`).join(", ")}.`);
  }

  /** Everything: every card, every night, every day. */
  private renderEnd(props: GameViewProps, game: Pub) {
    const cards = game.cards!;
    const nights = new Map((game.nights ?? []).map((n) => [n.night, n]));
    const log: HTMLElement[] = [];
    const rounds = Math.max(game.round, 0);
    for (let r = 1; r <= rounds; r++) {
      const n = nights.get(r);
      if (n) log.push(h("li", {}, h("b", {}, `Night ${r}: `), this.nightText(n, props)));
      const d = game.days.find((x) => x.day === r);
      if (d) {
        log.push(
          h(
            "li",
            {},
            h("b", {}, `Day ${r}: `),
            this.verdictText(d, props).replace(/^Day \d+: /, ""),
            this.votesLine(d.votes, props),
            d.runoffVotes ? h("span", { class: "nf-votes" }, ` Runoff:`, this.votesLine(d.runoffVotes, props) ?? " no votes.") : null,
          ),
        );
      }
    }
    replaceChildren(
      this.panel,
      h(
        "section",
        { class: "nf-end-part" },
        h("h3", {}, "The cards"),
        h(
          "ul",
          { class: "nf-list" },
          game.players.map((p) => {
            const role = roleById(cards[p.id] as RoleId);
            const fate = p.dead ? " · out" : p.left ? " · left" : "";
            return this.row(props, p.id, { extra: h("span", { class: `nf-role team-${role.team}` }, role.label, h("span", { class: "nf-fate" }, fate)) });
          }),
        ),
      ),
      h("section", { class: "nf-end-part" }, h("h3", {}, "What happened"), log.length ? h("ol", { class: "nf-log" }, log) : h("p", { class: "nf-muted" }, "The game ended before the first dawn.")),
    );
  }

  private nightText(n: NightRecord, props: GameViewProps): string {
    const parts: string[] = [];
    const votes = Object.entries(n.wolfVotes);
    parts.push(
      votes.length
        ? `Wolves chose ${votes.map(([w, t]) => `${this.name(w, props)} → ${this.name(t, props)}`).join(", ")}${n.target ? `. The Wolves attacked ${this.name(n.target, props)}` : ""}.`
        : "The Wolves did not choose anyone.",
    );
    if (n.sheltered) parts.push(`The Keeper protected ${this.name(n.sheltered, props)}.`);
    if (n.read) parts.push(`The Watcher checked ${this.name(n.read, props)}: ${n.readWolf ? "a Wolf" : "not a Wolf"}.`);
    parts.push(n.died ? `The Wolves attacked ${this.name(n.died, props)}.` : "Everyone was safe.");
    return parts.join(" ");
  }

  // ---- what just happened -------------------------------------------------

  private sounds(events: NightfallEvent[], props: GameViewProps) {
    const me = props.private as Priv | null;
    const game = props.game as Pub;
    for (const e of events) {
      switch (e.type) {
        case "night":
          // Same sound and buzz on every phone.
          audio.play("deal");
          audio.buzz(25);
          break;
        case "dawn":
          audio.play("shuffle");
          if (e.died === props.playerId) audio.buzz([40, 60, 40]);
          break;
        case "vote-open":
          audio.play("your-turn");
          audio.buzz(25);
          break;
        case "verdict":
          audio.play("card-place");
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
