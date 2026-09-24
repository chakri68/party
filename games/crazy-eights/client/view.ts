import { AnimationQueue, bubble, fly, once } from "@games/animation";
import { audio } from "@games/audio";
import type { Presence, RoomPublicState } from "@games/protocol";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { compareCards } from "../shared/rules.ts";
import {
  EIGHT,
  SUITS,
  type Card,
  type CrazyEightsEvent,
  type CrazyEightsPrivateState,
  type CrazyEightsPublicState,
  type Suit,
} from "../shared/types.ts";
import { cardBackFull, cardBackMini, cardFace, cardLabel, cardShort, handCard, isRed, SUIT_NAME, SUIT_SYMBOL } from "./cards.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
  left: "left",
};

/**
 * Mouse users click to play (§17). Touch gets tap-to-select, then tap again or
 * press Play: a stray tap mid-scroll shouldn't throw a card. Eights always go
 * through the suit picker, which doubles as the confirmation.
 */
/** A dealt card is mostly see-through for its first ~80ms of rise. */
const DEAL_SOUND_LAG = 80;

const directPlay = () => matchMedia("(hover: hover) and (pointer: fine)").matches;

function describe(e: CrazyEightsEvent, props: GameViewProps): string | null {
  const who = (id: string) => (id === props.playerId ? "You" : seatName(props.room, id));
  switch (e.type) {
    case "dealt":
      return `${who(e.dealerId)} dealt${e.buried.length ? ". An eight came up and got buried" : ""}. Starting on ${cardShort(e.starter)}.`;
    case "card-played":
      return e.calledSuit
        ? `${who(e.playerId)} played ${cardShort(e.card)} and called ${SUIT_NAME[e.calledSuit]}.`
        : `${who(e.playerId)} played ${cardShort(e.card)}.`;
    case "drew":
      return e.playerId === props.playerId ? null : `${who(e.playerId)} drew a card.`;
    case "you-drew":
      return `You drew ${cardShort(e.card)}.`;
    case "reshuffled":
      return "The pile got shuffled into a new stock.";
    case "passed":
      return e.playerId === props.playerId ? "Nothing to play and nothing to draw, so you passed." : `${who(e.playerId)} passed.`;
    case "turn-skipped":
      return `${who(e.playerId)} got skipped by the host.`;
    case "player-removed":
      return `${who(e.playerId)} left. Their cards went under the stock.`;
    case "game-over":
      return e.reason === "blocked" ? "Nobody can play and the stock's gone. Lowest hand wins." : null;
  }
}

/**
 * Which sounds a render makes. "all": nothing was acted out, so the events'
 * sounds play here. "cues": the animations made those, only the turn chime
 * and the ending are left. "none": a redraw mid-show, or of the same state.
 */
type Sounds = "all" | "cues" | "none";

/** Everyone but me, starting from my left: reads like the table, clockwise. */
function fromMyLeft<T extends { id: string }>(players: T[], me: string): T[] {
  const i = players.findIndex((p) => p.id === me);
  return i < 0 ? players : [...players.slice(i + 1), ...players.slice(0, i)];
}

