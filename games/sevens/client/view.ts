import { AnimationQueue, bubble, fly } from "@games/animation";
import { audio } from "@games/audio";
import type { Presence, RoomPublicState } from "@games/protocol";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { formatRank, rowBounds, SEVEN } from "../shared/rules.ts";
import { SUITS, type Card, type SevensEvent, type SevensPrivateState, type SevensPublicState } from "../shared/types.ts";
import { cardBack, cardLabel, cardShort, fullCard, isRed, miniCard, SUIT_NAME, SUIT_SYMBOL } from "./cards.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
  left: "left",
};

/**
 * Mouse users click to play (§17). Touch gets tap-to-select, then tap again or
 * press Play: a stray tap mid-scroll shouldn't throw a card.
 */
const directPlay = () => matchMedia("(hover: hover) and (pointer: fine)").matches;

function describe(e: SevensEvent, props: GameViewProps): string | null {
  const who = (id: string) => (id === props.playerId ? "You" : seatName(props.room, id));
  switch (e.type) {
    case "dealt":
      return `${who(e.dealerId)} dealt.`;
    case "card-played":
      return `${who(e.playerId)} played ${cardShort(e.card)}.`;
    case "ghost-card-placed":
      return `${cardShort(e.card)} went down on its own.`;
    case "passed":
      return e.playerId === props.playerId ? "You had nothing to play, so you passed." : `${who(e.playerId)} passed.`;
    case "turn-skipped":
      return `${who(e.playerId)} got skipped by the host.`;
    case "player-removed":
      return `${who(e.playerId)} left. Their cards will go down on their own.`;
    case "game-over":
      return null;
  }
}

/** Everyone but me, starting from my left: reads like the table, clockwise. */
function fromMyLeft<T extends { id: string }>(players: T[], me: string): T[] {
  const i = players.findIndex((p) => p.id === me);
  return i < 0 ? players : [...players.slice(i + 1), ...players.slice(0, i)];
}

