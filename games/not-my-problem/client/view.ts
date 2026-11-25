import { audio } from "@games/audio";
import { countdown, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { ACTION_TEXT, PROBLEM_TEXT } from "../shared/cards.ts";
import type { ActionCard, NmpEvent, NmpPrivateState, NmpPublicState } from "../shared/types.ts";
import { actionIcon, cardFace, handCard, playWhen, problemIcon, timingLabel } from "./cards.ts";
import { nextFeed, type FeedMemo } from "./feed.ts";
import { PICK_VERB, cardMove, needsFor } from "./moves.ts";
import { namesFor, promptModel, renderPrompt, type PromptButton } from "./prompts.ts";
import { rulesSheet } from "./rules.ts";
import { renderSeats, type SeatPick } from "./seats.ts";

/** The last seconds tick for whoever the clock is running on. */
const TICK_FROM = 3;
/** A refused move's message stays in the feed this long. */
const REJECT_MS = 3000;
/** A card shown by a challenge stays in the middle this long. */
const REVEAL_MS = 2000;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * A card picked in the hand. "look": the detail sheet is open. "seat" /
 * "face-down": Play was pressed and it waits on a pick, then Confirm. Tied to
 * the token it was made under: any new step forgets it.
 */
interface Selection {
  token: number;
  cardId: string;
  mode: "look" | "seat" | "face-down";
  picked: string | null;
}

export class NotMyProblemView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "nmp" });
  private top = h("div", { class: "nmp-top" });
  private roundEl = h("span", { class: "nmp-round" });
  private pileEl = h("span", { class: "nmp-pile" });
  private turnEl = h("span", { class: "nmp-turn", role: "status", "aria-live": "polite" });
  private timer = countdown();
  private seats = h("div", { class: "nmp-seats", role: "list", "aria-label": "Players" });
  private table = h("div", { class: "nmp-table", role: "group", "aria-label": "Table" });
  /** The card a challenge showed, over the table for a moment. */
  private revealEl = h("div", { class: "nmp-reveal", hidden: true, "aria-hidden": "true" });
  private reveal: { timer: ReturnType<typeof setTimeout>; done: Promise<void>; end: () => void } | null = null;
  private rulesBtn = h("button", { type: "button", class: "link nmp-rules-btn", onclick: () => this.rules.open() }, "Rules");
  private rules = rulesSheet(() => this.rulesBtn.focus());
  private feed = h("p", { class: "nmp-feed", "aria-live": "polite" });
  /** The window prompts (target, HR, challenge) render here, above the hand. */
  private prompt = h("div", { class: "nmp-prompt", hidden: true });
  /** Redrawn only when this changes, so focus and screen readers aren't disturbed every tick. */
  private promptKey = "";
  private promptTimer = countdown();
  private promptBar = h("div", { class: "nmp-bar", "aria-hidden": "true" }, h("span"));
  private hand = h("div", { class: "nmp-hand", role: "group", "aria-label": "Your hand" });
  private panel = h("div", { class: "nmp-panel" });

  private cards = new Map<string, HTMLButtonElement>();
  private selection: Selection | null = null;
  /** Sent and not yet answered: buttons stay locked meanwhile. */
  private pending = new Set<string>();
  /** My private state as last seen: a change in it is the server's answer to what I sent. */
  private privKey = "";
  private feedMemo: FeedMemo | null = null;
  private flash: { text: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private wasMine = false;
  /**
   * Where keyboard focus belongs after a redraw, as a selector. Seats and the
   * panel are rebuilt on each render, so the focused button is replaced: this
   * puts focus on its replacement (or on the next thing to press). It lasts
   * while a sent move waits, then for one render: it never jumps later.
   */
  private focusWant: string | null = null;
  /** A move that says where focus goes next (Confirm after a pick). Wins over focusWant. */
  private focusNext: string | null = null;
  /** Where Cancel sends focus, when the pick started from a prompt button. */
  private cancelFocus: string | null = null;
  private lastTick = -1;
  /** A new deadline starts a new set of ticks. */
  private tickDeadline: number | null = null;
  private clock: ReturnType<typeof setInterval>;

  constructor(api: GameClientApi) {
    this.api = api;
    this.top.append(h("span", { class: "nmp-where" }, this.roundEl, this.pileEl), this.turnEl, this.timer.el, this.rulesBtn);
    this.root.append(
      this.top,
      this.seats,
      h("div", { class: "nmp-center" }, this.table, this.revealEl),
      this.feed,
      h("div", { class: "nmp-dock" }, this.prompt, this.hand, this.panel),
      this.rules.el,
    );
    this.clock = setInterval(() => this.renderClock(), 200);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    clearInterval(this.clock);
    if (this.flash) clearTimeout(this.flash.timer);
    this.reveal?.end();
    this.rules.close();
    this.root.remove();
  }

  /** The shell waits on this before the results cover the table: a challenge's card stays in view. */
  whenIdle(): Promise<void> {
    return this.reveal?.done ?? Promise.resolve();
  }

  rejected(clientActionId: string, message: string) {
    if (this.pending.delete(clientActionId)) {
      this.hand.classList.remove("shake");
      void this.hand.offsetWidth; // restart the animation
      this.hand.classList.add("shake");
    }
    if (this.flash) clearTimeout(this.flash.timer);
    this.flash = {
      text: message,
      timer: setTimeout(() => {
        this.flash = null;
        // Reduced motion shows the shake as an outline: no animationend clears it.
        this.hand.classList.remove("shake");
        this.renderFeed();
      }, REJECT_MS),
    };
    this.rerender();
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    // Every move I can send changes my private state (a new token, a card
    // gone, a pass noted), so that change is the answer: unlock. Other
    // updates (someone's seat, someone else's pass) keep the lock.
    const privKey = JSON.stringify(props.private);
    if (privKey !== this.privKey) this.pending.clear();
    this.privKey = privKey;
    const game = props.game as NmpPublicState;
    const events = props.events as NmpEvent[];
    const first = !this.props;
    this.feedMemo = nextFeed(game.lastEvent, events, props, this.feedMemo);
    // A reconnect or a first look: show it as it is, no sounds or slides.
    const quiet = props.snapshot || first;
    this.render(props, !quiet);
    if (!quiet) {
      this.eventSounds(events, props);
      const shown = events.findLast((e) => e.type === "challenged");
      if (shown && !reducedMotion()) this.showReveal(shown, props);
    }
  }

  // ---- render ---------------------------------------------------------------

  private render(props: GameViewProps, fresh: boolean) {
    this.props = props;
    this.noteFocus();
    const game = props.game as NmpPublicState;
    const priv = props.private as NmpPrivateState | null;
    const me = props.playerId;
    const myTurn = !!priv?.canDraw;
    const myProblem = game.step === "problem" && game.problem?.ownerId === me && !!priv?.canAccept;
    const myTarget = game.step === "target" && !!priv?.canAccept;
    const mine = myTurn || myProblem || myTarget;

    // A new step (or a card that left the hand) forgets the pick.
    const sel = this.selection;
    if (sel && (sel.token !== priv?.token || !priv.hand.some((c) => c.id === sel.cardId))) this.selection = null;

    this.root.classList.toggle("my-turn", mine);
    this.root.classList.toggle("finished", game.step === "finished");

    this.api.setTurn(
      myTurn ? "Your turn"
      : myProblem ? "Fix your Problem"
      : myTarget ? "Answer the pass"
      : null,
    );

    this.renderTop(props, game, myProblem, myTarget);
    renderSeats(this.seats, props, game, this.seatPick(priv));
    this.renderTable(props, game);
    this.renderFeed();
    const seated = game.players.some((p) => p.id === me && !p.fired && !p.removed);
    this.renderPrompt(props, game, priv);
    this.renderHand(priv, fresh);
    // Fired, left or watching with nothing in hand: no empty hand row.
    this.hand.hidden = !seated && !priv?.hand.length;
    this.renderPanel(props, game, priv);
    this.renderClock();
    this.restoreFocus();

    if (fresh && mine && !this.wasMine) {
      audio.play("your-turn");
      audio.buzz(25);
    }
    this.wasMine = mine;
  }

  private rerender() {
    if (this.props) this.render(this.props, false);
  }

  /** Remembers the focused control, by its stable key, before a redraw. */
  private noteFocus() {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return; // lost in an earlier redraw: keep the old wish
    if (!this.root.contains(el)) {
      this.focusWant = null; // the player moved on (chat, menu): leave them there
      return;
    }
    const key = el.dataset.focus ? `[data-focus="${CSS.escape(el.dataset.focus)}"]` : el.dataset.card ? `[data-card="${CSS.escape(el.dataset.card)}"]` : null;
    this.focusWant = key;
  }

  private restoreFocus() {
    const next = this.focusNext;
    this.focusNext = null;
    const cur = document.activeElement;
    const lost = !cur || cur === document.body || !cur.isConnected;
    const want = next ?? (lost ? this.focusWant : null);
    if (want) {
      // A button that is gone (Confirm after it was sent): the next button to press instead,
      // in the prompt first, then the panel.
      const el =
        this.root.querySelector<HTMLElement>(want) ??
        (want.startsWith('[data-focus="act')
          ? (this.prompt.querySelector<HTMLElement>("button[data-focus]:not(:disabled)") ??
            this.panel.querySelector<HTMLElement>("button[data-focus]:not(:disabled)"))
          : null);
      if (el && !(el as HTMLButtonElement).disabled) {
        el.focus({ preventScroll: true });
        this.focusWant = null;
      }
    }
    // Only a move still waiting on its answer keeps the wish for a later render.
    if (!this.pending.size) this.focusWant = null;
  }

  private eventSounds(events: NmpEvent[], props: GameViewProps) {
    const me = props.playerId;
    for (const e of events) {
      if (e.type === "played" || e.type === "report") audio.play("card-place");
      else if (e.type === "drew") audio.play(e.problem ? "nudge" : "deal");
      else if (e.type === "fixed") audio.play("correct");
      else if (e.type === "challenged") audio.play(e.lied ? "boom" : "nudge");
      else if (e.type === "warned" && e.playerId === me && e.amount > 0) audio.buzz([50, 40, 50]);
      else if (e.type === "game-over") {
        const won = e.winnerIds.includes(me);
        audio.play(won ? "win" : "game-over");
        if (won) audio.buzz([40, 60, 40, 60, 90]);
      }
    }
  }

  private renderTop(props: GameViewProps, game: NmpPublicState, myProblem: boolean, myTarget: boolean) {
    this.top.hidden = game.step === "finished";
    this.roundEl.textContent = `Round ${game.round}`;
    this.pileEl.textContent = `${plural(game.drawCount, "card")} left`;
    this.pileEl.setAttribute("aria-label", `${plural(game.drawCount, "card")} left in the draw pile`);
    const id = game.turnPlayerId;
    // The clock runs on whoever must act: on a Problem passed to me, that's me.
    this.turnEl.textContent =
      myProblem ? "Your Problem"
      : myTarget ? "Passed to you"
      : !id ? ""
      : id === props.playerId ? "Your turn"
      : `${seatName(props.room, id)}'s turn`;
  }

  private renderClock() {
    const props = this.props;
    const game = props?.game as NmpPublicState | undefined;
    if (!props || !game || game.deadline === null || game.step === "finished") {
      this.timer.set(null);
      return;
    }
    const paused = props.room.paused;
    const left = Math.max(0, game.deadline - this.api.serverNow());
    this.timer.set(left, { paused, lowAt: 5_000 });
    if (!this.prompt.hidden) {
      this.promptTimer.set(left, { paused, lowAt: 3_000 });
      // Paused: the bar stays where it stopped (the deadline only moves on Resume).
      if (!paused) {
        const share = game.windowMs ? Math.min(1, left / game.windowMs) : 0;
        (this.promptBar.firstElementChild as HTMLElement).style.transform = `scaleX(${share})`;
      }
    }
    const secs = Math.ceil(left / 1000);
    if (game.deadline !== this.tickDeadline) {
      this.tickDeadline = game.deadline;
      this.lastTick = -1;
    }
    const mine = this.root.classList.contains("my-turn");
    if (mine && !paused && secs > 0 && secs <= TICK_FROM && secs !== this.lastTick) {
      this.lastTick = secs;
      audio.play("tick");
    }
  }

  /** The active Problem, big: what it is, who holds it, what it costs, the tries left. */
  private renderTable(props: GameViewProps, game: NmpPublicState) {
    const p = game.step === "finished" ? null : game.problem;
    // Redrawn only when it changes, so the card slides in once per move.
    const key = p ? `${p.cardId}:${p.ownerId}:${p.attemptsLeft}` : game.step === "finished" ? "over" : "none";
    if (this.table.dataset.key === key) return;
    this.table.dataset.key = key;
    this.table.classList.toggle("empty", !p);
    if (!p) {
      replaceChildren(this.table, h("p", { class: "nmp-no-problem" }, game.step === "finished" ? "The game is over." : "No Problem right now."));
      return;
    }
    const text = PROBLEM_TEXT[p.kind];
    const holder = p.ownerId === props.playerId ? "You hold it." : `${seatName(props.room, p.ownerId)} holds it.`;
    const tries =
      p.attemptsLeft <= 0 ? "It can't be passed on now."
      : `${p.attemptsLeft} ${p.attemptsLeft === 1 ? "try" : "tries"} left to pass it on.`;
    replaceChildren(
      this.table,
      h(
        "div",
        { class: `nmp-problem k-${p.kind}`, role: "group", "aria-label": `Problem: ${text.name}. ${text.line} ${holder} ${tries}` },
        problemIcon(p.kind),
        h(
          "div",
          { class: "nmp-problem-text", "aria-hidden": "true" },
          h("span", { class: "nmp-label" }, "Problem"),
          h("span", { class: "nmp-problem-name" }, text.name),
          h("span", { class: "nmp-problem-line" }, text.line),
          h("span", { class: "nmp-problem-owner" }, holder),
          h("span", { class: "nmp-problem-tries" }, tries),
        ),
      ),
    );
  }

  private renderFeed() {
    this.feed.classList.toggle("flash", !!this.flash);
    this.feed.textContent = this.flash?.text ?? this.feedMemo?.text ?? "";
  }

  /** The target, HR and challenge windows: who played what, what it will do, the answers. */
  private renderPrompt(props: GameViewProps, game: NmpPublicState, priv: NmpPrivateState | null) {
    const model = promptModel(game, priv, props.playerId, namesFor(props));
    const picking = this.selection?.mode === "seat";
    const locked = this.pending.size > 0;
    const key = model ? JSON.stringify([game.token, model, picking, locked]) : "";
    this.prompt.hidden = !model;
    if (key === this.promptKey) return;
    this.promptKey = key;
    if (!model) {
      this.prompt.replaceChildren();
      return;
    }
    renderPrompt(this.prompt, model, {
      locked,
      picking,
      timer: this.promptTimer.el,
      bar: this.promptBar,
      onButton: (b) => this.onPromptButton(b),
    });
  }

  private onPromptButton(b: PromptButton) {
    const priv = this.props?.private as NmpPrivateState | null | undefined;
    if (!priv) return;
    if (b.pickCardId) {
      this.startPick(priv, b.pickCardId, "seat");
      this.cancelFocus = `[data-focus="act:${b.key}"]`;
    }
    else if (b.action) this.send(b.action);
  }

  /** The card a challenge showed, in the middle of the table for a moment. */
  private showReveal(e: Extract<NmpEvent, { type: "challenged" }>, props: GameViewProps) {
    this.reveal?.end();
    const owner = e.ownerId === props.playerId ? "Your" : `${seatName(props.room, e.ownerId)}'s`;
    replaceChildren(
      this.revealEl,
      h("span", { class: "nmp-label" }, `${owner} face-down card`),
      cardFace(e.card.kind),
      h("span", { class: `nmp-verdict ${e.lied ? "lie" : "true"}` }, e.lied ? "Not a Quick Fix" : "A real Quick Fix"),
    );
    this.revealEl.hidden = false;
    let end!: () => void;
    const done = new Promise<void>((resolve) => {
      end = () => {
        clearTimeout(timer);
        this.revealEl.hidden = true;
        this.reveal = null;
        resolve();
      };
    });
    const timer = setTimeout(() => end(), REVEAL_MS);
    this.reveal = { timer, done, end };
  }

  // ---- hand -----------------------------------------------------------------

  private renderHand(priv: NmpPrivateState | null, fresh: boolean) {
    const hand = priv?.hand ?? [];
    const keep = new Set(hand.map((c) => c.id));
    for (const [id, btn] of this.cards) {
      if (!keep.has(id)) {
        btn.remove();
        this.cards.delete(id);
      }
    }
    const playable = new Set(priv?.playable.map((p) => p.cardId) ?? []);
    const sel = this.selection;
    const facePick = sel?.mode === "face-down";
    hand.forEach((card, i) => {
      let btn = this.cards.get(card.id);
      if (!btn) {
        btn = this.handButton(card);
        if (fresh) btn.classList.add("fresh");
      }
      const selected = sel?.cardId === card.id;
      const canPickDown = facePick && card.id !== sel!.cardId;
      const now = playable.has(card.id);
      btn.classList.toggle("selected", selected);
      btn.classList.toggle("playable", now);
      btn.classList.toggle("pick", canPickDown);
      btn.classList.toggle("picked", facePick && sel!.picked === card.id);
      btn.setAttribute("aria-pressed", String(selected || (facePick && sel!.picked === card.id)));
      const name = ACTION_TEXT[card.kind].name;
      btn.setAttribute(
        "aria-label",
        canPickDown ? `Put ${name} face down` : `${name}. ${ACTION_TEXT[card.kind].line}${now ? " You can play it now." : ""}`,
      );
      const tagEl = btn.querySelector(".nmp-card-when");
      if (tagEl) tagEl.textContent = canPickDown ? "Pick" : now ? "Play now" : timingLabel(card.kind);
      if (this.hand.children[i] !== btn) this.hand.insertBefore(btn, this.hand.children[i] ?? null);
    });
    if (!hand.length) replaceChildren(this.hand, h("p", { class: "hint" }, "No cards"));
    else this.hand.querySelector(":scope > p")?.remove();
  }

  private handButton(card: ActionCard): HTMLButtonElement {
    const btn = handCard(card);
    btn.prepend(h("span", { class: "nmp-card-when", "aria-hidden": "true" }));
    btn.addEventListener("click", () => this.onCardTap(card.id));
    btn.addEventListener("animationend", () => btn.classList.remove("fresh"));
    this.cards.set(card.id, btn);
    return btn;
  }

  // ---- panel: the card sheet, the pick, or the step's buttons -----------------

  private renderPanel(props: GameViewProps, game: NmpPublicState, priv: NmpPrivateState | null) {
    const sel = this.selection;
    const card = sel && priv?.hand.find((c) => c.id === sel.cardId);
    if (sel && card && priv) {
      replaceChildren(this.panel, sel.mode === "look" ? this.sheet(game, priv, card) : this.pickBar(props, game, priv, card, sel));
      return;
    }
    replaceChildren(this.panel, this.stepActions(props, game, priv));
  }

  /** The detail sheet: the card's words, and Play when it can be played now. */
  private sheet(game: NmpPublicState, priv: NmpPrivateState, card: ActionCard): HTMLElement {
    const text = ACTION_TEXT[card.kind];
    const can = priv.playable.find((p) => p.cardId === card.id);
    const locked = this.pending.size > 0;
    return h(
      "div",
      { class: `nmp-sheet k-${card.kind}`, role: "group", "aria-label": `${text.name} card` },
      actionIcon(card.kind),
      h(
        "div",
        { class: "nmp-sheet-text" },
        h("span", { class: "nmp-label" }, timingLabel(card.kind)),
        h("strong", {}, text.name),
        h("span", {}, text.line),
        can ? null : h("span", { class: "nmp-muted" }, `You can't play it now. ${playWhen(card.kind)}`),
      ),
      h(
        "div",
        { class: "nmp-buttons" },
        h("button", { type: "button", class: "link", "data-focus": "act:close", onclick: () => this.clearSelection() }, "Close"),
        can
          ? h("button", { type: "button", class: "primary", "data-focus": "act:play", disabled: locked, onclick: () => this.onPlay(game, priv, card) }, `Play ${text.name}`)
          : null,
      ),
    );
  }

  /** Waiting on a seat or a face-down card, then Confirm. */
  private pickBar(props: GameViewProps, game: NmpPublicState, priv: NmpPrivateState, card: ActionCard, sel: Selection): HTMLElement {
    const name = ACTION_TEXT[card.kind].name;
    const picked = sel.picked;
    let ask: string;
    if (sel.mode === "seat") {
      ask = picked ? `${name} on ${picked === props.playerId ? "you" : seatName(props.room, picked)}?` : `Pick a player for ${name}.`;
    } else {
      const down = picked && priv.hand.find((c) => c.id === picked);
      ask = down
        ? `Put ${ACTION_TEXT[down.kind].name} face down and say it is a Quick Fix?`
        : "Pick a card to put face down. You will say it is a Quick Fix.";
    }
    const move = picked
      ? cardMove(game.step, card.kind, priv.token, card.id, sel.mode === "seat" ? { targetId: picked } : { faceDownId: picked })
      : null;
    return h(
      "div",
      { class: "nmp-pickbar" },
      h("p", { class: "hint strong" }, ask),
      h(
        "div",
        { class: "nmp-buttons" },
        h("button", { type: "button", class: "link", "data-focus": "act:cancel", onclick: () => this.clearSelection() }, "Cancel"),
        h("button", { type: "button", class: "primary", "data-focus": "act:confirm", disabled: !move || this.pending.size > 0, onclick: () => move && this.send(move) }, "Confirm"),
      ),
    );
  }

  /** The buttons for this step when no card is picked. */
  private stepActions(props: GameViewProps, game: NmpPublicState, priv: NmpPrivateState | null): Node | (Node | null)[] | null {
    const hint = (text: string, strong = false) => h("p", { class: `hint${strong ? " strong" : ""}` }, text);
    const me = game.players.find((p) => p.id === props.playerId);
    if (game.step === "finished") return null;
    if (this.pending.size) return hint("…");
    if (!me) return hint("You are watching.");
    if (me.fired) return hint("You are fired. You can still watch.");
    if (me.removed) return hint("You left the game.");
    if (!priv) return null;

    if (game.step === "action") {
      if (!priv.canDraw) return hint(`Waiting for ${seatName(props.room, game.turnPlayerId)}.`);
      const say =
        game.actionsLeft <= 0 ? "Draw a card to end your turn."
        : priv.playable.length
          ? game.actionsLeft === 1 ? "You can play 1 more card. Then draw." : `You can play ${game.actionsLeft} cards. Then draw.`
        : "Draw a card to end your turn.";
      return [
        hint(say, true),
        h("div", { class: "nmp-buttons" }, h("button", { type: "button", class: "primary nmp-draw", "data-focus": "act:draw", onclick: () => this.send({ type: "draw", token: priv.token }) }, "Draw")),
      ];
    }

    if (game.step === "problem" && game.problem) {
      const problem = game.problem;
      if (problem.ownerId !== props.playerId || !priv.canAccept) return hint(`Waiting for ${seatName(props.room, problem.ownerId)}.`);
      const first = (kind: ActionCard["kind"]) => priv.playable.find((p) => priv.hand.some((c) => c.id === p.cardId && c.kind === kind));
      const fix = first("quick-fix");
      const blame = first("blame-game");
      const report = first("fake-report");
      // An Intern takes exactly one warning (server/problem.ts giveWarnings).
      const take = Math.max(0, PROBLEM_TEXT[problem.kind].penalty - (me.shield ? 1 : 0));
      const btn = (label: string, onclick: () => void, cls = "") => h("button", { type: "button", class: cls, "data-focus": `act:${label}`, onclick }, label);
      return [
        hint(fix || blame || report ? "Answer the Problem, or take it." : "You have no card for it. Take it.", true),
        take === 0 ? hint("Your Intern stops the warning.") : null,
        h(
          "div",
          { class: "nmp-buttons wrap" },
          fix ? btn("Fix", () => this.send({ type: "fix", token: priv.token, cardId: fix.cardId }), "primary") : null,
          blame ? btn("Pass it on", () => this.startPick(priv, blame.cardId, "seat")) : null,
          report ? btn("Fake Report", () => this.startPick(priv, report.cardId, "face-down")) : null,
          btn(take > 0 ? `Take ${plural(take, "warning")}` : "Take it", () => this.send({ type: "accept", token: priv.token }), fix ? "link" : ""),
        ),
      ];
    }
    return null;
  }

  /** Seats that can be picked for the card waiting on a seat. */
  private seatPick(priv: NmpPrivateState | null): SeatPick | null {
    const sel = this.selection;
    if (!sel || sel.mode !== "seat" || !priv || this.pending.size) return null;
    const entry = priv.playable.find((p) => p.cardId === sel.cardId);
    const card = priv.hand.find((c) => c.id === sel.cardId);
    if (!entry?.targets || !card) return null;
    return {
      ids: new Set(entry.targets),
      picked: sel.picked,
      verb: PICK_VERB[card.kind] ?? "Pick",
      onPick: (id) => {
        if (this.selection) this.selection.picked = this.selection.picked === id ? null : id;
        // Picked: Confirm is the next thing to press. Unpicked: stay on the seat.
        this.focusNext = this.selection?.picked ? '[data-focus="act:confirm"]' : `[data-focus="${CSS.escape(`seat:${id}`)}"]`;
        this.rerender();
      },
    };
  }

  // ---- interaction ------------------------------------------------------------

  private onCardTap(cardId: string) {
    const priv = this.props?.private as NmpPrivateState | null | undefined;
    if (!priv) return;
    const sel = this.selection;
    if (sel?.mode === "face-down") {
      if (cardId !== sel.cardId) {
        sel.picked = sel.picked === cardId ? null : cardId;
        if (sel.picked) this.focusNext = '[data-focus="act:confirm"]';
      }
    } else if (sel?.mode === "look" && sel.cardId === cardId) {
      this.selection = null;
    } else {
      // Looking at a card never plays it.
      this.selection = { token: priv.token, cardId, mode: "look", picked: null };
    }
    this.rerender();
  }

  private onPlay(game: NmpPublicState, priv: NmpPrivateState, card: ActionCard) {
    const entry = priv.playable.find((p) => p.cardId === card.id);
    if (!entry) return;
    const needs = needsFor(card.kind, entry.targets);
    if (needs) {
      this.startPick(priv, card.id, needs);
      return;
    }
    const move = cardMove(game.step, card.kind, priv.token, card.id);
    if (move) this.send(move);
  }

  private startPick(priv: NmpPrivateState, cardId: string, mode: "seat" | "face-down") {
    this.cancelFocus = null;
    this.selection = { token: priv.token, cardId, mode, picked: null };
    this.focusNext = mode === "seat" ? ".nmp-seat.pick button" : ".nmp-card.pick";
    this.rerender();
  }

  private clearSelection() {
    // Back to where the pick started: the prompt's button, or the card it was about.
    const id = this.selection?.cardId;
    if (id) this.focusNext = this.cancelFocus ?? `[data-card="${CSS.escape(id)}"]`;
    this.cancelFocus = null;
    this.selection = null;
    this.rerender();
  }

  /** The pick stays until the move is answered: a refused Confirm can be pressed again. */
  private send(action: unknown) {
    this.pending.add(this.api.act(action));
    this.rerender();
  }
}
