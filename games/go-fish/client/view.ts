import { AnimationQueue, bubble, fly, once } from "@games/animation";
import { audio } from "@games/audio";
import type { Presence, RoomPublicState } from "@games/protocol";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { compareCards, formatRank, makeCard, rankName, rankPlural } from "../shared/rules.ts";
import { SUITS, type AskRecord, type Card, type GoFishEvent, type GoFishPrivateState, type GoFishPublicState, type Rank } from "../shared/types.ts";
import { cardBackFull, cardBackMini, cardFace, cardLabel, cardShort, handCard } from "./cards.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
  left: "left",
};

/** A dealt card is mostly see-through for its first ~80ms of rise. */
const DEAL_SOUND_LAG = 80;

/**
 * Mouse users ask on the click that completes the question (rank + who).
 * Touch picks both, then presses Ask: a stray tap mid-scroll shouldn't
 * spend your turn.
 */
const directPlay = () => matchMedia("(hover: hover) and (pointer: fine)").matches;

/** How far each card of a book sits from the last (matches .gf-book in styles.css). */
const BOOK_STEP = 14;
/** Asks shown under the table. The server keeps a few more. */
const HEARD_LINES = 3;

const plural = (rank: Rank) => rankPlural(rank).toLowerCase();
/** "a seven", "an eight", "three sevens". */
function howMany(n: number, rank: Rank): string {
  if (n === 1) return `${rank === 1 || rank === 8 ? "an" : "a"} ${rankName(rank).toLowerCase()}`;
  return `${["no", "one", "two", "three"][n] ?? n} ${plural(rank)}`;
}

function describe(e: GoFishEvent, props: GameViewProps): string | null {
  const me = props.playerId;
  const who = (id: string) => (id === me ? "You" : seatName(props.room, id));
  const whom = (id: string) => (id === me ? "you" : seatName(props.room, id));
  switch (e.type) {
    case "dealt":
      return `${who(e.dealerId)} dealt. ${e.pondCount} cards in the pond.`;
    case "asked":
      return `${who(e.playerId)} asked ${whom(e.targetId)} for ${plural(e.rank)}.`;
    case "handed":
      return `${who(e.fromId)} handed ${whom(e.toId)} ${howMany(e.cards.length, e.cards[0]!.rank)}.`;
    case "go-fish":
      return `${who(e.playerId)}: "Go fish."`;
    case "drew":
      if (e.shown) return `${who(e.playerId)} fished up ${cardShort(e.shown)}. Go again.`;
      // You get the private version instead.
      if (e.playerId === me) return null;
      return e.refill ? `${who(e.playerId)} ran out and drew ${e.count}.` : `${who(e.playerId)} drew one.`;
    case "you-drew":
      return `You drew ${e.cards.map(cardShort).join(" ")}.`;
    case "booked":
      return `${who(e.playerId)} made a book of ${plural(e.rank)}.`;
    case "went-out":
      return e.playerId === me ? "You're out of cards, and the pond's empty. You're done." : `${who(e.playerId)}'s out of cards.`;
    case "turn-skipped":
      return `${who(e.playerId)} got skipped by the host.`;
    case "player-removed":
      return e.returned ? `${who(e.playerId)} left. Their ${e.returned} cards went back in the pond.` : `${who(e.playerId)} left.`;
    case "game-over":
      return e.reason === "abandoned" ? "Everyone else left." : null;
  }
}

