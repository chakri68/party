import { bubble, motionAllowed } from "@games/animation";
import { audio } from "@games/audio";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { parseDrawOp } from "../shared/rules.ts";
import {
  MAX_CHUNK,
  MAX_GUESS_LENGTH,
  MAX_POINTS,
  PALETTE,
  PAPER,
  SIZES,
  type ChatLine,
  type DrawingSnapshot,
  type DrawOp,
  type ScribblEvent,
  type ScribblPrivateState,
  type ScribblPublicState,
} from "../shared/types.ts";
import { Board } from "./board.ts";

/** How often the drawer's buffered points go out. ~25 msgs/s, smooth enough to watch. */
const FLUSH_MS = 40;
/** Page units a pointer has to move before it's worth a point. */
const MIN_STEP = 2;
/** Last seconds of a drawing that tick. */
const TICK_FROM = 5;

const fine = () => matchMedia("(pointer: fine)").matches;

/** For screen readers; lines up with PALETTE. */
const COLOUR_NAMES = ["white", "silver", "grey", "black", "red", "orange", "yellow", "green", "teal", "blue", "navy", "purple", "pink", "brown", "tan"];

const LETTER_NAMES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "5" or "3 3" (hot dog), how long the answer is. */
function lengths(chars: (string | null)[]): string {
  return chars
    .map((c) => (c === " " ? " " : "x"))
    .join("")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.length)
    .join(" ");
}

