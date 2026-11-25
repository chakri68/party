import { audio } from "@games/audio";
import { countdown, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { ACTION_TEXT, PROBLEM_TEXT } from "../shared/cards.ts";
import type { ActionCard, NmpEvent, NmpPrivateState, NmpPublicState } from "../shared/types.ts";
import { actionIcon, handCard, playWhen, problemIcon, timingLabel } from "./cards.ts";
import { feedLine } from "./feed.ts";
import { PICK_VERB, cardMove, needsFor } from "./moves.ts";
import { renderSeats, type SeatPick } from "./seats.ts";

/** The last seconds tick for whoever the clock is running on. */
const TICK_FROM = 3;
/** A refused move's message stays in the feed this long. */
const REJECT_MS = 3000;

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
  private feed = h("p", { class: "nmp-feed", "aria-live": "polite" });
  /** The window prompts (target, HR, challenge) render here, above the hand. */
  private prompt = h("div", { class: "nmp-prompt" });
  private hand = h("div", { class: "nmp-hand", role: "group", "aria-label": "Your hand" });
  private panel = h("div", { class: "nmp-panel" });

  private cards = new Map<string, HTMLButtonElement>();
  private selection: Selection | null = null;
  /** Sent and not yet answered: buttons stay locked meanwhile. */
  private pending = new Set<string>();
  private feedText = "";
  private flash: { text: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private wasMine = false;
  /**
   * Where keyboard focus belongs after a redraw, as a selector. Seats and the
   * panel are rebuilt on each render, so the focused button is replaced: this
   * puts focus on its replacement (or on the next thing to press).
   */
  private focusWant: string | null = null;
  /** A move that says where focus goes next (Confirm after a pick). Wins over focusWant. */
  private focusNext: string | null = null;
  private lastTick = -1;
  /** A new deadline starts a new set of ticks. */
  private tickDeadline: number | null = null;
  private clock: ReturnType<typeof setInterval>;

  constructor(api: GameClientApi) {
    this.api = api;
    this.top.append(h("span", { class: "nmp-where" }, this.roundEl, this.pileEl), this.turnEl, this.timer.el);
    this.root.append(
      this.top,
      this.seats,
      this.table,
      this.feed,
      h("div", { class: "nmp-dock" }, this.prompt, this.hand, this.panel),
    );
    this.clock = setInterval(() => this.renderClock(), 200);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    clearInterval(this.clock);
    if (this.flash) clearTimeout(this.flash.timer);
    this.root.remove();
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
    // Anything from the server answers what we sent: unlock.
    this.pending.clear();
    const game = props.game as NmpPublicState;
    const events = props.events as NmpEvent[];
    const first = !this.props;
    this.feedText = feedLine(game.lastEvent, events, props);
    // A reconnect or a first look: show it as it is, no sounds or slides.
    const quiet = props.snapshot || first;
    this.render(props, !quiet);
    if (!quiet) this.eventSounds(events, props);
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
    const mine = myTurn || myProblem;

    // A new step (or a card that left the hand) forgets the pick.
    const sel = this.selection;
    if (sel && (sel.token !== priv?.token || !priv.hand.some((c) => c.id === sel.cardId))) this.selection = null;

    this.root.classList.toggle("my-turn", mine);
    this.root.classList.toggle("finished", game.step === "finished");

    this.api.setTurn(
      myTurn ? "Play or draw"
      : myProblem ? "Fix your Problem"
      : game.step === "target" && priv?.canAccept ? "Answer the pass"
      : null,
    );

    this.renderTop(props, game, myProblem);
    renderSeats(this.seats, props, game, this.seatPick(priv));
    this.renderTable(props, game);
    this.renderFeed();
    const seated = game.players.some((p) => p.id === me && !p.fired && !p.removed);
    this.renderPrompt(game, seated);
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
    if (!want) return;
    // A panel button that is gone (Confirm after it was sent): the panel's next button instead.
    const el =
      this.root.querySelector<HTMLElement>(want) ??
      (want.startsWith('[data-focus="act') ? this.panel.querySelector<HTMLElement>("button[data-focus]:not(:disabled)") : null);
    if (el && !(el as HTMLButtonElement).disabled) {
      el.focus({ preventScroll: true });
      this.focusWant = null;
    }
  }

  private eventSounds(events: NmpEvent[], props: GameViewProps) {
    const me = props.playerId;
    for (const e of events) {
      if (e.type === "played" || e.type === "report") audio.play("card-place");
      else if (e.type === "drew") audio.play(e.problem ? "nudge" : "deal");
      else if (e.type === "fixed") audio.play("correct");
      else if (e.type === "warned" && e.playerId === me && e.amount > 0) audio.buzz([50, 40, 50]);
      else if (e.type === "game-over") {
        const won = e.winnerIds.includes(me);
        audio.play(won ? "win" : "game-over");
        if (won) audio.buzz([40, 60, 40, 60, 90]);
      }
    }
  }

  private renderTop(props: GameViewProps, game: NmpPublicState, myProblem: boolean) {
    this.top.hidden = game.step === "finished";
    this.roundEl.textContent = `Round ${game.round}`;
    this.pileEl.textContent = `${plural(game.drawCount, "card")} left`;
    this.pileEl.setAttribute("aria-label", `${plural(game.drawCount, "card")} left in the draw pile`);
    const id = game.turnPlayerId;
    // The clock runs on whoever must act: on a Problem passed to me, that's me.
    this.turnEl.textContent =
      myProblem ? "Your Problem"
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
    this.feed.textContent = this.flash?.text ?? this.feedText;
  }

  /** Target, HR and challenge windows get their own prompts; until then, a plain line. */
  private renderPrompt(game: NmpPublicState, seated: boolean) {
    const waiting = seated && (game.step === "target" || game.step === "hr" || game.step === "challenge");
    this.prompt.hidden = !waiting;
    replaceChildren(this.prompt, waiting ? h("p", { class: "hint" }, "Waiting") : null);
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
    this.selection = { token: priv.token, cardId, mode, picked: null };
    this.focusNext = mode === "seat" ? ".nmp-seat.pick button" : ".nmp-card.pick";
    this.rerender();
  }

  private clearSelection() {
    // Back to the card it was about.
    const id = this.selection?.cardId;
    if (id) this.focusNext = `[data-card="${CSS.escape(id)}"]`;
    this.selection = null;
    this.rerender();
  }

  private send(action: unknown) {
    this.selection = null;
    this.pending.add(this.api.act(action));
    this.rerender();
  }
}
