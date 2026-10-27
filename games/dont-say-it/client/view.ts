import { AnimationQueue, bubble } from "@games/animation";
import { audio } from "@games/audio";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import {
  type DontSayItEvent,
  type DontSayItPrivateState,
  type DontSayItPublicState,
  type Outcome,
  OUTCOME_POINTS,
  other,
  type TeamId,
} from "../shared/types.ts";

type Pub = DontSayItPublicState;
type Priv = DontSayItPrivateState;

/** The last seconds of a turn tick out loud. */
const TICK_FROM = 5;

const OUTCOME_LABEL: Record<Outcome, string> = {
  got: "Got it",
  skip: "Skipped",
  oops: "Oops",
  fair: "Buzzed",
  upheld: "Buzz upheld",
  time: "Time",
  ended: "Turn ended",
};

const TEAM_CLASS = ["amber", "teal"] as const;

/** Restarts a one-off animation class, even if it's already on. */
function replay(el: Element, cls: string) {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

interface Button {
  label: string;
  action: string;
  kind?: "primary" | "danger" | "plain";
  wide?: boolean;
}

export class DontSayItView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "dsi" });
  private scoreA = h("span", { class: "dsi-score amber" });
  private scoreB = h("span", { class: "dsi-score teal" });
  private turnLabel = h("span", { class: "dsi-turn" });
  private timer = h("span", { class: "dsi-timer", role: "timer" });
  private bar = h("div", { class: "dsi-bar" });

  private card = h("section", { class: "dsi-card", "aria-label": "The card" });
  private headline = h("p", { class: "dsi-headline", role: "status", "aria-live": "polite" });
  private sub = h("p", { class: "dsi-sub" });
  private buttons = h("div", { class: "dsi-buttons" });
  private log = h("ol", { class: "dsi-log", "aria-label": "This turn's cards" });
  private roster = h("div", { class: "dsi-roster" });

  private queue = new AnimationQueue();
  private lastTick = -1;
  private stage = "";
  private clock: ReturnType<typeof setInterval>;

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(
      h("div", { class: "dsi-top" }, this.scoreA, this.turnLabel, this.scoreB),
      h("div", { class: "dsi-clock" }, this.timer, h("div", { class: "dsi-track", "aria-hidden": "true" }, this.bar)),
      this.card,
      this.headline,
      this.sub,
      this.buttons,
      this.log,
      this.roster,
    );
    this.clock = setInterval(() => this.renderClock(), 200);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    clearInterval(this.clock);
    this.queue.clear();
    this.root.remove();
  }

  whenIdle() {
    return this.queue.idle();
  }

  rejected(_clientActionId: string, message: string) {
    this.sub.textContent = message;
    replay(this.buttons, "shake");
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    const events = props.events as DontSayItEvent[];
    if (props.snapshot || !this.props) {
      this.queue.clear();
      this.settle(props);
      return;
    }
    this.props = props;
    let animated = false;
    this.queue.push({
      animate: async () => {
        animated = true;
        this.sounds(events, props);
        this.act(events);
      },
      settle: () => {
        if (!animated) this.sounds(events, props);
        this.settle(props);
      },
    });
  }

  // ---- helpers ------------------------------------------------------------

  private game(): Pub | null {
    return (this.props?.game as Pub | undefined) ?? null;
  }

  private name(id: string | null | undefined, props: GameViewProps = this.props!): string {
    return id === props.playerId ? "You" : seatName(props.room, id);
  }

  private isHost(props: GameViewProps = this.props!): boolean {
    return props.room.hostId === props.playerId;
  }

  private teamName(game: Pub, t: TeamId | null): string {
    return t === null ? "" : game.teams[t].name;
  }

  private send(action: string) {
    this.api.act({ type: action });
    audio.buzz(15);
  }

  // ---- the clock ----------------------------------------------------------

  private renderClock() {
    const game = this.game();
    const phase = game?.phase;
    if (!game || phase === "teams" || phase === "finished" || phase === "ready") {
      this.timer.textContent = phase === "ready" ? `${game!.turnMs / 1000} s` : "";
      this.bar.style.transform = phase === "ready" ? "scaleX(1)" : "scaleX(0)";
      this.root.classList.remove("low", "frozen");
      return;
    }
    const now = this.api.serverNow();
    const frozen = game.turnLeft !== null;
    const left = frozen ? game.turnLeft! : phase === "turn" ? Math.max(0, game.deadline - now) : 0;
    const secs = Math.ceil(left / 1000);
    this.root.classList.toggle("frozen", frozen);
    if (phase === "turn-result") {
      this.timer.textContent = "";
      this.bar.style.transform = "scaleX(0)";
      this.root.classList.remove("low");
      return;
    }
    this.timer.textContent = frozen ? `${secs} s, paused` : `${secs} s`;
    this.bar.style.transform = `scaleX(${Math.min(1, left / game.turnMs)})`;
    const low = !frozen && secs <= TICK_FROM;
    this.root.classList.toggle("low", low);
    if (low && secs > 0 && secs !== this.lastTick && document.visibilityState === "visible") {
      this.lastTick = secs;
      audio.play("tick");
    }
    if (frozen) {
      // The dispute's own clock, in the sub line.
      const d = Math.max(0, Math.ceil((game.deadline - now) / 1000));
      const el = this.sub.querySelector(".dsi-dispute-clock");
      if (el) el.textContent = `${d} s`;
    }
  }

  // ---- settled state ------------------------------------------------------

  private settle(props: GameViewProps) {
    this.props = props;
    const game = props.game as Pub;
    const me = props.private as Priv | null;
    const stage = `${game.turnNumber}:${game.phase}`;
    if (stage !== this.stage) {
      this.stage = stage;
      this.lastTick = -1;
    }
    this.root.dataset.phase = game.phase;
    this.root.classList.remove("amber", "teal");
    if (game.activeTeam !== null) this.root.classList.add(TEAM_CLASS[game.activeTeam]);

    this.scoreA.textContent = `${game.teams[0].name} ${game.teams[0].score}`;
    this.scoreB.textContent = `${game.teams[1].score} ${game.teams[1].name}`;
    this.turnLabel.textContent =
      game.phase === "teams" ? "Pick sides" : game.phase === "finished" ? "Game over" : game.suddenDeath && game.turnNumber > game.totalTurns - 2 ? "Sudden death" : `Turn ${game.turnNumber} of ${game.totalTurns}`;

    this.renderCard(game, me);
    this.renderPrompt(props, game, me);
    this.renderLog(game);
    this.renderRoster(props, game);
    this.renderClock();
  }

  private renderCard(game: Pub, me: Priv | null) {
    const card = me?.card;
    if (card) {
      this.card.hidden = false;
      this.card.className = "dsi-card";
      replaceChildren(
        this.card,
        h("strong", { class: "dsi-target" }, card.target),
        h("span", { class: "dsi-kicker" }, "Don't say"),
        h("ul", { class: "dsi-forbidden" }, card.forbidden.map((w) => h("li", {}, w))),
      );
      return;
    }
    if (me?.role === "guesser" && ["turn", "buzzed", "appeal"].includes(game.phase)) {
      this.card.hidden = false;
      this.card.className = "dsi-card guessing";
      const last = game.cards.at(-1);
      replaceChildren(
        this.card,
        h("span", { class: "dsi-kicker" }, "You're guessing"),
        h("strong", { class: "dsi-target" }, "Shout it out"),
        last ? h("span", { class: "dsi-last" }, `Last: ${last.target}, ${OUTCOME_LABEL[last.outcome].toLowerCase()}`) : null,
      );
      return;
    }
    this.card.hidden = true;
  }

  private renderPrompt(props: GameViewProps, game: Pub, me: Priv | null) {
    const host = this.isHost(props);
    const describer = this.name(game.describerId, props);
    const youDescribe = me?.role === "describer";
    const activeName = this.teamName(game, game.activeTeam);
    let headline = "";
    let sub: (Node | string)[] = [];
    const buttons: Button[] = [];

    switch (game.phase) {
      case "teams": {
        headline = "Two teams. Even them out, then start.";
        sub = [host ? "Anyone can switch sides. You start when it's right." : "Anyone can switch sides. The host starts."];
        if (me?.team !== null && me?.team !== undefined) buttons.push({ label: `Switch to ${game.teams[other(me.team)].name}`, action: "switch" });
        if (host) buttons.push({ label: "Shuffle", action: "shuffle" }, { label: "Start", action: "start", kind: "primary", wide: true });
        break;
      }
      case "ready": {
        headline = youDescribe ? `You're describing for ${activeName}` : `${describer} describes for ${activeName}`;
        sub = [
          youDescribe
            ? "Start when your team's listening."
            : me?.team === game.activeTeam
              ? "You're guessing. Get close to them."
              : "You'll see the card. Listen for slips.",
        ];
        if (youDescribe) buttons.push({ label: "Start", action: "go", kind: "primary", wide: true });
        break;
      }
      case "turn": {
        if (youDescribe) {
          headline = "Describe it. Don't say any of it.";
          buttons.push({ label: "Got it", action: "got", kind: "primary", wide: true }, { label: "Skip", action: "skip" }, { label: "Oops", action: "oops", kind: "danger" });
        } else if (me?.role === "watcher") {
          headline = `${describer} is describing`;
          sub = ["Hear a word from the card? Buzz."];
          buttons.push({ label: "Buzz", action: "buzz", kind: "danger", wide: true });
        } else if (me?.role === "guesser") {
          headline = `${describer} is describing`;
        } else {
          headline = `${describer} describes for ${activeName}`;
        }
        break;
      }
      case "buzzed": {
        headline = `${this.name(game.buzzerId, props)} buzzed`;
        const clock = h("span", { class: "dsi-dispute-clock" });
        if (me?.deciding) {
          sub = ["Did you say it? Fair costs a point. Nope goes to their captain. ", clock];
          buttons.push({ label: "Fair (−1)", action: "fair", kind: "danger" }, { label: "Nope", action: "nope" });
        } else {
          sub = [`${describer} ${game.describerId === props.playerId ? "decide" : "decides"}: fair or not. `, clock];
        }
        break;
      }
      case "appeal": {
        headline = `${describer} contests the buzz`;
        const clock = h("span", { class: "dsi-dispute-clock" });
        if (me?.deciding) {
          sub = ["You're the captain. Uphold it and they lose a point; drop it and the card carries on. ", clock];
          buttons.push({ label: "Uphold (−1)", action: "uphold", kind: "danger" }, { label: "Drop", action: "drop" });
        } else {
          sub = [`${this.name(game.captainId, props)} (captain) decides. `, clock];
        }
        break;
      }
      case "turn-result": {
        const n = game.net;
        headline = `${activeName} ${signed(n)} this turn`;
        sub = [`${game.teams[0].name} ${game.teams[0].score}, ${game.teams[1].name} ${game.teams[1].score}`];
        if (host) buttons.push({ label: "Next turn", action: "next", kind: "primary" });
        break;
      }
      case "finished": {
        const [a, b] = [game.teams[0].score, game.teams[1].score];
        if (game.endReason === "abandoned") headline = "A team ran short of players.";
        else headline = a === b ? "A draw. Both teams win." : `${game.teams[a > b ? 0 : 1].name} win, ${Math.max(a, b)} to ${Math.min(a, b)}`;
        break;
      }
    }
    if (game.reshuffled && game.phase !== "teams" && game.phase !== "finished" && !sub.length) sub = ["The deck ran out and was reshuffled. Cards may repeat."];

    this.headline.textContent = headline;
    replaceChildren(this.sub, sub);
    replaceChildren(
      this.buttons,
      buttons.map((b) =>
        h(
          "button",
          {
            type: "button",
            class: [b.kind === "primary" ? "primary" : b.kind === "danger" ? "danger" : "", "dsi-btn", b.wide && "wide"].filter(Boolean).join(" "),
            onclick: () => this.send(b.action),
          },
          b.label,
        ),
      ),
    );
    this.buttons.hidden = !buttons.length;
  }

  private renderLog(game: Pub) {
    const show = game.phase !== "teams" && game.phase !== "ready" && game.cards.length > 0;
    this.log.hidden = !show;
    if (!show) return;
    replaceChildren(
      this.log,
      [...game.cards].reverse().map((c) => {
        const pts = OUTCOME_POINTS[c.outcome];
        return h(
          "li",
          { class: `dsi-entry ${c.outcome}` },
          h("span", { class: "dsi-entry-word" }, c.target),
          h("span", { class: "dsi-entry-what" }, OUTCOME_LABEL[c.outcome]),
          h("span", { class: "dsi-entry-pts" }, pts ? signed(pts) : ""),
        );
      }),
    );
  }

  private renderRoster(props: GameViewProps, game: Pub) {
    replaceChildren(
      this.roster,
      game.teams.map((t) =>
        h(
          "section",
          { class: `dsi-team ${TEAM_CLASS[t.id]}${game.activeTeam === t.id ? " active" : ""}`, "aria-label": `Team ${t.name}` },
          h("h3", {}, h("span", {}, t.name), h("span", { class: "dsi-team-score" }, String(t.score))),
          h(
            "ul",
            {},
            t.members.map((id) => {
              const seat = props.room.seats.find((s) => s.id === id);
              const away = seat && seat.presence !== "connected";
              const tags = [
                game.describerId === id && game.phase !== "teams" && game.phase !== "finished" ? "describing" : null,
                t.captainId === id ? "captain" : null,
              ].filter(Boolean) as string[];
              return h(
                "li",
                { class: ["dsi-member", away && "away", id === props.playerId && "me", game.describerId === id && "describer"].filter(Boolean).join(" ") },
                seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
                h("span", { class: "name" }, this.name(id, props)),
                tags.map((tag) => h("span", { class: `tag ${tag}` }, tag)),
              );
            }),
          ),
        ),
      ),
    );
  }

  // ---- what just happened -------------------------------------------------

  private sounds(events: DontSayItEvent[], props: GameViewProps) {
    const me = props.private as Priv | null;
    const myTeam = me?.team ?? null;
    for (const e of events) {
      switch (e.type) {
        case "turn-ready":
          if (e.describerId === props.playerId) {
            audio.play("your-turn");
            audio.buzz(25);
          }
          break;
        case "turn-started":
          audio.play("deal");
          break;
        case "card":
          audio.play(e.outcome === "got" ? "correct" : e.outcome === "skip" ? "pass" : "reject");
          break;
        case "buzzed":
          audio.play("boom");
          audio.buzz([40, 30, 40]);
          break;
        case "appealed":
        case "dropped":
          audio.play("nudge");
          break;
        case "turn-over":
          audio.play("card-place");
          break;
        case "sudden-death":
          audio.play("shuffle");
          break;
        case "game-over": {
          const game = props.game as Pub;
          const [a, b] = [game.teams[0].score, game.teams[1].score];
          const won = myTeam !== null && (a === b || (a > b ? 0 : 1) === myTeam);
          audio.play(won && e.reason === "done" ? "win" : "game-over");
          break;
        }
        default:
          break;
      }
    }
  }

  private act(events: DontSayItEvent[]) {
    for (const e of events) {
      if (e.type === "card" && (e.outcome === "got" || e.outcome === "fair" || e.outcome === "upheld" || e.outcome === "oops")) {
        void bubble(this.headline, `${OUTCOME_LABEL[e.outcome]} ${signed(OUTCOME_POINTS[e.outcome])}`, `anim-bubble dsi-bubble ${e.outcome}`, 900);
      }
      if (e.type === "buzzed" || e.type === "sudden-death") replay(this.headline, "pop");
    }
  }
}