/** One line of the table's memory: "Sam → Kim: sevens · got 2". */
function heard(a: AskRecord, props: GameViewProps): HTMLElement {
  const me = props.playerId;
  const name = (id: string) => (id === me ? "You" : seatName(props.room, id));
  const answer =
    a.outcome === "given" ? `got ${a.got}`
    : a.outcome === "caught" ? "go fish · caught one"
    : a.outcome === "dry" ? "go fish · pond's dry"
    : "go fish";
  return h(
    "li",
    { class: a.outcome === "given" || a.outcome === "caught" ? "hit" : "" },
    h("span", { class: "who" }, `${name(a.playerId)} → ${name(a.targetId)}`),
    h("b", {}, formatRank(a.rank)),
    h("span", { class: "answer" }, answer),
  );
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

const bookCards = (rank: Rank): Card[] => SUITS.map((s) => makeCard(s, rank));

export class GoFishView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "go-fish" });
  private status = h("div", { class: "gf-status", role: "status", "aria-live": "polite" });
  private opponents = h("div", { class: "gf-opponents", role: "group", "aria-label": "Other players" });
  private pond = h("div", { class: "gf-pond", role: "img" });
  private book = h("div", { class: "gf-book", role: "img" });
  private bookCount = h("span", { class: "gf-book-count" });
  private heard = h("ol", { class: "gf-heard", "aria-label": "Recent asks" });
  private log = h("p", { class: "gf-log", "aria-live": "polite" });
  private me = h("div", { class: "gf-me" });
  private action = h("div", { class: "gf-action" });
  private hand = h("div", { class: "gf-hand", role: "toolbar", "aria-label": "Your hand" });

  /** Keyed so updates keep scroll position and focus (§8). */
  private cards = new Map<string, HTMLButtonElement>();
  /** The question being put together: a rank from your hand, someone to ask. */
  private rank: Rank | null = null;
  private target: string | null = null;
  /** Sent, waiting on the server: one ask at a time. */
  private asking = false;
  private pending = new Set<string>();

  /** Events act out first, settled state lands after (§19). */
  private queue = new AnimationQueue();
  private wasMyTurn = false;

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(
      this.status,
      this.opponents,
      h(
        "div",
        { class: "gf-table", role: "group", "aria-label": "Table" },
        h("div", { class: "gf-spot" }, this.pond),
        h("div", { class: "gf-spot" }, this.book, this.bookCount),
      ),
      this.heard,
      this.log,
      h("div", { class: "gf-dock" }, h("div", { class: "gf-dock-head" }, this.me, this.action), this.hand),
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
    if (this.pending.delete(clientActionId)) {
      this.hand.classList.remove("shake");
      void this.hand.offsetWidth; // restart the animation
      this.hand.classList.add("shake");
    }
    this.asking = false;
    if (this.props) this.render(this.props, "none");
    this.log.textContent = message;
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    const events = props.events as GoFishEvent[];
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
    // A new state from the server answers the last ask, one way or another.
    if (props !== this.props) this.asking = false;
    this.props = props;
    const game = props.game as GoFishPublicState;
    const priv = props.private as GoFishPrivateState | null;
    const myTurn = game.currentPlayerId === props.playerId;
    this.root.classList.toggle("my-turn", myTurn);
    this.root.classList.toggle("finished", game.currentPlayerId === null);
    this.tidySelection(props, game, priv, myTurn);

    this.renderStatus(props.room, game, myTurn);
    this.renderOpponents(props, game, myTurn);
    this.renderTable(game);
    this.renderHeard(props, game);
    this.renderHand(priv, myTurn);
    this.renderDock(props, game, myTurn);

    const events = props.events as GoFishEvent[];
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

  /** Who you could ask right now: seated, and holding something. */
  private targets(props: GameViewProps, game: GoFishPublicState): string[] {
    return game.players.filter((p) => p.id !== props.playerId && !p.removed && p.cardCount > 0).map((p) => p.id);
  }

  /** Drops a half-built question the table has moved past; fills in the only possible target. */
  private tidySelection(props: GameViewProps, game: GoFishPublicState, priv: GoFishPrivateState | null, myTurn: boolean) {
    if (!myTurn) {
      this.rank = null;
      this.target = null;
      return;
    }
    if (this.rank !== null && !priv?.askableRanks.includes(this.rank)) this.rank = null;
    const targets = this.targets(props, game);
    if (this.target && !targets.includes(this.target)) this.target = null;
    if (targets.length === 1) this.target = targets[0]!;
  }

  // ---- animation (§18) ----------------------------------------------------

  /** Acts out one update's events, in order, against the still-old DOM. */
  private async act(events: GoFishEvent[], props: GameViewProps) {
    const me = props.playerId;
    for (const [i, e] of events.entries()) {
      switch (e.type) {
        case "dealt":
          // The table as dealt, books still in hand: they go down next, on camera.
          audio.play("shuffle");
          this.render(this.asDealt(e, events, props), "none");
          await this.dealIn(380);
          break;
        case "asked": {
          const text = e.targetId === me ? `Any ${plural(e.rank)}?` : `${seatName(props.room, e.targetId)}, any ${plural(e.rank)}?`;
          await bubble(this.anchorFor(e.playerId, props), text, "anim-bubble", 1100);
          break;
        }
        case "handed":
          if (e.toId === me) audio.buzz(12);
          await this.flyHanded(e.fromId, e.toId, e.cards);
          break;
        case "go-fish":
          audio.play("pass");
          await bubble(this.anchorFor(e.playerId, props), "Go fish!");
          break;
        case "drew": {
          const next = events[i + 1];
          const mine = e.playerId === me && next?.type === "you-drew" ? next.cards : null;
          await this.flyFromPond(e.playerId, mine ?? (e.shown ? [e.shown] : null), e.count);
          if (e.shown) await bubble(this.anchorFor(e.playerId, props), `${howMany(1, e.shown.rank).replace(/^a/, "A")}!`);
          break;
        }
        case "booked":
          await this.flyBook(e.playerId, e.cards);
          if (e.playerId === me) audio.buzz([20, 40, 20]);
          break;
        case "went-out":
          await bubble(this.anchorFor(e.playerId, props), "Out");
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

  private eventSounds(events: GoFishEvent[]) {
    const types = new Set(events.map((e) => e.type));
    if (types.has("dealt")) audio.play("shuffle");
    if (types.has("drew")) audio.play("deal");
    if (types.has("handed") || types.has("booked")) audio.play("card-place");
    if (types.has("go-fish") || types.has("turn-skipped")) audio.play("pass");
  }

  /**
   * This update's state as it stood right after the deal: hands at their
   * dealt sizes, your books still in yours, nothing down.
   */
  private asDealt(dealt: Extract<GoFishEvent, { type: "dealt" }>, events: GoFishEvent[], props: GameViewProps): GameViewProps {
    const game = props.game as GoFishPublicState;
    const priv = props.private as GoFishPrivateState | null;
    const booked = events.flatMap((x) => (x.type === "booked" && x.playerId === props.playerId ? x.cards : []));
    return {
      ...props,
      game: {
        ...game,
        players: game.players.map((p) => ({ ...p, cardCount: dealt.handSizes[p.id] ?? p.cardCount, books: [] })),
        lastBook: null,
        booksDown: 0,
      } satisfies GoFishPublicState,
      private: priv && { ...priv, hand: [...priv.hand, ...booked].sort(compareCards) },
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

  private cardSize(): DOMRect {
    return (this.hand.firstElementChild ?? this.pond.firstElementChild ?? this.pond).getBoundingClientRect();
  }

  /**
   * Puts incoming cards in their sorted spots, hidden, so flights have real
   * targets and the hand makes room. The caller shows them on landing.
   */
  private makeRoom(cards: Card[]): HTMLButtonElement[] {
    const hand = [...((this.props?.private as GoFishPrivateState | null)?.hand ?? []), ...cards];
    return cards
      .filter((c) => !this.cards.has(c.id))
      .map((card) => {
        const next = hand.filter((c) => compareCards(c, card) > 0 && this.cards.has(c.id)).sort(compareCards)[0];
        const btn = this.handButton(card);
        btn.style.visibility = "hidden";
        this.hand.insertBefore(btn, next ? this.cards.get(next.id)! : null);
        return btn;
      });
  }

  /** Handed over face up, from the giver (your hand, if it's you) to the asker. */
  private async flyHanded(fromId: string, toId: string, cards: Card[]) {
    const props = this.props;
    if (!props) return;
    const me = props.playerId;
    const size = this.cardSize();
    const froms = cards.map((c) => {
      const el = fromId === me ? this.cards.get(c.id) : undefined;
      const r = el ? el.getBoundingClientRect() : this.cardRectAt(this.anchorFor(fromId, props), size);
      if (el) el.style.visibility = "hidden"; // settle removes it
      return r;
    });
    const landing = toId === me ? this.makeRoom(cards) : [];
    landing[0]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    audio.play("card-place");
    await Promise.all(
      cards.map(async (card, i) => {
        await new Promise((r) => setTimeout(r, i * 70));
        const el = landing.find((b) => b.dataset.card === card.id);
        const to = el ? el.getBoundingClientRect() : this.cardRectAt(this.anchorFor(toId, props), size);
        try {
          await fly(cardFace(card), froms[i]!, to, 340);
        } finally {
          if (el) el.style.visibility = "";
        }
      }),
    );
  }

  /**
   * Out of the pond. Yours (or a catch you show) face up, anyone else's face
   * down onto their chip. A refill is up to five, a little staggered.
   */
  private async flyFromPond(playerId: string, faces: Card[] | null, count: number) {
    const props = this.props;
    if (!props) return;
    const from = (this.pond.firstElementChild ?? this.pond).getBoundingClientRect();
    const landing = playerId === props.playerId && faces ? this.makeRoom(faces) : [];
    landing[0]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        await new Promise((r) => setTimeout(r, i * 80));
        audio.play("deal");
        const card = faces?.[i];
        const el = card && landing.find((b) => b.dataset.card === card.id);
        const to = el ? el.getBoundingClientRect() : this.cardRectAt(this.anchorFor(playerId, props), from);
        try {
          await fly(card ? cardFace(card) : cardBackFull(), from, to, 300);
        } finally {
          if (el) el.style.visibility = "";
        }
      }),
    );
  }

  /** A book goes down: four cards to their spots on the table, the count ticking over. */
  private async flyBook(playerId: string, cards: Card[]) {
    const props = this.props;
    if (!props) return;
    const pile = this.book.getBoundingClientRect();
    const w = pile.width - BOOK_STEP * 3;
    const size = new DOMRect(0, 0, w, pile.height);
    const froms = cards.map((c) => {
      const el = playerId === props.playerId ? this.cards.get(c.id) : undefined;
      const r = el ? el.getBoundingClientRect() : this.cardRectAt(this.anchorFor(playerId, props), size);
      if (el) el.style.visibility = "hidden";
      return r;
    });
    const landed: HTMLElement[] = [];
    await Promise.all(
      cards.map(async (card, i) => {
        await new Promise((r) => setTimeout(r, i * 60));
        await fly(cardFace(card), froms[i]!, new DOMRect(pile.left + i * BOOK_STEP, pile.top, w, pile.height), 320, { handoff: true });
        landed[i] = once(cardFace(card), "landed");
        if (i === 0) {
          replaceChildren(this.book, landed[0]!);
          this.book.dataset.rank = "";
        } else {
          this.book.append(landed[i]!);
        }
        audio.play("card-place");
      }),
    );
    this.book.dataset.rank = String(cards[0]!.rank);
    const game = props.game as GoFishPublicState;
    this.setBooksDown(Math.min(game.booksDown, Number(this.bookCount.dataset.down ?? 0) + 1));
  }

  /**
   * Cards slide up into the hand one by one. From below rather than from the
   * table: the hand is a scroller and clips anything outside it.
   */
  private async dealIn(after = 0) {
    const cards = [...this.hand.children] as HTMLElement[];
    const flights = cards.map((el, i) => {
      const delay = after + i * 60;
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

  private renderStatus(room: RoomPublicState, game: GoFishPublicState, myTurn: boolean) {
    // Once finished, the room's results panel announces the winner.
    this.status.hidden = game.currentPlayerId === null;
    if (this.status.hidden) return;
    const seat = room.seats.find((s) => s.id === game.currentPlayerId);
    const away = seat && seat.presence !== "connected" ? ` (${PRESENCE_LABEL[seat.presence]})` : "";
    replaceChildren(
      this.status,
      myTurn
        ? h("span", {}, "Your turn: ask someone")
        : [seat ? avatar(seat.name, seat.avatarSeed, "sm") : null, h("span", {}, `${seat?.name ?? "Someone"} is asking${away}`)],
    );
  }

  /** Opponent chips double as the "who to ask" buttons on your turn. */
  private renderOpponents(props: GameViewProps, game: GoFishPublicState, myTurn: boolean) {
    const targets = new Set(myTurn ? this.targets(props, game) : []);
    replaceChildren(
      this.opponents,
      fromMyLeft(game.players, props.playerId).map((p) => {
        const seat = props.room.seats.find((s) => s.id === p.id);
        const away = seat && seat.presence !== "connected" && !p.removed;
        const name = seat?.name ?? "?";
        const current = p.id === game.currentPlayerId;
        const picked = p.id === this.target && myTurn;
        const canPick = targets.has(p.id) && !this.asking;
        const books = p.books.length;
        const holding = p.removed ? "left" : p.out ? "out of cards" : `${p.cardCount} ${p.cardCount === 1 ? "card" : "cards"}`;
        const bookText = `${books} ${books === 1 ? "book" : "books"}`;
        const chip = h(
          "button",
          {
            type: "button",
            class: `gf-opp${current ? " current" : ""}${picked ? " picked" : ""}${canPick ? " askable" : ""}${away || p.removed ? " away" : ""}`,
            "data-player": p.id,
            disabled: !canPick,
            "aria-pressed": String(picked),
            "aria-label": `${name}: ${holding}, ${bookText}${current ? ", asking now" : ""}${away ? `, ${PRESENCE_LABEL[seat!.presence]}` : ""}${canPick ? ". Ask them" : ""}`,
            title: books ? `Books: ${p.books.map(formatRank).join(" ")}` : undefined,
            onclick: () => this.onTargetTap(p.id),
          },
          seat ? avatar(name, seat.avatarSeed) : null,
          h(
            "span",
            { class: "gf-opp-text", "aria-hidden": "true" },
            h("span", { class: "name" }, name, p.id === game.dealerId ? h("span", { class: "gf-dealer", title: "Dealer" }, "D") : null),
            h(
              "span",
              { class: "count" },
              p.removed || p.out ? holding : [cardBackMini(), ` ${p.cardCount}`],
              h("span", { class: "books" }, ` · ${bookText}`),
              away ? h("span", { class: "away-label" }, ` · ${PRESENCE_LABEL[seat!.presence]}`) : null,
            ),
          ),
        );
        return chip;
      }),
    );
  }

  private setBooksDown(n: number) {
    this.bookCount.dataset.down = String(n);
    this.bookCount.textContent = n ? `${n} of 13 books` : "No books yet";
  }

  private renderTable(game: GoFishPublicState) {
    this.pond.classList.toggle("empty", game.pondCount === 0);
    this.pond.setAttribute("aria-label", `Pond, ${game.pondCount} ${game.pondCount === 1 ? "card" : "cards"}`);
    replaceChildren(
      this.pond,
      game.pondCount ? cardBackFull() : h("span", { class: "gf-card slot", "aria-hidden": "true" }),
      h("span", { class: "gf-pond-count", "aria-hidden": "true" }, game.pondCount ? `Pond · ${game.pondCount}` : "Pond's empty"),
    );

    // Already showing (it just landed): leave it be, landing and all.
    const key = game.lastBook === null ? "" : String(game.lastBook);
    if (this.book.dataset.rank !== key) {
      this.book.dataset.rank = key;
      replaceChildren(
        this.book,
        game.lastBook === null ? h("span", { class: "gf-card slot", "aria-hidden": "true" }) : bookCards(game.lastBook).map((c) => cardFace(c)),
      );
    }
    this.setBooksDown(game.booksDown);
    this.book.setAttribute(
      "aria-label",
      game.lastBook === null ? "No books down yet" : `${game.booksDown} of 13 books down. Latest: ${plural(game.lastBook)}`,
    );
  }

  private renderHeard(props: GameViewProps, game: GoFishPublicState) {
    const recent = game.asks.slice(-HEARD_LINES).reverse();
    this.heard.hidden = !recent.length;
    replaceChildren(this.heard, recent.map((a) => heard(a, props)));
  }

  private renderHand(priv: GoFishPrivateState | null, myTurn: boolean) {
    const hand = priv?.hand ?? [];
    const keep = new Set(hand.map((c) => c.id));

    for (const [id, btn] of this.cards) {
      if (!keep.has(id)) {
        btn.remove();
        this.cards.delete(id);
      }
    }

    // Cards that show up mid-game were handed or drawn: flag them. (Ones that
    // flew in are already here, flagged by the flight.)
    const arriving = this.cards.size > 0;
    let fresh: HTMLButtonElement | null = null;
    hand.forEach((card, i) => {
      let btn = this.cards.get(card.id);
      if (!btn) {
        btn = this.handButton(card);
        if (arriving) fresh = once(btn, "fresh");
      }
      const picked = myTurn && card.rank === this.rank;
      btn.classList.toggle("selected", picked);
      btn.classList.toggle("askable", myTurn);
      btn.disabled = this.asking;
      btn.setAttribute("aria-pressed", String(picked));
      btn.setAttribute("aria-label", `${cardLabel(card)}${myTurn ? `. Ask for ${plural(card.rank)}` : ""}`);
      if (this.hand.children[i] !== btn) this.hand.insertBefore(btn, this.hand.children[i] ?? null);
    });
    (fresh as HTMLButtonElement | null)?.scrollIntoView({ block: "nearest", inline: "nearest" });

    // Roving tabindex: one tab stop into the hand, arrows within it (§38).
    const focusTarget = [...this.cards.values()].find((b) => b.classList.contains("selected")) ?? this.hand.firstElementChild;
    for (const btn of this.cards.values()) btn.tabIndex = btn === focusTarget ? 0 : -1;
  }

  private handButton(card: Card): HTMLButtonElement {
    const btn = handCard(card);
    btn.addEventListener("click", () => this.onCardTap(card.rank));
    this.cards.set(card.id, btn);
    return btn;
  }

  private renderDock(props: GameViewProps, game: GoFishPublicState, myTurn: boolean) {
    const mine = game.players.find((p) => p.id === props.playerId);
    const books = mine?.books.length ?? 0;
    replaceChildren(
      this.me,
      h("span", { class: "you" }, mine?.out ? "Out of cards" : "Your hand"),
      mine
        ? h(
            "span",
            { class: "count" },
            `${mine.out ? "" : `${mine.cardCount} ${mine.cardCount === 1 ? "card" : "cards"} · `}${books} ${books === 1 ? "book" : "books"}`,
          )
        : null,
      mine && game.dealerId === props.playerId ? h("span", { class: "gf-dealer", title: "Dealer" }, "D") : null,
    );

    let action: Node | null = null;
    if (game.currentPlayerId === null) action = null;
    else if (!myTurn) action = h("span", { class: "hint" }, mine?.out ? "Watching" : "Not your turn yet");
    else if (this.asking) action = h("span", { class: "hint" }, "Asking…");
    else if (this.rank !== null && this.target) {
      action = h(
        "button",
        { type: "button", class: "primary", onclick: () => this.sendAsk() },
        `Ask ${seatName(props.room, this.target)} for ${plural(this.rank)}`,
      );
    } else if (this.rank !== null) action = h("span", { class: "hint strong" }, "Now pick who to ask");
    else action = h("span", { class: "hint strong" }, directPlay() ? "Click a rank to ask for" : "Tap a rank to ask for");
    replaceChildren(this.action, action);
  }

  // ---- interaction --------------------------------------------------------

  private myTurn(): boolean {
    const game = this.props?.game as GoFishPublicState | undefined;
    return !!game && game.currentPlayerId === this.props!.playerId;
  }

  private rerender() {
    if (this.props) this.render(this.props, "none");
  }

  private onCardTap(rank: Rank) {
    if (!this.props || this.asking) return;
    if (!this.myTurn()) {
      this.log.textContent = "Not your turn yet.";
      return;
    }
    // Tapping the picked rank again puts it back (touch), or asks (mouse, with someone picked).
    if (this.rank === rank && !(directPlay() && this.target)) this.rank = null;
    else this.rank = rank;
    if (directPlay() && this.rank !== null && this.target) return this.sendAsk();
    this.rerender();
  }

  private onTargetTap(playerId: string) {
    if (!this.props || this.asking || !this.myTurn()) return;
    this.target = playerId;
    if (directPlay() && this.rank !== null) return this.sendAsk();
    this.rerender();
  }

  private sendAsk() {
    if (this.rank === null || !this.target || this.asking) return;
    this.pending.add(this.api.act({ type: "ask", targetId: this.target, rank: this.rank }));
    this.asking = true;
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