export class CrazyEightsView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "crazy-eights" });
  private status = h("div", { class: "ce-status", role: "status", "aria-live": "polite" });
  private opponents = h("div", { class: "ce-opponents", role: "list", "aria-label": "Other players" });
  private stock = h("button", { type: "button", class: "ce-stock" });
  private pile = h("div", { class: "ce-pile" });
  private suitBadge = h("div", { class: "ce-suit-badge" });
  private log = h("p", { class: "ce-log", "aria-live": "polite" });
  private me = h("div", { class: "ce-me" });
  private action = h("div", { class: "ce-action" });
  private picker = h("div", { class: "ce-picker", role: "group", "aria-label": "Call a suit", hidden: true });
  private hand = h("div", { class: "ce-hand", role: "toolbar", "aria-label": "Your hand" });

  /** Keyed so updates keep scroll position, focus and selection (§8). */
  private cards = new Map<string, HTMLButtonElement>();
  private selected: string | null = null;
  /** An eight waiting on its suit. */
  private calling: string | null = null;
  private pending = new Map<string, string>(); // clientActionId → cardId

  /** Events act out first, settled state lands after (§19). */
  private queue = new AnimationQueue();
  private wasMyTurn = false;

  constructor(api: GameClientApi) {
    this.api = api;
    this.stock.addEventListener("click", () => this.draw());
    this.picker.append(
      ...SUITS.map((suit) =>
        h(
          "button",
          { type: "button", class: `ce-pick${isRed(suit) ? " red" : ""}`, "aria-label": SUIT_NAME[suit], onclick: () => this.callSuit(suit) },
          h("span", { "aria-hidden": "true" }, SUIT_SYMBOL[suit]),
        ),
      ),
    );
    this.root.append(
      this.status,
      this.opponents,
      h("div", { class: "ce-table", role: "group", "aria-label": "Table" }, this.stock, this.pile, this.suitBadge),
      this.log,
      h("div", { class: "ce-dock" }, h("div", { class: "ce-dock-head" }, this.me, this.action), this.picker, this.hand),
    );
    this.hand.addEventListener("keydown", this.onHandKey);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    this.root.remove();
  }

  whenIdle() {
    return this.queue.idle();
  }

  rejected(clientActionId: string, message: string) {
    const cardId = this.pending.get(clientActionId);
    this.pending.delete(clientActionId);
    const btn = cardId ? this.cards.get(cardId) : undefined;
    if (btn) {
      btn.classList.remove("shake");
      void btn.offsetWidth; // restart the animation
      btn.classList.add("shake");
    }
    this.log.textContent = message;
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    const events = props.events as CrazyEightsEvent[];
    // Reconnects, and joining mid-game: show it as it is, no replaying history.
    // A brand-new view for a fresh deal is the exception: that's the show.
    const freshDeal = !this.props && events.some((e) => e.type === "dealt");
    if (props.snapshot || (!this.props && !freshDeal)) {
      this.queue.clear();
      this.render(props, "none");
      return;
    }
    let acted = false;
    this.queue.push({
      animate: events.length
        ? async () => {
            acted = true;
            await this.act(events, props);
          }
        : undefined,
      // Sounds ride on the animations; if those were skipped, play them here.
      settle: () => this.render(props, acted ? "cues" : "all"),
    });
  }

  private render(props: GameViewProps, sounds: Sounds) {
    this.props = props;
    const game = props.game as CrazyEightsPublicState;
    const priv = props.private as CrazyEightsPrivateState | null;
    const myTurn = game.currentPlayerId === props.playerId;
    if (!myTurn) this.calling = null;
    this.root.classList.toggle("my-turn", myTurn);
    this.root.classList.toggle("finished", game.currentPlayerId === null);

    this.renderStatus(props.room, game, myTurn);
    this.renderOpponents(props, game);
    this.renderTable(game, priv, myTurn);
    this.renderHand(priv, myTurn);
    this.renderDock(props, game, priv, myTurn);

    const events = props.events as CrazyEightsEvent[];
    const lines = events.map((e) => describe(e, props)).filter(Boolean);
    if (lines.length) this.log.textContent = lines.slice(-2).join(" ");

    if (sounds !== "none") {
      if (sounds === "all") this.eventSounds(events);
      const over = events.find((e) => e.type === "game-over");
      if (over?.type === "game-over") {
        const won = over.winnerIds.includes(props.playerId);
        audio.play(won ? "win" : "game-over");
        if (won) audio.buzz([40, 60, 40, 60, 90]);
      }
      if (myTurn && !this.wasMyTurn) {
        audio.play("your-turn");
        audio.buzz(25);
      }
    }
    // Mid-show redraws leave it alone, so the chime waits for the settled turn.
    if (sounds !== "none" || props.snapshot) this.wasMyTurn = myTurn;
  }

  // ---- animation (§18) ----------------------------------------------------

  /** Acts out one update's events, in order, against the still-old DOM. */
  private async act(events: CrazyEightsEvent[], props: GameViewProps) {
    for (const [i, e] of events.entries()) {
      switch (e.type) {
        case "dealt":
          // Paint the new table now (hand held back), give the riffle a beat, fan the hand in.
          audio.play("shuffle");
          this.render(props, "none");
          await this.dealIn(380);
          break;
        case "card-played":
          await this.flyToPile(e.playerId, e.card);
          audio.play("card-place");
          if (e.playerId === props.playerId) audio.buzz(12);
          break;
        case "drew": {
          const drawn = events.slice(i + 1).find((x) => x.type === "you-drew");
          audio.play("deal");
          await this.flyFromStock(e.playerId, e.playerId === props.playerId && drawn?.type === "you-drew" ? drawn.card : null);
          break;
        }
        case "reshuffled":
          audio.play("shuffle");
          await bubble(this.stock, "Reshuffled");
          break;
        case "passed":
          audio.play("pass");
          await bubble(this.anchorFor(e.playerId, props), e.playerId === props.playerId ? "Nothing to play" : "Pass");
          break;
        case "turn-skipped":
          audio.play("pass");
          await bubble(this.anchorFor(e.playerId, props), "Skipped");
          break;
        default:
          break;
      }
    }
  }

  private eventSounds(events: CrazyEightsEvent[]) {
    const types = new Set(events.map((e) => e.type));
    if (types.has("dealt") || types.has("reshuffled")) audio.play("shuffle");
    if (types.has("drew")) audio.play("deal");
    if (types.has("card-played")) audio.play("card-place");
    if (types.has("passed") || types.has("turn-skipped")) audio.play("pass");
  }

  /** Where a player "sits" on screen: their chip, or your dock. */
  private anchorFor(playerId: string, props: GameViewProps): Element {
    if (playerId === props.playerId) return this.me;
    return this.opponents.querySelector(`[data-player="${CSS.escape(playerId)}"] .avatar`) ?? this.status;
  }

  /** A card-sized rect centred on a small anchor, so flights don't start as specks. */
  private cardRectAt(anchor: Element, like: DOMRect): DOMRect {
    const r = anchor.getBoundingClientRect();
    return new DOMRect(r.left + r.width / 2 - like.width * 0.3, r.top + r.height / 2 - like.height * 0.3, like.width * 0.6, like.height * 0.6);
  }

  private async flyToPile(playerId: string, card: Card) {
    if (!this.props) return;
    const to = this.pile.getBoundingClientRect();
    const mine = playerId === this.props.playerId ? this.cards.get(card.id) : undefined;
    let from: DOMRect;
    if (mine) {
      from = mine.getBoundingClientRect();
      mine.style.visibility = "hidden"; // it's in the air now; settle removes it
    } else {
      from = this.cardRectAt(this.anchorFor(playerId, this.props), to);
    }
    // Dressed as a table card, so the corners don't change size as it lands.
    const ghost = cardFace(card);
    ghost.classList.add("on-table");
    await fly(ghost, from, to, 340, { handoff: true });
    // Land it now, so the next flight in this batch sees it on top.
    replaceChildren(this.pile, once(this.pileCard(card), "landed"));
  }

  /** The pile's top card, keyed so a redraw of the same card leaves it (and its landing) alone. */
  private pileCard(card: Pick<Card, "suit" | "rank">): HTMLElement {
    const el = cardFace(card);
    el.dataset.face = `${card.suit}-${card.rank}`;
    return el;
  }

  /**
   * A draw. Yours goes into its sorted place in the hand (put there first,
   * hidden, so the flight has a real target and the hand makes room);
   * anyone else's goes onto their chip.
   */
  private async flyFromStock(playerId: string, card: Card | null) {
    const props = this.props;
    if (!props) return;
    const from = this.stock.getBoundingClientRect();
    if (playerId !== props.playerId) {
      await fly(cardBackFull(), from, this.cardRectAt(this.anchorFor(playerId, props), from), 280);
      return;
    }
    const hand = (props.private as CrazyEightsPrivateState | null)?.hand ?? [];
    if (!card || this.cards.has(card.id)) return;
    const next = hand.find((c) => compareCards(c, card) > 0 && this.cards.has(c.id));
    const btn = this.handButton(card);
    btn.style.visibility = "hidden";
    this.hand.insertBefore(btn, next ? this.cards.get(next.id)! : null);
    btn.scrollIntoView({ block: "nearest", inline: "nearest" });
    try {
      await fly(cardBackFull(), from, btn.getBoundingClientRect(), 280);
    } finally {
      btn.style.visibility = "";
    }
  }

  /**
   * Cards slide up into the hand one by one. From below rather than from the
   * table: the hand is a scroller and clips anything outside it.
   */
  private async dealIn(after = 0) {
    const cards = [...this.hand.children] as HTMLElement[];
    const flights = cards.map((el, i) => {
      const delay = after + i * 70;
      // Timed to when the card shows, not when its (invisible) rise starts.
      setTimeout(() => audio.play("deal"), delay + DEAL_SOUND_LAG);
      return el.animate(
        [
          { transform: "translateY(110%) rotate(-8deg)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 360, delay, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
      ).finished;
    });
    await Promise.all(flights).catch(() => {});
  }

  // ---- regions ------------------------------------------------------------

  private renderStatus(room: RoomPublicState, game: CrazyEightsPublicState, myTurn: boolean) {
    // Once finished, the room's results panel announces the winner.
    this.status.hidden = game.currentPlayerId === null;
    if (this.status.hidden) return;
    const seat = room.seats.find((s) => s.id === game.currentPlayerId);
    const away = seat && seat.presence !== "connected" ? ` (${PRESENCE_LABEL[seat.presence]})` : "";
    replaceChildren(
      this.status,
      myTurn
        ? h("span", {}, "Your turn")
        : [seat ? avatar(seat.name, seat.avatarSeed, "sm") : null, h("span", {}, `${seat?.name ?? "Someone"}'s turn${away}`)],
    );
  }

  private renderOpponents(props: GameViewProps, game: CrazyEightsPublicState) {
    replaceChildren(
      this.opponents,
      fromMyLeft(game.players, props.playerId).map((p) => {
        const seat = props.room.seats.find((s) => s.id === p.id);
        const away = seat && seat.presence !== "connected" && !p.removed;
        const name = seat?.name ?? "?";
        const current = p.id === game.currentPlayerId;
        return h(
          "div",
          {
            class: `ce-opp${current ? " current" : ""}${away || p.removed ? " away" : ""}`,
            role: "listitem",
            "data-player": p.id,
            "aria-label": `${name}: ${p.removed ? "left" : `${p.cardCount} cards`}${current ? ", playing now" : ""}${away ? `, ${PRESENCE_LABEL[seat!.presence]}` : ""}`,
          },
          seat ? avatar(name, seat.avatarSeed) : null,
          h(
            "div",
            { class: "ce-opp-text", "aria-hidden": "true" },
            h("span", { class: "name" }, name, p.id === game.dealerId ? h("span", { class: "ce-dealer", title: "Dealer" }, "D") : null),
            h(
              "span",
              { class: "count" },
              p.removed ? "left" : [cardBackMini(), ` ${p.cardCount}`],
              away ? h("span", { class: "away-label" }, ` · ${PRESENCE_LABEL[seat!.presence]}`) : null,
            ),
          ),
        );
      }),
    );
  }

  private renderTable(game: CrazyEightsPublicState, priv: CrazyEightsPrivateState | null, myTurn: boolean) {
    const canDraw = myTurn && !!priv?.canDraw;
    const left = game.stockCount + game.reshuffleCount;
    this.stock.disabled = !canDraw;
    this.stock.classList.toggle("can-draw", canDraw);
    this.stock.classList.toggle("empty", game.stockCount === 0);
    this.stock.setAttribute(
      "aria-label",
      `Stock, ${game.stockCount} ${game.stockCount === 1 ? "card" : "cards"}${canDraw ? ". Draw a card" : ""}`,
    );
    replaceChildren(
      this.stock,
      game.stockCount ? cardBackFull() : h("span", { class: "ce-card slot", "aria-hidden": "true" }, left ? "↻" : ""),
      h("span", { class: "ce-stock-count", "aria-hidden": "true" }, game.stockCount ? String(game.stockCount) : left ? "reshuffle" : "empty"),
    );

    const top = this.pile.firstElementChild as HTMLElement | null;
    if (top?.dataset.face !== `${game.topCard.suit}-${game.topCard.rank}`) replaceChildren(this.pile, this.pileCard(game.topCard));

    // The suit to follow. Loud after an eight, since that's the one people miss.
    const suit = game.activeSuit;
    this.suitBadge.classList.toggle("called", !!game.calledSuit);
    this.suitBadge.classList.toggle("red", isRed(suit));
    replaceChildren(
      this.suitBadge,
      h("span", { class: "sym", "aria-hidden": "true" }, SUIT_SYMBOL[suit]),
      h("span", { class: "what" }, game.calledSuit ? `${SUIT_NAME[suit]} called` : `${SUIT_NAME[suit]} to follow`),
    );
  }

  private renderHand(priv: CrazyEightsPrivateState | null, myTurn: boolean) {
    const hand = priv?.hand ?? [];
    const playable = new Set(priv?.playableCardIds ?? []);
    const keep = new Set(hand.map((c) => c.id));

    for (const [id, btn] of this.cards) {
      if (!keep.has(id)) {
        btn.remove();
        this.cards.delete(id);
      }
    }
    if (this.selected && (!keep.has(this.selected) || !myTurn)) this.selected = null;
    if (this.calling && !keep.has(this.calling)) this.calling = null;

    // Cards that show up mid-hand are draws: flag them so they're easy to spot.
    const drawing = this.cards.size > 0;
    let fresh: HTMLButtonElement | null = null;
    hand.forEach((card, i) => {
      let btn = this.cards.get(card.id);
      if (!btn) {
        btn = this.handButton(card);
        if (drawing) fresh = once(btn, "fresh");
      }
      const canPlay = myTurn && playable.has(card.id);
      const picked = this.selected === card.id || this.calling === card.id;
      btn.classList.toggle("playable", canPlay);
      btn.classList.toggle("selected", picked);
      btn.setAttribute("aria-label", `${cardLabel(card)}${canPlay ? ", playable" : ""}`);
      btn.setAttribute("aria-pressed", String(picked));
      if (this.hand.children[i] !== btn) this.hand.insertBefore(btn, this.hand.children[i] ?? null);
    });
    (fresh as HTMLButtonElement | null)?.scrollIntoView({ block: "nearest", inline: "nearest" });

    // Roving tabindex: one tab stop into the hand, arrows within it (§38).
    const focusTarget =
      (this.selected && this.cards.get(this.selected)) ||
      [...this.cards.values()].find((b) => b.classList.contains("playable")) ||
      this.hand.firstElementChild;
    for (const btn of this.cards.values()) btn.tabIndex = btn === focusTarget ? 0 : -1;
  }

  private handButton(card: Card): HTMLButtonElement {
    const btn = handCard(card);
    btn.addEventListener("click", () => this.onCardTap(card.id));
    this.cards.set(card.id, btn);
    return btn;
  }

  private renderDock(props: GameViewProps, game: CrazyEightsPublicState, priv: CrazyEightsPrivateState | null, myTurn: boolean) {
    const mine = game.players.find((p) => p.id === props.playerId);
    replaceChildren(
      this.me,
      h("span", { class: "you" }, "Your hand"),
      mine ? h("span", { class: "count" }, `${mine.cardCount} ${mine.cardCount === 1 ? "card" : "cards"}`) : null,
      mine && game.dealerId === props.playerId ? h("span", { class: "ce-dealer", title: "Dealer" }, "D") : null,
    );

    this.picker.hidden = !this.calling;
    const hasPlay = (priv?.playableCardIds.length ?? 0) > 0;
    const drawBtn = (primary: boolean) =>
      h("button", { type: "button", class: primary ? "primary" : "", onclick: () => this.draw() }, "Draw");

    let action: Node | Node[] | null = null;
    if (game.currentPlayerId === null) {
      action = null;
    } else if (!myTurn) {
      action = h("span", { class: "hint" }, "Not your turn yet");
    } else if (this.calling) {
      action = [
        h("span", { class: "hint strong" }, "Call a suit"),
        h("button", { type: "button", class: "link", onclick: () => this.cancelCall() }, "Cancel"),
      ];
    } else if (this.selected) {
      const card = priv?.hand.find((c) => c.id === this.selected);
      action = h("button", { type: "button", class: "primary", onclick: () => this.playSelected() }, `Play ${card ? cardShort(card) : ""}`);
    } else if (!hasPlay) {
      action = priv?.canDraw ? drawBtn(true) : null;
    } else {
      action = [
        h("span", { class: "hint" }, directPlay() ? "Click a card" : "Tap a card"),
        priv?.canDraw ? drawBtn(false) : null,
      ].filter((n): n is HTMLElement => !!n);
    }
    replaceChildren(this.action, action);
  }

  // ---- interaction --------------------------------------------------------

  private myTurn(): boolean {
    const game = this.props?.game as CrazyEightsPublicState | undefined;
    return !!game && game.currentPlayerId === this.props!.playerId;
  }

  private rerender() {
    if (this.props) this.render(this.props, "none");
  }

  private onCardTap(cardId: string) {
    const props = this.props;
    if (!props) return;
    if (!this.myTurn()) {
      this.log.textContent = "Not your turn yet.";
      return;
    }
    const priv = props.private as CrazyEightsPrivateState | null;
    const card = priv?.hand.find((c) => c.id === cardId);
    const playable = priv?.playableCardIds.includes(cardId);

    // A playable eight opens the suit picker, however you got here.
    if (card?.rank === EIGHT && playable) {
      this.selected = null;
      this.calling = this.calling === cardId ? null : cardId;
      this.rerender();
      if (this.calling) (this.picker.querySelector("button") as HTMLButtonElement | null)?.focus();
      return;
    }
    this.calling = null;
    // Mouse: straight in. Touch: select first, second tap plays. Unplayable cards
    // still go to the server so the rejection (and its shake) comes from one place.
    if (directPlay() || this.selected === cardId || !playable) {
      this.selected = cardId;
      this.playSelected();
      return;
    }
    this.selected = cardId;
    this.rerender();
  }

  private playSelected() {
    const cardId = this.selected;
    if (!cardId) return;
    this.selected = null;
    this.pending.set(this.api.act({ type: "play-card", cardId }), cardId);
    this.rerender();
  }

  private callSuit(suit: Suit) {
    const cardId = this.calling;
    if (!cardId) return;
    this.calling = null;
    this.pending.set(this.api.act({ type: "play-card", cardId, suit }), cardId);
    this.rerender();
  }

  private cancelCall() {
    const cardId = this.calling;
    this.calling = null;
    this.rerender();
    if (cardId) this.cards.get(cardId)?.focus();
  }

  private draw() {
    const priv = this.props?.private as CrazyEightsPrivateState | null | undefined;
    if (!this.myTurn() || !priv?.canDraw) return;
    this.selected = null;
    this.calling = null;
    this.api.act({ type: "draw" });
    this.rerender();
  }

  private onHandKey = (e: KeyboardEvent) => {
    const buttons = [...this.hand.children] as HTMLButtonElement[];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const next =
      e.key === "ArrowRight" ? buttons[i + 1]
      : e.key === "ArrowLeft" ? buttons[i - 1]
      : e.key === "Home" ? buttons[0]
      : e.key === "End" ? buttons.at(-1)
      : undefined;
    if (!next) return;
    e.preventDefault();
    for (const b of buttons) b.tabIndex = b === next ? 0 : -1;
    next.focus();
    next.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
}
