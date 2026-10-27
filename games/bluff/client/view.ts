import { AnimationQueue } from "@games/animation";
import { audio } from "@games/audio";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { cleanDefinition, cleanFake, definitionShapeProblem, fakeShapeProblem } from "../shared/rules.ts";
import { type BluffEvent, type BluffPrivateState, type BluffPublicState, MAX_DEFINITION, MAX_FAKE, type Variant } from "../shared/types.ts";

type Pub = BluffPublicState;
type Priv = BluffPrivateState;

/** The last seconds of a timed phase tick out loud. */
const TICK_FROM = 5;

/** Restarts a one-off animation class, even if it's already on. */
function replay(el: Element, cls: string) {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

const PHASE_LABEL: Record<Pub["phase"], string> = {
  write: "Write",
  vote: "Vote",
  reveal: "The reveal",
  finished: "Game over",
};

/**
 * One view for both games. Fake Word types a word into a one-line input;
 * Bluff Definitions a meaning into a short textarea (Enter still sends).
 */
export class BluffView implements GameView {
  private api: GameClientApi;
  private variant: Variant;
  private props: GameViewProps | null = null;

  private root: HTMLElement;
  private roundLabel = h("span", { class: "bl-round" });
  private phaseLabel = h("span", { class: "bl-phase" });
  private timer = h("span", { class: "bl-timer", role: "timer" });
  private bar = h("div", { class: "bl-bar" });

  private card = h("section", { class: "bl-card", "aria-label": "This round" });

  private headline = h("p", { class: "bl-headline", role: "status", "aria-live": "polite" });
  private sub = h("p", { class: "bl-sub" });

  private input: HTMLInputElement | HTMLTextAreaElement;
  private send = h("button", { type: "submit", class: "primary bl-send" }, "Send");
  private form: HTMLFormElement;
  private count = h("span", { class: "bl-count", "aria-hidden": "true" });
  private button = h("button", { type: "button", class: "primary bl-action" });
  private note = h("p", { class: "bl-note", "aria-live": "assertive" });

  private options = h("ul", { class: "bl-options", "aria-label": "Which one is real?" });
  private table = h("ul", { class: "bl-table", "aria-label": "Players" });

  private queue = new AnimationQueue();
  private pending: string | null = null;
  /** Round + phase the input belongs to; a new one clears it. */
  private stage = "";
  private lastTick = -1;
  private clock: ReturnType<typeof setInterval>;

  constructor(api: GameClientApi, variant: Variant) {
    this.api = api;
    this.variant = variant;
    this.root = h("div", { class: `bluff ${variant}` });
    const common = { autocomplete: "off", autocorrect: "off", spellcheck: "false", enterkeyhint: "send" } as const;
    if (variant === "fake-word") {
      this.input = h("input", { ...common, class: "bl-input", autocapitalize: "off", maxlength: String(MAX_FAKE), placeholder: "Your made-up word", "aria-label": "Your made-up word" });
    } else {
      this.input = h("textarea", { ...common, class: "bl-input", rows: "3", maxlength: String(MAX_DEFINITION), placeholder: "What it means…", "aria-label": "Your made-up meaning" });
    }
    this.form = h("form", { class: "bl-form" }, h("div", { class: "bl-field" }, this.input, this.count), this.send);
    this.root.append(
      h("div", { class: "bl-top" }, this.roundLabel, this.phaseLabel, this.timer),
      h("div", { class: "bl-track", "aria-hidden": "true" }, this.bar),
      this.card,
      this.headline,
      this.sub,
      this.form,
      this.options,
      this.button,
      this.note,
      this.table,
    );
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submit();
    });
    this.input.addEventListener("keydown", (e) => {
      const k = e as KeyboardEvent;
      if (k.key === "Enter" && !k.shiftKey && !k.isComposing && this.input instanceof HTMLTextAreaElement) {
        e.preventDefault();
        this.submit();
      }
    });
    this.input.addEventListener("input", () => {
      this.note.textContent = "";
      this.renderCount();
    });
    this.button.addEventListener("click", () => this.press());
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
    const events = props.events as BluffEvent[];
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

  private inGame(game: Pub, props: GameViewProps): boolean {
    return game.players.some((p) => p.id === props.playerId && !p.removed);
  }

  // ---- input --------------------------------------------------------------

  private submit() {
    const game = this.game();
    const me = this.mine();
    if (!game || !me || this.pending || game.phase !== "write" || me.sent) return;
    const fake = this.variant === "fake-word";
    const text = fake ? cleanFake(this.input.value) : cleanDefinition(this.input.value);
    const problem = fake ? fakeShapeProblem(text) : definitionShapeProblem(text);
    if (problem) return this.bounce(problem);
    this.pending = this.api.act({ type: "submit", text });
  }

  private press() {
    const game = this.game();
    if (game?.phase === "reveal" && this.isHost()) this.api.act({ type: "next" });
  }

  private vote(id: string) {
    const me = this.mine();
    if (!me || !me.choices.includes(id)) return;
    this.api.act({ type: "vote", optionId: id });
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
    const low = secs <= TICK_FROM && (game.phase === "write" || game.phase === "vote");
    this.root.classList.toggle("low", low);
    if (low && secs > 0 && secs !== this.lastTick && document.visibilityState === "visible") {
      this.lastTick = secs;
      audio.play("tick");
    }
  }

  private renderCount() {
    if (this.variant === "fake-word") {
      this.count.textContent = "";
      return;
    }
    const n = [...this.input.value].length;
    this.count.textContent = n ? `${n}/${MAX_DEFINITION}` : "";
  }

  // ---- settled state ------------------------------------------------------

  private settle(props: GameViewProps) {
    this.props = props;
    const game = props.game as Pub;
    const me = props.private as Priv | null;
    const stage = `${game.round}:${game.phase}`;
    if (stage !== this.stage) {
      this.stage = stage;
      this.lastTick = -1;
      this.pending = null;
      if (game.phase === "write") this.input.value = "";
      this.note.textContent = game.phase === "reveal" && game.noFakes ? "Nobody wrote anything, so no vote." : "";
      this.renderCount();
    }
    this.roundLabel.textContent = `Round ${game.round} of ${game.rounds}`;
    this.phaseLabel.textContent = PHASE_LABEL[game.phase];
    this.root.dataset.phase = game.phase;

    this.renderCard(game);
    this.renderPrompt(props, game, me);
    this.renderOptions(props, game, me);
    this.renderTable(props, game);
    this.renderClock();
  }

  /** The prompt, and from the reveal on, the answer and its note. */
  private renderCard(game: Pub) {
    this.card.hidden = game.phase === "finished";
    const shown = game.phase === "reveal";
    const parts: (HTMLElement | null)[] = [];
    if (this.variant === "fake-word") {
      parts.push(
        h("span", { class: "bl-kicker" }, "An uncommon English word. Its meaning:"),
        h("p", { class: "bl-meaning" }, game.definition ?? ""),
        shown && game.word ? h("strong", { class: "bl-word" }, game.word) : null,
      );
    } else {
      parts.push(
        h("span", { class: "bl-kicker" }, "An uncommon English word"),
        h("strong", { class: "bl-word" }, game.word ?? ""),
        shown && game.definition ? h("p", { class: "bl-meaning" }, game.definition) : null,
      );
    }
    if (shown && game.notes) parts.push(h("p", { class: "bl-notes" }, game.notes));
    replaceChildren(this.card, parts);
  }

  private renderPrompt(props: GameViewProps, game: Pub, me: Priv | null) {
    const fake = this.variant === "fake-word";
    const playing = this.inGame(game, props);
    const waiting = game.players.filter((p) => !p.removed && !p.done).length;
    let headline = "";
    let sub = "";
    let form = false;
    let button: string | null = null;

    switch (game.phase) {
      case "write":
        if (me?.sent) {
          headline = me.mine ? `Yours: ${me.mine}` : "Sat this one out";
          sub = `Waiting for ${waiting}`;
        } else if (playing) {
          headline = fake ? "Make up a word that could mean that" : "Make up what it means";
          sub = fake ? "3 to 18 letters. Real words don't count." : "Sound like a dictionary. 15 characters at least.";
          form = true;
        } else {
          headline = "They're writing";
        }
        break;
      case "vote":
        headline = fake ? "Which word is real?" : "Which meaning is real?";
        sub = !playing ? "" : me?.vote ? "Voted. You can change it." : me?.choices.length ? "Tap one. Not your own." : `Waiting for ${waiting}`;
        break;
      case "reveal": {
        const got = me && game.gained ? (game.gained[props.playerId] ?? 0) : 0;
        headline = game.noFakes ? "No fakes this round" : me?.vote && me.vote === game.realId ? "You found it" : me?.vote ? "Fooled" : "The answer";
        sub = got ? `+${got} for you` : "";
        if (this.isHost()) button = game.round >= game.rounds ? "Finish" : "Next round";
        break;
      }
      case "finished":
        headline = game.endReason === "abandoned" ? "Not enough players left." : "That's the game.";
        break;
    }

    this.headline.textContent = headline;
    this.sub.textContent = sub;
    const typing = document.activeElement === this.input;
    this.form.hidden = !form;
    if (form && typing) this.input.focus({ preventScroll: true });
    this.button.hidden = !button;
    if (button) this.button.textContent = button;
  }

  private renderOptions(props: GameViewProps, game: Pub, me: Priv | null) {
    const list = game.phase === "vote" || game.phase === "reveal" ? (game.options ?? []) : [];
    this.options.hidden = !list.length;
    const shown = game.phase === "reveal";
    const voters = new Map<string, string[]>();
    for (const [voter, choice] of Object.entries(game.votes ?? {})) voters.set(choice, [...(voters.get(choice) ?? []), voter]);
    replaceChildren(
      this.options,
      list.map((o) => {
        const canPick = game.phase === "vote" && !!me?.choices.includes(o.id);
        const picked = me?.vote === o.id;
        const own = me?.mineId === o.id;
        const real = shown && o.id === game.realId;
        const author = shown ? game.authors?.[o.id] : undefined;
        const by = voters.get(o.id) ?? [];
        const cls = ["bl-option", canPick && "pickable", picked && "picked", own && "own", real && "real", shown && !real && "fake"].filter(Boolean).join(" ");
        const inner = [
          h("span", { class: "bl-text" }, o.text),
          own && !shown ? h("span", { class: "tag" }, "yours") : null,
          shown
            ? h(
                "span",
                { class: "bl-verdict" },
                real ? h("span", { class: "tag real" }, "Real") : h("span", { class: "tag" }, `Fake by ${this.name(author, props)}`),
                by.length ? h("span", { class: "bl-by" }, `${real ? "Found by" : "Fooled"} ${by.map((id) => this.name(id, props)).join(", ")}`) : null,
              )
            : null,
        ];
        return canPick
          ? h("li", { class: cls }, h("button", { type: "button", class: "bl-pick", "aria-pressed": picked ? "true" : "false", onclick: () => this.vote(o.id) }, inner))
          : h("li", { class: cls }, h("div", { class: "bl-pick" }, inner));
      }),
    );
  }

  private renderTable(props: GameViewProps, game: Pub) {
    const ticking = game.phase === "write" || game.phase === "vote";
    replaceChildren(
      this.table,
      game.players.map((p) => {
        const seat = props.room.seats.find((s) => s.id === p.id);
        const away = seat && seat.presence !== "connected";
        const got = game.gained?.[p.id] ?? 0;
        const cls = ["bl-row", p.removed && "gone", away && "away", p.done && "done", p.id === props.playerId && "me"].filter(Boolean).join(" ");
        return h(
          "li",
          { class: cls },
          seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
          h("span", { class: "name" }, this.name(p.id, props)),
          p.removed ? h("span", { class: "tag" }, "left") : null,
          ticking && p.done ? h("span", { class: "bl-tick", "aria-label": "done" }, "✓") : null,
          got ? h("span", { class: "bl-gain" }, `+${got}`) : null,
          h("span", { class: "bl-score", "aria-label": `${p.score} points` }, String(p.score)),
        );
      }),
    );
  }

  // ---- what just happened -------------------------------------------------

  private sounds(events: BluffEvent[], props: GameViewProps) {
    const me = props.private as Priv | null;
    const game = props.game as Pub;
    for (const e of events) {
      switch (e.type) {
        case "round-started":
          audio.play("shuffle");
          break;
        case "vote-open":
          audio.play("your-turn");
          audio.buzz(25);
          break;
        case "no-fakes":
          audio.play("nudge");
          break;
        case "revealed": {
          if (!me?.vote) break;
          const found = me.vote === e.realId;
          audio.play(found ? "correct" : "boom");
          if (found) audio.buzz([40, 60, 40]);
          break;
        }
        case "game-over": {
          const top = Math.max(...game.players.filter((p) => !p.removed).map((p) => p.score));
          const mine = game.players.find((p) => p.id === props.playerId);
          audio.play(e.reason === "done" && mine && mine.score === top ? "win" : "game-over");
          break;
        }
        default:
          break;
      }
    }
  }
}