export class SevensView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "sevens" });
  private status = h("div", { class: "sv-status", role: "status", "aria-live": "polite" });
  private opponents = h("div", { class: "sv-opponents", role: "list", "aria-label": "Other players" });
  private board = h("div", { class: "sv-board", role: "group", "aria-label": "Board" });
  private log = h("p", { class: "sv-log", "aria-live": "polite" });
  private me = h("div", { class: "sv-me" });
  private action = h("div", { class: "sv-action" });
  private hand = h("div", { class: "sv-hand", role: "toolbar", "aria-label": "Your hand" });

  /** Keyed so updates keep scroll position, focus and selection (§8). */
  private cards = new Map<string, HTMLButtonElement>();
  private selected: string | null = null;
  private pending = new Map<string, string>(); // clientActionId → cardId

  /** Events act out first, settled state lands after (§19). */
  private queue = new AnimationQueue();
  private wasMyTurn = false;

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(
      this.status,
      this.opponents,
      this.board,
      this.log,
      h("div", { class: "sv-dock" }, h("div", { class: "sv-dock-head" }, this.me, this.action), this.hand),
    );
    this.hand.addEventListener("keydown", this.onHandKey);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    this.root.remove();
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
    const events = props.events as SevensEvent[];
    // Reconnects, and joining mid-game: show it as it is, no replaying history.
    // A brand-new view for a fresh deal is the exception: that's the show.
    const freshDeal = !this.props && events.some((e) => e.type === "dealt");
    if (props.snapshot || (!this.props && !freshDeal)) {
      this.queue.clear();
      this.render(props, { quiet: true });
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
      settle: () => this.render(props, { quiet: acted }),
    });
  }

  private render(props: GameViewProps, { quiet }: { quiet: boolean }) {
    this.props = props;
    const game = props.game as SevensPublicState;
    const priv = props.private as SevensPrivateState | null;
    const myTurn = game.currentPlayerId === props.playerId;
    this.root.classList.toggle("my-turn", myTurn);
    this.root.classList.toggle("finished", game.currentPlayerId === null);

    this.renderStatus(props.room, game, myTurn);
    this.renderOpponents(props, game);
    this.renderBoard(game);
    this.renderHand(priv, myTurn);
    this.renderDock(props, game, priv, myTurn);

    const events = props.events as SevensEvent[];
    const lines = events.map((e) => describe(e, props)).filter(Boolean);
    if (lines.length) this.log.textContent = lines.slice(-2).join(" ");

    if (!props.snapshot) {
      if (!quiet) this.eventSounds(events);
      const over = events.find((e) => e.type === "game-over");
      if (over) {
        const won = over.type === "game-over" && over.winnerId === props.playerId;
        audio.play(won ? "win" : "game-over");
        if (won) audio.buzz([40, 60, 40, 60, 90]);
      }
      if (myTurn && !this.wasMyTurn) {
        audio.play("your-turn");
        audio.buzz(25);
      }
    }
    this.wasMyTurn = myTurn;
  }

  // ---- animation (§18) ----------------------------------------------------

  /** Acts out one update's events, in order, against the still-old DOM. */
  private async act(events: SevensEvent[], props: GameViewProps) {
    // A long ghost chain shouldn't hold the table hostage.
    const quick = events.length > 4;
    for (const e of events) {
      switch (e.type) {
        case "dealt":
          // Paint the new hands first, then fan them in from the table.
          this.render(props, { quiet: true });
          await this.dealIn();
          break;
        case "card-played":
          await this.flyCard(e.playerId, e.card, quick ? 180 : 340);
          audio.play("card-place");
          if (e.playerId === props.playerId) audio.buzz(12);
          break;
        case "ghost-card-placed":
          await this.flyCard(e.playerId, e.card, quick ? 140 : 220);
          audio.play("card-place");
          break;
        case "passed":
          audio.play("pass");
          await bubble(this.anchorFor(e.playerId, props), e.playerId === props.playerId ? "Nothing to play" : "Pass");
          break;
        default:
          break;
      }
    }
  }

  private eventSounds(events: SevensEvent[]) {
    const types = new Set(events.map((e) => e.type));
    if (types.has("dealt")) audio.play("deal");
    if (types.has("card-played") || types.has("ghost-card-placed")) audio.play("card-place");
    if (types.has("passed")) audio.play("pass");
  }

  /** Where a player "sits" on screen: their chip, or your dock. */
  private anchorFor(playerId: string, props: GameViewProps): Element {
    if (playerId === props.playerId) return this.me;
    return this.opponents.querySelector(`[data-player="${CSS.escape(playerId)}"] .avatar`) ?? this.status;
  }

  private async flyCard(playerId: string, card: Card, duration: number) {
    const cell = this.board.querySelector(`[data-cell="${card.suit}-${card.rank}"]`);
    if (!cell || !this.props) return;
    const to = cell.getBoundingClientRect();
    const mine = playerId === this.props.playerId ? this.cards.get(card.id) : undefined;
    let from: DOMRect;
    if (mine) {
      from = mine.getBoundingClientRect();
      mine.style.visibility = "hidden"; // it's in the air now; settle removes it
    } else {
      // From the player's avatar, starting card-sized-ish rather than chip-sized.
      const r = this.anchorFor(playerId, this.props).getBoundingClientRect();
      from = new DOMRect(r.left + r.width / 2 - to.width * 0.35, r.top + r.height / 2 - to.height * 0.35, to.width * 0.7, to.height * 0.7);
    }
    await fly(miniCard(card), from, to, duration);
    // Land it for real now, so the next flight in this batch sees it on the table.
    const landed = miniCard(card);
    landed.dataset.cell = `${card.suit}-${card.rank}`;
    landed.classList.add("landed");
    cell.replaceWith(landed);
  }

  /**
   * Cards slide up into the hand one by one. From below rather than from the
   * table: the hand is a scroller and clips anything outside it, so rising out
   * of its bottom edge looks deliberate instead of cut off.
   */
  private async dealIn() {
    const cards = [...this.hand.children] as HTMLElement[];
    const step = Math.min(35, 500 / Math.max(cards.length, 1));
    const flights = cards.map((el, i) => {
      if (i % 3 === 0) setTimeout(() => audio.play("deal"), i * step);
      return el.animate(
        [
          { transform: "translateY(110%) rotate(-8deg)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 360, delay: i * step, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
      ).finished;
    });
    await Promise.all(flights).catch(() => {});
  }

  // ---- regions ------------------------------------------------------------

  private renderStatus(room: RoomPublicState, game: SevensPublicState, myTurn: boolean) {
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

  private renderOpponents(props: GameViewProps, game: SevensPublicState) {
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
            class: `sv-opp${current ? " current" : ""}${away || p.removed ? " away" : ""}`,
            role: "listitem",
            "data-player": p.id,
            "aria-label": `${name}: ${p.removed ? "left" : `${p.cardCount} cards`}${current ? ", playing now" : ""}${away ? `, ${PRESENCE_LABEL[seat!.presence]}` : ""}`,
          },
          seat ? avatar(name, seat.avatarSeed) : null,
          h(
            "div",
            { class: "sv-opp-text", "aria-hidden": "true" },
            h("span", { class: "name" }, name, p.id === game.dealerId ? h("span", { class: "dealer", title: "Dealer" }, "D") : null),
            h(
              "span",
              { class: "count" },
              p.removed ? "left" : [cardBack(), ` ${p.cardCount}`],
              away ? h("span", { class: "away-label" }, ` · ${PRESENCE_LABEL[seat!.presence]}`) : null,
            ),
          ),
        );
      }),
    );
  }

  private renderBoard(game: SevensPublicState) {
    // Fixed columns so every seven sits in the same place (§15).
    const { min, max } = rowBounds(game.acePosition);
    replaceChildren(
      this.board,
      SUITS.map((suit) => {
        const row = game.board[suit];
        const cells = [];
        for (let r = min; r <= max; r++) {
          const played = row && r >= row.low && r <= row.high;
          const cell = played ? miniCard({ suit, rank: r }) : h("span", { class: `slot${r === SEVEN ? " seven" : ""}`, "aria-hidden": "true" });
          cell.dataset.cell = `${suit}-${r}`;
          cells.push(cell);
        }
        return h(
          "div",
          {
            class: "sv-row",
            role: "group",
            "aria-label": `${SUIT_NAME[suit]}: ${row ? `${formatRank(row.low)} to ${formatRank(row.high)}` : "not started"}`,
          },
          h("span", { class: `sv-row-suit${isRed(suit) ? " red" : ""}`, "aria-hidden": "true" }, SUIT_SYMBOL[suit]),
          cells,
        );
      }),
    );
  }

  private renderHand(priv: SevensPrivateState | null, myTurn: boolean) {
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

    hand.forEach((card, i) => {
      let btn = this.cards.get(card.id);
      if (!btn) {
        btn = fullCard(card);
        btn.addEventListener("click", () => this.onCardTap(card.id));
        this.cards.set(card.id, btn);
      }
      const canPlay = myTurn && playable.has(card.id);
      btn.classList.toggle("playable", canPlay);
      btn.classList.toggle("selected", this.selected === card.id);
      btn.setAttribute("aria-label", `${cardLabel(card)}${canPlay ? ", playable" : ""}`);
      btn.setAttribute("aria-pressed", String(this.selected === card.id));
      if (this.hand.children[i] !== btn) this.hand.insertBefore(btn, this.hand.children[i] ?? null);
    });

    // Roving tabindex: one tab stop into the hand, arrows within it (§38).
    const focusTarget =
      (this.selected && this.cards.get(this.selected)) ||
      [...this.cards.values()].find((b) => b.classList.contains("playable")) ||
      this.hand.firstElementChild;
    for (const btn of this.cards.values()) btn.tabIndex = btn === focusTarget ? 0 : -1;
  }

  private renderDock(props: GameViewProps, game: SevensPublicState, priv: SevensPrivateState | null, myTurn: boolean) {
    const mine = game.players.find((p) => p.id === props.playerId);
    replaceChildren(
      this.me,
      h("span", { class: "you" }, "Your hand"),
      mine ? h("span", { class: "count" }, `${mine.cardCount} ${mine.cardCount === 1 ? "card" : "cards"}`) : null,
      mine && game.dealerId === props.playerId ? h("span", { class: "dealer", title: "Dealer" }, "D") : null,
    );

    let action: Node | null = null;
    if (game.currentPlayerId === null) {
      action = null;
    } else if (!myTurn) {
      action = h("span", { class: "hint" }, "Not your turn yet");
    } else if (priv?.canPass) {
      action = h("button", { type: "button", class: "primary", onclick: () => this.api.act({ type: "pass" }) }, "Pass");
    } else if (this.selected) {
      const card = priv?.hand.find((c) => c.id === this.selected);
      action = h("button", { type: "button", class: "primary", onclick: () => this.playSelected() }, `Play ${card ? cardShort(card) : ""}`);
    } else {
      action = h("span", { class: "hint" }, directPlay() ? "Click a highlighted card" : "Tap a highlighted card");
    }
    replaceChildren(this.action, action);
  }

  // ---- interaction --------------------------------------------------------

  private onCardTap(cardId: string) {
    const props = this.props;
    if (!props) return;
    const game = props.game as SevensPublicState;
    const priv = props.private as SevensPrivateState | null;
    if (game.currentPlayerId !== props.playerId) {
      this.log.textContent = "Not your turn yet.";
      return;
    }
    const playable = priv?.playableCardIds.includes(cardId);
    // Mouse: straight in. Touch: select first, second tap plays. Unplayable cards
    // still go to the server so the rejection (and its shake) comes from one place.
    if (directPlay() || this.selected === cardId || !playable) {
      this.selected = cardId;
      this.playSelected();
      return;
    }
    this.selected = cardId;
    this.render(props, { quiet: true });
  }

  private playSelected() {
    const cardId = this.selected;
    if (!cardId) return;
    this.selected = null;
    this.pending.set(this.api.act({ type: "play-card", cardId }), cardId);
    if (this.props) this.render(this.props, { quiet: true });
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
