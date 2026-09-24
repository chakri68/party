import { AnimationQueue, bubble, fly } from "@games/animation";
import { audio } from "@games/audio";
import type { Presence, RoomPublicState } from "@games/protocol";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { ordinal } from "../shared/rules.ts";
import type { Card, OldMaidEvent, OldMaidPrivateState, OldMaidPublicState } from "../shared/types.ts";
import { cardBackFull, cardBackMini, cardFace, cardLabel, cardShort } from "./cards.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
  left: "left",
};

/**
 * Mouse users click to take (§17). Touch gets tap-to-lift, then tap again or
 * press Take: a stray tap mid-scroll shouldn't pick your card for you.
 */
const directPlay = () => matchMedia("(hover: hover) and (pointer: fine)").matches;

function describe(e: OldMaidEvent, props: GameViewProps): string | null {
  const me = props.playerId;
  const who = (id: string | null) => (id === me ? "You" : seatName(props.room, id));
  const whom = (id: string | null) => (id === me ? "you" : seatName(props.room, id));
  switch (e.type) {
    case "dealt":
      return `${who(e.dealerId)} dealt.`;
    case "discarded":
      return e.pairs.length === 1
        ? `${who(e.playerId)} paired ${e.pairs[0]!.map(cardShort).join(" ")}.`
        : `${who(e.playerId)} put down ${e.pairs.length} pairs.`;
    case "took":
      // The two people involved get the private version instead.
      return e.playerId === me || e.fromId === me ? null : `${who(e.playerId)} took a card from ${whom(e.fromId)}.`;
    case "you-took":
      return `You took ${cardShort(e.card)} from ${whom(e.fromId)}.`;
    case "taken-from-you":
      return `${who(e.byId)} took your ${cardShort(e.card)}.`;
    case "went-out":
      return e.playerId === me ? `You're out, ${ordinal(e.place)}. Safe.` : `${who(e.playerId)}'s out.`;
    case "turn-skipped":
      return `${who(e.playerId)} got skipped by the host, so a card was taken for them.`;
    case "player-removed":
      return e.toId ? `${who(e.playerId)} left. Their cards went to ${whom(e.toId)}.` : `${who(e.playerId)} left.`;
    case "game-over":
      if (!e.loserId) return "Called off: too many people left.";
      return e.loserId === me ? "You're left holding the Old Maid." : `${who(e.loserId)}'s left holding the Old Maid.`;
  }
}

/** Everyone but me, starting from my left: reads like the table, clockwise. */
function fromMyLeft<T extends { id: string }>(players: T[], me: string): T[] {
  const i = players.findIndex((p) => p.id === me);
  return i < 0 ? players : [...players.slice(i + 1), ...players.slice(0, i)];
}

