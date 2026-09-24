import { AnimationQueue, bubble, fly, once } from "@games/animation";
import { audio } from "@games/audio";
import type { Presence, RoomPublicState } from "@games/protocol";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { compareCards, ordinal } from "../shared/rules.ts";
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
/** A dealt card is mostly see-through for its first ~80ms of rise. */
const DEAL_SOUND_LAG = 80;

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

/**
 * Which sounds a render makes. "all": nothing was acted out, so the events'
 * sounds play here. "cues": the animations made those, only the turn chime
 * and the ending are left. "none": a redraw mid-show, or of the same state.
 */
type Sounds = "all" | "cues" | "none";

/** How far the pile's second card sits from its first (matches .om-pile in styles.css). */
const PILE_OFFSET = { x: 14, y: 8 };

const pairKey = (pair: Card[]) => pair.map((c) => c.id).join("+");

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
  /** Cards that came in this update: highlighted until the next one. */
  private fresh = new Set<string>();
  /** Pairs the pile says are down, so flights can count up from it. */
  private pairsDown = 0;

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
    if (this.props) this.render(this.props, "none");
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
      this.fresh.clear();
      this.render(props, "none");
      return;
    }
    let acted = false;
    this.queue.push({
      animate: events.length
        ? async () => {
            acted = true;
            this.fresh.clear();
            await this.act(events, props);
          }
        : undefined,
      // Sounds ride on the animations; if those were skipped, play them here.
      settle: () => {
        if (!acted) this.fresh.clear();
        this.render(props, acted ? "cues" : "all");
      },
    });
  }

  private render(props: GameViewProps, sounds: Sounds) {
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

    if (sounds !== "none") {
      if (sounds === "all") this.eventSounds(events);
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
    // Mid-show redraws leave it alone, so the chime waits for the settled turn.
    if (sounds !== "none" || props.snapshot) this.wasMyTurn = myTurn;
  }

  // ---- animation (§18) ----------------------------------------------------

  /** Acts out one update's events, in order, against the still-old DOM. */
  private async act(events: OldMaidEvent[], props: GameViewProps) {
    for (const [i, e] of events.entries()) {
      switch (e.type) {
        case "dealt":
          // The table as dealt, pairs still in hand: they go down next, on camera.
          // Painted now (hand held back), the riffle gets a beat, then the hand fans in.
          audio.play("shuffle");
          this.render(this.asDealt(e, events, props), "none");
          await this.dealIn(380);
          break;
        case "took": {
          // Only the taker and the one taken from get to see the card.
          const mine = events
            .slice(i + 1)
            .find(
              (x): x is Extract<OldMaidEvent, { type: "you-took" | "taken-from-you" }> =>
                (x.type === "you-took" && x.fromId === e.fromId) || (x.type === "taken-from-you" && x.byId === e.playerId),
            );
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
          await this.flyPairs(e.playerId, e.pairs);
          break;
        case "went-out":
          await bubble(this.anchorFor(e.playerId, props), e.playerId === props.playerId ? "You're out!" : "Out!");
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

  private eventSounds(events: OldMaidEvent[]) {
    const types = new Set(events.map((e) => e.type));
    if (types.has("dealt")) audio.play("shuffle");
    if (types.has("took")) audio.play("deal");
    if (types.has("discarded")) audio.play("card-place");
    if (types.has("turn-skipped")) audio.play("pass");
  }

  /**
   * This update's state as it stood right after the deal: hands at their
   * dealt sizes, your pairs still in yours, nothing on the pile.
   */
  private asDealt(dealt: Extract<OldMaidEvent, { type: "dealt" }>, events: OldMaidEvent[], props: GameViewProps): GameViewProps {
    const game = props.game as OldMaidPublicState;
    const priv = props.private as OldMaidPrivateState | null;
    const paired = events.flatMap((x) => (x.type === "discarded" && x.playerId === props.playerId ? x.pairs.flat() : []));
    return {
      ...props,
      game: {
        ...game,
        players: game.players.map((p) => ({ ...p, cardCount: dealt.handSizes[p.id] ?? p.cardCount, outPlace: null })),
        discardCount: 0,
        lastPair: null,
        loserId: null,
        loserCard: null,
      } satisfies OldMaidPublicState,
      private: priv && { ...priv, hand: [...priv.hand, ...paired].sort(compareCards) },
    };
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
    // The sound goes with the card leaving, not with the beat before it.
    audio.play("deal");

    if (takerId !== me || !card || this.cards.has(card.id)) {
      await fly(card ? cardFace(card) : cardBackFull(), from, this.cardRectAt(this.anchorFor(takerId, props), size), 340);
      return;
    }
    // Yours: put it in its sorted spot first, hidden, so the flight has a real
    // target, the hand makes room, and a pair it makes can leave from there.
    const hand = (props.private as OldMaidPrivateState | null)?.hand ?? [];
    const next = hand.find((c) => compareCards(c, card) > 0 && this.cards.has(c.id));
    const el = this.handCard(card);
    el.style.visibility = "hidden";
    this.hand.insertBefore(el, next ? this.cards.get(next.id)! : null);
    this.fresh.add(card.id);
    el.classList.add("fresh");
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    try {
      await fly(cardFace(card), from, el.getBoundingClientRect(), 340);
    } finally {
      el.style.visibility = "";
    }
  }

  /**
   * Pairs go down face up onto the pile. A player's pairs fly together, a
   * little staggered: after the deal that's a dozen of them, and nobody wants
   * to sit through a dozen flights each.
   */
  private async flyPairs(playerId: string, pairs: Card[][]) {
    const props = this.props;
    if (!props) return;
    // Where each card of a pair sits on the pile: the second one offset (see .om-pile).
    const pile = this.pile.getBoundingClientRect();
    const w = pile.width - PILE_OFFSET.x;
    const h = pile.height - PILE_OFFSET.y;
    const spots = [new DOMRect(pile.left, pile.top, w, h), new DOMRect(pile.left + PILE_OFFSET.x, pile.top + PILE_OFFSET.y, w, h)];
    // Same length flights, launched in order, so they land in order too.
    await Promise.all(
      pairs.map((pair, p) =>
        Promise.all(
          pair.map(async (card, c) => {
            const el = playerId === props.playerId ? this.cards.get(card.id) : undefined;
            const to = spots[c] ?? spots[0]!;
            const from = el ? el.getBoundingClientRect() : this.cardRectAt(this.anchorFor(playerId, props), to);
            if (el) el.style.visibility = "hidden";
            await new Promise((r) => setTimeout(r, (p * 2 + c) * 50));
            await fly(cardFace(card), from, to, 300, { handoff: true });
            const landed = once(cardFace(card), "landed");
            if (c === 0) {
              replaceChildren(this.pile, landed);
              delete this.pile.dataset.pair;
            } else {
              this.pile.append(landed);
              this.pile.dataset.pair = pairKey(pair);
              this.setPairsDown(this.pairsDown + 1);
              audio.play("card-place");
            }
          }),
        ),
      ),
    );
  }

  /**
   * Cards slide up into the hand one by one. From below rather than from the
   * table: the hand is a scroller and clips anything outside it.
   */
  private async dealIn(after = 0) {
    const cards = [...this.hand.children] as HTMLElement[];
    const flights = cards.map((el, i) => {
      const delay = after + i * 50;
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

  private setPairsDown(pairs: number) {
    this.pairsDown = pairs;
    this.pileCount.textContent = pairs ? `${pairs} ${pairs === 1 ? "pair" : "pairs"} down` : "No pairs yet";
  }

  private renderPile(game: OldMaidPublicState) {
    // Already showing (it just landed): leave it be, landing and all.
    const key = game.lastPair ? pairKey(game.lastPair) : "";
    if (this.pile.dataset.pair !== key) {
      this.pile.dataset.pair = key;
      replaceChildren(this.pile, game.lastPair ? game.lastPair.map((c) => cardFace(c)) : h("span", { class: "om-card slot", "aria-hidden": "true" }));
    }
    const pairs = game.discardCount / 2;
    this.setPairsDown(pairs);
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
      if (!keep.has(id)) {
        el.remove();
        this.cards.delete(id);
      }
    }

    // Cards that show up mid-game were taken: flag them so they're easy to spot.
    // (Ones that flew in are already here, flagged by the flight.)
    const taking = this.cards.size > 0;
    let fresh: HTMLElement | null = null;
    hand.forEach((card, i) => {
      let el = this.cards.get(card.id);
      if (!el) {
        el = this.handCard(card);
        if (taking) {
          this.fresh.add(card.id);
          fresh = once(el, "arrive");
        }
      }
      el.classList.toggle("fresh", this.fresh.has(card.id));
      if (this.hand.children[i] !== el) this.hand.insertBefore(el, this.hand.children[i] ?? null);
    });
    (fresh as HTMLElement | null)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private handCard(card: Card): HTMLElement {
    const el = cardFace(card);
    el.setAttribute("role", "listitem");
    this.cards.set(card.id, el);
    return el;
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
    this.render(this.props!, "none");
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
