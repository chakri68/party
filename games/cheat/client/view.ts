import { AnimationQueue, bubble, fly, once } from "@games/animation";
import { audio } from "@games/audio";
import type { Presence, RoomPublicState } from "@games/protocol";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { claimText, rankPlural } from "../shared/rules.ts";
import { MAX_PLAY, type Card, type CheatEvent, type CheatPrivateState, type CheatPublicState, type Rank } from "../shared/types.ts";
import { cardBackFull, cardBackMini, cardFace, cardLabel, cardShort, handCard } from "./cards.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
  left: "left",
};

/** A dealt card is mostly see-through for its first ~80ms of rise. */
const DEAL_SOUND_LAG = 80;
/** The window's last seconds tick, for anyone who can still call. */
const TICK_FROM = 3;
/** Most ghosts a pile pick-up throws: past that it's just noise. */
const MAX_PICKUP_GHOSTS = 8;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** "Sixes, Sevens or Eights". */
function claimList(ranks: Rank[]): string {
  const names = ranks.map(rankPlural);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : (names[0] ?? "");
}

function describe(e: CheatEvent, props: GameViewProps): string | null {
  const me = props.playerId;
  const who = (id: string | null) => (id === me ? "You" : seatName(props.room, id));
  const whom = (id: string | null) => (id === me ? "you" : seatName(props.room, id));
  switch (e.type) {
    case "dealt":
      return `${who(e.dealerId)} dealt ${e.decks === 2 ? "two decks" : "the deck"}. Aces first.`;
    case "played":
      return `${who(e.playerId)} said ${claimText(e.count, e.claim)}.`;
    case "you-played":
      return `(Really: ${e.cards.map(cardShort).join(" ")}.)`;
    case "passed":
      return e.playerId === me ? "You let it go." : null;
    case "accepted":
      return "Nobody called it.";
    case "called": {
      const verdict = e.lied ? "caught lying" : "it was true";
      const takes = e.takerId === me ? `You take ${e.taken}.` : `${who(e.takerId)} takes ${e.taken}.`;
      return `${who(e.callerId)} called Cheat on ${whom(e.playerId)}: ${verdict}. ${takes}`;
    }
    case "turn-skipped":
      return `${who(e.playerId)} got skipped by the host, so a card went down for them.`;
    case "player-removed":
      return `${who(e.playerId)} left. Their cards went under the pile.`;
    case "game-over":
      if (e.reason === "abandoned") return "Everyone else left.";
      return e.winnerId === me ? "Out of cards, and it stood. You win!" : `${who(e.winnerId)} is out of cards.`;
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

export class CheatView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "cheat" });
  private status = h("div", { class: "ch-status", role: "status", "aria-live": "polite" });
  private opponents = h("div", { class: "ch-opponents", role: "list", "aria-label": "Other players" });
  private pile = h("div", { class: "ch-pile" });
  private pileCount = h("span", { class: "ch-pile-count" });
  private playLabel = h("p", { class: "ch-play-label" });
  private play = h("div", { class: "ch-play" });
  private bar = h("div", { class: "ch-bar", "aria-hidden": "true" }, h("span"));
  private log = h("p", { class: "ch-log", "aria-live": "polite" });
  private me = h("div", { class: "ch-me" });
  private action = h("div", { class: "ch-action" });
  private hand = h("div", { class: "ch-hand", role: "toolbar", "aria-label": "Your hand" });

  /** Keyed so updates keep the hand steady (§8). */
  private cards = new Map<string, HTMLButtonElement>();
  /** Picked for the next play, in the order they were picked. */
  private selected: string[] = [];
  /** Sent and not yet answered: the hand and buttons stay locked meanwhile. */
  private pending = new Set<string>();

  /** Events act out first, settled state lands after (§19). */
  private queue = new AnimationQueue();
  private wasMyTurn = false;
  private clock: ReturnType<typeof setInterval>;
  private lastTick = -1;
  /** A call is being acted out: the window it closed shouldn't keep draining. */
  private calling = false;

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(
      this.status,
      this.opponents,
      h(
        "div",
        { class: "ch-table", role: "group", "aria-label": "Table" },
        h("div", { class: "ch-pile-wrap" }, this.pile, this.pileCount),
        h("div", { class: "ch-play-wrap" }, this.playLabel, this.play, this.bar),
      ),
      this.log,
      h("div", { class: "ch-dock" }, h("div", { class: "ch-dock-head" }, this.me, this.action), this.hand),
    );
    this.hand.addEventListener("keydown", this.onHandKey);
    this.clock = setInterval(() => this.renderClock(), 200);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    clearInterval(this.clock);
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
    this.rerender();
    this.log.textContent = message;
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    const events = props.events as CheatEvent[];
    // Anything from the server answers what we sent: unlock.
    this.pending.clear();
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
    this.calling = false;
    const game = props.game as CheatPublicState;
    const priv = props.private as CheatPrivateState | null;
    const myTurn = !!priv?.canPlay;
    // The play went down or the turn moved on: forget what was picked.
    if (!myTurn) this.selected = [];
    this.root.classList.toggle("my-turn", myTurn);
    this.root.classList.toggle("window", game.step === "window");
    this.root.classList.toggle("can-call", !!priv?.canCall);
    this.root.classList.toggle("finished", game.step === "finished");

    this.renderStatus(props, game, myTurn);
    this.renderOpponents(props, game);
    this.renderPile(game);
    this.renderPlay(props, game, priv);
    this.renderHand(priv, myTurn);
    this.renderDock(props, game, priv, myTurn);
    this.renderClock();

    const events = props.events as CheatEvent[];
    const lines = events.map((e) => describe(e, props)).filter(Boolean);
    if (lines.length && sounds !== "none") this.log.textContent = lines.slice(-2).join(" ");

    if (sounds !== "none") {
      if (sounds === "all") this.eventSounds(events, props);
      const over = events.find((e) => e.type === "game-over");
      if (over?.type === "game-over" && over.winnerId) {
        const won = over.winnerId === props.playerId;
        audio.play(won ? "win" : "game-over");
        if (won) audio.buzz([40, 60, 40, 60, 90]);
      }
      if (myTurn && !this.wasMyTurn) {
        audio.play("your-turn");
        audio.buzz(25);
      }
      if (events.some((e) => e.type === "played")) this.lastTick = -1;
    }
    // Mid-show redraws leave it alone, so the chime waits for the settled turn.
    if (sounds !== "none" || props.snapshot) this.wasMyTurn = myTurn;
  }

  private rerender() {
    if (this.props) this.render(this.props, "none");
  }

  // ---- animation (§18) ----------------------------------------------------

  /** Acts out one update's events, in order, against the still-old DOM. */
  private async act(events: CheatEvent[], props: GameViewProps) {
    // Nothing to press while the show's on: the buttons belong to the old state.
    replaceChildren(this.action);
    for (const e of events) {
      switch (e.type) {
        case "dealt":
          // The table paints at once; the riffle gets a beat, then the hand fans in.
          audio.play("shuffle");
          this.render(props, "none");
          await this.dealIn(380);
          break;
        case "played": {
          const mine = events.find((x): x is Extract<CheatEvent, { type: "you-played" }> => x.type === "you-played");
          await this.flyPlay(e.playerId, e.count, e.claim, e.playerId === props.playerId ? (mine?.cards ?? null) : null);
          break;
        }
        case "passed":
          // No waiting on it: passes come in quick and nobody needs a show.
          if (e.playerId !== props.playerId) void bubble(this.anchorFor(e.playerId, props), "Pass", "anim-bubble", 700);
          break;
        case "called":
          await this.showCall(e, props);
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

  private eventSounds(events: CheatEvent[], props: GameViewProps) {
    const types = new Set(events.map((e) => e.type));
    if (types.has("dealt")) audio.play("shuffle");
    if (types.has("played")) audio.play("card-place");
    if (types.has("turn-skipped")) audio.play("pass");
    const call = events.find((e) => e.type === "called");
    if (call?.type === "called") {
      audio.play(call.lied ? "correct" : "reject");
      if (call.takerId === props.playerId) audio.buzz([50, 40, 50]);
    }
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
   * A play going down. Whatever was on top joins the pile first; then the
   * cards fly into the play spot one after another, face down for everyone
   * but the player, whose own cards stay face up to them.
   */
  private async flyPlay(playerId: string, count: number, claim: Rank, cards: Card[] | null) {
    const props = this.props;
    if (!props) return;
    const game = props.game as CheatPublicState;
    this.setPile(game.pileCount);

    const spots = Array.from({ length: count }, (_, i) => {
      const el = cards?.[i] ? cardFace(cards[i]) : cardBackFull();
      if (cards) el.classList.add("mine");
      el.style.visibility = "hidden";
      return el;
    });
    replaceChildren(this.play, spots);
    this.playLabel.textContent = `${playerId === props.playerId ? "You" : seatName(props.room, playerId)}: “${claimText(count, claim)}”`;

    const size = spots[0]!.getBoundingClientRect();
    await Promise.all(
      spots.map(async (spot, i) => {
        const own = cards?.[i] ? this.cards.get(cards[i].id) : undefined;
        const from = own ? own.getBoundingClientRect() : this.cardRectAt(this.anchorFor(playerId, props), size);
        if (own) own.style.visibility = "hidden"; // it's in the air now; settle removes it
        await wait(i * 90);
        await fly(cards?.[i] ? cardFace(cards[i]) : cardBackFull(), from, spot.getBoundingClientRect(), 300, { handoff: true });
        spot.style.visibility = "";
        once(spot, "landed");
        audio.play("card-place");
      }),
    );
  }

  /**
   * "Cheat!" The caller shouts, the play turns over for everyone, the
   * verdict lands, and the whole pile goes to whoever got it wrong.
   */
  private async showCall(e: Extract<CheatEvent, { type: "called" }>, props: GameViewProps) {
    this.calling = true;
    this.bar.hidden = true;
    audio.play("nudge");
    audio.buzz(30);
    await bubble(this.anchorFor(e.callerId, props), "Cheat!", "anim-bubble ch-shout", 1100);

    // Turn the play over, card by card.
    replaceChildren(
      this.play,
      e.cards.map((c, i) => {
        const el = cardFace(c);
        el.style.animationDelay = `${i * 110}ms`;
        el.classList.toggle("wrong", c.rank !== e.claim);
        return once(el, "flip");
      }),
    );
    audio.play("deal");
    await wait(700 + e.cards.length * 110);

    const verdict = h("span", { class: `ch-verdict ${e.lied ? "lie" : "true"}` }, e.lied ? "Lie!" : "True");
    this.play.append(once(verdict, "stamp"));
    audio.play(e.lied ? "correct" : "reject");
    if (e.takerId === props.playerId) audio.buzz([50, 40, 50]);
    await wait(900);

    // The lot goes to the taker: a handful of ghosts, not all fifty.
    const from = this.play.getBoundingClientRect();
    const size = (this.play.firstElementChild ?? this.pile).getBoundingClientRect();
    const to = e.takerId === props.playerId ? this.hand.getBoundingClientRect() : this.cardRectAt(this.anchorFor(e.takerId, props), size);
    const target = new DOMRect(to.left + to.width / 2 - size.width / 2, to.top + to.height / 2 - size.height / 2, size.width, size.height);
    replaceChildren(this.play);
    this.setPile(0);
    const ghosts = Math.min(e.taken, MAX_PICKUP_GHOSTS);
    await Promise.all(
      Array.from({ length: ghosts }, async (_, i) => {
        await wait(i * 45);
        if (i % 2 === 0) audio.play("deal");
        const start = new DOMRect(from.left + from.width / 2 - size.width / 2 + i * 2, from.top + from.height / 2 - size.height / 2, size.width, size.height);
        await fly(cardBackFull(), start, target, 380);
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
      const delay = after + i * 40;
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

  private renderStatus(props: GameViewProps, game: CheatPublicState, myTurn: boolean) {
    // Once finished, the room's results panel announces the winner.
    this.status.hidden = game.step === "finished";
    if (this.status.hidden) return;
    const room: RoomPublicState = props.room;
    if (game.window && game.lastPlay) {
      const mine = game.window.playerId === props.playerId;
      const seat = room.seats.find((s) => s.id === game.window!.playerId);
      const said = `“${claimText(game.lastPlay.count, game.lastPlay.claim)}”`;
      replaceChildren(
        this.status,
        mine ? h("span", {}, `You said ${said}`) : [seat ? avatar(seat.name, seat.avatarSeed, "sm") : null, h("span", {}, `${seat?.name ?? "Someone"} says ${said}`)],
      );
      return;
    }
    const seat = room.seats.find((s) => s.id === game.currentPlayerId);
    const away = seat && seat.presence !== "connected" ? ` (${PRESENCE_LABEL[seat.presence]})` : "";
    replaceChildren(
      this.status,
      myTurn
        ? h("span", {}, `Your turn: ${claimList(game.claims)}`)
        : [seat ? avatar(seat.name, seat.avatarSeed, "sm") : null, h("span", {}, `${seat?.name ?? "Someone"}${away} is up: ${claimList(game.claims)}`)],
    );
  }

  private renderOpponents(props: GameViewProps, game: CheatPublicState) {
    const playing = game.window?.playerId ?? game.currentPlayerId;
    replaceChildren(
      this.opponents,
      fromMyLeft(game.players, props.playerId).map((p) => {
        const seat = props.room.seats.find((s) => s.id === p.id);
        const away = seat && seat.presence !== "connected" && !p.removed;
        const name = seat?.name ?? "?";
        const current = p.id === playing;
        const winner = p.id === game.winnerId;
        const holding = p.removed ? "left" : `${p.cardCount} ${p.cardCount === 1 ? "card" : "cards"}`;
        return h(
          "div",
          {
            class: `ch-opp${current ? " current" : ""}${p.passed ? " passed" : ""}${winner ? " winner" : ""}${away || p.removed ? " away" : ""}`,
            role: "listitem",
            "data-player": p.id,
            "aria-label": `${name}: ${holding}${current ? (game.window ? ", just played" : ", playing now") : ""}${p.passed ? ", let it go" : ""}${away ? `, ${PRESENCE_LABEL[seat!.presence]}` : ""}`,
          },
          seat ? avatar(name, seat.avatarSeed) : null,
          h(
            "div",
            { class: "ch-opp-text", "aria-hidden": "true" },
            h("span", { class: "name" }, name, p.id === game.dealerId ? h("span", { class: "ch-dealer", title: "Dealer" }, "D") : null),
            h(
              "span",
              { class: "count" },
              p.removed ? holding : [cardBackMini(), ` ${p.cardCount}`],
              p.passed ? h("span", { class: "passed-label" }, " · pass") : null,
              away ? h("span", { class: "away-label" }, ` · ${PRESENCE_LABEL[seat!.presence]}`) : null,
            ),
          ),
        );
      }),
    );
  }

  /** The pile under the play on top: a stack of backs and a count. */
  private renderPile(game: CheatPublicState) {
    this.setPile(game.pileCount - (game.lastPlay?.count ?? 0), game.pileCount);
  }

  /** `under`: cards drawn as the stack; `total`: what the count says (the play on top included). */
  private setPile(under: number, total = under) {
    const depth = Math.min(3, Math.ceil(under / 6));
    if (this.pile.childElementCount !== Math.max(depth, 1) || this.pile.dataset.depth !== String(depth)) {
      this.pile.dataset.depth = String(depth);
      replaceChildren(this.pile, depth ? Array.from({ length: depth }, () => cardBackFull()) : h("span", { class: "ch-card slot", "aria-hidden": "true" }));
    }
    this.pileCount.textContent = total ? `${total} in the pile` : "Empty pile";
    this.pile.setAttribute("role", "img");
    this.pile.setAttribute("aria-label", total ? `Pile, ${total} cards face down` : "Pile, empty");
  }

  /**
   * The play on top: face down, except to whoever made it. After a call, the
   * flipped cards stay up (dimmed) until the next play, so anyone who looked
   * away can see what happened.
   */
  private renderPlay(props: GameViewProps, game: CheatPublicState, priv: CheatPrivateState | null) {
    const room = props.room;
    const name = (id: string) => (id === props.playerId ? "You" : seatName(room, id));
    const last = game.lastPlay;
    const r = game.lastReveal;
    this.play.classList.toggle("settled", !!last && !game.window);
    this.play.classList.toggle("old", !last && !!r);
    if (last) {
      const mine = priv?.myPlay;
      const key = `play:${last.playerId}:${last.count}:${game.pileCount}`;
      if (this.play.dataset.key !== key) {
        replaceChildren(
          this.play,
          Array.from({ length: last.count }, (_, i) => {
            const el = mine?.[i] ? cardFace(mine[i]) : cardBackFull();
            if (mine) el.classList.add("mine");
            return el;
          }),
        );
      }
      this.play.dataset.key = key;
      this.playLabel.textContent = `${name(last.playerId)}: “${claimText(last.count, last.claim)}”`;
      this.play.setAttribute("aria-label", `${name(last.playerId)} put down ${last.count} face down, claiming ${claimText(last.count, last.claim)}${mine ? `. You know they're ${mine.map(cardLabel).join(", ")}` : ""}`);
    } else if (r) {
      const key = `reveal:${r.callerId}:${r.playerId}:${r.cards.map((c) => c.id).join()}`;
      if (this.play.dataset.key !== key) {
        replaceChildren(
          this.play,
          r.cards.map((c) => {
            const el = cardFace(c);
            el.classList.toggle("wrong", c.rank !== r.claim);
            return el;
          }),
          h("span", { class: `ch-verdict ${r.lied ? "lie" : "true"}` }, r.lied ? "Lie!" : "True"),
        );
      }
      this.play.dataset.key = key;
      this.playLabel.textContent = `${name(r.callerId)} called ${r.playerId === props.playerId ? "you" : seatName(room, r.playerId)} · ${name(r.takerId)} took ${r.taken}`;
      this.play.setAttribute("aria-label", `Called: ${r.cards.map(cardLabel).join(", ")} for ${claimText(r.cards.length, r.claim)}. ${r.lied ? "A lie" : "True"}.`);
    } else {
      if (this.play.dataset.key !== "empty") replaceChildren(this.play, h("span", { class: "ch-card slot", "aria-hidden": "true" }, "A"));
      this.play.dataset.key = "empty";
      this.playLabel.textContent = game.step === "finished" ? "" : "Aces first";
      this.play.setAttribute("aria-label", "Nothing played yet");
    }
    this.play.setAttribute("role", "img");
  }

  /** The window's countdown: a bar that drains, ticking at the end for anyone who could still call. */
  private renderClock() {
    const game = this.props?.game as CheatPublicState | undefined;
    const w = this.calling ? null : game?.window;
    this.bar.hidden = !w;
    if (!w) return;
    const left = Math.max(0, w.endsAt - this.api.serverNow());
    (this.bar.firstElementChild as HTMLElement).style.transform = `scaleX(${Math.min(1, left / Math.max(w.ms, 1))})`;
    const secs = Math.ceil(left / 1000);
    this.bar.classList.toggle("low", secs <= TICK_FROM);
    const priv = this.props?.private as CheatPrivateState | null;
    if (priv?.canCall && secs > 0 && secs <= TICK_FROM && secs !== this.lastTick) {
      this.lastTick = secs;
      audio.play("tick");
    }
  }

  private renderHand(priv: CheatPrivateState | null, myTurn: boolean) {
    const hand = priv?.hand ?? [];
    const keep = new Set(hand.map((c) => c.id));

    for (const [id, btn] of this.cards) {
      if (!keep.has(id)) {
        btn.remove();
        this.cards.delete(id);
      }
    }
    this.selected = this.selected.filter((id) => keep.has(id));

    // Cards that show up mid-game came with the pile: flag them so it's clear what came in.
    const pickingUp = this.cards.size > 0;
    let fresh: HTMLButtonElement | null = null;
    hand.forEach((card, i) => {
      let btn = this.cards.get(card.id);
      if (!btn) {
        btn = this.handButton(card);
        if (pickingUp) fresh ??= once(btn, "fresh");
      }
      const picked = this.selected.includes(card.id);
      btn.classList.toggle("selected", picked);
      btn.classList.toggle("playable", myTurn);
      btn.setAttribute("aria-pressed", String(picked));
      if (this.hand.children[i] !== btn) this.hand.insertBefore(btn, this.hand.children[i] ?? null);
    });
    (fresh as HTMLButtonElement | null)?.scrollIntoView({ block: "nearest", inline: "nearest" });

    // Roving tabindex: one tab stop into the hand, arrows within it (§38).
    const focusTarget = (this.selected[0] && this.cards.get(this.selected[0])) || this.hand.firstElementChild;
    for (const btn of this.cards.values()) btn.tabIndex = btn === focusTarget ? 0 : -1;
  }

  private handButton(card: Card): HTMLButtonElement {
    const btn = handCard(card);
    btn.addEventListener("click", () => this.onCardTap(card.id));
    this.cards.set(card.id, btn);
    return btn;
  }

  private renderDock(props: GameViewProps, game: CheatPublicState, priv: CheatPrivateState | null, myTurn: boolean) {
    const mine = game.players.find((p) => p.id === props.playerId);
    replaceChildren(
      this.me,
      h("span", { class: "you" }, "Your hand"),
      mine ? h("span", { class: "count" }, `${mine.cardCount} ${mine.cardCount === 1 ? "card" : "cards"}`) : null,
      mine && game.dealerId === props.playerId ? h("span", { class: "ch-dealer", title: "Dealer" }, "D") : null,
    );

    const hint = (text: string, strong = false) => h("span", { class: `hint${strong ? " strong" : ""}` }, text);
    let action: Node | Node[] | null = null;
    if (game.step === "finished") action = null;
    else if (this.pending.size) action = hint("…");
    else if (game.window) {
      if (priv?.canCall) {
        action = [
          h("button", { type: "button", class: "link", onclick: () => this.send({ type: "pass" }) }, "Let it go"),
          h("button", { type: "button", class: "ch-call", onclick: () => this.send({ type: "call" }) }, "Cheat!"),
        ];
      } else if (game.window.playerId === props.playerId) action = hint("Straight face…");
      else action = hint(mine?.passed ? "You let it go" : "Waiting…");
    } else if (!myTurn) action = hint("Not your turn yet");
    else if (!this.selected.length) action = hint(`Pick up to ${MAX_PLAY}`, true);
    else {
      const n = this.selected.length;
      action = game.claims.map((rank, i) =>
        h(
          "button",
          { type: "button", class: game.claims.length === 1 || i === 1 ? "primary" : "", onclick: () => this.playSelected(rank) },
          game.claims.length === 1 ? `Put down ${n} as ${rankPlural(rank)}` : rankPlural(rank),
        ),
      );
    }
    replaceChildren(this.action, action);
    this.action.classList.toggle("claims", myTurn && this.selected.length > 0 && game.claims.length > 1);
  }

  // ---- interaction --------------------------------------------------------

  private onCardTap(cardId: string) {
    const props = this.props;
    const priv = props?.private as CheatPrivateState | null | undefined;
    if (!props || !priv?.canPlay || this.pending.size) {
      this.log.textContent = "Not your turn yet.";
      return;
    }
    const i = this.selected.indexOf(cardId);
    if (i >= 0) this.selected.splice(i, 1);
    else if (this.selected.length >= MAX_PLAY) {
      this.log.textContent = `${MAX_PLAY} at most.`;
      const btn = this.cards.get(cardId);
      btn?.classList.remove("shake");
      void btn?.offsetWidth;
      btn?.classList.add("shake");
      return;
    } else this.selected.push(cardId);
    this.rerender();
  }

  private playSelected(claim: Rank) {
    if (!this.selected.length) return;
    // In hand order, so your own play reads left to right the way you held it.
    const order = [...this.cards.keys()];
    const cardIds = [...this.selected].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    this.send({ type: "play", cardIds, claim });
  }

  private send(action: unknown) {
    this.pending.add(this.api.act(action));
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
