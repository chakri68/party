import { AnimationQueue, bubble } from "@games/animation";
import { audio } from "@games/audio";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { effectiveCluster, normalizeWord, parseTyping, shapeProblem } from "../shared/rules.ts";
import {
  CATEGORY_LABELS,
  LENGTH_MAX,
  LENGTH_MIN,
  MAX_WORD,
  type PassTheBombEvent,
  type PassTheBombPrivateState,
  type PassTheBombPublicState,
  type VoteChoice,
} from "../shared/types.ts";
import { bombEl, burstEl } from "./bomb.ts";

type Pub = PassTheBombPublicState;

/** How long the bang plays before the table settles on it. */
const BOOM_ANIM_MS = 900;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** What the word needs, worked out from what the bomb shows. */
const needs = (game: Pub) => effectiveCluster(game.cluster, game.modes);

/** "an animal ending in GNI, backwards": what the holder's after, as the bomb puts it. */
function ask(game: Pub): string {
  const what = game.category ? `a word from ${CATEGORY_LABELS[game.category].toUpperCase()}` : "a word";
  const where = game.modes.ending ? "ending in" : "with";
  const backwards = game.modes.reverse ? " backwards" : "";
  const size = game.modes.length ? `, ${LENGTH_MIN}–${LENGTH_MAX} letters` : "";
  return `${what} ${where} ${game.cluster.toUpperCase()}${backwards}${size}`;
}

