import { AnimationQueue, bubble } from "@games/animation";
import { audio } from "@games/audio";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { cleanClue, clueProblem } from "../shared/rules.ts";
import { MAX_CLUE, MAX_GUESS, type ImposterEvent, type ImposterPrivateState, type ImposterPublicState } from "../shared/types.ts";

type Pub = ImposterPublicState;
type Priv = ImposterPrivateState;

/** The last seconds of a phase tick out loud. */
const TICK_FROM = 5;

/** Restarts a one-off animation class, even if it's already on. */
function replay(el: Element, cls: string) {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

const PHASE_LABEL: Record<Pub["phase"], string> = {
  reveal: "Your card",
  clues: "Clues",
  discuss: "Talk it over",
  vote: "Vote",
  runoff: "Runoff",
  "reveal-role": "The reveal",
  guess: "Last guess",
  "round-result": "Round over",
  finished: "Game over",
};

export class ImposterView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "imposter" });
  private roundLabel = h("span", { class: "im-round" });
  private phaseLabel = h("span", { class: "im-phase" });
  private timer = h("span", { class: "im-timer", role: "timer" });
  private bar = h("div", { class: "im-bar" });

  private cardBody = h("div", { class: "im-card-body" });
  private peek = h("button", { type: "button", class: "link im-peek" });
  private card = h("section", { class: "im-card", "aria-label": "Your card" }, this.cardBody, this.peek);

  private headline = h("p", { class: "im-headline", role: "status", "aria-live": "polite" });
  private sub = h("p", { class: "im-sub" });

  private input = h("input", {
    class: "im-input",
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    enterkeyhint: "send",
  });
  private send = h("button", { type: "submit", class: "primary im-send" });
  private form = h("form", { class: "im-form" }, this.input, this.send);
  private button = h("button", { type: "button", class: "primary im-action" });
  private note = h("p", { class: "im-note", "aria-live": "assertive" });

  private table = h("ul", { class: "im-table", "aria-label": "Players" });

  private queue = new AnimationQueue();
  private rows = new Map<string, HTMLElement>();
  private hidden = false;
  /** The round that started over because the Imposter left, to say so. */
  private dropped = -1;
  private pending: string | null = null;
  /** Phase + round the input belongs to; a new one clears it. */
  private stage = "";
  private lastTick = -1;
  private clock: ReturnType<typeof setInterval>;

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(
      h("div", { class: "im-top" }, this.roundLabel, this.phaseLabel, this.timer),
      h("div", { class: "im-track", "aria-hidden": "true" }, this.bar),
      this.card,
      this.headline,
      this.sub,
      this.form,
      this.button,
      this.note,
      this.table,
    );
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submit();
    });
    this.input.addEventListener("input", () => (this.note.textContent = ""));
    this.button.addEventListener("click", () => this.press());
    this.peek.addEventListener("click", () => {
      this.hidden = !this.hidden;
      if (this.props) this.renderCard(this.props);
    });
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

  rejected(clientActionId: string, message: string) {
    if (clientActionId === this.pending) this.pending = null;
    this.bounce(message);
  }

  update(props: GameViewProps) {
    const events = props.events as ImposterEvent[];
    if (events.some((e) => e.type === "round-dropped")) {
      // Same round number, new card: show it.
      this.dropped = (props.game as Pub).round;
      this.hidden = false;
    }
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

  private mine(): Priv | null {
    return (this.props?.private as Priv | null | undefined) ?? null;
  }

  private name(id: string | null | undefined, props: GameViewProps = this.props!): string {
    return id === props.playerId ? "You" : seatName(props.room, id);
  }

  private isHost(): boolean {
    return !!this.props && this.props.room.hostId === this.props.playerId;
  }

  // ---- input --------------------------------------------------------------

  private submit() {
    const game = this.game();
    const me = this.mine();
    if (!game || !me || this.pending) return;
    if (game.phase === "clues" && !me.sentClue) {
      const clue = cleanClue(this.input.value);
      const problem = me.role === "innocent" && me.word ? clueProblem(clue, me.word) : clue ? null : "Type a clue.";
      if (problem) return this.bounce(problem);
      this.pending = this.api.act({ type: "clue", text: clue });
    } else if (game.phase === "guess" && me.guessing) {
      const text = this.input.value.trim();
      if (!text) return this.bounce("Type a guess.");
      this.pending = this.api.act({ type: "guess", text });
    }
  }

  private press() {
    const game = this.game();
    const me = this.mine();
    if (!game || !me) return;
    if (game.phase === "reveal" && !me.acked) {
      this.hidden = true;
      this.api.act({ type: "ack" });
    } else if ((game.phase === "discuss" || game.phase === "round-result") && this.isHost()) {
      this.api.act({ type: "next" });
    }
  }

  private vote(id: string) {
    const me = this.mine();
    if (!me || !me.choices.includes(id)) return;
    this.api.act({ type: "vote", playerId: id });
    audio.play("card-place");
    audio.buzz(15);
  }

  private bounce(message: string) {
    replay(this.form, "shake");
    this.note.textContent = message;
    audio.play("reject");
    audio.buzz([30, 40, 30]);
    this.input.select();
  }

  // ---- the clock ----------------------------------------------------------

  private renderClock() {
    const game = this.game();
    const live = game && game.phase !== "finished" && game.phaseMs > 0;
    if (!live) {
      this.timer.textContent = "";
      this.bar.style.transform = "scaleX(0)";
      return;
    }
    const left = Math.max(0, game.deadline - this.api.serverNow());
    const secs = Math.ceil(left / 1000);
    this.timer.textContent = `${secs} s`;
    this.bar.style.transform = `scaleX(${Math.min(1, left / game.phaseMs)})`;
    const low = secs <= TICK_FROM && ["clues", "vote", "runoff", "guess", "discuss"].includes(game.phase);
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
    const stage = `${game.round}:${game.phase}`;
    if (stage !== this.stage) {
      // New phase: whatever was typed belonged to the last one.
      if (!this.stage.startsWith(`${game.round}:`)) this.hidden = false;
      this.stage = stage;
      this.lastTick = -1;
      this.pending = null;
      this.input.value = "";
      this.note.textContent = game.phase === "reveal" && this.dropped === game.round ? "Someone left mid-round. New word, new Imposter." : "";
    }
    this.roundLabel.textContent = `Round ${game.round} of ${game.rounds}`;
    this.phaseLabel.textContent = PHASE_LABEL[game.phase];
    this.root.dataset.phase = game.phase;

    this.renderCard(props);
    this.renderPrompt(props, game, me);
    this.renderTable(props, game, me);
    this.renderClock();
  }

  private renderCard(props: GameViewProps) {
    const game = props.game as Pub;
    const me = props.private as Priv | null;
    const over = game.phase === "round-result" || game.phase === "finished";
    this.card.hidden = !me?.role || game.phase === "finished";
    if (!me?.role) return;
    const imposter = me.role === "imposter";
    this.card.classList.toggle("imposter", imposter && !this.hidden);
    this.card.classList.toggle("covered", this.hidden);
    this.peek.textContent = this.hidden ? "Show my card" : "Hide";
    this.peek.hidden = over;
    if (this.hidden && !over) {
      replaceChildren(this.cardBody, h("span", { class: "im-card-kicker" }, `Category: ${game.category}`));
      return;
    }
    replaceChildren(
      this.cardBody,
      imposter
        ? [
            h("span", { class: "im-card-kicker" }, "You're the"),
            h("strong", { class: "im-card-word" }, "Imposter"),
            h("span", { class: "im-card-cat" }, `Category: ${game.category}. Blend in.`),
          ]
        : [
            h("span", { class: "im-card-kicker" }, "The word"),
            h("strong", { class: "im-card-word" }, me.word ?? ""),
            h("span", { class: "im-card-cat" }, `Category: ${game.category}`),
          ],
    );
  }

  private renderPrompt(props: GameViewProps, game: Pub, me: Priv | null) {
    const inGame = !!me?.role;
    const waiting = game.players.filter((p) => !p.removed && !p.done).length;
    const host = this.isHost();
    let headline = "";
    let sub = "";
    let form: { placeholder: string; label: string; max: number } | null = null;
    let button: string | null = null;

    switch (game.phase) {
      case "reveal":
        headline = me?.acked ? "Waiting for the others" : "Check your card";
        sub = me?.acked ? `${waiting} still looking` : "Keep it to yourself.";
        if (inGame && !me!.acked) button = "Got it";
        break;
      case "clues":
        if (me?.sentClue) {
          headline = `Your clue: ${me.clue ?? "none"}`;
          sub = `Waiting for ${waiting}`;
        } else if (inGame) {
          headline = "One clue. Don't give it away.";
          sub = me!.role === "imposter" ? "You don't know the word. Say something that fits the category." : "Show you know it, without handing it to the Imposter.";
          form = { placeholder: "Your clue", label: "Send", max: MAX_CLUE };
        }
        break;
      case "discuss":
        headline = "Who's bluffing?";
        sub = "Talk it out. Room chat's open.";
        if (host) button = "Vote now";
        break;
      case "vote":
      case "runoff":
        headline = game.phase === "runoff" ? `Tie. Runoff: ${game.tied.map((id) => this.name(id, props)).join(" or ")}` : "Vote for the Imposter";
        sub = me?.vote ? `You voted for ${this.name(me.vote, props)}. You can change it.` : me?.choices.length ? "Tap a player. Not yourself." : `Waiting for ${waiting}`;
        break;
      case "reveal-role":
        headline = game.accusedId
          ? `${this.name(game.accusedId, props)} ${game.accusedId === props.playerId ? "were" : "was"} ${game.accusedRole === "imposter" ? "the Imposter" : "not the Imposter"}`
          : "";
        sub = game.accusedRole === "imposter" ? "One guess at the word to steal it." : "";
        break;
      case "guess":
        if (me?.guessing) {
          headline = "Caught. Guess the word.";
          sub = `Category: ${game.category}. Right, and you take the round.`;
          form = { placeholder: "The word is…", label: "Guess", max: MAX_GUESS };
        } else {
          headline = `${this.name(game.accusedId, props)} ${game.accusedId === props.playerId ? "are" : "is"} guessing the word`;
        }
        break;
      case "round-result":
        headline = this.resultLine(props, game);
        sub = `The word was ${(game.word ?? "").toUpperCase()}.${game.guess ? ` Guess: ${game.guess}.` : ""}${game.guessClose ? " So close." : ""}`;
        if (host) button = game.round >= game.rounds ? "Finish" : "Next round";
        break;
      case "finished":
        headline = game.endReason === "abandoned" ? "Not enough players left." : "That's the game.";
        // Cut short mid-round: the round never got its result line, so give the secret here.
        if (game.endReason === "abandoned" && game.imposterId && game.word) {
          const youImp = game.imposterId === props.playerId;
          sub = `${this.name(game.imposterId, props)} ${youImp ? "were" : "was"} the Imposter. The word was ${game.word.toUpperCase()}.`;
        }
        break;
    }

    this.headline.textContent = headline;
    this.sub.textContent = sub;
    const typing = document.activeElement === this.input;
    this.form.hidden = !form;
    if (form) {
      this.input.placeholder = form.placeholder;
      this.input.maxLength = form.max;
      this.input.setAttribute("aria-label", form.placeholder);
      this.send.textContent = form.label;
      if (typing) this.input.focus({ preventScroll: true });
    }
    this.button.hidden = !button;
    if (button) this.button.textContent = button;
  }

  private resultLine(props: GameViewProps, game: Pub): string {
    const imp = this.name(game.imposterId, props);
    const youImp = game.imposterId === props.playerId;
    if (game.winner === "innocents") return `Caught. ${imp} ${youImp ? "were" : "was"} the Imposter. Innocents +2`;
    if (game.guessRight) return `${imp} ${youImp ? "were" : "was"} caught, and guessed it. Imposter +2`;
    return `${imp} ${youImp ? "were" : "was"} the Imposter, and got away. Imposter +2`;
  }

  private renderTable(props: GameViewProps, game: Pub, me: Priv | null) {
    const clues = new Map((game.clues ?? []).map((c) => [c.playerId, c.text]));
    // Clue order once they're out, seat order before.
    const order = game.clues ? [...game.clues.map((c) => c.playerId), ...game.players.map((p) => p.id).filter((id) => !clues.has(id))] : game.players.map((p) => p.id);
    const voting = game.phase === "vote" || game.phase === "runoff";
    this.rows.clear();
    replaceChildren(
      this.table,
      order.map((id) => {
        const p = game.players.find((x) => x.id === id)!;
        const seat = props.room.seats.find((s) => s.id === id);
        const who = this.name(id, props);
        const canPick = voting && !!me?.choices.includes(id);
        const picked = voting && me?.vote === id;
        const count = game.counts?.[id] ?? 0;
        const accused = game.accusedId === id;
        const isImp = game.imposterId === id;
        const clue = clues.has(id) ? (clues.get(id) ?? "no clue") : null;
        const away = seat && seat.presence !== "connected";
        const cls = [
          "im-row",
          p.removed && "gone",
          away && "away",
          canPick && "pickable",
          picked && "picked",
          accused && "accused",
          isImp && "imp",
          p.done && "done",
          id === props.playerId && "me",
        ].filter(Boolean).join(" ");
        const inner = [
          seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
          h("span", { class: "im-who" }, h("span", { class: "name" }, who), clue !== null ? h("span", { class: clues.get(id) ? "im-clue" : "im-clue none" }, clue) : null),
          game.counts && count ? h("span", { class: "im-votes", "aria-label": `${count} ${count === 1 ? "vote" : "votes"}` }, `${count}×`) : null,
          isImp ? h("span", { class: "tag imp" }, "Imposter") : null,
          p.removed ? h("span", { class: "tag" }, "left") : null,
          p.done && !game.counts ? h("span", { class: "im-tick", "aria-label": "done" }, "✓") : null,
          h("span", { class: "im-score", "aria-label": `${p.score} points` }, String(p.score)),
        ];
        const row = canPick
          ? h("li", { class: cls }, h("button", { type: "button", class: "im-pick", "aria-pressed": picked ? "true" : "false", onclick: () => this.vote(id) }, inner))
          : h("li", { class: cls }, h("div", { class: "im-pick" }, inner));
        this.rows.set(id, row);
        return row;
      }),
    );
  }

  // ---- what just happened -------------------------------------------------

  private sounds(events: ImposterEvent[], props: GameViewProps) {
    const me = props.private as Priv | null;
    for (const e of events) {
      switch (e.type) {
        case "round-started":
          audio.play("shuffle");
          break;
        case "clues-in":
          audio.play("deal");
          break;
        case "vote-open":
          audio.play("your-turn");
          audio.buzz(25);
          break;
        case "accused":
          audio.play(e.role === "imposter" ? "correct" : "boom");
          break;
        case "nobody-accused":
        case "round-dropped":
          audio.play("nudge");
          break;
        case "round-over": {
          const won = me?.role === (e.winner === "imposter" ? "imposter" : "innocent");
          audio.play(won ? "win" : "game-over");
          if (won) audio.buzz([40, 60, 40]);
          break;
        }
        default:
          break;
      }
    }
  }

  /** Bubbles over the table as it was; settle() catches up right after. */
  private act(events: ImposterEvent[]) {
    for (const e of events) {
      if (e.type === "accused") {
        const row = this.rows.get(e.playerId);
        if (row) void bubble(row, e.role === "imposter" ? "Imposter" : "Innocent", "anim-bubble im-bubble", 1200);
        replay(this.headline, "pop");
      }
    }
  }
}
