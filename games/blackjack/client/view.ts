import { audio } from "@games/audio";
import type { Presence } from "@games/protocol";
import { avatar, countdown, h, replaceChildren, seatName, withBotBadge, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { formatChips } from "@games/game-core";
import type {
  BlackjackAction,
  BlackjackEvent,
  BlackjackPrivateState,
  BlackjackPublicPlayer,
  BlackjackPublicState,
  Card,
  PublicHand,
} from "../shared/types.ts";
import { cardBack, cardFace, cardLabel, cardMini, cardSlot, chip } from "./cards.ts";
import { describe, handLabel, quickBets, resultText, roundNet, statusText, type Names } from "./text.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting",
  disconnected: "disconnected",
  left: "left",
};

/** Your clock ticks through its last seconds. */
const TICK_FROM = 5;
const BET_STEP = 10;

const resultClass = (hand: Pick<PublicHand, "result">) =>
  hand.result === "win" || hand.result === "blackjack" ? " won" : hand.result === "push" ? " tie" : hand.result ? " lost" : "";

export class BlackjackView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "blackjack" });
  private info = h("div", { class: "bj-info" });
  private timer = countdown();
  private status = h("div", { class: "bj-status", role: "status", "aria-live": "polite" });
  private dealer = h("section", { class: "bj-dealer", "aria-label": "Dealer" });
  private seats = h("div", { class: "bj-seats", role: "list", "aria-label": "Other players" });
  private log = h("p", { class: "bj-log", "aria-live": "polite" });
  private dock = h("div", { class: "bj-dock" });
  private hands = h("div", { class: "bj-hands" });
  private me = h("div", { class: "bj-me" });
  private actions = h("div", { class: "bj-actions" });

  /** Cards already shown per hand ("p1:0", "dealer"), so only new ones flip in. */
  private seen = new Map<string, number>();
  private betAmount = 50;
  /** An action is on its way: buttons wait for the answer, so a double tap can't send two. */
  private sending = false;
  private wasMyTurn = false;
  private lastTick = -1;
  private clock: ReturnType<typeof setInterval>;

  constructor(api: GameClientApi) {
    this.api = api;
    this.dock.append(this.hands, this.me, this.actions);
    this.root.append(h("div", { class: "bj-top" }, this.info, this.timer.el), this.status, this.dealer, this.seats, this.log, this.dock);
    this.clock = setInterval(() => this.renderClock(), 250);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    clearInterval(this.clock);
    this.root.remove();
  }

  rejected(_clientActionId: string, message: string) {
    this.sending = false;
    this.log.textContent = message;
    this.actions.classList.remove("shake");
    void this.actions.offsetWidth; // restart the animation
    this.actions.classList.add("shake");
    if (this.props) this.render(this.props, false);
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    this.sending = false;
    if (props.snapshot || !this.props) this.seen.clear();
    this.render(props, !props.snapshot);
  }

  private names(props: GameViewProps): Names {
    return { me: props.playerId, name: (id) => seatName(props.room, id) };
  }

  private render(props: GameViewProps, live: boolean) {
    const first = !this.props;
    this.props = props;
    const game = props.game as BlackjackPublicState;
    const priv = props.private as BlackjackPrivateState | null;
    const myTurn = !!(priv?.bet || priv?.moves || priv?.canRebuy);
    const names = this.names(props);
    this.root.classList.toggle("my-turn", myTurn);
    this.root.classList.toggle("over", game.step === "over");
    this.api.setTurn(priv?.moves ? "Your move" : priv?.bet ? "Place your bet" : priv?.canRebuy ? "Rebuy?" : null);

    const flips = live && !first;
    // Between rounds the table is empty: the next deal flips in from nothing.
    if (game.step === "betting") this.seen.clear();
    this.renderInfo(game);
    this.status.textContent = statusText(game, priv, names);
    this.renderDealer(game, flips);
    this.renderSeats(props, game, flips);
    this.renderDock(props, game, priv, flips);
    this.renderClock();

    if (!live) return;
    const events = props.events as BlackjackEvent[];
    const lines = events.map((e) => describe(e, names)).filter(Boolean);
    if (lines.length) this.log.textContent = lines.slice(-2).join(" ");
    this.sounds(events, props);
    if (myTurn && !this.wasMyTurn) {
      audio.play("your-turn");
      audio.buzz(25);
      this.lastTick = -1;
    }
    this.wasMyTurn = myTurn;
  }

  private sounds(events: BlackjackEvent[], props: GameViewProps) {
    const me = props.playerId;
    for (const e of events) {
      if (e.type === "round-start" && e.shuffled) audio.play("shuffle");
      else if (e.type === "deal" || e.type === "dealer-draw" || e.type === "dealer-reveal") audio.play("deal");
      else if (e.type === "move" && e.playerId === me && e.kind !== "stand") audio.play("deal");
      else if (e.type === "bet" && e.playerId === me) audio.play("card-place");
      else if (e.type === "settled") {
        const mine = e.results.filter((r) => r.playerId === me);
        const net = mine.reduce((sum, r) => sum + r.paid - r.bet, 0);
        if (mine.length && net > 0) {
          audio.play("win");
          audio.buzz([30, 40, 60]);
        }
      } else if (e.type === "game-over") {
        const won = e.winnerIds.includes(me);
        audio.play(won ? "win" : "game-over");
        if (won) audio.buzz([40, 60, 40, 60, 90]);
      }
    }
  }

  // ---- table ------------------------------------------------------------------

  private renderInfo(game: BlackjackPublicState) {
    const parts = [`Round ${game.round} of ${game.rounds}`, `${game.shoeLeft} cards in the shoe`];
    if (game.shuffled && game.step === "betting") parts.push("New shuffle");
    this.info.textContent = parts.join(" · ");
  }

  /** New cards (past what this hand showed before) flip in. */
  private flipFrom(key: string, count: number, flips: boolean): number {
    const before = this.seen.get(key) ?? 0;
    this.seen.set(key, count);
    return flips && count >= before ? before : count;
  }

  private renderDealer(game: BlackjackPublicState, flips: boolean) {
    const cards = game.dealer.cards;
    const shown = cards.filter((c) => c !== null).length;
    const from = this.flipFrom("dealer", shown, flips);
    let i = 0;
    const row = cards.map((c) => (c ? cardFace(c, i++ >= from) : cardBack()));
    const total = game.dealer.total;
    const label = game.dealer.blackjack ? "Blackjack" : total === null ? "" : total > 21 ? `Bust ${total}` : cards.includes(null) ? `Shows ${total}` : String(total);
    replaceChildren(
      this.dealer,
      h("div", { class: "bj-dealer-head" }, h("b", {}, "Dealer"), label ? h("span", { class: `bj-total${total !== null && total > 21 ? " bust" : ""}` }, label) : null),
      h("div", { class: "bj-row", role: "group", "aria-label": cards.length ? `Dealer cards: ${cards.map((c) => (c ? cardLabel(c) : "face down")).join(", ")}` : "No cards yet" }, row.length ? row : cardSlot()),
      h("p", { class: "bj-rule" }, "Dealer stands on 17. Blackjack pays 3 to 2."),
    );
  }

  private renderSeats(props: GameViewProps, game: BlackjackPublicState, flips: boolean) {
    const i = game.players.findIndex((p) => p.id === props.playerId);
    const others = i < 0 ? game.players : [...game.players.slice(i + 1), ...game.players.slice(0, i)];
    replaceChildren(this.seats, others.map((p) => this.seat(p, props, game, flips)));
    this.seats.hidden = !others.length;
  }

  private seat(p: BlackjackPublicPlayer, props: GameViewProps, game: BlackjackPublicState, flips: boolean): HTMLElement {
    const seat = props.room.seats.find((s) => s.id === p.id);
    const name = seat?.name ?? "?";
    const presence = seat && seat.presence !== "connected" && !p.removed ? PRESENCE_LABEL[seat.presence] : "";
    const state = p.removed
      ? "Left"
      : p.out
        ? "Out"
        : p.pendingRebuy
          ? "No chips"
          : game.step === "betting"
            ? p.bet !== null ? "" : p.sittingOut ? "Sitting out" : "Betting"
            : p.bet === null && game.step !== "over" ? "Sits out" : "";
    const playingNow = p.active >= 0;
    const net = roundNet(p);
    const hands = p.hands.map((hand, idx) => {
      const from = this.flipFrom(`${p.id}:${idx}`, hand.cards.length, flips);
      return h(
        "span",
        { class: `bj-seat-hand${resultClass(hand)}${p.active === idx ? " on" : ""}` },
        h("span", { class: "bj-seat-cards" }, hand.cards.map((c, k) => cardMini(c, k >= from))),
        h("span", { class: "bj-seat-total" }, hand.result ? resultText(hand) : handLabel(hand)),
      );
    });
    const label = [
      name,
      `${formatChips(p.stack)} chips`,
      p.bet !== null ? `bet ${formatChips(p.bet)}` : "",
      state.toLowerCase(),
      presence,
      ...p.hands.map((hand) => `${hand.cards.map(cardLabel).join(", ")}: ${hand.result ? resultText(hand) : handLabel(hand)}`),
      playingNow ? "playing" : "",
    ]
      .filter(Boolean)
      .join(", ");
    const face = seat ? withBotBadge(avatar(name, seat.avatarSeed, "sm"), seat) : h("span", { class: "avatar avatar-sm" });
    return h(
      "div",
      {
        class: `bj-seat${playingNow ? " current" : ""}${p.out || p.removed ? " gone" : ""}${net !== null && net > 0 ? " won" : ""}${presence ? " away" : ""}`,
        role: "listitem",
        "aria-label": label,
      },
      h(
        "div",
        { class: "bj-seat-head", "aria-hidden": "true" },
        face,
        h("span", { class: "bj-name" }, name),
        h("span", { class: "bj-seat-stack" }, chip(), formatChips(p.stack)),
      ),
      h(
        "div",
        { class: "bj-seat-body", "aria-hidden": "true" },
        p.bet !== null ? h("span", { class: "bj-seat-bet" }, `Bet ${formatChips(p.bet)}`) : null,
        state || presence ? h("span", { class: "bj-tag" }, [state, presence].filter(Boolean).join(" · ")) : null,
        hands,
      ),
    );
  }

  // ---- your dock ----------------------------------------------------------------

  private renderDock(props: GameViewProps, game: BlackjackPublicState, priv: BlackjackPrivateState | null, flips: boolean) {
    const p = game.players.find((x) => x.id === props.playerId);
    if (!p) {
      replaceChildren(this.hands);
      replaceChildren(this.me, h("span", {}, "You are watching."));
      replaceChildren(this.actions);
      return;
    }
    replaceChildren(
      this.hands,
      p.hands.map((hand, idx) => {
        const from = this.flipFrom(`${p.id}:${idx}`, hand.cards.length, flips);
        const on = p.active === idx && p.hands.length > 1;
        return h(
          "div",
          { class: `bj-hand${resultClass(hand)}${on ? " on" : ""}`, role: "group", "aria-label": `Your hand${p.hands.length > 1 ? ` ${idx + 1}` : ""}: ${hand.cards.map(cardLabel).join(", ")}` },
          h("div", { class: "bj-row" }, hand.cards.map((c: Card, k) => cardFace(c, k >= from))),
          h(
            "div",
            { class: "bj-hand-line" },
            h("b", { class: `bj-total${hand.total > 21 ? " bust" : ""}` }, handLabel(hand)),
            h("span", {}, `Bet ${formatChips(hand.bet)}${hand.doubled ? " (doubled)" : ""}`),
            hand.result ? h("span", { class: "bj-result" }, resultText(hand)) : null,
          ),
        );
      }),
    );
    this.hands.hidden = !p.hands.length;
    const tag = p.removed ? "You left" : p.out ? "You are out" : p.sittingOut ? "Sitting out" : "";
    replaceChildren(
      this.me,
      h("span", { class: "bj-me-stack" }, chip(), h("b", {}, formatChips(p.stack)), " chips"),
      p.bet !== null && !p.hands.length ? h("span", {}, `Bet ${formatChips(p.bet)}`) : null,
      tag ? h("span", { class: "bj-tag" }, tag) : null,
    );
    this.renderActions(game, priv);
  }

  private renderActions(game: BlackjackPublicState, priv: BlackjackPrivateState | null) {
    const off = this.sending;
    if (priv?.canRebuy) {
      replaceChildren(
        this.actions,
        h("button", { class: "secondary", disabled: off, onclick: () => this.send({ type: "stay-out" }) }, "Stay out"),
        h("button", { class: "primary", disabled: off, onclick: () => this.send({ type: "rebuy" }) }, `Rebuy ${formatChips(game.startingChips)}`),
      );
      this.actions.className = "bj-actions two";
      return;
    }
    if (priv?.bet) return this.renderBet(priv.bet.min, priv.bet.max, off);
    if (priv?.moves) {
      const m = priv.moves;
      const move = (type: "hit" | "stand" | "double" | "split", label: string, ok: boolean) =>
        h("button", { class: `bj-${type}`, disabled: off || !ok, onclick: () => this.send({ type, hand: m.hand, cards: m.cards }) }, label);
      replaceChildren(this.actions, move("hit", "Hit", m.hit), move("stand", "Stand", m.stand), move("double", "Double", m.double), move("split", "Split", m.split));
      this.actions.className = "bj-actions moves";
      return;
    }
    if (priv?.canBack) {
      replaceChildren(this.actions, h("button", { class: "primary", disabled: off, onclick: () => this.send({ type: "back" }) }, "Play next round"));
      this.actions.className = "bj-actions";
      return;
    }
    replaceChildren(this.actions);
    this.actions.className = "bj-actions";
  }

  private renderBet(min: number, max: number, off: boolean) {
    this.betAmount = Math.min(max, Math.max(min, this.betAmount));
    const set = (n: number) => {
      this.betAmount = Math.min(max, Math.max(min, n));
      if (this.props) this.render(this.props, false);
    };
    const quick = quickBets(min, max).map((n) =>
      h("button", { class: `bj-quick${n === this.betAmount ? " on" : ""}`, disabled: off, onclick: () => set(n) }, formatChips(n)),
    );
    quick.push(h("button", { class: `bj-quick${max === this.betAmount ? " on" : ""}`, disabled: off, onclick: () => set(max) }, "All"));
    replaceChildren(
      this.actions,
      h("div", { class: "bj-quick-row", role: "group", "aria-label": "Bet amount" }, quick),
      h(
        "div",
        { class: "bj-bet-row" },
        h("button", { class: "bj-step", disabled: off || this.betAmount <= min, "aria-label": `${BET_STEP} less`, onclick: () => set(this.betAmount - BET_STEP) }, "−"),
        h("button", { class: "primary bj-bet", disabled: off, onclick: () => this.send({ type: "bet", amount: this.betAmount }) }, `Bet ${formatChips(this.betAmount)}`),
        h("button", { class: "bj-step", disabled: off || this.betAmount >= max, "aria-label": `${BET_STEP} more`, onclick: () => set(this.betAmount + BET_STEP) }, "+"),
      ),
    );
    this.actions.className = "bj-actions bet";
  }

  private send(action: BlackjackAction) {
    this.sending = true;
    this.api.act(action);
    if (this.props) this.render(this.props, false);
  }

  // ---- clock --------------------------------------------------------------------

  private renderClock() {
    const game = this.props?.game as BlackjackPublicState | undefined;
    if (!game) return;
    const priv = this.props?.private as BlackjackPrivateState | null;
    const paused = game.pausedAt !== null;
    const now = game.pausedAt ?? this.api.serverNow();
    const left = game.clock ? Math.max(0, game.clock.endsAt - now) : null;
    const mine = !!(priv?.bet || priv?.moves || priv?.canRebuy);
    this.timer.set(left, { paused: paused && left !== null, lowAt: mine ? TICK_FROM * 1000 : 0 });
    if (!mine || paused || left === null) return;
    const secs = Math.ceil(left / 1000);
    if (secs > 0 && secs <= TICK_FROM && secs !== this.lastTick && document.visibilityState === "visible") {
      this.lastTick = secs;
      audio.play("tick");
      if (secs <= 2) audio.buzz(15);
    }
  }
}