export class ScribblView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private board = new Board();
  private root = h("div", { class: "scribbl" });
  private round = h("span", { class: "sb-round" });
  private word = h("div", { class: "sb-word", "aria-live": "polite" });
  private timer = h("span", { class: "sb-timer", role: "timer" });
  private bar = h("div", { class: "sb-bar" });
  private overlay = h("div", { class: "sb-overlay" });
  private tools = h("div", { class: "sb-tools", role: "toolbar", "aria-label": "Drawing tools" });
  private players = h("ul", { class: "sb-players", "aria-label": "Scores" });
  private log = h("ol", { class: "sb-log", "aria-live": "polite", "aria-label": "Chat" });
  private input = h("input", { class: "sb-input", maxlength: MAX_GUESS_LENGTH, autocomplete: "off", enterkeyhint: "send", "aria-label": "Your guess" });
  private send = h("button", { type: "submit", class: "primary sb-send" }, "Send");

  private overlayKey = "";
  private lastLine = -1;
  private chips = new Map<string, HTMLElement>();
  private clock: ReturnType<typeof setInterval>;
  private lastTick = -1;

  // Drawing tools and the stroke in progress.
  private color = 3;
  private size = 1;
  private eraser = false;
  private pointer: number | null = null;
  private last: [number, number] | null = null;
  /** Points drawn locally that haven't gone out yet. */
  private outgoing: DrawOp | null = null;
  private flusher: ReturnType<typeof setInterval> | undefined;

  constructor(api: GameClientApi) {
    this.api = api;
    const form = h("form", { class: "sb-form" }, this.input, this.send);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text || this.input.disabled) return;
      this.api.act({ type: "guess", text });
      this.input.value = "";
    });

    this.root.append(
      h("div", { class: "sb-top" }, this.round, this.word, this.timer),
      h("div", { class: "sb-stage" }, this.board.el, this.bar, this.overlay),
      this.tools,
      h("div", { class: "sb-side" }, this.players, h("div", { class: "sb-chat" }, this.log, form)),
    );

    const c = this.board.el;
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
    this.clock = setInterval(() => this.renderClock(), 250);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    clearInterval(this.clock);
    clearInterval(this.flusher);
    this.board.destroy();
    this.root.remove();
  }

  rejected(_clientActionId: string, message: string) {
    this.log.append(h("li", { class: "sb-line err" }, message));
    this.scrollLog(true);
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  stream(_from: string, data: unknown) {
    const op = parseDrawOp(data);
    if (op && op.turn === this.board.turn) this.board.apply(op);
  }

  update(props: GameViewProps) {
    const game = props.game as ScribblPublicState;
    const prevTurn = this.board.turn;
    if (props.snapshot && props.stream) {
      const snap = props.stream as DrawingSnapshot;
      this.board.reset(snap.turn, snap.strokes, snap.nextId);
    } else if (game.turn !== this.board.turn) {
      this.board.reset(game.turn);
    }
    if (this.board.turn !== prevTurn) this.endStroke();
    this.props = props;
    this.render(props);
    if (!props.snapshot) this.react(props.events as ScribblEvent[], props);
  }

  // ---- rendering ----------------------------------------------------------

  private render(props: GameViewProps) {
    const game = props.game as ScribblPublicState;
    const priv = props.private as ScribblPrivateState | null;
    const canDraw = !!priv?.canDraw;
    this.root.classList.toggle("can-draw", canDraw);
    if (!canDraw && this.pointer !== null) this.endStroke();

    this.round.textContent = `Round ${game.round}/${game.rounds}`;
    this.renderWord(props, game, priv);
    this.renderOverlay(props, game, priv);
    this.renderTools(canDraw);
    this.renderPlayers(props, game);
    this.renderChat(props, priv);
    this.renderClock();

    const typing = document.activeElement === this.input;
    this.input.disabled = !priv?.canChat;
    this.send.disabled = !priv?.canChat;
    this.input.placeholder = !priv
      ? "Watching"
      : !priv.canChat
        ? game.phase === "finished" ? "Game over" : "You're drawing"
        : game.phase === "drawing" && !priv.word ? "Type your guess" : "Say something";
    // Losing the input to `disabled` drops the keyboard; get it back when it's usable again.
    if (typing && !this.input.disabled) this.input.focus();
  }

  private renderWord(props: GameViewProps, game: ScribblPublicState, priv: ScribblPrivateState | null) {
    const drawerName = props.playerId === game.drawerId ? "You" : seatName(props.room, game.drawerId);
    if (game.phase === "drawing" && game.hint) {
      const known = priv?.word;
      const chars = known ? [...known] : game.hint;
      const letters = h(
        "span",
        { class: `sb-letters${known ? " known" : ""}`, "aria-hidden": "true" },
        chars.map((c) => (c === " " ? h("span", { class: "gap" }) : h("span", { class: c ? "l" : "l blank" }, c ?? ""))),
      );
      const count = lengths(game.hint);
      const label = known
        ? `The word is ${known}`
        : `${count.includes(" ") ? `Words of ${count} letters` : `${LETTER_NAMES[Number(count)] ?? count} letters`}`;
      replaceChildren(this.word, h("span", { class: "sb-sr" }, label), letters, h("span", { class: "sb-count", "aria-hidden": "true" }, count));
    } else if (game.phase === "choosing") {
      replaceChildren(this.word, h("span", { class: "muted" }, `${drawerName} ${drawerName === "You" ? "are" : "is"} picking…`));
    } else if (game.word) {
      replaceChildren(this.word, h("span", { class: "sb-letters known revealed" }, game.word));
    } else {
      replaceChildren(this.word);
    }
  }

  private renderOverlay(props: GameViewProps, game: ScribblPublicState, priv: ScribblPrivateState | null) {
    const me = props.playerId;
    const key = `${game.turn}:${game.phase}:${priv?.choices?.join() ?? ""}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    const drawer = props.room.seats.find((s) => s.id === game.drawerId);

    if (game.phase === "choosing") {
      if (priv?.choices) {
        const buttons = priv.choices.map((w, i) =>
          h("button", {
            type: "button",
            class: "sb-choice",
            onclick: () => {
              for (const b of buttons) b.disabled = true;
              this.api.act({ type: "choose", index: i });
            },
          }, w),
        );
        this.showOverlay("choose", h("h2", {}, "Pick a word to draw"), h("div", { class: "sb-choices" }, buttons));
        buttons[0]?.focus({ preventScroll: true });
      } else {
        this.showOverlay(
          "wait",
          drawer ? avatar(drawer.name, drawer.avatarSeed, "lg") : null,
          h("p", {}, h("b", {}, seatName(props.room, game.drawerId)), " is picking a word"),
        );
      }
      return;
    }

    if ((game.phase === "reveal" || game.phase === "finished") && game.word) {
      const why = game.endedBy === "all"
        ? "Everyone got it!"
        : game.endedBy === "left"
          ? `${seatName(props.room, game.drawerId)} left.`
          : game.players.some((p) => p.guessed) ? "Time's up." : "Time's up. Nobody got it.";
      const scored = game.players
        .filter((p) => p.turnPoints)
        .sort((a, b) => b.turnPoints! - a.turnPoints!)
        .map((p) =>
          h("li", {}, h("span", {}, p.id === me ? "You" : seatName(props.room, p.id), p.id === game.drawerId ? h("span", { class: "muted" }, " (drew)") : null), h("b", {}, `+${p.turnPoints}`)),
        );
      this.showOverlay(
        "reveal",
        h("p", { class: "muted" }, "The word was"),
        h("h2", { class: "sb-answer" }, game.word),
        h("p", { class: "muted" }, why),
        scored.length ? h("ul", { class: "sb-scored" }, scored) : null,
      );
      return;
    }
    this.showOverlay(null);
  }

  private showOverlay(kind: string | null, ...children: (Node | null)[]) {
    this.overlay.className = kind ? `sb-overlay show ${kind}` : "sb-overlay";
    replaceChildren(this.overlay, kind ? h("div", { class: "sb-card" }, children) : null);
  }

  private renderTools(canDraw: boolean) {
    this.tools.hidden = !canDraw;
    if (!canDraw) return;
    const swatches = PALETTE.map((hex, i) =>
      i === PAPER
        ? null
        : h("button", {
            type: "button",
            class: "sb-swatch",
            style: `--c: ${hex}`,
            "aria-label": COLOUR_NAMES[i],
            "aria-pressed": String(!this.eraser && this.color === i),
            onclick: () => {
              this.color = i;
              this.eraser = false;
              this.renderTools(true);
            },
          }),
    );
    const sizes = SIZES.map((px, i) =>
      h("button", {
        type: "button",
        class: "sb-size",
        "aria-label": `Brush size ${i + 1}`,
        "aria-pressed": String(this.size === i),
        onclick: () => {
          this.size = i;
          this.renderTools(true);
        },
      }, h("span", { style: `--d: ${Math.max(4, Math.round(px * 0.55))}px; --c: ${this.eraser ? "#fff" : PALETTE[this.color]}` })),
    );
    replaceChildren(
      this.tools,
      h("div", { class: "sb-palette" }, swatches),
      h(
        "div",
        { class: "sb-tool-row" },
        sizes,
        h("button", { type: "button", class: "sb-tool", "aria-pressed": String(this.eraser), onclick: () => ((this.eraser = !this.eraser), this.renderTools(true)) }, "Eraser"),
        h("button", { type: "button", class: "sb-tool", onclick: () => this.command("undo") }, "Undo"),
        h("button", { type: "button", class: "sb-tool danger", onclick: () => this.command("clear") }, "Clear"),
      ),
    );
  }

  private renderPlayers(props: GameViewProps, game: ScribblPublicState) {
    const me = props.playerId;
    this.chips.clear();
    replaceChildren(
      this.players,
      game.players
        .filter((p) => !p.removed)
        .map((p) => {
          const seat = props.room.seats.find((s) => s.id === p.id);
          const drawing = p.id === game.drawerId && game.phase !== "finished";
          const away = seat && seat.presence !== "connected";
          const li = h(
            "li",
            { class: `sb-player${drawing ? " drawer" : ""}${p.guessed ? " guessed" : ""}${away ? " away" : ""}${p.id === me ? " me" : ""}` },
            seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
            h("span", { class: "name" }, p.id === me ? "You" : seatName(props.room, p.id)),
            drawing ? h("span", { class: "tag" }, "drawing") : p.guessed ? h("span", { class: "tag" }, "got it") : null,
            h("span", { class: "score" }, String(p.score)),
          );
          this.chips.set(p.id, li);
          return li;
        }),
    );
  }

  private renderChat(props: GameViewProps, priv: ScribblPrivateState | null) {
    const lines = priv?.chat ?? [];
    const lastId = lines.at(-1)?.id ?? -1;
    if (lastId === this.lastLine) return;
    const mine = lines.at(-1)?.playerId === props.playerId;
    const stick = this.nearBottom();
    this.lastLine = lastId;
    replaceChildren(this.log, lines.map((l) => this.line(l, props)));
    this.scrollLog(stick || mine);
  }

  private line(l: ChatLine, props: GameViewProps): HTMLElement {
    const who = l.playerId === props.playerId ? "You" : seatName(props.room, l.playerId);
    const b = (s: string) => h("b", {}, s);
    switch (l.kind) {
      case "msg":
        return h("li", { class: "sb-line" }, b(who), " ", l.text);
      case "secret":
        return h("li", { class: "sb-line secret" }, b(who), " ", l.text);
      case "guessed":
        return h("li", { class: "sb-line good" }, b(who), l.playerId === props.playerId ? " got it!" : " guessed the word!");
      case "close":
        return h("li", { class: "sb-line close" }, `“${l.text}” is close!`);
      case "drawing":
        return h("li", { class: "sb-line info" }, b(who), l.playerId === props.playerId ? " are drawing now." : " is drawing now.");
      case "word":
        return h("li", { class: "sb-line info" }, "The word was ", b(l.text), ".");
      case "missed":
        return h("li", { class: "sb-line info" }, b(who), " is away and misses their turn.");
    }
  }

  private nearBottom(): boolean {
    return this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 48;
  }

  private scrollLog(force: boolean) {
    if (force) this.log.scrollTop = this.log.scrollHeight;
  }

  private renderClock() {
    const game = this.props?.game as ScribblPublicState | undefined;
    if (!game || game.phase === "finished" || !game.phaseMs) {
      this.timer.textContent = "";
      this.bar.style.transform = "scaleX(0)";
      return;
    }
    const left = Math.max(0, game.endsAt - this.api.serverNow());
    const secs = Math.ceil(left / 1000);
    this.timer.textContent = String(secs);
    this.timer.classList.toggle("low", game.phase === "drawing" && secs <= 10);
    this.bar.style.transform = `scaleX(${Math.min(1, left / game.phaseMs)})`;
    this.bar.classList.toggle("low", game.phase === "drawing" && secs <= 10);
    if (game.phase === "drawing" && secs > 0 && secs <= TICK_FROM && secs !== this.lastTick) {
      this.lastTick = secs;
      audio.play("tick");
    }
  }

  // ---- what just happened -------------------------------------------------

  private react(events: ScribblEvent[], props: GameViewProps) {
    const me = props.playerId;
    for (const e of events) {
      switch (e.type) {
        case "turn-started":
          this.lastTick = -1;
          if (e.drawerId === me) {
            audio.play("your-turn");
            audio.buzz(25);
          }
          break;
        case "drawing":
          // Guessers on a keyboard can start typing straight away.
          if (e.drawerId !== me && fine() && !this.input.disabled) this.input.focus({ preventScroll: true });
          break;
        case "guessed": {
          audio.play("correct");
          if (e.playerId === me) audio.buzz([20, 40, 20]);
          const chip = this.chips.get(e.playerId);
          if (chip && motionAllowed()) void bubble(chip, `+${e.points}`);
          break;
        }
        case "close":
          audio.play("nudge");
          break;
        case "hint":
          audio.play("deal");
          break;
        case "turn-ended":
          audio.play(e.by === "all" ? "card-place" : "pass");
          break;
        case "game-over": {
          const won = !!props.room.result?.winnerIds.includes(me);
          audio.play(won ? "win" : "game-over");
          if (won) audio.buzz([40, 60, 40, 60, 90]);
          break;
        }
        default:
          break;
      }
    }
  }

  // ---- drawing input (§35) ------------------------------------------------

  private canDraw(): boolean {
    return !!(this.props?.private as ScribblPrivateState | null)?.canDraw;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.canDraw() || this.pointer !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (this.board.spent >= MAX_POINTS) return;
    e.preventDefault();
    try {
      // Keeps the stroke going if the pen drifts off the page. Nice, not needed.
      this.board.el.setPointerCapture(e.pointerId);
    } catch {
      // No such live pointer (synthetic events); draw anyway.
    }
    this.pointer = e.pointerId;
    const [x, y] = this.board.toPage(e);
    this.last = [x, y];
    const op: DrawOp = { turn: this.board.turn, op: "start", id: this.board.nextId, color: this.eraser ? PAPER : this.color, size: this.size, points: [x, y] };
    this.board.apply(op);
    this.outgoing = { ...op, points: [x, y] };
    this.flusher ??= setInterval(() => this.flush(), FLUSH_MS);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointer || !this.last) return;
    const id = this.board.nextId - 1;
    const fresh: number[] = [];
    // Coalesced events: the in-between points a fast stroke would otherwise skip.
    const coalesced = e.getCoalescedEvents?.() ?? [];
    for (const pe of coalesced.length ? coalesced : [e]) {
      const [x, y] = this.board.toPage(pe);
      if (Math.hypot(x - this.last[0], y - this.last[1]) < MIN_STEP) continue;
      if (this.board.spent + fresh.length / 2 >= MAX_POINTS) break;
      fresh.push(x, y);
      this.last = [x, y];
    }
    if (!fresh.length) return;
    this.board.apply({ turn: this.board.turn, op: "add", id, points: fresh });
    if (this.outgoing?.op === "start" || this.outgoing?.op === "add") this.outgoing.points.push(...fresh);
    else this.outgoing = { turn: this.board.turn, op: "add", id, points: fresh };
    if ((this.outgoing.op === "start" || this.outgoing.op === "add") && this.outgoing.points.length >= MAX_CHUNK - 64) this.flush();
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointer) return;
    this.endStroke();
  };

  /** Lifts the pen: whatever's buffered goes out, and the flush loop stops. */
  private endStroke() {
    this.flush();
    this.pointer = null;
    this.last = null;
    clearInterval(this.flusher);
    this.flusher = undefined;
  }

  private flush() {
    const op = this.outgoing;
    this.outgoing = null;
    if (!op) return;
    // Big strokes go out in pieces the server will take.
    if ((op.op === "start" || op.op === "add") && op.points.length > MAX_CHUNK) {
      const head = op.points.slice(0, MAX_CHUNK);
      this.api.stream({ ...op, points: head });
      for (let i = MAX_CHUNK; i < op.points.length; i += MAX_CHUNK) {
        this.api.stream({ turn: op.turn, op: "add", id: op.id, points: op.points.slice(i, i + MAX_CHUNK) });
      }
      return;
    }
    this.api.stream(op);
  }

  private command(kind: "undo" | "clear") {
    if (!this.canDraw() || !this.board.strokes.length) return;
    this.endStroke();
    const op: DrawOp = { turn: this.board.turn, op: kind };
    this.board.apply(op);
    this.api.stream(op);
  }
}