export class OldMaidView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "old-maid" });
  private status = h("div", { class: "om-status", role: "status", "aria-live": "polite" });
  private opponents = h("div", { class: "om-opponents", role: "list", "aria-label": "Other players" });
  private fanLabel = h("p", { class: "om-fan-label" });
  private fan = h("div", { class: "om-fan", role: "toolbar" });
  private pile = h("div", { class: "om-pile" });
  private pileCount = h("span", { class: "om-pile-count" });
  private log = h("p", { class: "om-log", "aria-live": "polite" });
  private me = h("div", { class: "om-me" });
  private action = h("div", { class: "om-action" });
  private hand = h("div", { class: "om-hand", role: "list", "aria-label": "Your hand" });

  /** Keyed so updates keep the hand steady (§8). */
  private cards = new Map<string, HTMLElement>();
  /** Fan slots, rebuilt each render: positions mean nothing across takes. */
  private slots: HTMLButtonElement[] = [];
  private selected: number | null = null;
  private pending = new Set<string>();

  /** Events act out first, settled state lands after (§19). */
  private queue = new AnimationQueue();
  private wasMyTurn = false;
  private resize = new ResizeObserver(() => this.fitFan());

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(
      this.status,
      this.opponents,
      h(
        "div",
        { class: "om-table", role: "group", "aria-label": "Table" },
        h("div", { class: "om-fan-wrap" }, this.fanLabel, this.fan),
        h("div", { class: "om-pile-wrap" }, this.pile, this.pileCount),
      ),
      this.log,
      h("div", { class: "om-dock" }, h("div", { class: "om-dock-head" }, this.me, this.action), this.hand),
    );
    this.fan.addEventListener("keydown", this.onFanKey);
    this.resize.observe(this.fan);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    this.resize.disconnect();
    this.root.remove();
  }

  whenIdle() {
    return this.queue.idle();
  }

  rejected(clientActionId: string, message: string) {
    if (this.pending.delete(clientActionId)) {
      this.fan.classList.remove("shake");
      void this.fan.offsetWidth; // restart the animation
      this.fan.classList.add("shake");
    }
    // Unlock the fan for another go.
    this.selected = null;
    if (this.props) this.render(this.props, { quiet: true });
    this.log.textContent = message;
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    const events = props.events as OldMaidEvent[];
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
    // A new state from the server means a new fan: forget the lifted card.
    if (props !== this.props) this.selected = null;
    this.props = props;
    const game = props.game as OldMaidPublicState;
    const priv = props.private as OldMaidPrivateState | null;
    const myTurn = game.currentPlayerId === props.playerId;
    this.root.classList.toggle("my-turn", myTurn);
    this.root.classList.toggle("finished", game.currentPlayerId === null);

    this.renderStatus(props, game, myTurn);
    this.renderOpponents(props, game);
    this.renderFan(props, game, myTurn);
    this.renderPile(game);
    this.renderHand(priv);
    this.renderDock(props, game, myTurn);

    const events = props.events as OldMaidEvent[];
    const lines = events.map((e) => describe(e, props)).filter(Boolean);
    if (lines.length) this.log.textContent = lines.slice(-2).join(" ");

    if (!props.snapshot) {
      if (!quiet) this.eventSounds(events);
      const over = events.find((e) => e.type === "game-over");
      if (over?.type === "game-over" && over.loserId) {
        const lost = over.loserId === props.playerId;
        audio.play(lost ? "game-over" : "win");
        if (!lost) audio.buzz([40, 60, 40, 60, 90]);
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
  private async act(events: OldMaidEvent[], props: GameViewProps) {
    for (const e of events) {
      switch (e.type) {
        case "dealt":
          // Shuffle, give the riffle a beat, then paint the new hands and fan them in.
          audio.play("shuffle");
          await new Promise((r) => setTimeout(r, 380));
          this.render(props, { quiet: true });
          await this.dealIn();
          break;
        case "took": {
          // Only the taker and the one taken from get to see the card.
          const mine = events.find((x) => x.type === "you-took" || x.type === "taken-from-you") as
            | Extract<OldMaidEvent, { type: "you-took" | "taken-from-you" }>
            | undefined;
          audio.play("deal");
          if (e.playerId === props.playerId) audio.buzz(12);
          await this.flyTake(e.playerId, e.fromId, e.slot, mine?.card ?? null);
          if (mine?.card.suit === "joker") {
            // The one moment the joker variant exists for.
            if (mine.type === "you-took") {
              audio.buzz([60, 40, 60]);
              await bubble(this.me, "Uh oh");
            } else await bubble(this.me, "Good riddance");
          }
          break;
        }
        case "discarded":
          audio.play("card-place");
          await this.flyPairs(e.playerId, e.pairs);
          break;
        case "went-out":
          await bubble(this.anchorFor(e.playerId, props), e.playerId === props.playerId ? "You're out!" : "Out!");
          break;
        case "turn-skipped":
          await bubble(this.anchorFor(e.playerId, props), "Skipped");
          break;
        default:
          break;
      }
    }
  }

  private eventSounds(events: OldMaidEvent[]) {
    const types = new Set(events.map((e) => e.type));
    if (types.has("dealt")) audio.play("shuffle");
    if (types.has("took")) audio.play("deal");
    if (types.has("discarded")) audio.play("card-place");
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

  /** A card-sized rect at the right end of your hand, where new cards show up. */
  private handEnd(like: DOMRect): DOMRect {
    const r = this.hand.getBoundingClientRect();
    return new DOMRect(Math.min(r.right, innerWidth) - like.width - 8, r.top + 20, like.width, like.height);
  }

  /**
   * The take. Out of the fan slot that was picked (or out of your hand, if it
   * was yours), into the taker's hand or onto their chip. Face up only for the
   * two people who get to know what it was.
   */
  private async flyTake(takerId: string, fromId: string, slot: number, card: Card | null) {
    const props = this.props;
    if (!props) return;
    const me = props.playerId;
    const size = (this.slots[0] ?? this.hand.firstElementChild ?? this.fan).getBoundingClientRect();

    let from: DOMRect;
    const ownCard = fromId === me && card ? this.cards.get(card.id) : undefined;
    const fanSlot = this.fan.dataset.source === fromId ? this.slots[slot] : undefined;
    if (fanSlot) {
      fanSlot.classList.add("lifted");
      await new Promise((r) => setTimeout(r, 160)); // a beat on the chosen card
      from = fanSlot.getBoundingClientRect();
      fanSlot.style.visibility = "hidden";
    } else {
      from = ownCard ? ownCard.getBoundingClientRect() : this.cardRectAt(this.anchorFor(fromId, props), size);
    }
    if (ownCard) ownCard.style.visibility = "hidden"; // settle removes it
    const to = takerId === me ? this.handEnd(size) : this.cardRectAt(this.anchorFor(takerId, props), size);
    await fly(card ? cardFace(card) : cardBackFull(), from, to, 340);
  }

  /**
   * Pairs go down face up onto the pile. A player's pairs fly together, a
   * little staggered: after the deal that's a dozen of them, and nobody wants
   * to sit through a dozen flights each.
   */
  private async flyPairs(playerId: string, pairs: Card[][]) {
    const props = this.props;
    if (!props) return;
    const to = this.pile.getBoundingClientRect();
    await Promise.all(
      pairs.flat().map((card, i) => {
        const el = playerId === props.playerId ? this.cards.get(card.id) : undefined;
        const from = el ? el.getBoundingClientRect() : this.cardRectAt(this.anchorFor(playerId, props), to);
        if (el) el.style.visibility = "hidden";
        return new Promise((r) => setTimeout(r, i * 50)).then(() => fly(cardFace(card), from, to, 300));
      }),
    );
    this.showPair(pairs.at(-1) ?? null, true);
  }

  /**
   * Cards slide up into the hand one by one. From below rather than from the
   * table: the hand is a scroller and clips anything outside it.
   */
  private async dealIn() {
    const cards = [...this.hand.children] as HTMLElement[];
    const flights = cards.map((el, i) => {
      setTimeout(() => audio.play("deal"), i * 50);
      return el.animate(
        [
          { transform: "translateY(110%) rotate(-8deg)", opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 360, delay: i * 50, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
      ).finished;
    });
    await Promise.all(flights).catch(() => {});
  }

  // ---- regions ------------------------------------------------------------

  private renderStatus(props: GameViewProps, game: OldMaidPublicState, myTurn: boolean) {
    // Once finished, the room's results panel announces the loser.
    this.status.hidden = game.currentPlayerId === null;
    if (this.status.hidden) return;
    const room: RoomPublicState = props.room;
    const seat = room.seats.find((s) => s.id === game.currentPlayerId);
    const away = seat && seat.presence !== "connected" ? ` (${PRESENCE_LABEL[seat.presence]})` : "";
    const fromMe = game.sourceId === props.playerId;
    replaceChildren(
      this.status,
      myTurn
        ? h("span", {}, `Your turn: take one from ${seatName(room, game.sourceId)}`)
        : [
            seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
            h("span", {}, `${seat?.name ?? "Someone"}${away} is taking ${fromMe ? "from you" : "a card"}`),
          ],
    );
  }

  private renderOpponents(props: GameViewProps, game: OldMaidPublicState) {
    replaceChildren(
      this.opponents,
      fromMyLeft(game.players, props.playerId).map((p) => {
        const seat = props.room.seats.find((s) => s.id === p.id);
        const away = seat && seat.presence !== "connected" && !p.removed;
        const name = seat?.name ?? "?";
        const current = p.id === game.currentPlayerId;
        const source = p.id === game.sourceId;
        const loser = p.id === game.loserId;
        const holding = p.removed ? "left" : p.outPlace ? `out ${ordinal(p.outPlace)}` : `${p.cardCount} cards`;
        return h(
          "div",
          {
            class: `om-opp${current ? " current" : ""}${source ? " source" : ""}${p.outPlace ? " out" : ""}${loser ? " loser" : ""}${away || p.removed ? " away" : ""}`,
            role: "listitem",
            "data-player": p.id,
            "aria-label": `${name}: ${holding}${current ? ", taking now" : ""}${source ? ", being taken from" : ""}${away ? `, ${PRESENCE_LABEL[seat!.presence]}` : ""}`,
          },
          seat ? avatar(name, seat.avatarSeed) : null,
          h(
            "div",
            { class: "om-opp-text", "aria-hidden": "true" },
            h("span", { class: "name" }, name, p.id === game.dealerId ? h("span", { class: "om-dealer", title: "Dealer" }, "D") : null),
            h(
              "span",
              { class: "count" },
              p.removed || p.outPlace ? holding : [cardBackMini(), ` ${p.cardCount}`],
              away ? h("span", { class: "away-label" }, ` · ${PRESENCE_LABEL[seat!.presence]}`) : null,
            ),
          ),
        );
      }),
    );
  }

  /** The fan everyone's watching: the source's cards, face down. */
  private renderFan(props: GameViewProps, game: OldMaidPublicState, myTurn: boolean) {
    const room = props.room;
    const source = game.players.find((p) => p.id === game.sourceId);
    this.fan.dataset.source = source?.id ?? "";
    if (!source) {
      // Finished: the loser's card goes face up where the fan was.
      this.fanLabel.textContent = game.loserCard
        ? `${game.loserId === props.playerId ? "You're" : `${seatName(room, game.loserId)}'s`} stuck with it`
        : "";
      this.slots = [];
      replaceChildren(this.fan, game.loserCard ? cardFace(game.loserCard) : null);
      return;
    }

    const whose = source.id === props.playerId ? "Your" : `${seatName(room, source.id)}'s`;
    this.fanLabel.textContent = myTurn ? `${whose} cards. Pick one.` : `${whose} cards`;
    this.fan.setAttribute("aria-label", myTurn ? `Take a card from ${seatName(room, source.id)}` : `${whose} cards, face down`);

    this.slots = Array.from({ length: source.cardCount }, (_, i) => {
      const btn = h(
        "button",
        {
          type: "button",
          class: `om-card back${this.selected === i ? " selected" : ""}`,
          "aria-label": `Card ${i + 1} of ${source.cardCount}`,
          disabled: !myTurn,
          onclick: () => this.onSlotTap(i),
        },
      );
      btn.tabIndex = i === (this.selected ?? 0) ? 0 : -1;
      return btn;
    });
    replaceChildren(this.fan, this.slots);
    this.fitFan();
  }

  /** Overlap the fan just enough to fit, so a 26-card hand still fits a phone. */
  private fitFan() {
    const n = this.slots.length;
    if (n < 2) return;
    const card = this.slots[0]!.getBoundingClientRect().width || 58;
    const room = this.fan.clientWidth || 320;
    const step = Math.min(card * 0.62, (room - card) / (n - 1));
    this.fan.style.setProperty("--fan-overlap", `${Math.min(0, step - card)}px`);
  }

  private showPair(pair: Card[] | null, landed = false) {
    const cards = (pair ?? []).map((c) => {
      const el = cardFace(c);
      if (landed) el.classList.add("landed");
      return el;
    });
    replaceChildren(this.pile, cards.length ? cards : h("span", { class: "om-card slot", "aria-hidden": "true" }));
  }

  private renderPile(game: OldMaidPublicState) {
    this.showPair(game.lastPair);
    const pairs = game.discardCount / 2;
    this.pileCount.textContent = pairs ? `${pairs} ${pairs === 1 ? "pair" : "pairs"} down` : "No pairs yet";
    this.pile.setAttribute("role", "img");
    this.pile.setAttribute(
      "aria-label",
      game.lastPair ? `Discard pile, ${pairs} pairs. Top: ${game.lastPair.map(cardLabel).join(" and ")}` : "Discard pile, empty",
    );
  }

  private renderHand(priv: OldMaidPrivateState | null) {
    const hand = priv?.hand ?? [];
    const keep = new Set(hand.map((c) => c.id));

    for (const [id, el] of this.cards) {
      el.classList.remove("fresh");
      if (!keep.has(id)) {
        el.remove();
        this.cards.delete(id);
      }
    }

    // Cards that show up mid-game were taken: flag them so they're easy to spot.
    const taking = this.cards.size > 0;
    let fresh: HTMLElement | null = null;
    hand.forEach((card, i) => {
      let el = this.cards.get(card.id);
      if (!el) {
        el = cardFace(card);
        el.setAttribute("role", "listitem");
        this.cards.set(card.id, el);
        if (taking) {
          el.classList.add("fresh");
          fresh = el;
        }
      }
      if (this.hand.children[i] !== el) this.hand.insertBefore(el, this.hand.children[i] ?? null);
    });
    (fresh as HTMLElement | null)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private renderDock(props: GameViewProps, game: OldMaidPublicState, myTurn: boolean) {
    const mine = game.players.find((p) => p.id === props.playerId);
    replaceChildren(
      this.me,
      mine?.outPlace
        ? h("span", { class: "you" }, `You're out · ${ordinal(mine.outPlace)}`)
        : [
            h("span", { class: "you" }, "Your hand"),
            mine ? h("span", { class: "count" }, `${mine.cardCount} ${mine.cardCount === 1 ? "card" : "cards"}`) : null,
          ],
      mine && game.dealerId === props.playerId ? h("span", { class: "om-dealer", title: "Dealer" }, "D") : null,
    );

    let action: Node | null = null;
    if (game.currentPlayerId === null) action = null;
    else if (!myTurn) action = mine?.outPlace ? h("span", { class: "hint" }, "Watching") : h("span", { class: "hint" }, "Not your turn yet");
    else if (this.selected !== null) action = h("button", { type: "button", class: "primary", onclick: () => this.takeSelected() }, "Take it");
    else action = h("span", { class: "hint strong" }, directPlay() ? "Click a card above" : "Tap a card above");
    replaceChildren(this.action, action);
  }

  // ---- interaction --------------------------------------------------------

  private onSlotTap(slot: number) {
    const game = this.props?.game as OldMaidPublicState | undefined;
    if (!game || game.currentPlayerId !== this.props!.playerId) return;
    if (directPlay() || this.selected === slot) {
      this.selected = slot;
      this.takeSelected();
      return;
    }
    this.selected = slot;
    this.render(this.props!, { quiet: true });
    this.slots[slot]?.focus();
  }

  private takeSelected() {
    const slot = this.selected;
    if (slot === null) return;
    this.pending.add(this.api.act({ type: "take", slot }));
    // Lock the fan until the server answers: one take per turn.
    for (const b of this.slots) b.disabled = true;
    this.slots[slot]?.classList.add("selected");
    replaceChildren(this.action, h("span", { class: "hint" }, "Taking…"));
  }

  private onFanKey = (e: KeyboardEvent) => {
    const buttons = this.slots;
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
  };
}