/** "Allow: Sam, You · Reject: Kit" */
function voteLine(votes: Record<string, VoteChoice>, name: (id: string) => string): string {
  const by = (c: VoteChoice) => Object.keys(votes).filter((id) => votes[id] === c).map(name);
  const allow = by("allow");
  const rej = by("reject");
  return [allow.length ? `Allow: ${allow.join(", ")}` : "", rej.length ? `Reject: ${rej.join(", ")}` : ""].filter(Boolean).join(" · ") || "Nobody voted";
}

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
  private category = h("span", { class: "pb-category" });
  private modes = h("p", { class: "pb-modes", "aria-label": "Modes" });
  private voteWord = h("p", { class: "pb-vote-word" });
  private voteBy = h("p", { class: "pb-vote-by" });
  private voteBar = h("div", { class: "pb-vote-bar", "aria-hidden": "true" }, h("span"));
  private voteCount = h("p", { class: "pb-vote-count", "aria-live": "polite" });
  private allowBtn = h("button", { type: "button", class: "pb-vote-allow" }, "Allow");
  private rejectBtn = h("button", { type: "button", class: "pb-vote-reject" }, "Reject");
  private voteButtons = h("div", { class: "pb-vote-buttons" }, this.allowBtn, this.rejectBtn);
  private voteWait = h("p", { class: "pb-vote-wait" }, "The room is deciding");
  private voteCard = h(
    "section",
    { class: "pb-vote", role: "dialog", "aria-label": "Room vote" },
    h("p", { class: "pb-vote-title" }, "Is this a word?"),
    this.voteWord,
    this.voteBy,
    this.voteBar,
    this.voteButtons,
    this.voteWait,
    this.voteCount,
  );
  private verdict = h("p", { class: "pb-verdict" });
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
  /** The ballot the bar is running for. */
  private voteId = -1;
  private clock: ReturnType<typeof setInterval>;

  constructor(api: GameClientApi) {
    this.api = api;
    this.stage.append(this.bomb, this.burst, this.cluster, this.category);
    this.voteCard.hidden = true;
    this.root.append(
      h("div", { class: "pb-top" }, this.round, this.used),
      this.modes,
      this.stage,
      this.voteCard,
      this.status,
      this.typing,
      this.form,
      this.note,
      this.last,
      this.verdict,
      this.players,
    );
    this.allowBtn.addEventListener("click", () => this.vote("allow"));
    this.rejectBtn.addEventListener("click", () => this.vote("reject"));
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
    this.showTyping(t.text, needs(game));
    if (t.wrong) replay(this.typing, "shake");
  }

  update(props: GameViewProps) {
    const events = props.events as PassTheBombEvent[];
    if (props.snapshot || !this.props) {
      this.queue.clear();
      const t = parseTyping(props.stream);
      this.settle(props);
      const game = props.game as Pub;
      if (t && t.turn === game.turn && !this.holding()) this.showTyping(t.text, needs(game));
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
    this.showTyping(text, needs(game));
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
    const problem = shapeProblem(word, needs(game), game.modes);
    if (problem) return this.bounce(problem);
    this.pending = this.api.act({ type: "word", text: word });
  }

  private vote(choice: VoteChoice) {
    const game = this.props?.game as Pub | undefined;
    if (!game?.vote) return;
    this.api.act({ type: "vote", ballot: game.vote.id, choice });
    // Lit straight away; the next update confirms it.
    this.allowBtn.setAttribute("aria-pressed", String(choice === "allow"));
    this.rejectBtn.setAttribute("aria-pressed", String(choice === "reject"));
    audio.buzz(15);
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
      this.showTyping("", needs(game));
    }
    // Once it's gone off, whatever they were typing went with it.
    if (game.phase === "boom" || game.phase === "finished") this.showTyping("", needs(game));

    this.round.textContent = `Round ${game.round}`;
    this.used.textContent = `${game.usedCount} ${game.usedCount === 1 ? "word" : "words"} played`;

    const boom = game.phase !== "live" && !!game.blownId;
    this.stage.classList.toggle("boom", boom);
    this.stage.classList.toggle("mine", holding);
    this.bomb.hidden = boom;
    this.burst.hidden = !boom;
    this.cluster.hidden = boom || game.phase === "finished";
    this.cluster.textContent = game.cluster.toUpperCase();
    this.category.hidden = this.cluster.hidden || !game.category;
    this.category.textContent = game.category ? CATEGORY_LABELS[game.category] : "";
    replaceChildren(
      this.modes,
      [
        game.modes.ending ? "End" : null,
        game.modes.reverse ? "Backwards" : null,
        game.modes.length ? `${LENGTH_MIN}–${LENGTH_MAX} letters` : null,
        game.modes.category ? "Category" : null,
      ].filter((m): m is string => !!m).map((m) => h("span", { class: "pb-mode" }, m)),
    );
    this.modes.hidden = !this.modes.childElementCount;

    const holder = game.holderId === me ? "You" : seatName(props.room, game.holderId);
    if (game.phase === "vote") {
      this.status.textContent = "The room's deciding";
    } else if (game.phase === "live") {
      this.status.textContent = holding ? `Your go: ${ask(game)}` : `${holder} has it`;
    } else if (game.blownId) {
      const who = game.blownId === me ? "You" : seatName(props.room, game.blownId);
      const left = game.players.find((p) => p.id === game.blownId)?.lives ?? 0;
      this.status.textContent = left > 0
        ? `Boom. ${who} ${who === "You" ? "lose" : "loses"} a life`
        : `Boom. ${who} ${who === "You" ? "are" : "is"} out`;
    } else {
      this.status.textContent = "";
    }

    this.renderVote(props, game);
    const lv = game.lastVote;
    const name = (id: string) => (id === me ? "You" : seatName(props.room, id));
    replaceChildren(
      this.verdict,
      lv && game.phase !== "finished"
        ? [`The room ${lv.allowed ? "allowed" : "rejected"} `, h("b", {}, lv.word.toUpperCase()), `. ${voteLine(lv.votes, name)}`]
        : null,
    );
    this.verdict.classList.toggle("no", !!lv && !lv.allowed);

    const lw = game.lastWord;
    replaceChildren(
      this.last,
      lw ? [lw.playerId === me ? "You" : seatName(props.room, lw.playerId), " played ", h("b", {}, lw.word.toUpperCase())] : null,
    );

    // Out, watching, or it's over: no keyboard. Otherwise it stays up between
    // turns, so the phone's keyboard doesn't bounce every time the bomb moves.
    const typing = document.activeElement === this.input;
    this.form.hidden = !inGame || game.phase === "finished" || game.phase === "vote";
    this.input.placeholder = holding
      ? `Something ${game.modes.ending ? "ending in" : "with"} ${game.cluster.toUpperCase()}${game.modes.reverse ? " backwards" : ""}`
      : game.phase === "live" ? "Wait for the bomb" : "Next round's coming";
    this.send.disabled = !holding;
    this.root.classList.toggle("holding", holding);
    if (typing && !this.form.hidden) this.input.focus({ preventScroll: true });

    this.renderPlayers(props, game);
  }

  /** The card over the table while the room decides: buttons for voters, a wait for everyone else. */
  private renderVote(props: GameViewProps, game: Pub) {
    const v = game.phase === "vote" ? game.vote : null;
    const priv = props.private as PassTheBombPrivateState | null;
    this.voteCard.hidden = !v;
    this.root.classList.toggle("voting", !!v);
    if (!v) {
      this.voteId = -1;
      return;
    }
    const me = props.playerId;
    this.voteWord.textContent = v.word.toUpperCase();
    this.voteBy.textContent = `${v.by === me ? "You" : seatName(props.room, v.by)} played it. Not in the ${game.category ? `${CATEGORY_LABELS[game.category].toLowerCase()} list` : "dictionary"}.`;
    this.voteCount.textContent = `${v.voted.length} of ${v.voters.length} voted`;
    const canVote = !!priv?.canVote;
    this.voteButtons.hidden = !canVote;
    this.voteWait.hidden = canVote;
    this.voteWait.textContent = v.by === me ? "The room is deciding on yours" : "The room is deciding";
    this.allowBtn.setAttribute("aria-pressed", String(priv?.myVote === "allow"));
    this.rejectBtn.setAttribute("aria-pressed", String(priv?.myVote === "reject"));
    if (v.id !== this.voteId) {
      // The bar drains over whatever's left by the server's clock.
      this.voteId = v.id;
      const left = Math.max(0, Math.min(v.ms, v.deadline - this.api.serverNow()));
      const bar = this.voteBar.firstElementChild as HTMLElement;
      bar.style.setProperty("--left", `${left}ms`);
      bar.style.setProperty("--from", String(left / v.ms));
      replay(bar, "run");
    }
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
          // An allowed word already got its sound from the vote.
          if (!(e.type === "passed" && e.voted)) audio.play(e.type === "passed" ? "correct" : "pass");
          if (e.to === me) this.yourGo();
          break;
        case "left":
          if (e.to === me) this.yourGo();
          break;
        case "vote-opened": {
          const priv = props.private as PassTheBombPrivateState | null;
          audio.play(priv?.canVote ? "nudge" : "pass");
          if (priv?.canVote) audio.buzz([20, 40, 20]);
          break;
        }
        case "vote-closed":
          audio.play(e.allowed ? "correct" : "reject");
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
