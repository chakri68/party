import { AnimationQueue, bubble, fly, once } from "@games/animation";
import { audio } from "@games/audio";
import type { Presence } from "@games/protocol";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { checkPlay, compareCards, ordinal, setName, titleFor } from "../shared/rules.ts";
import type { Card, PresidentEvent, PresidentPrivateState, PresidentPublicState, Title } from "../shared/types.ts";
import { cardBackFull, cardBackMini, cardFace, cardLabel, cardShort, handCard, TITLE_TAG } from "./cards.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
  left: "left",
};

/** A dealt card is mostly see-through for its first ~80ms of rise. */
const DEAL_SOUND_LAG = 80;
/** How long the between-rounds recap holds the table before the next deal. */
const RECAP_MS = 2200;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const the = (title: Title) => (title === "Citizen" ? "a Citizen" : `the ${title}`);

function describe(e: PresidentEvent, props: GameViewProps): string | null {
  const me = props.playerId;
  const who = (id: string) => (id === me ? "You" : seatName(props.room, id));
  const whom = (id: string) => (id === me ? "you" : seatName(props.room, id));
  switch (e.type) {
    case "dealt":
      return `Round ${e.round}. ${who(e.dealerId)} dealt.`;
    case "swapped":
      // The two people involved get the version with the cards in it.
      if (e.fromId === me || e.toId === me) return null;
      return e.kind === "tribute"
        ? `${who(e.fromId)} handed ${whom(e.toId)} their best ${e.count === 1 ? "card" : e.count}.`
        : `${who(e.fromId)} gave ${whom(e.toId)} ${e.count} back.`;
    case "swap-cards": {
      const list = e.cards.map(cardShort).join(" ");
      if (!e.cards.length) return null;
      return e.fromId === me ? `You gave ${whom(e.toId)} ${list}.` : `${who(e.fromId)} gave you ${list}.`;
    }
    case "played":
      return `${who(e.playerId)} played ${e.cards.map(cardShort).join(" ")}.`;
    case "passed":
      if (!e.auto) return `${who(e.playerId)} passed.`;
      return e.playerId === me ? "Nothing of yours beats it, so you passed." : `${who(e.playerId)} can't beat it.`;
    case "skipped":
      return e.playerId === me ? "Matched: you're skipped." : `Matched: ${who(e.playerId)} is skipped.`;
    case "cleared":
      return `Pile cleared. ${who(e.leaderId)} ${e.leaderId === me ? "lead" : "leads"}.`;
    case "went-out":
      return e.playerId === me ? `You're out, ${ordinal(e.place)}: ${the(e.title)}.` : `${who(e.playerId)}'s out, ${ordinal(e.place)}: ${the(e.title)}.`;
    case "round-over":
      return `Round ${e.round} over.`;
    case "turn-skipped":
      return `${who(e.playerId)} got skipped by the host.`;
    case "player-removed":
      return `${who(e.playerId)} left. Their cards are out of play.`;
    case "game-over":
      return e.reason === "abandoned" ? "Called off: too many people left." : null;
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

const setKey = (cards: Card[]) => cards.map((c) => c.id).join("+");

export class PresidentView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "president" });
  private status = h("div", { class: "pr-status", role: "status", "aria-live": "polite" });
  private opponents = h("div", { class: "pr-opponents", role: "list", "aria-label": "Other players" });
  private roundLabel = h("p", { class: "pr-round" });
  private pile = h("div", { class: "pr-pile" });
  private pileCaption = h("p", { class: "pr-pile-caption" });
  private recap = h("div", { class: "pr-recap", hidden: true });
  private log = h("p", { class: "pr-log", "aria-live": "polite" });
  private me = h("div", { class: "pr-me" });
  private action = h("div", { class: "pr-action" });
  private hand = h("div", { class: "pr-hand", role: "toolbar", "aria-label": "Your hand" });

  /** Keyed so updates keep scroll position, focus and selection (§8). */
  private cards = new Map<string, HTMLButtonElement>();
  private selected = new Set<string>();
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
        { class: "pr-table", role: "group", "aria-label": "Table" },
        this.roundLabel,
        h("div", { class: "pr-pile-wrap" }, this.pile, this.pileCaption),
        this.recap,
      ),
      this.log,
      h("div", { class: "pr-dock" }, h("div", { class: "pr-dock-head" }, this.me, this.action), this.hand),
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
      for (const id of this.selected) {
        const btn = this.cards.get(id);
        if (!btn) continue;
        btn.classList.remove("shake");
        void btn.offsetWidth; // restart the animation
        btn.classList.add("shake");
      }
    }
    this.log.textContent = message;
    this.rerender();
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    const events = props.events as PresidentEvent[];
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
    const game = props.game as PresidentPublicState;
    const priv = props.private as PresidentPrivateState | null;
    const myTurn = game.currentPlayerId === props.playerId;
    const giving = (priv?.mustGive ?? 0) > 0;
    // Waiting on me, one way or the other.
    const onMe = myTurn || giving;
    this.root.classList.toggle("my-turn", onMe);
    this.root.classList.toggle("finished", game.phase === "finished");

    this.renderStatus(props, game, priv, myTurn);
    this.renderOpponents(props, game);
    this.renderTable(props, game);
    this.renderHand(game, priv, myTurn);
    this.renderDock(props, game, priv, myTurn);

    const events = props.events as PresidentEvent[];
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
      if (onMe && !this.wasMyTurn) {
        audio.play("your-turn");
        audio.buzz(25);
      }
    }
    // Mid-show redraws leave it alone, so the chime waits for the settled turn.
    if (sounds !== "none" || props.snapshot) this.wasMyTurn = onMe;
  }

  // ---- animation (§18) ----------------------------------------------------

  /** Acts out one update's events, in order, against the still-old DOM. */
  private async act(events: PresidentEvent[], props: GameViewProps) {
    for (const e of events) {
      switch (e.type) {
        case "dealt":
          // Paint the new table now (hand held back), give the riffle a beat, fan the hand in.
          audio.play("shuffle");
          this.recap.hidden = true;
          this.render(props, "none");
          await this.dealIn(380);
          break;
        case "swap-cards":
          if (e.cards.length) await this.flySwap(e.fromId, e.toId, e.cards);
          break;
        case "swapped":
          // Nobody's hand shows in the air but the two involved, who get swap-cards.
          if (e.fromId !== props.playerId && e.toId !== props.playerId) await this.flySwap(e.fromId, e.toId, null, e.count);
          break;
        case "played":
          await this.flyToPile(e.playerId, e.cards);
          audio.play("card-place");
          if (e.playerId === props.playerId) audio.buzz(12);
          break;
        case "passed":
          audio.play("pass");
          await bubble(this.anchorFor(e.playerId, props), e.auto ? "Can't beat" : "Pass");
          break;
        case "skipped":
          audio.play("pass");
          await bubble(this.anchorFor(e.playerId, props), "Skipped");
          break;
        case "cleared":
          await this.sweepPile();
          break;
        case "went-out":
          await bubble(this.anchorFor(e.playerId, props), e.playerId === props.playerId ? `You're ${e.title}!` : e.title);
          break;
        case "round-over":
          // Hold the table on the result before the next deal wipes it.
          this.pile.parentElement!.hidden = true;
          this.showRecap(e.order, `Round ${e.round}`, props, false);
          await wait(RECAP_MS);
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

  private eventSounds(events: PresidentEvent[]) {
    const types = new Set(events.map((e) => e.type));
    if (types.has("dealt")) audio.play("shuffle");
    if (types.has("played")) audio.play("card-place");
    if (types.has("swapped")) audio.play("deal");
    if (types.has("passed") || types.has("skipped") || types.has("turn-skipped")) audio.play("pass");
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
   * A set goes down. The new pile is laid out first, hidden, so every card
   * has a real spot to fly to; they launch a beat apart and land in order.
   */
  private async flyToPile(playerId: string, set: Card[]) {
    const props = this.props;
    if (!props) return;
    const landing = set.map((c) => cardFace(c));
    for (const el of landing) el.style.visibility = "hidden";
    replaceChildren(this.pile, landing);
    this.pile.dataset.set = setKey(set);
    this.pileCaption.textContent = `${seatName(props.room, playerId)}: ${setName(set.length, set[0]!.rank)}`;
    await Promise.all(
      set.map(async (card, i) => {
        const to = landing[i]!.getBoundingClientRect();
        const mine = playerId === props.playerId ? this.cards.get(card.id) : undefined;
        const from = mine ? mine.getBoundingClientRect() : this.cardRectAt(this.anchorFor(playerId, props), to);
        if (mine) mine.style.visibility = "hidden"; // it's in the air now; settle removes it
        await wait(i * 60);
        await fly(cardFace(card), from, to, 320, { handoff: true });
        landing[i]!.style.visibility = "";
        once(landing[i]!, "landed");
      }),
    );
  }

  /** Everyone passed: the pile slides off the table. */
  private async sweepPile() {
    const cards = [...this.pile.children] as HTMLElement[];
    if (!cards.length || cards[0]!.classList.contains("slot")) return;
    await Promise.all(
      cards.map(
        (el) =>
          el.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(-24px) scale(0.9)", opacity: 0 }], {
            duration: 260,
            easing: "ease-in",
            fill: "forwards",
          }).finished,
      ),
    ).catch(() => {});
    delete this.pile.dataset.set;
    replaceChildren(this.pile, h("span", { class: "pr-card slot", "aria-hidden": "true" }));
  }

  /**
   * Cards changing hands between rounds. Yours fly face up (out of your hand,
   * or into your dock); anyone else's go chip to chip, face down.
   */
  private async flySwap(fromId: string, toId: string, cards: Card[] | null, count = cards?.length ?? 0) {
    const props = this.props;
    if (!props) return;
    audio.play("deal");
    const like = this.pile.getBoundingClientRect();
    const to = this.cardRectAt(this.anchorFor(toId, props), like);
    await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const card = cards?.[i];
        const mine = fromId === props.playerId && card ? this.cards.get(card.id) : undefined;
        const from = mine ? mine.getBoundingClientRect() : this.cardRectAt(this.anchorFor(fromId, props), like);
        if (mine) mine.style.visibility = "hidden";
        await wait(i * 80);
        await fly(card ? cardFace(card) : cardBackFull(), from, to, 380);
      }),
    );
  }

  /**
   * Cards slide up into the hand one by one. From below rather than from the
   * table: the hand is a scroller and clips anything outside it.
   */
  private async dealIn(after = 0) {
    const cards = [...this.hand.children] as HTMLElement[];
    const flights = cards.map((el, i) => {
      const delay = after + i * 45;
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

  private renderStatus(props: GameViewProps, game: PresidentPublicState, priv: PresidentPrivateState | null, myTurn: boolean) {
    // Once finished, the room's results panel announces the winner.
    this.status.hidden = game.phase === "finished";
    if (this.status.hidden) return;
    const room = props.room;
    if (game.phase === "exchange") {
      const owe = game.exchange.find((s) => s.kind === "return" && s.fromId === props.playerId && !s.done);
      if (owe && priv?.mustGive) {
        replaceChildren(this.status, h("span", {}, `Give ${seatName(room, owe.toId)} ${owe.count} back`));
        return;
      }
      const waiting = game.exchange.filter((s) => s.kind === "return" && !s.done).map((s) => seatName(room, s.fromId));
      replaceChildren(this.status, h("span", {}, `Swapping cards: waiting on ${waiting.join(" and ")}`));
      return;
    }
    const seat = room.seats.find((s) => s.id === game.currentPlayerId);
    const away = seat && seat.presence !== "connected" ? ` (${PRESENCE_LABEL[seat.presence]})` : "";
    const leading = !game.top;
    replaceChildren(
      this.status,
      myTurn
        ? h("span", {}, leading ? "Your lead" : `Your turn: beat ${setName(game.top!.cards.length, game.top!.cards[0]!.rank)}`)
        : [
            seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
            h("span", {}, `${seat?.name ?? "Someone"}${away} ${leading ? "leads" : "to play"}`),
          ],
    );
  }

  private renderOpponents(props: GameViewProps, game: PresidentPublicState) {
    // Players in this round: seated, or left after going out.
    const n = game.players.filter((p) => !p.removed || p.place !== null).length;
    replaceChildren(
      this.opponents,
      fromMyLeft(game.players, props.playerId).map((p) => {
        const seat = props.room.seats.find((s) => s.id === p.id);
        const away = seat && seat.presence !== "connected" && !p.removed;
        const name = seat?.name ?? "?";
        const current = p.id === game.currentPlayerId;
        const owes = game.exchange.some((s) => s.kind === "return" && s.fromId === p.id && !s.done);
        const tag = p.title ? TITLE_TAG[p.title] : null;
        const holding = p.removed
          ? "left"
          : p.place
            ? `out ${ordinal(p.place)}, ${titleFor(p.place, n)}`
            : `${p.cardCount} cards${p.passed ? ", passed" : ""}`;
        return h(
          "div",
          {
            class: `pr-opp${current || owes ? " current" : ""}${p.passed ? " passed" : ""}${p.place ? " out" : ""}${away || p.removed ? " away" : ""}`,
            role: "listitem",
            "data-player": p.id,
            "aria-label": `${name}${p.title ? `, ${p.title}` : ""}: ${holding}, ${p.points} points${current ? ", playing now" : ""}${owes ? ", giving cards back" : ""}${away ? `, ${PRESENCE_LABEL[seat!.presence]}` : ""}`,
          },
          seat ? avatar(name, seat.avatarSeed) : null,
          h(
            "div",
            { class: "pr-opp-text", "aria-hidden": "true" },
            h(
              "span",
              { class: "name" },
              name,
              tag ? h("span", { class: `pr-title${p.title === "President" || p.title === "Vice-President" ? " up" : " down"}`, title: p.title! }, tag) : null,
            ),
            h(
              "span",
              { class: "count" },
              p.removed ? "left" : p.place ? `out ${ordinal(p.place)}` : [cardBackMini(), ` ${p.cardCount}`],
              p.passed && !p.place ? h("span", { class: "pass-label" }, " · pass") : null,
              h("span", { class: "pts" }, ` · ${p.points} ${p.points === 1 ? "pt" : "pts"}`),
              away ? h("span", { class: "away-label" }, ` · ${PRESENCE_LABEL[seat!.presence]}`) : null,
            ),
          ),
        );
      }),
    );
  }

  private renderTable(props: GameViewProps, game: PresidentPublicState) {
    const room = props.room;
    this.roundLabel.textContent = `Round ${game.round} of ${game.rounds}${game.matchSkips ? " · match to skip" : ""}`;

    // Between rounds (and at the end), the pile makes way for who came where and who owes what.
    const recap = game.phase !== "playing" && game.lastRound;
    if (recap) this.showRecap(game.lastRound!, `Round ${game.phase === "finished" ? game.round : game.round - 1}`, props);
    else this.recap.hidden = true;
    this.pile.parentElement!.hidden = !!recap;

    const top = game.top;
    const key = top ? setKey(top.cards) : "";
    // Already showing (it just landed): leave it be, landing and all.
    if (this.pile.dataset.set !== key || !this.pile.childElementCount) {
      this.pile.dataset.set = key;
      replaceChildren(this.pile, top ? top.cards.map((c) => cardFace(c)) : h("span", { class: "pr-card slot", "aria-hidden": "true" }));
    }
    this.pileCaption.textContent = top
      ? `${seatName(room, top.playerId)}: ${setName(top.cards.length, top.cards[0]!.rank)}`
      : game.phase === "playing"
        ? `${game.currentPlayerId === props.playerId ? "You lead" : `${seatName(room, game.currentPlayerId)} leads`}: anything goes`
        : "";
    this.pile.setAttribute("role", "img");
    this.pile.setAttribute("aria-label", top ? `To beat: ${top.cards.map(cardLabel).join(", ")}` : "Pile empty");
  }

  /** Last round's order with titles, plus this exchange's swaps. */
  private showRecap(order: string[], heading: string, props: GameViewProps, withSwaps = true) {
    const game = props.game as PresidentPublicState;
    const room = props.room;
    const name = (id: string) => (id === props.playerId ? "You" : seatName(room, id));
    const swaps = withSwaps && game.phase === "exchange" ? game.exchange.filter((s) => s.kind === "return") : [];
    this.recap.hidden = false;
    replaceChildren(
      this.recap,
      h("h3", {}, heading),
      h(
        "ol",
        { class: "pr-order" },
        order.map((id, i) => {
          const title = titleFor(i + 1, order.length);
          return h(
            "li",
            { class: id === props.playerId ? "me" : "" },
            h("span", { class: "place" }, ordinal(i + 1)),
            h("span", { class: "who" }, name(id)),
            h("span", { class: `pr-title${i < order.length / 2 ? " up" : " down"}${title === "Citizen" ? " plain" : ""}` }, title),
          );
        }),
      ),
      swaps.length
        ? h(
            "ul",
            { class: "pr-swaps" },
            // One line per pair: the tribute that went up, and the return coming down.
            swaps.map((s) =>
              h(
                "li",
                { class: s.done ? "done" : "" },
                h("span", {}, `${name(s.toId)} → ${name(s.fromId)}: best ${s.count}`),
                h("span", {}, `${name(s.fromId)} → ${name(s.toId)}: ${s.done ? `${s.count} back` : "picking…"}`),
              ),
            ),
          )
        : null,
    );
  }

  private renderHand(game: PresidentPublicState, priv: PresidentPrivateState | null, myTurn: boolean) {
    const hand = priv?.hand ?? [];
    const playable = new Set(priv?.playableRanks ?? []);
    const got = new Set(game.phase === "exchange" ? (priv?.got ?? []).map((c) => c.id) : []);
    const giving = (priv?.mustGive ?? 0) > 0;
    const keep = new Set(hand.map((c) => c.id));

    for (const [id, btn] of this.cards) {
      if (!keep.has(id)) {
        btn.remove();
        this.cards.delete(id);
      }
    }
    for (const id of this.selected) if (!keep.has(id) || !(myTurn || giving)) this.selected.delete(id);

    hand.forEach((card, i) => {
      let btn = this.cards.get(card.id);
      if (!btn) btn = this.handButton(card);
      btn.style.visibility = "";
      const canPlay = myTurn && playable.has(card.rank);
      const picked = this.selected.has(card.id);
      btn.classList.toggle("playable", canPlay || giving);
      btn.classList.toggle("selected", picked);
      btn.classList.toggle("got", got.has(card.id));
      btn.setAttribute("aria-label", `${cardLabel(card)}${got.has(card.id) ? ", just given to you" : ""}${canPlay ? ", playable" : ""}`);
      btn.setAttribute("aria-pressed", String(picked));
      if (this.hand.children[i] !== btn) this.hand.insertBefore(btn, this.hand.children[i] ?? null);
    });

    // Roving tabindex: one tab stop into the hand, arrows within it (§38).
    const focusTarget =
      [...this.cards.values()].find((b) => b.classList.contains("selected")) ||
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

  private renderDock(props: GameViewProps, game: PresidentPublicState, priv: PresidentPrivateState | null, myTurn: boolean) {
    const mine = game.players.find((p) => p.id === props.playerId);
    const n = game.players.filter((p) => !p.removed || p.place !== null).length;
    const pts = mine ? `${mine.points} ${mine.points === 1 ? "pt" : "pts"}` : "";
    replaceChildren(
      this.me,
      mine?.place
        ? h("span", { class: "you" }, `You're out · ${titleFor(mine.place, n)}`)
        : h("span", { class: "you" }, "Your hand"),
      mine?.title && TITLE_TAG[mine.title]
        ? h("span", { class: `pr-title${mine.title.includes("President") ? " up" : " down"}`, title: mine.title }, TITLE_TAG[mine.title])
        : null,
      mine ? h("span", { class: "count" }, mine.place ? pts : `${mine.cardCount} ${mine.cardCount === 1 ? "card" : "cards"} · ${pts}`) : null,
    );

    const picked = this.pickedCards();
    let action: Node | Node[] | null = null;
    if (game.phase === "finished") {
      action = null;
    } else if (priv?.mustGive) {
      const k = priv.mustGive;
      action = h(
        "button",
        { type: "button", class: "primary", disabled: picked.length !== k, onclick: () => this.give() },
        picked.length === k ? `Give ${picked.map(cardShort).join(" ")}` : `Pick ${k - picked.length} to give`,
      );
    } else if (!myTurn) {
      action = h("span", { class: "hint" }, mine?.place ? "Watching" : game.phase === "exchange" ? "Swapping…" : "Not your turn yet");
    } else {
      const why = picked.length ? checkPlay(picked, game.top, game.matchSkips) : null;
      action = [
        priv?.canPass ? h("button", { type: "button", onclick: () => this.pass() }, "Pass") : null,
        picked.length
          ? h(
              "button",
              { type: "button", class: "primary", disabled: !!why, title: why ?? undefined, onclick: () => this.playSelected() },
              `Play ${setName(picked.length, picked[0]!.rank).replace(/^a /, "")}`,
            )
          : h("span", { class: "hint strong" }, game.top ? "Pick cards to beat it" : "Pick a set to lead"),
      ].filter((x): x is HTMLElement => !!x);
    }
    replaceChildren(this.action, action);
  }

  // ---- interaction --------------------------------------------------------

  private pickedCards(): Card[] {
    const hand = (this.props?.private as PresidentPrivateState | null | undefined)?.hand ?? [];
    return hand.filter((c) => this.selected.has(c.id)).sort(compareCards);
  }

  private rerender() {
    if (this.props) this.render(this.props, "none");
  }

  /**
   * Picking a set. In the exchange, any cards up to the count owed. In play,
   * a set is one rank: tapping another rank starts over, and when following,
   * the first tap picks as many of that rank as the trick needs (lowest
   * suits), so a pair is one tap, not two.
   */
  private onCardTap(cardId: string) {
    const props = this.props;
    if (!props) return;
    const game = props.game as PresidentPublicState;
    const priv = props.private as PresidentPrivateState | null;
    const card = priv?.hand.find((c) => c.id === cardId);
    if (!priv || !card) return;

    if (priv.mustGive) {
      if (this.selected.has(cardId)) this.selected.delete(cardId);
      else if (this.selected.size < priv.mustGive) this.selected.add(cardId);
      else {
        // Full: the oldest pick makes way.
        this.selected.delete(this.selected.values().next().value!);
        this.selected.add(cardId);
      }
      this.rerender();
      return;
    }
    if (game.currentPlayerId !== props.playerId) {
      this.log.textContent = game.phase === "exchange" ? "Hang on, cards are still being swapped." : "Not your turn yet.";
      return;
    }

    const sameRank = priv.hand.filter((c) => c.rank === card.rank);
    const picked = this.pickedCards();
    if (this.selected.has(cardId)) {
      this.selected.delete(cardId);
    } else if (picked.length && picked[0]!.rank === card.rank) {
      this.selected.add(cardId);
    } else {
      this.selected.clear();
      const need = game.top?.cards.length ?? 1;
      // The tapped card, topped up with the rest of its rank to the trick's size.
      for (const c of [card, ...sameRank.filter((c) => c.id !== cardId)].slice(0, need)) this.selected.add(c.id);
    }
    this.rerender();
  }

  private playSelected() {
    const cardIds = this.pickedCards().map((c) => c.id);
    if (!cardIds.length) return;
    this.pending.add(this.api.act({ type: "play", cardIds }));
    this.lockDock("Playing…");
  }

  private pass() {
    this.selected.clear();
    this.pending.add(this.api.act({ type: "pass" }));
    this.lockDock("Passing…");
  }

  private give() {
    const cardIds = this.pickedCards().map((c) => c.id);
    this.pending.add(this.api.act({ type: "give", cardIds }));
    this.lockDock("Giving…");
  }

  /** One move per turn: the dock goes quiet until the server answers. */
  private lockDock(text: string) {
    replaceChildren(this.action, h("span", { class: "hint" }, text));
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
