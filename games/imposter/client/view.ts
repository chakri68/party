import { AnimationQueue, bubble } from "@games/animation";
import { audio } from "@games/audio";
import { roleReveal } from "@games/hidden-roles/reveal";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { PLACES, placeById } from "../shared/places.ts";
import { cleanClue, clueProblem } from "../shared/rules.ts";
import { MAX_CLUE, MAX_GUESS, type ImposterEvent, type ImposterPrivateState, type ImposterPublicState } from "../shared/types.ts";

type Pub = ImposterPublicState;
type Priv = ImposterPrivateState;

/** The last seconds of a phase tick out loud. */
const TICK_FROM = 5;
/** How long "I know where we are" stays armed after the first tap. */
const ARM_MS = 4000;

/** Alphabetical, for scanning. */
const SORTED_PLACES = [...PLACES].sort((a, b) => a.name.localeCompare(b.name));

/** Restarts a one-off animation class, even if it's already on. */
function replay(el: Element, cls: string) {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

const PHASE_LABEL: Record<Pub["phase"], string> = {
  reveal: "Your card",
  clues: "Clues",
  discuss: "Talk",
  talk: "Talk",
  vote: "Vote",
  runoff: "Revote",
  "reveal-role": "The reveal",
  guess: "Last guess",
  "round-result": "Round result",
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

  /** Clues mode's category: public, so it lives outside the face-down card. */
  private category = h("p", { class: "im-category" });
  private cardSlot = h("div", { class: "im-card-slot" });
  /** The kit's card: face down until tapped, and again whenever the tab goes. */
  private reveal: ReturnType<typeof roleReveal> | null = null;
  /** Which deal the card belongs to; a new key deals a fresh, face-down card. */
  private cardKey = "";
  /** Bumped to turn the card over: "Got it", and a round dealt again. */
  private flips = 0;

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
  /** Spoken mode's "I know where we are". On every screen, same look. */
  private call = h("button", { type: "button", class: "im-call" });
  private placeList = h("ul", { class: "im-place-list" });
  private placeCount = h("summary", { class: "im-places-head" });
  private places = h("details", { class: "im-places" }, this.placeCount, this.placeList) as HTMLDetailsElement;
  private note = h("p", { class: "im-note", "aria-live": "assertive" });

  private table = h("ul", { class: "im-table", "aria-label": "Players" });

  private queue = new AnimationQueue();
  private rows = new Map<string, HTMLElement>();
  /** The round that started over because the Imposter left, to say so. */
  private dropped = -1;
  private pending: string | null = null;
  /** Phase + round the input belongs to; a new one clears it. */
  private stage = "";
  private lastTick = -1;
  /** First tap on the call button; a second within ARM_MS goes through. */
  private armed: ReturnType<typeof setTimeout> | null = null;
  private noteTimer: ReturnType<typeof setTimeout> | null = null;
  /** The place the guesser has tapped, waiting on the confirm. */
  private picked: string | null = null;
  private clock: ReturnType<typeof setInterval>;

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(
      h("div", { class: "im-top" }, this.roundLabel, this.phaseLabel, this.timer),
      h("div", { class: "im-track", "aria-hidden": "true" }, this.bar),
      this.category,
      this.cardSlot,
      this.headline,
      this.sub,
      this.form,
      this.button,
      this.call,
      this.note,
      this.places,
      this.table,
    );
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submit();
    });
    this.input.addEventListener("input", () => (this.note.textContent = ""));
    this.button.addEventListener("click", () => this.press());
    this.call.addEventListener("click", () => this.callIt());
    this.clock = setInterval(() => this.renderClock(), 200);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    clearInterval(this.clock);
    this.disarm();
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.reveal?.destroy();
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
      this.flips++;
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
      // Seen it: turn it face down for them.
      this.flips++;
      this.api.act({ type: "ack" });
    } else if (game.phase === "guess" && me.guessing && game.mode === "spoken") {
      if (this.picked && !this.pending) this.pending = this.api.act({ type: "guess-place", placeId: this.picked });
    } else if ((game.phase === "discuss" || game.phase === "talk" || game.phase === "round-result") && this.isHost()) {
      this.api.act({ type: "next" });
    }
  }

  /**
   * Same two taps for everyone. Only the Imposter's second tap sends; anyone
   * else gets a note only they can see, and the server would refuse them anyway.
   */
  private callIt() {
    const game = this.game();
    const me = this.mine();
    if (!game || !me?.role || game.phase !== "talk") return;
    if (!this.armed) {
      this.note.textContent = "";
      this.armed = setTimeout(() => {
        this.armed = null;
        if (this.props) this.settle(this.props);
      }, ARM_MS);
      if (this.props) this.settle(this.props);
      return;
    }
    this.disarm();
    if (me.role === "imposter") this.api.act({ type: "call" });
    else this.notImposter();
    if (this.props) this.settle(this.props);
  }

  /** Private, and gone again as the button settles back, so it can't linger over someone's shoulder. */
  private notImposter() {
    const text = "You are not the Imposter. Keep asking questions.";
    this.note.textContent = text;
    if (this.noteTimer) clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => {
      this.noteTimer = null;
      if (this.note.textContent === text) this.note.textContent = "";
    }, ARM_MS);
  }

  private disarm() {
    if (this.armed) clearTimeout(this.armed);
    this.armed = null;
  }

  private pickPlace(id: string) {
    const me = this.mine();
    if (!me?.guessing || this.pending) return;
    this.picked = id;
    audio.play("card-place");
    if (this.props) this.settle(this.props);
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
    // Spoken mode's minutes read better as minutes.
    this.timer.textContent = game.phase === "talk" && secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : `${secs} s`;
    this.bar.style.transform = `scaleX(${Math.min(1, left / game.phaseMs)})`;
    const low = secs <= TICK_FROM && ["clues", "vote", "runoff", "guess", "discuss", "talk"].includes(game.phase);
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
      this.stage = stage;
      this.lastTick = -1;
      this.pending = null;
      this.input.value = "";
      this.picked = null;
      this.disarm();
      // Open for the guess (everyone's, so it says nothing), shut for a new round.
      if (game.phase === "guess") this.places.open = true;
      if (game.phase === "reveal") this.places.open = false;
      const fresh = game.mode === "spoken" ? "New place and new Imposter." : "New word and new Imposter.";
      this.note.textContent = game.phase === "reveal" && this.dropped === game.round ? `A player left during the round. ${fresh}` : "";
    }
    this.roundLabel.textContent = `Round ${game.round} of ${game.rounds}`;
    this.phaseLabel.textContent = PHASE_LABEL[game.phase];
    this.root.dataset.phase = game.phase;

    this.renderCard(props);
    this.renderPrompt(props, game, me);
    this.renderTable(props, game, me);
    this.renderPlaces(game, me);
    this.renderClock();
  }

  /** Spoken mode: the list everyone plays from. The guesser's copy is buttons. */
  private renderPlaces(game: Pub, me: Priv | null) {
    const show = game.mode === "spoken" && game.phase !== "round-result" && game.phase !== "finished";
    this.places.hidden = !show;
    if (!show) return;
    const guessing = game.phase === "guess" && !!me?.guessing;
    this.places.classList.toggle("choosing", guessing);
    this.placeCount.textContent = guessing ? "Where are we? Tap a place." : `All places (${PLACES.length})`;
    replaceChildren(
      this.placeList,
      SORTED_PLACES.map((p) =>
        h(
          "li",
          {},
          guessing
            ? h(
                "button",
                { type: "button", class: "im-place pick", "aria-pressed": this.picked === p.id ? "true" : "false", onclick: () => this.pickPlace(p.id) },
                p.name,
              )
            : h("span", { class: "im-place" }, p.name),
        ),
      ),
    );
  }

  private renderCard(props: GameViewProps) {
    const game = props.game as Pub;
    const me = props.private as Priv | null;
    const playing = !!me?.role && game.phase !== "finished";
    this.category.hidden = !playing || game.mode === "spoken";
    this.category.textContent = `Category: ${game.category}`;
    if (!playing) {
      this.reveal?.destroy();
      this.reveal = null;
      this.cardKey = "";
      return;
    }
    const body = this.cardFace(game, me!);
    const key = `${game.round}:${this.flips}`;
    if (this.reveal && key === this.cardKey) return this.reveal.update(body);
    this.reveal?.destroy();
    this.reveal = roleReveal({ title: "Your card", body });
    this.cardKey = key;
    this.cardSlot.append(this.reveal.el);
  }

  private cardFace(game: Pub, me: Priv): HTMLElement {
    const imposter = me.role === "imposter";
    const spoken = game.mode === "spoken";
    // No role class: nothing on the face may be styled by who holds it.
    const cls = ["im-card-body", spoken && "place"].filter(Boolean).join(" ");
    if (imposter) {
      return h(
        "div",
        { class: cls },
        h("span", { class: "im-card-kicker" }, "You're the"),
        h("strong", { class: "im-card-word" }, "Imposter"),
        h("span", { class: "im-card-cat" }, spoken ? "No place for you. Listen, and work out where." : `Category: ${game.category}. Try to fit in.`),
      );
    }
    return h(
      "div",
      { class: cls },
      h("span", { class: "im-card-kicker" }, spoken ? "You're at the" : "The word"),
      h("strong", { class: "im-card-word" }, me.word ?? ""),
      h("span", { class: "im-card-cat" }, spoken ? "Show you know it. Don't name it." : `Category: ${game.category}`),
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
    let call = false;
    const spoken = game.mode === "spoken";
    const thing = spoken ? "place" : "word";

    switch (game.phase) {
      case "reveal":
        headline = me?.acked ? "Waiting for the others" : "Look at your card";
        sub = me?.acked ? `${waiting} still reading` : "Do not show your card to anyone.";
        if (inGame && !me!.acked) button = "Got it";
        break;
      case "clues":
        if (me?.sentClue) {
          headline = `Your clue: ${me.clue ?? "none"}`;
          sub = `Waiting for ${waiting}`;
        } else if (inGame) {
          headline = "Write 1 clue. Do not say the word.";
          sub = me!.role === "imposter" ? "You do not know the word. Write a clue for the category." : "Show that you know the word. Do not make it easy for the Imposter.";
          form = { placeholder: "Your clue", label: "Send", max: MAX_CLUE };
        }
        break;
      case "talk":
        headline = "Ask each other questions";
        sub = `${game.firstAsker ? `${this.name(game.firstAsker, props)} ${game.firstAsker === props.playerId ? "go" : "goes"} first. ` : ""}Ask out loud. Do not say the place.`;
        if (host) button = "Vote now";
        call = inGame;
        break;
      case "discuss":
        headline = "Who is the Imposter?";
        sub = "Talk about it. Room chat is open.";
        if (host) button = "Vote now";
        break;
      case "vote":
      case "runoff":
        headline = game.phase === "runoff" ? `Tie. Vote again: ${game.tied.map((id) => this.name(id, props)).join(" or ")}` : "Vote for the Imposter";
        sub = me?.vote ? `You voted for ${this.name(me.vote, props)}. You can change your vote.` : me?.choices.length ? "Tap a player. You cannot choose yourself." : `Waiting for ${waiting}`;
        break;
      case "reveal-role":
        headline = game.accusedId
          ? `${this.name(game.accusedId, props)} ${game.accusedId === props.playerId ? "were" : "was"} ${game.accusedRole === "imposter" ? "the Imposter" : "not the Imposter"}`
          : "";
        sub = game.accusedRole === "imposter" ? `The Imposter gets 1 guess at the ${thing}. A right guess wins the round.` : "";
        break;
      case "guess":
        if (spoken && me?.guessing) {
          headline = game.early ? "You stopped the clock. Where are we?" : "You were caught. Where are we?";
          sub = this.picked ? "Are you sure? You get 1 try." : "Tap a place on the list. If you are right, you win the round.";
          if (this.picked) button = `It's the ${placeById(this.picked)?.name ?? ""}`;
        } else if (spoken && game.early) {
          headline = "The Imposter stopped the clock";
          sub = "The Imposter is choosing a place. The Imposter gets 1 try.";
        } else if (me?.guessing) {
          headline = "You were caught. Guess the word.";
          sub = `Category: ${game.category}. If you are right, you win the round.`;
          form = { placeholder: "The word is…", label: "Guess", max: MAX_GUESS };
        } else {
          headline = `${this.name(game.accusedId, props)} ${game.accusedId === props.playerId ? "are" : "is"} guessing the ${thing}`;
        }
        break;
      case "round-result":
        headline = this.resultLine(props, game);
        sub = `The ${thing} was ${(game.word ?? "").toUpperCase()}.${game.guess ? ` Guess: ${game.guess}.` : ""}${game.guessClose ? " The guess was very close." : ""}`;
        if (host) button = game.round >= game.rounds ? "Finish" : "Next round";
        break;
      case "finished":
        headline = game.endReason === "abandoned" ? "Too few players are left." : "Game over.";
        // Cut short mid-round: the round never got its result line, so give the secret here.
        if (game.endReason === "abandoned" && game.imposterId && game.word) {
          const youImp = game.imposterId === props.playerId;
          sub = `${this.name(game.imposterId, props)} ${youImp ? "were" : "was"} the Imposter. The ${thing} was ${game.word.toUpperCase()}.`;
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
    this.call.hidden = !call;
    this.call.classList.toggle("armed", !!this.armed);
    this.call.textContent = this.armed ? "Tap again to stop the clock" : "I know where we are";
  }

  private resultLine(props: GameViewProps, game: Pub): string {
    const imp = this.name(game.imposterId, props);
    const youImp = game.imposterId === props.playerId;
    const was = `${imp} ${youImp ? "were" : "was"} the Imposter`;
    if (game.early) return game.guessRight ? `${was}. The Imposter stopped the clock and guessed right. Imposter +2` : `${was}. The Imposter stopped the clock and guessed wrong. Innocents +2`;
    if (game.winner === "innocents") return `${imp} ${youImp ? "were" : "was"} the Imposter and got caught. Innocents +2`;
    if (game.guessRight) return `${imp} ${youImp ? "were" : "was"} caught but guessed right. Imposter +2`;
    return `${imp} ${youImp ? "were" : "was"} the Imposter and did not get caught. Imposter +2`;
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
        case "early-guess":
          audio.play("your-turn");
          audio.buzz(25);
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
