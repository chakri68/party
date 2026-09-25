import { AnimationQueue, bubble } from "@games/animation";
import { audio } from "@games/audio";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { normalizeWord, parseTyping, shapeProblem } from "../shared/rules.ts";
import { MAX_WORD, type PassTheBombEvent, type PassTheBombPrivateState, type PassTheBombPublicState } from "../shared/types.ts";
import { bombEl, burstEl } from "./bomb.ts";

type Pub = PassTheBombPublicState;

/** How long the bang plays before the table settles on it. */
const BOOM_ANIM_MS = 900;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Restarts a one-off animation class, even if it's already on. */
function replay(el: Element, cls: string) {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

/** The typed letters, with the cluster lit up wherever it turns up. */
function lettersWithCluster(text: string, cluster: string): (Node | string)[] {
  if (!cluster || !text.includes(cluster)) return [text];
  const out: (Node | string)[] = [];
  let i = 0;
  for (let at = text.indexOf(cluster); at >= 0; at = text.indexOf(cluster, at + cluster.length)) {
    if (at > i) out.push(text.slice(i, at));
    out.push(h("mark", {}, cluster));
    i = at + cluster.length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

export class PassTheBombView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "pass-the-bomb" });
  private round = h("span", { class: "pb-round" });
  private used = h("span", { class: "pb-used" });
  private stage = h("div", { class: "pb-stage" });
  private bomb = bombEl();
  private burst = burstEl();
  private cluster = h("span", { class: "pb-cluster" });
  private status = h("p", { class: "pb-status", role: "status", "aria-live": "polite" });
  private typing = h("p", { class: "pb-typing", "aria-hidden": "true" });
  private last = h("p", { class: "pb-last" });
  private input = h("input", {
    class: "pb-input",
    maxlength: MAX_WORD,
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    enterkeyhint: "send",
    "aria-label": "Your word",
  });
  private send = h("button", { type: "submit", class: "primary pb-send" }, "Pass");
  private form = h("form", { class: "pb-form" }, this.input, this.send);
  private note = h("p", { class: "pb-note", "aria-live": "assertive" });
  private players = h("ul", { class: "pb-players", "aria-label": "Players" });

  private queue = new AnimationQueue();
  private chips = new Map<string, HTMLElement>();
  /** The turn the input and the typing line belong to. */
  private turn = -1;
  private typed = "";
  private pending: string | null = null;
  private clock: ReturnType<typeof setInterval>;

  constructor(api: GameClientApi) {
    this.api = api;
    this.stage.append(this.bomb, this.burst, this.cluster);
    this.root.append(
      h("div", { class: "pb-top" }, this.round, this.used),
      this.stage,
      this.status,
      this.typing,
      this.form,
      this.note,
      this.last,
      this.players,
    );
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submit();
    });
    this.input.addEventListener("input", () => this.onType());
    // Steady, whatever the fuse has left: the tick is all anyone gets to know.
    this.clock = setInterval(() => {
      const game = this.props?.game as Pub | undefined;
      if (game?.phase === "live" && document.visibilityState === "visible") audio.play("tick");
    }, 1000);
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
    this.showTyping(t.text, game.cluster);
    if (t.wrong) replay(this.typing, "shake");
  }

  update(props: GameViewProps) {
    const events = props.events as PassTheBombEvent[];
    if (props.snapshot || !this.props) {
      this.queue.clear();
      const t = parseTyping(props.stream);
      this.settle(props);
      const game = props.game as Pub;
      if (t && t.turn === game.turn && !this.holding()) this.showTyping(t.text, game.cluster);
      return;
    }
    this.props = props;
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
    return !!(this.props?.private as PassTheBombPrivateState | null)?.holding;
  }

  private onType() {
    const game = this.props?.game as Pub | undefined;
    if (!game || !this.holding()) return;
    const text = this.input.value.toLowerCase().replace(/[^a-z]/g, "");
    this.showTyping(text, game.cluster);
    this.api.stream({ turn: game.turn, text });
  }

  private submit() {
    const game = this.props?.game as Pub | undefined;
    if (!game || this.pending) return;
    if (!this.holding()) {
      this.note.textContent = game.phase === "live" ? "Not yours. Yet." : "";
      return;
    }
    const word = normalizeWord(this.input.value);
    if (!word) return;
    const problem = shapeProblem(word, game.cluster);
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

  private showTyping(text: string, cluster: string) {
    if (text === this.typed) return;
    this.typed = text;
    replaceChildren(this.typing, lettersWithCluster(text, cluster));
  }

  // ---- settled state --------------------------------------------------------

  private settle(props: GameViewProps) {
    this.props = props;
    const game = props.game as Pub;
    const priv = props.private as PassTheBombPrivateState | null;
    const me = props.playerId;
    const mine = game.players.find((p) => p.id === me);
    const inGame = !!mine && !mine.removed && mine.lives > 0;
    const holding = !!priv?.holding;

    if (game.turn !== this.turn) {
      // New holder, new letters: whatever was typed belonged to the last one.
      this.turn = game.turn;
      this.pending = null;
      this.input.value = "";
      this.note.textContent = "";
      this.showTyping("", game.cluster);
    }
    // Once it's gone off, whatever they were typing went with it.
    if (game.phase !== "live") this.showTyping("", game.cluster);

    this.round.textContent = `Round ${game.round}`;
    this.used.textContent = `${game.usedCount} ${game.usedCount === 1 ? "word" : "words"} played`;

    const boom = game.phase !== "live" && !!game.blownId;
    this.stage.classList.toggle("boom", boom);
    this.stage.classList.toggle("mine", holding);
    this.bomb.hidden = boom;
    this.burst.hidden = !boom;
    this.cluster.hidden = boom || game.phase === "finished";
    this.cluster.textContent = game.cluster.toUpperCase();

    const holder = game.holderId === me ? "You" : seatName(props.room, game.holderId);
    if (game.phase === "live") {
      this.status.textContent = holding ? `Your go: a word with ${game.cluster.toUpperCase()}` : `${holder} has it`;
    } else if (game.blownId) {
      const who = game.blownId === me ? "You" : seatName(props.room, game.blownId);
      const left = game.players.find((p) => p.id === game.blownId)?.lives ?? 0;
      this.status.textContent = left > 0
        ? `Boom. ${who} ${who === "You" ? "lose" : "loses"} a life`
        : `Boom. ${who} ${who === "You" ? "are" : "is"} out`;
    } else {
      this.status.textContent = "";
    }

    const lw = game.lastWord;
    replaceChildren(
      this.last,
      lw ? [lw.playerId === me ? "You" : seatName(props.room, lw.playerId), " played ", h("b", {}, lw.word.toUpperCase())] : null,
    );

    // Out, watching, or it's over: no keyboard. Otherwise it stays up between
    // turns, so the phone's keyboard doesn't bounce every time the bomb moves.
    const typing = document.activeElement === this.input;
    this.form.hidden = !inGame || game.phase === "finished";
    this.input.placeholder = holding ? `Something with ${game.cluster.toUpperCase()}` : game.phase === "live" ? "Wait for the bomb" : "Next round's coming";
    this.send.disabled = !holding;
    this.root.classList.toggle("holding", holding);
    if (typing && !this.form.hidden) this.input.focus({ preventScroll: true });

    this.renderPlayers(props, game);
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
        const li = h(
          "li",
          {
            class: `pb-player${has ? " has" : ""}${out ? " out" : ""}${away ? " away" : ""}${p.id === me ? " me" : ""}`,
            "aria-label": `${p.id === me ? "You" : seatName(props.room, p.id)}: ${out ? (p.removed ? "left" : "out") : `${p.lives} ${p.lives === 1 ? "life" : "lives"}`}${has ? ", holding the bomb" : ""}`,
          },
          seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
          h("span", { class: "name", "aria-hidden": "true" }, p.id === me ? "You" : seatName(props.room, p.id)),
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

  private sounds(events: PassTheBombEvent[], props: GameViewProps) {
    const me = props.playerId;
    for (const e of events) {
      switch (e.type) {
        case "round-started":
          if (e.holderId === me) this.yourGo();
          else audio.play("deal");
          break;
        case "passed":
        case "skipped":
          audio.play(e.type === "passed" ? "correct" : "pass");
          if (e.to === me) this.yourGo();
          break;
        case "left":
          if (e.to === me) this.yourGo();
          break;
        case "boom":
          audio.play("boom");
          audio.buzz(e.playerId === me ? [80, 40, 240] : 60);
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

  /** Acts the events out over the table as it was, then settle() catches up. */
  private async act(events: PassTheBombEvent[], props: GameViewProps) {
    for (const e of events) {
      this.sounds([e], props);
      switch (e.type) {
        case "passed":
        case "skipped": {
          const chip = this.chips.get(e.from);
          if (chip) void bubble(chip, e.type === "passed" ? e.word.toUpperCase() : "skipped", "anim-bubble pb-bubble", 1100);
          replay(this.stage, "hop");
          break;
        }
        case "round-started":
          replay(this.stage, "lit");
          break;
        case "boom":
          await this.explode(e.playerId);
          break;
        default:
          break;
      }
    }
  }

  /** Only runs when motion's allowed; otherwise settle() just shows the burst. */
  private async explode(holderId: string) {
    // The bang lands on the table as it was: the old cluster, the old holder.
    this.bomb.hidden = true;
    this.cluster.hidden = true;
    this.burst.hidden = false;
    this.stage.classList.add("boom");
    this.status.textContent = "Boom.";
    this.chips.get(holderId)?.classList.add("hit");
    replay(this.root, "quake");
    const flash = h("div", { class: "pb-flash", "aria-hidden": "true" });
    document.body.append(flash);
    setTimeout(() => flash.remove(), 1000);
    await wait(BOOM_ANIM_MS);
  }
}
