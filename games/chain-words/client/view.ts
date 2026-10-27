import { AnimationQueue, bubble } from "@games/animation";
import { audio } from "@games/audio";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { MAX_WORD, normalizeWord, parseTyping, shapeProblem } from "../shared/rules.ts";
import type { ChainWordsEvent, ChainWordsPrivateState, ChainWordsPublicState, Link } from "../shared/types.ts";

type Pub = ChainWordsPublicState;

/** Links shown in the strip; older ones are a scroll away on the server only. */
const STRIP = 5;
/** The clock ticks out loud for this many seconds. */
const TICK_FROM = 3;
const SVG_NS = "http://www.w3.org/2000/svg";
/** How long a timeout holds the table before it settles. */
const TIMEOUT_ANIM_MS = 600;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Restarts a one-off animation class, even if it's already on. */
function replay(el: Element, cls: string) {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

/** A word in capitals with its first and last letters marked: the links. */
function linked(word: string, first: boolean, last: boolean): (Node | string)[] {
  const w = word.toUpperCase();
  if (w.length < 2) return [w];
  return [first ? h("mark", {}, w[0]!) : w[0]!, w.slice(1, -1), last ? h("mark", {}, w.at(-1)!) : w.at(-1)!];
}

/** A ring that empties as the clock runs down. pathLength 100, so the offset is a percentage. */
function ringEl(): { el: SVGSVGElement; arc: SVGCircleElement } {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", "0 0 100 100");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("class", "cw-ring");
  const track = document.createElementNS(SVG_NS, "circle");
  const arc = document.createElementNS(SVG_NS, "circle");
  for (const c of [track, arc]) {
    c.setAttribute("cx", "50");
    c.setAttribute("cy", "50");
    c.setAttribute("r", "45");
    c.setAttribute("pathLength", "100");
  }
  track.setAttribute("class", "cw-ring-track");
  arc.setAttribute("class", "cw-ring-arc");
  el.append(track, arc);
  return { el, arc };
}

export class ChainWordsView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "chain-words" });
  private count = h("span", { class: "cw-count" });
  private clockLabel = h("span", { class: "cw-clock-label" });
  private strip = h("ol", { class: "cw-strip", "aria-label": "The chain so far" });
  private ring = ringEl();
  private letter = h("span", { class: "cw-letter" });
  private secs = h("span", { class: "cw-secs", "aria-hidden": "true" });
  private stage = h("div", { class: "cw-stage" });
  private status = h("p", { class: "cw-status", role: "status", "aria-live": "polite" });
  private flash = h("p", { class: "cw-flash", "aria-live": "polite" });
  private typing = h("p", { class: "cw-typing", "aria-hidden": "true" });
  private input = h("input", {
    class: "cw-input",
    maxlength: MAX_WORD,
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    enterkeyhint: "send",
    "aria-label": "Your word",
  });
  private send = h("button", { type: "submit", class: "primary cw-send" }, "Play");
  private form = h("form", { class: "cw-form" }, this.input, this.send);
  private note = h("p", { class: "cw-note", "aria-live": "assertive" });
  private players = h("ul", { class: "cw-players", "aria-label": "Players" });

  private queue = new AnimationQueue();
  private chips = new Map<string, HTMLElement>();
  /** The turn the input and the typing line belong to. */
  private turn = -1;
  private typed = "";
  private pending: string | null = null;
  /** What just happened that the state can't say (a timeout, a rescue), for the turn it happened on. */
  private news: { text: string; turn: number } | null = null;
  private lastTick = -1;
  private clock: ReturnType<typeof setInterval>;

  constructor(api: GameClientApi) {
    this.api = api;
    this.stage.append(this.ring.el, this.letter, this.secs);
    this.root.append(
      h("div", { class: "cw-top" }, this.count, this.clockLabel),
      this.strip,
      this.stage,
      this.status,
      this.flash,
      this.typing,
      this.form,
      this.note,
      this.players,
    );
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submit();
    });
    this.input.addEventListener("input", () => this.onType());
    this.clock = setInterval(() => this.renderClock(), 100);
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

  stream(_from: string, data: unknown) {
    const t = parseTyping(data);
    const game = this.props?.game as Pub | undefined;
    if (!t || !game || t.turn !== game.turn || this.holding()) return;
    this.showTyping(t.text, game.letter);
    if (t.wrong) replay(this.typing, "shake");
  }

  update(props: GameViewProps) {
    const events = props.events as ChainWordsEvent[];
    if (props.snapshot || !this.props) {
      this.queue.clear();
      this.news = null;
      const t = parseTyping(props.stream);
      this.settle(props);
      const game = props.game as Pub;
      if (t && t.turn === game.turn && !this.holding()) this.showTyping(t.text, game.letter);
      return;
    }
    this.props = props;
    this.announce(events, props);
    let animated = false;
    this.queue.push({
      animate: async () => {
        animated = true;
        await this.act(events, props);
      },
      settle: () => {
        if (!animated) this.sounds(events, props);
        this.settle(props);
      },
    });
  }

  // ---- input ----------------------------------------------------------------

  private holding(): boolean {
    return !!(this.props?.private as ChainWordsPrivateState | null)?.holding;
  }

  private onType() {
    const game = this.props?.game as Pub | undefined;
    if (!game || !this.holding()) return;
    const text = this.input.value.toLowerCase().replace(/[^a-z]/g, "");
    this.showTyping(text, game.letter);
    this.api.stream({ turn: game.turn, text });
  }

  private submit() {
    const game = this.props?.game as Pub | undefined;
    if (!game || this.pending) return;
    if (!this.holding()) {
      this.note.textContent = game.phase === "live" ? "Not your turn." : "";
      return;
    }
    const word = normalizeWord(this.input.value);
    if (!word) return;
    const problem = shapeProblem(word, game.letter);
    if (problem) return this.bounce(problem);
    this.pending = this.api.act({ type: "word", text: word });
  }

  /** A word that didn't take: shake, say why, and let the others see it bounce. */
  private bounce(message: string) {
    replay(this.form, "shake");
    replay(this.typing, "shake");
    this.note.textContent = message;
    audio.play("reject");
    audio.buzz([30, 40, 30]);
    const game = this.props?.game as Pub | undefined;
    if (game && this.holding()) {
      this.api.stream({ turn: game.turn, text: this.input.value.toLowerCase().replace(/[^a-z]/g, ""), wrong: true });
    }
    this.input.select();
  }

  private showTyping(text: string, letter: string) {
    if (text === this.typed) return;
    this.typed = text;
    // The first letter lights up when it's the right one.
    replaceChildren(
      this.typing,
      text && letter && text.startsWith(letter) ? [h("mark", {}, text[0]!), text.slice(1)] : [text],
    );
  }

  // ---- the clock --------------------------------------------------------------

  private renderClock() {
    const game = this.props?.game as Pub | undefined;
    if (!game || game.phase !== "live") {
      this.secs.textContent = "";
      this.ring.arc.style.strokeDashoffset = "100";
      this.stage.classList.remove("low");
      return;
    }
    const left = Math.max(0, game.deadline - this.api.serverNow());
    const secs = Math.ceil(left / 1000);
    this.secs.textContent = String(secs);
    this.ring.arc.style.strokeDashoffset = String(100 - Math.min(1, left / game.turnMs) * 100);
    this.stage.classList.toggle("low", secs <= TICK_FROM);
    if (secs > 0 && secs <= TICK_FROM && secs !== this.lastTick && document.visibilityState === "visible") {
      this.lastTick = secs;
      audio.play("tick");
    }
  }

  // ---- settled state --------------------------------------------------------

  private settle(props: GameViewProps) {
    this.props = props;
    const game = props.game as Pub;
    const me = props.playerId;
    const mine = game.players.find((p) => p.id === me);
    const inGame = !!mine && !mine.removed && mine.lives > 0;
    const holding = this.holding();
    const name = (id: string) => (id === me ? "You" : seatName(props.room, id));

    if (game.turn !== this.turn) {
      // New turn: whatever was typed belonged to the last one.
      this.turn = game.turn;
      this.lastTick = -1;
      this.pending = null;
      this.input.value = "";
      this.note.textContent = "";
      this.showTyping("", game.letter);
    }
    if (game.phase !== "live") this.showTyping("", game.letter);

    this.count.textContent = `${game.chainLength} ${game.chainLength === 1 ? "word" : "words"} in the chain`;
    this.clockLabel.textContent = `${game.turnMs / 1000} s a turn`;
    this.renderStrip(game.chain, props);

    this.letter.textContent = game.letter.toUpperCase();
    this.stage.classList.toggle("mine", holding);
    this.stage.classList.toggle("over", game.phase === "finished");

    if (game.phase === "live") {
      this.status.textContent = holding ? `Your go: a word starting with ${game.letter.toUpperCase()}` : `${name(game.holderId)}'s go`;
    } else {
      this.status.textContent = "";
    }
    this.flash.textContent = this.news && this.news.turn === game.turn ? this.news.text : "";

    // Out, watching, or it's over: no keyboard. Otherwise it stays up between
    // turns, so the phone's keyboard doesn't bounce every time the turn moves.
    const typing = document.activeElement === this.input;
    this.form.hidden = !inGame || game.phase === "finished";
    this.input.placeholder = holding ? `Starts with ${game.letter.toUpperCase()}` : "Wait for your go";
    this.send.disabled = !holding;
    this.root.classList.toggle("holding", holding);
    if (typing && !this.form.hidden) this.input.focus({ preventScroll: true });

    this.renderPlayers(props, game);
    this.renderClock();
  }

  /** The tail of the chain, newest last, its links marked. */
  private renderStrip(chain: Link[], props: GameViewProps) {
    const tail = chain.slice(-STRIP);
    replaceChildren(
      this.strip,
      tail.map((l, i) =>
        h(
          "li",
          {
            class: i === tail.length - 1 ? "cw-link newest" : "cw-link",
            title: l.playerId ? (l.playerId === props.playerId ? "You" : seatName(props.room, l.playerId)) : "Opener",
          },
          linked(l.word, i > 0, true),
        ),
      ),
    );
  }

  private renderPlayers(props: GameViewProps, game: Pub) {
    const me = props.playerId;
    this.chips.clear();
    replaceChildren(
      this.players,
      game.players.map((p) => {
        const seat = props.room.seats.find((s) => s.id === p.id);
        const out = p.removed || p.lives <= 0;
        const has = !out && p.id === game.holderId && game.phase === "live";
        const away = seat && seat.presence !== "connected";
        const pips = Array.from({ length: game.maxLives }, (_, i) => h("span", { class: i < p.lives ? "pip on" : "pip" }));
        const who = p.id === me ? "You" : seatName(props.room, p.id);
        const li = h(
          "li",
          {
            class: `cw-player${has ? " has" : ""}${out ? " out" : ""}${away ? " away" : ""}${p.id === me ? " me" : ""}`,
            "aria-label": `${who}: ${out ? (p.removed ? "left" : "out") : `${p.lives} ${p.lives === 1 ? "life" : "lives"}`}${has ? ", on the clock" : ""}`,
          },
          seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
          h("span", { class: "name", "aria-hidden": "true" }, who),
          out
            ? h("span", { class: "tag", "aria-hidden": "true" }, p.removed ? "left" : "out")
            : h("span", { class: "pips", "aria-hidden": "true" }, pips),
        );
        this.chips.set(p.id, li);
        return li;
      }),
    );
  }

  // ---- what just happened ---------------------------------------------------

  /** The news line: things the settled state can't say on its own. */
  private announce(events: ChainWordsEvent[], props: GameViewProps) {
    const game = props.game as Pub;
    const me = props.playerId;
    const name = (id: string) => (id === me ? "You" : seatName(props.room, id));
    for (const e of events) {
      let text: string | null = null;
      switch (e.type) {
        case "timeout":
          text = e.lives > 0
            ? `Time. ${name(e.playerId)} ${e.playerId === me ? "lose" : "loses"} a life`
            : `Time. ${name(e.playerId)} ${e.playerId === me ? "are" : "is"} out`;
          break;
        case "rescued":
          text = `Nothing left on ${e.from.toUpperCase()}. ${e.to.toUpperCase()} instead`;
          break;
        case "skipped":
          text = `${name(e.from)} got skipped`;
          break;
        case "left":
          if (e.to) text = `${name(e.playerId)} left`;
          break;
        default:
          break;
      }
      // A rescue after a timeout says more; the latest one wins.
      if (text) this.news = { text, turn: game.turn };
    }
  }

  private sounds(events: ChainWordsEvent[], props: GameViewProps) {
    const me = props.playerId;
    for (const e of events) {
      switch (e.type) {
        case "opened":
          if (e.holderId === me) this.yourGo();
          else audio.play("deal");
          break;
        case "played":
          audio.play("correct");
          if (e.to === me) this.yourGo();
          break;
        case "skipped":
          audio.play("pass");
          if (e.to === me) this.yourGo();
          break;
        case "left":
          if (e.to === me) this.yourGo();
          break;
        case "rescued":
          audio.play("nudge");
          break;
        case "timeout":
          audio.play("boom");
          audio.buzz(e.playerId === me ? [80, 40, 240] : 60);
          if (e.to === me) this.yourGo();
          break;
        case "game-over": {
          const won = e.winnerId === me;
          audio.play(won ? "win" : "game-over");
          if (won) audio.buzz([40, 60, 40, 60, 90]);
          break;
        }
      }
    }
  }

  private yourGo() {
    audio.play("your-turn");
    audio.buzz(25);
  }

  /** Bubbles and bumps over the table as it was; settle() catches up right after. */
  private async act(events: ChainWordsEvent[], props: GameViewProps) {
    this.sounds(events, props);
    for (const e of events) {
      switch (e.type) {
        case "played": {
          const chip = this.chips.get(e.playerId);
          if (chip) void bubble(chip, e.word.toUpperCase(), "anim-bubble cw-bubble", 1100);
          replay(this.stage, "hop");
          break;
        }
        case "timeout": {
          const chip = this.chips.get(e.playerId);
          chip?.classList.add("hit");
          if (chip) void bubble(chip, "time", "anim-bubble cw-bubble", 1100);
          replay(this.root, "quake");
          // Long enough to see who it was before the turn moves on.
          await wait(TIMEOUT_ANIM_MS);
          break;
        }
        case "rescued":
          replay(this.stage, "swap");
          break;
        case "opened":
          replay(this.stage, "lit");
          break;
        default:
          break;
      }
    }
  }
}
