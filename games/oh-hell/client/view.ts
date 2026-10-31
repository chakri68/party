import { AnimationQueue, bubble, fly, once } from "@games/animation";
import { audio } from "@games/audio";
import type { Presence } from "@games/protocol";
import { avatar, h, openDialog, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import type { Card, OhHellEvent, OhHellPrivateState, OhHellPublicPlayer, OhHellPublicState, Suit, TrickPlay } from "../shared/types.ts";
import { SUIT_NAME, SUIT_SYMBOL, cardBackMini, cardFace, cardLabel, cardShort, handCard } from "./cards.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
  left: "left",
};

/** A dealt card is mostly see-through for its first ~80ms of rise. */
const DEAL_SOUND_LAG = 80;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Heart", for "play a Heart". */
const suitOne = (s: Suit) => SUIT_NAME[s].slice(0, -1);

function describe(e: OhHellEvent, props: GameViewProps): string | null {
  const me = props.playerId;
  const who = (id: string | null) => (id === me ? "You" : seatName(props.room, id));
  switch (e.type) {
    case "dealt":
      return `${e.redeal ? "Redealt" : `Round ${e.round}`}: ${plural(e.handSize, "card")} each. ${SUIT_NAME[e.trump.suit]} are trump.`;
    case "bid":
      return `${who(e.playerId)} bid ${e.tricks}.`;
    case "played":
      return null;
    case "trick-won":
      return `${who(e.winnerId)} ${e.winnerId === me ? "take" : "takes"} the trick.`;
    case "trick-collected":
      return null;
    case "round-scored": {
      const mine = e.results.find((r) => r.playerId === me);
      if (!mine) return `Round ${e.round} scored.`;
      return mine.bid === mine.tricks
        ? `You made it: ${mine.points} points.`
        : `You bid ${mine.bid} and took ${mine.tricks}. ${mine.points ? `${mine.points} points.` : "Nothing for that."}`;
    }
    case "ready":
      return null;
    case "turn-skipped":
      return `${who(e.playerId)} got skipped by the host.`;
    case "player-removed":
      return `${who(e.playerId)} left. Their score stays on the board.`;
    case "game-over":
      return e.reason === "abandoned" ? "Too few players left to carry on." : "That's the last round.";
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

/** Seated players in play order, starting with whoever leads. */
function playOrder(game: OhHellPublicState, leaderId: string | null): string[] {
  const seated = game.players.filter((p) => !p.removed).map((p) => p.id);
  const i = leaderId ? seated.indexOf(leaderId) : -1;
  return i < 0 ? seated : [...seated.slice(i), ...seated.slice(0, i)];
}

/** "bid 2 · won 1", or where they are with it. */
function bidLine(p: OhHellPublicPlayer, game: OhHellPublicState): string {
  if (p.removed) return "left";
  if (p.bid === null) return p.id === game.currentPlayerId ? "bidding…" : "no bid yet";
  return game.phase === "bidding" ? `bid ${p.bid}` : `bid ${p.bid} · won ${p.tricks}`;
}

/** On course, over, or still short: colours the bid line once play's on. */
function bidState(p: OhHellPublicPlayer, game: OhHellPublicState): string {
  if (p.bid === null || game.phase === "bidding") return "";
  return p.tricks > p.bid ? " over" : p.tricks === p.bid ? " on" : "";
}

export class OhHellView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "oh-hell" });
  private status = h("div", { class: "oh-status", role: "status", "aria-live": "polite" });
  private round = h("div", { class: "oh-round" });
  private players = h("div", { class: "oh-players", role: "list", "aria-label": "Other players" });
  private tableHead = h("div", { class: "oh-table-head" });
  private tableBody = h("div", { class: "oh-table-body" });
  private table = h("div", { class: "oh-table", role: "group", "aria-label": "Table" }, this.tableHead, this.tableBody);
  private log = h("p", { class: "oh-log", "aria-live": "polite" });
  private me = h("div", { class: "oh-me" });
  private action = h("div", { class: "oh-action" });
  private bids = h("div", { class: "oh-bids", role: "group", "aria-label": "Your bid" });
  private hand = h("div", { class: "oh-hand", role: "toolbar", "aria-label": "Your hand" });

  /** Keyed so updates keep the hand steady. */
  private cards = new Map<string, HTMLButtonElement>();
  /** Tapped once, waiting for a second tap (or the Play button) to go down. */
  private lifted: string | null = null;
  /** Picked in the bid picker, not sent yet. */
  private bidPick: number | null = null;
  /** Sent and not yet answered: the hand and buttons stay locked meanwhile. */
  private pending = new Set<string>();

  /** Events act out first, settled state lands after. */
  private queue = new AnimationQueue();
  private wasMyTurn = false;
  private clock: ReturnType<typeof setInterval>;
  /** The trick as drawn right now; animations build on it card by card. */
  private shownTrick: TrickPlay[] = [];

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(
      this.status,
      this.round,
      this.players,
      this.table,
      this.log,
      h("div", { class: "oh-dock" }, h("div", { class: "oh-dock-head" }, this.me, this.action), this.bids, this.hand),
    );
    this.hand.addEventListener("keydown", this.onHandKey);
    this.clock = setInterval(() => this.renderCountdown(), 250);
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
      const target = this.bids.hidden ? this.hand : this.bids;
      target.classList.remove("shake");
      void target.offsetWidth; // restart the animation
      target.classList.add("shake");
    }
    this.rerender();
    this.log.textContent = message;
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    const events = props.events as OhHellEvent[];
    this.pending.clear();
    // Reconnects, and joining mid-game: show it as it is, no replaying history.
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
      settle: () => this.render(props, acted ? "cues" : "all"),
    });
  }

  private render(props: GameViewProps, sounds: Sounds) {
    this.props = props;
    const game = props.game as OhHellPublicState;
    const priv = props.private as OhHellPrivateState | null;
    const myTurn = !!priv && (priv.canBid || priv.legal.length > 0);
    if (!priv?.canBid) this.bidPick = null;
    if (!priv?.legal.includes(this.lifted ?? "")) this.lifted = null;
    this.root.classList.toggle("my-turn", myTurn);
    this.root.classList.toggle("over", game.phase === "over");

    this.renderStatus(props, game, priv);
    this.renderRound(game);
    this.renderPlayers(props, game);
    this.renderTable(props, game);
    this.renderHand(game, priv);
    this.renderDock(props, game, priv);
    this.renderCountdown();

    const events = props.events as OhHellEvent[];
    const lines = events.map((e) => describe(e, props)).filter(Boolean);
    if (lines.length && sounds !== "none") this.log.textContent = lines.slice(-2).join(" ");

    if (sounds !== "none") {
      if (sounds === "all") this.eventSounds(events, props);
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
    if (sounds !== "none" || props.snapshot) this.wasMyTurn = myTurn;
  }

  private rerender() {
    if (this.props) this.render(this.props, "none");
  }

  // ---- animation ----------------------------------------------------------

  /** Acts out one update's events, in order, against the still-old DOM. */
  private async act(events: OhHellEvent[], props: GameViewProps) {
    // Nothing to press while the show's on: the buttons belong to the old state.
    replaceChildren(this.action);
    for (const e of events) {
      switch (e.type) {
        case "dealt":
          audio.play("shuffle");
          this.render(props, "none");
          once(this.round.querySelector(".oh-card") ?? this.round, "flip");
          await this.dealIn(380);
          break;
        case "bid":
          audio.play("pass");
          await bubble(this.anchorFor(e.playerId, props), `Bid ${e.tricks}`, "anim-bubble", 900);
          break;
        case "played":
          await this.flyPlay(e.playerId, e.card, props);
          break;
        case "trick-won":
          await this.showWin(e.winnerId, props);
          break;
        case "trick-collected":
          await this.collect(e.winnerId, props);
          break;
        case "round-scored":
          this.scoreSound(e, props);
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

  private eventSounds(events: OhHellEvent[], props: GameViewProps) {
    const types = new Set(events.map((e) => e.type));
    if (types.has("dealt")) audio.play("shuffle");
    if (types.has("played")) audio.play("card-place");
    if (types.has("bid") || types.has("turn-skipped")) audio.play("pass");
    const won = events.find((e) => e.type === "trick-won");
    if (won?.type === "trick-won" && won.winnerId === props.playerId) audio.play("correct");
    const scored = events.find((e) => e.type === "round-scored");
    if (scored?.type === "round-scored") this.scoreSound(scored, props);
  }

  private scoreSound(e: Extract<OhHellEvent, { type: "round-scored" }>, props: GameViewProps) {
    const mine = e.results.find((r) => r.playerId === props.playerId);
    if (!mine) return;
    audio.play(mine.bid === mine.tricks ? "correct" : "nudge");
    if (mine.bid === mine.tricks) audio.buzz([30, 50, 30]);
  }

  /** Where a player "sits" on screen: their chip, or your dock. */
  private anchorFor(playerId: string, props: GameViewProps): Element {
    if (playerId === props.playerId) return this.me;
    return this.players.querySelector(`[data-player="${CSS.escape(playerId)}"] .avatar`) ?? this.status;
  }

  /** A card-sized rect centred on a small anchor, so flights don't start as specks. */
  private cardRectAt(anchor: Element, like: DOMRect): DOMRect {
    const r = anchor.getBoundingClientRect();
    return new DOMRect(r.left + r.width / 2 - like.width * 0.3, r.top + r.height / 2 - like.height * 0.3, like.width * 0.6, like.height * 0.6);
  }

  /** A card goes from its player into its place in the trick. */
  private async flyPlay(playerId: string, card: Card, props: GameViewProps) {
    const game = props.game as OhHellPublicState;
    this.shownTrick = [...this.shownTrick, { playerId, card }];
    this.drawTrick(props, game, this.shownTrick, null);
    const spot = this.tableBody.querySelector<HTMLElement>(`[data-slot="${CSS.escape(playerId)}"] .oh-card`);
    if (!spot) return;
    spot.style.visibility = "hidden";
    const to = spot.getBoundingClientRect();
    const own = playerId === props.playerId ? this.cards.get(card.id) : undefined;
    const from = own ? own.getBoundingClientRect() : this.cardRectAt(this.anchorFor(playerId, props), to);
    if (own) own.style.visibility = "hidden"; // in the air now; settle removes it
    await fly(cardFace(card), from, to, 300, { handoff: true });
    spot.style.visibility = "";
    once(spot, "landed");
    audio.play("card-place");
  }

  /** The full trick sits a beat; the card that took it lifts. */
  private async showWin(winnerId: string, props: GameViewProps) {
    const slot = this.tableBody.querySelector(`[data-slot="${CSS.escape(winnerId)}"]`);
    slot?.classList.add("won");
    this.tableBody.querySelector(".oh-trick")?.classList.add("decided");
    if (winnerId === props.playerId) {
      audio.play("correct");
      audio.buzz(30);
    }
    await bubble(this.anchorFor(winnerId, props), winnerId === props.playerId ? "Yours" : "Takes it", "anim-bubble", 900);
  }

  /** The trick sweeps over to whoever took it. */
  private async collect(winnerId: string, props: GameViewProps) {
    const spots = [...this.tableBody.querySelectorAll<HTMLElement>(".oh-slot .oh-card:not(.empty)")];
    if (!spots.length) return;
    const size = spots[0]!.getBoundingClientRect();
    const target = winnerId === props.playerId ? this.me.getBoundingClientRect() : this.cardRectAt(this.anchorFor(winnerId, props), size);
    const faces = this.shownTrick.map((t) => t.card);
    const rects = spots.map((s) => s.getBoundingClientRect());
    for (const s of spots) s.style.visibility = "hidden";
    audio.play("deal");
    await Promise.all(
      rects.map(async (from, i) => {
        await wait(i * 50);
        const face = faces[i];
        await fly(face ? cardFace(face) : h("span", { class: "oh-card" }), from, target, 340);
      }),
    );
    this.shownTrick = [];
  }

  /** Cards slide up into the hand one by one. */
  private async dealIn(after = 0) {
    const cards = [...this.hand.children] as HTMLElement[];
    const flights = cards.map((el, i) => {
      const delay = after + i * 40;
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

  private name(id: string | null, props: GameViewProps) {
    return id === props.playerId ? "You" : seatName(props.room, id);
  }

  private renderStatus(props: GameViewProps, game: OhHellPublicState, priv: OhHellPrivateState | null) {
    // Once it's over, the room's results panel announces the winner.
    this.status.hidden = game.phase === "over";
    if (this.status.hidden) return;
    const seat = props.room.seats.find((s) => s.id === game.currentPlayerId);
    const away = seat && seat.presence !== "connected" ? ` (${PRESENCE_LABEL[seat.presence]})` : "";
    const them = (text: string) => [seat ? avatar(seat.name, seat.avatarSeed, "sm") : null, h("span", {}, `${seat?.name ?? "Someone"}${away} ${text}`)];
    let content: Node | (Node | null)[];
    if (game.phase === "round-summary") content = h("span", {}, `Round ${game.round} scored`);
    else if (game.trickWinnerId) {
      const mine = game.trickWinnerId === props.playerId;
      content = h("span", {}, mine ? "You take the trick" : `${seatName(props.room, game.trickWinnerId)} takes the trick`);
    } else if (game.phase === "bidding") content = priv?.canBid ? h("span", {}, `Your bid: 0 to ${game.handSize}`) : them("is bidding");
    else if (priv?.legal.length) {
      const led = game.trick[0]?.card.suit;
      const following = led && priv.legal.every((id) => id.startsWith(`${led}-`));
      content = h("span", {}, following ? `Your turn: follow ${SUIT_NAME[led]} ${SUIT_SYMBOL[led]}` : game.trick.length ? "Your turn: play anything" : "Your lead");
    } else content = them(game.trick.length ? "to play" : "leads");
    replaceChildren(this.status, content);
  }

  /** Trump, the round, and the whole schedule as a strip of bars. */
  private renderRound(game: OhHellPublicState) {
    const big = Math.max(...game.schedule);
    const trump = cardFace(game.trump, "sm");
    trump.setAttribute("aria-label", `Trump: ${SUIT_NAME[game.trump.suit]} (turned up the ${cardLabel(game.trump)})`);
    replaceChildren(
      this.round,
      h("div", { class: "oh-trump" }, trump, h("span", { class: "oh-trump-label" }, "Trump", h("b", {}, SUIT_SYMBOL[game.trump.suit]))),
      h(
        "div",
        { class: "oh-round-info" },
        h(
          "p",
          { class: "oh-round-text" },
          h("b", {}, `Round ${game.round} of ${game.schedule.length}`),
          h("span", {}, ` · ${plural(game.handSize, "card")}`),
        ),
        h(
          "div",
          { class: "oh-sched", role: "img", "aria-label": `Hand sizes: ${game.schedule.join(", ")}. This round: ${game.handSize}.` },
          game.schedule.map((n, i) =>
            h("span", {
              class: `oh-sched-bar${i < game.round - 1 ? " past" : i === game.round - 1 ? " now" : ""}`,
              style: `height:${Math.max(14, Math.round((n / big) * 100))}%`,
              title: `Round ${i + 1}: ${plural(n, "card")}`,
            }),
          ),
        ),
      ),
    );
  }

  private renderPlayers(props: GameViewProps, game: OhHellPublicState) {
    replaceChildren(
      this.players,
      fromMyLeft(game.players, props.playerId).map((p) => {
        const seat = props.room.seats.find((s) => s.id === p.id);
        const away = seat && seat.presence !== "connected" && !p.removed;
        const name = seat?.name ?? "?";
        const current = p.id === game.currentPlayerId;
        const dealer = p.id === game.dealerId;
        const line = bidLine(p, game);
        return h(
          "div",
          {
            class: `oh-opp${current ? " current" : ""}${p.id === game.trickWinnerId ? " took" : ""}${game.winnerIds.includes(p.id) ? " winner" : ""}${away || p.removed ? " away" : ""}`,
            role: "listitem",
            "data-player": p.id,
            "aria-label": `${name}${dealer ? ", dealer" : ""}: ${line}, ${plural(p.score, "point")}, ${plural(p.cardCount, "card")}${current ? ", their turn" : ""}${away ? `, ${PRESENCE_LABEL[seat!.presence]}` : ""}`,
          },
          seat ? avatar(name, seat.avatarSeed) : null,
          h(
            "div",
            { class: "oh-opp-text", "aria-hidden": "true" },
            h("span", { class: "name" }, h("span", { class: "nm" }, name), dealer ? h("span", { class: "oh-dealer", title: "Dealer" }, "D") : null, h("span", { class: "pts" }, String(p.score))),
            h("span", { class: `line${bidState(p, game)}` }, p.removed ? null : [cardBackMini(), ` ${p.cardCount} · `], line, away ? ` · ${PRESENCE_LABEL[seat!.presence]}` : ""),
          ),
        );
      }),
    );
  }

  private renderTable(props: GameViewProps, game: OhHellPublicState) {
    this.table.classList.toggle("summary", !!game.results);
    if (game.results) {
      this.shownTrick = [];
      this.renderSummary(props, game);
      return;
    }
    const lastBtn = h(
      "button",
      { type: "button", class: "link oh-last-btn", disabled: !game.lastTrick, onclick: () => this.showLastTrick() },
      "Last trick",
    );
    if (game.phase === "bidding") {
      this.shownTrick = [];
      const seated = game.players.filter((p) => !p.removed).length;
      const dealer = this.name(game.dealerId, props);
      replaceChildren(this.tableHead, h("span", { class: "oh-table-title" }, `Bidding · ${game.bidsMade} of ${seated} in`), lastBtn);
      const left = game.handSize - game.bidsTotal;
      replaceChildren(
        this.tableBody,
        h(
          "div",
          { class: "oh-bidboard" },
          h("p", { class: "oh-bids-so-far" }, "Bids so far: ", h("b", {}, `${game.bidsTotal} of ${game.handSize}`)),
          h(
            "p",
            { class: "oh-bid-note" },
            game.forbiddenBid !== null
              ? `${dealer === "You" ? "You're" : `${dealer}'s`} the dealer: ${game.forbiddenBid} would make it add up, so it's out.`
              : !game.dealerRule
                ? "No dealer's restriction this game."
                : left < 0
                  ? "Already over. Someone's going to be disappointed."
                  : `The dealer, ${dealer === "You" ? "you" : dealer}, can't make it add up to ${game.handSize}.`,
          ),
        ),
      );
      return;
    }
    replaceChildren(
      this.tableHead,
      h("span", { class: "oh-table-title" }, game.phase === "playing" ? `Trick ${game.trickNumber} of ${game.handSize}` : ""),
      lastBtn,
    );
    this.shownTrick = game.trick;
    this.drawTrick(props, game, game.trick, game.trickWinnerId);
  }

  /** One slot per seated player in play order: their card once it's down. */
  private drawTrick(props: GameViewProps, game: OhHellPublicState, plays: TrickPlay[], winnerId: string | null) {
    const leader = plays[0]?.playerId ?? game.currentPlayerId;
    const order = playOrder(game, leader);
    const byId = new Map(plays.map((t) => [t.playerId, t.card]));
    const trick = h(
      "div",
      { class: `oh-trick${winnerId ? " decided" : ""}`, role: "list", "aria-label": "This trick" },
      order.map((id, i) => {
        const card = byId.get(id);
        const nm = this.name(id, props);
        return h(
          "div",
          {
            class: `oh-slot${id === winnerId ? " won" : ""}${i === 0 && card ? " lead" : ""}`,
            role: "listitem",
            "data-slot": id,
            "aria-label": card ? `${nm}: ${cardLabel(card)}${i === 0 ? ", led" : ""}${id === winnerId ? ", takes it" : ""}` : `${nm}: not played yet`,
          },
          card ? cardFace(card) : h("span", { class: "oh-card empty", "aria-hidden": "true" }),
          h("span", { class: "oh-slot-name", "aria-hidden": "true" }, nm),
        );
      }),
    );
    replaceChildren(this.tableBody, trick);
  }

  private renderSummary(props: GameViewProps, game: OhHellPublicState) {
    const results = game.results!;
    const last = game.round >= game.schedule.length;
    replaceChildren(this.tableHead, h("span", { class: "oh-table-title" }, `Round ${game.round} · ${plural(game.handSize, "card")}`));
    replaceChildren(
      this.tableBody,
      h(
        "table",
        { class: "oh-score" },
        h("caption", { class: "oh-sr" }, `Round ${game.round} results`),
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Player"), h("th", { scope: "col" }, "Bid"), h("th", { scope: "col" }, "Won"), h("th", { scope: "col" }, "Pts"), h("th", { scope: "col" }, "Total"))),
        h(
          "tbody",
          {},
          results.map((r) => {
            const made = r.bid === r.tricks;
            const p = game.players.find((x) => x.id === r.playerId);
            return h(
              "tr",
              { class: `${made ? "made" : "missed"}${r.playerId === props.playerId ? " me" : ""}` },
              h("th", { scope: "row" }, h("span", { class: "nm" }, this.name(r.playerId, props)), p?.ready ? h("span", { class: "oh-ready" }, h("span", { "aria-hidden": "true" }, " ✓"), h("span", { class: "oh-sr" }, ", ready")) : null),
              h("td", {}, String(r.bid)),
              h("td", {}, String(r.tricks)),
              h("td", { class: "pts" }, r.points > 0 ? `+${r.points}` : String(r.points)),
              h("td", { class: "total" }, String(r.total)),
            );
          }),
        ),
      ),
      h("p", { class: "oh-countdown", "data-last": last ? "1" : "" }),
    );
  }

  /** The summary's clock, from the server's deadline. */
  private renderCountdown() {
    const game = this.props?.game as OhHellPublicState | undefined;
    const el = this.tableBody.querySelector<HTMLElement>(".oh-countdown");
    if (!el || !game?.summaryEndsAt) return;
    const secs = Math.max(0, Math.ceil((game.summaryEndsAt - this.api.serverNow()) / 1000));
    const text = `${el.dataset.last ? "Final scores" : "Next round"} in ${secs}`;
    if (el.textContent !== text) el.textContent = text;
  }

  private showLastTrick() {
    const props = this.props;
    const game = props?.game as OhHellPublicState | undefined;
    const last = game?.lastTrick;
    if (!props || !last) return;
    openDialog(
      "Last trick",
      h(
        "div",
        { class: "oh-trick oh-last", role: "list" },
        last.plays.map((t, i) =>
          h(
            "div",
            { class: `oh-slot${t.playerId === last.winnerId ? " won" : ""}`, role: "listitem", "aria-label": `${this.name(t.playerId, props)}: ${cardLabel(t.card)}${i === 0 ? ", led" : ""}` },
            cardFace(t.card),
            h("span", { class: "oh-slot-name", "aria-hidden": "true" }, this.name(t.playerId, props)),
          ),
        ),
      ),
      h("p", {}, `${this.name(last.winnerId, props)} took it.`),
    );
  }

  private renderHand(game: OhHellPublicState, priv: OhHellPrivateState | null) {
    const hand = priv?.hand ?? [];
    const keep = new Set(hand.map((c) => c.id));
    for (const [id, btn] of this.cards) {
      if (!keep.has(id)) {
        btn.remove();
        this.cards.delete(id);
      }
    }
    const playing = !!priv?.legal.length;
    const legal = new Set(priv?.legal ?? []);
    hand.forEach((card, i) => {
      let btn = this.cards.get(card.id);
      if (!btn) {
        btn = handCard(card);
        const id = card.id;
        btn.addEventListener("click", () => this.onCardTap(id));
        this.cards.set(id, btn);
      }
      const ok = legal.has(card.id);
      const lifted = this.lifted === card.id;
      btn.classList.toggle("trump", card.suit === game.trump.suit);
      btn.classList.toggle("playable", playing && ok);
      btn.classList.toggle("illegal", playing && !ok);
      btn.classList.toggle("lifted", lifted);
      btn.setAttribute("aria-pressed", String(lifted));
      btn.setAttribute(
        "aria-label",
        `${cardLabel(card)}${card.suit === game.trump.suit ? ", trump" : ""}${playing && !ok ? ", can't play" : ""}${lifted ? ", tap again to play" : ""}`,
      );
      if (this.hand.children[i] !== btn) this.hand.insertBefore(btn, this.hand.children[i] ?? null);
    });
    // Roving tabindex: one tab stop into the hand, arrows within it.
    const focusTarget = (this.lifted && this.cards.get(this.lifted)) || this.hand.querySelector(".playable") || this.hand.firstElementChild;
    for (const btn of this.cards.values()) btn.tabIndex = btn === focusTarget ? 0 : -1;
  }

  private renderDock(props: GameViewProps, game: OhHellPublicState, priv: OhHellPrivateState | null) {
    const mine = game.players.find((p) => p.id === props.playerId);
    replaceChildren(
      this.me,
      h("span", { class: "you" }, "You"),
      mine && game.dealerId === props.playerId ? h("span", { class: "oh-dealer", title: "Dealer" }, "D") : null,
      mine && !mine.removed ? h("span", { class: `line${bidState(mine, game)}` }, bidLine(mine, game)) : null,
      mine ? h("span", { class: "pts" }, plural(mine.score, "pt")) : null,
    );

    const hint = (text: string, strong = false) => h("span", { class: `hint${strong ? " strong" : ""}` }, text);
    let action: Node | Node[] | null = null;
    if (game.phase === "over" || !mine || mine.removed) action = null;
    else if (this.pending.size) action = hint("…");
    else if (game.phase === "round-summary") {
      const waiting = game.players.filter((p) => !p.removed && !p.ready).length;
      action = priv?.canReady
        ? h("button", { type: "button", class: "primary", onclick: () => this.send({ type: "ready" }) }, "Ready")
        : hint(`Waiting on ${waiting}…`);
    } else if (priv?.canBid) {
      action =
        this.bidPick === null
          ? hint("Pick your bid", true)
          : h("button", { type: "button", class: "primary", onclick: () => this.sendBid() }, `Bid ${this.bidPick}`);
    } else if (priv?.legal.length) {
      const card = this.lifted ? priv.hand.find((c) => c.id === this.lifted) : undefined;
      action = card
        ? h("button", { type: "button", class: "primary", onclick: () => this.playLifted() }, `Play ${cardShort(card)}`)
        : hint("Tap a card twice", true);
    } else if (game.trickWinnerId) action = null;
    else action = hint(game.phase === "bidding" ? "Waiting for bids" : "Not your turn yet");
    replaceChildren(this.action, action);

    // The bid picker: 0 to the hand size, the dealer's forbidden number struck out.
    this.bids.hidden = !priv?.canBid || !!this.pending.size;
    if (this.bids.hidden) replaceChildren(this.bids);
    else {
      replaceChildren(
        this.bids,
        Array.from({ length: game.handSize + 1 }, (_, n) => {
          const banned = n === game.forbiddenBid;
          return h(
            "button",
            {
              type: "button",
              class: `oh-bid${this.bidPick === n ? " picked" : ""}${banned ? " banned" : ""}`,
              disabled: banned,
              "aria-pressed": String(this.bidPick === n),
              "aria-label": banned ? `${n}: not allowed, the bids would add up to ${game.handSize}` : String(n),
              title: banned ? `Would make the bids add up to ${game.handSize}` : undefined,
              onclick: () => this.onBidTap(n),
            },
            String(n),
          );
        }),
      );
    }
  }

  // ---- interaction --------------------------------------------------------

  private onBidTap(n: number) {
    // A second tap on the same number confirms, like the cards.
    if (this.bidPick === n) return this.sendBid();
    this.bidPick = n;
    this.rerender();
  }

  private sendBid() {
    if (this.bidPick === null) return;
    const tricks = this.bidPick;
    this.bidPick = null;
    this.send({ type: "bid", tricks });
  }

  /**
   * Tap to lift, tap again (or press Play) to put it down. One tap would be
   * quicker, but overlapping cards on a phone make a stray tap too easy, and
   * there's no taking a card back.
   */
  private onCardTap(cardId: string) {
    const props = this.props;
    const priv = props?.private as OhHellPrivateState | null | undefined;
    const game = props?.game as OhHellPublicState | undefined;
    if (!props || !priv || !game || this.pending.size) return;
    if (!priv.legal.length) {
      this.log.textContent = priv.canBid ? "Bid first: pick a number above your hand." : "Not your turn yet.";
      return;
    }
    if (!priv.legal.includes(cardId)) {
      const led = game.trick[0]?.card.suit;
      this.log.textContent = led ? `Follow suit: play a ${suitOne(led)}.` : "You can't play that.";
      const btn = this.cards.get(cardId);
      btn?.classList.remove("shake");
      void btn?.offsetWidth;
      btn?.classList.add("shake");
      audio.buzz(20);
      return;
    }
    if (this.lifted === cardId) return this.playLifted();
    this.lifted = cardId;
    this.rerender();
  }

  private playLifted() {
    if (!this.lifted) return;
    const card = this.lifted;
    this.lifted = null;
    this.send({ type: "play", card });
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
