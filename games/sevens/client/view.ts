import type { Presence } from "@games/protocol";
import { h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { formatRank, rankName, rowBounds, SEVEN } from "../shared/rules.ts";
import { SUITS, type Card, type SevensEvent, type SevensPrivateState, type SevensPublicState, type Suit } from "../shared/types.ts";

// U+FE0E asks for text presentation; without it some platforms draw ♥ as an emoji.
const SUIT_SYMBOL: Record<Suit, string> = { spades: "♠\uFE0E", hearts: "♥\uFE0E", diamonds: "♦\uFE0E", clubs: "♣\uFE0E" };
const SUIT_NAME: Record<Suit, string> = { spades: "Spades", hearts: "Hearts", diamonds: "Diamonds", clubs: "Clubs" };

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
  left: "left",
};

const cardLabel = (c: Pick<Card, "suit" | "rank">) => `${rankName(c.rank)} of ${SUIT_NAME[c.suit]}`;
const isRed = (suit: Suit) => suit === "hearts" || suit === "diamonds";

function cardFace(c: Pick<Card, "suit" | "rank">, tag: "span" | "button" = "span") {
  return h(
    tag,
    { class: `sv-card${isRed(c.suit) ? " red" : ""}`, "aria-label": cardLabel(c) },
    h("span", { class: "rank" }, formatRank(c.rank)),
    h("span", { class: "suit", "aria-hidden": "true" }, SUIT_SYMBOL[c.suit]),
  );
}

function describe(e: SevensEvent, props: GameViewProps): string | null {
  const who = (id: string) => (id === props.playerId ? "You" : seatName(props.room, id));
  switch (e.type) {
    case "dealt":
      return `${who(e.dealerId)} dealt.`;
    case "card-played":
      return `${who(e.playerId)} played the ${cardLabel(e.card)}.`;
    case "ghost-card-placed":
      return `The ${cardLabel(e.card)} went down on its own.`;
    case "passed":
      return `${who(e.playerId)} ${e.playerId === props.playerId ? "have" : "has"} nothing to play — passed.`;
    case "turn-skipped":
      return `${who(e.playerId)} got skipped by the host.`;
    case "player-removed":
      return `${who(e.playerId)} left the game.`;
    case "game-over":
      return null;
  }
}

/**
 * Phase 1 view: correct, plain, and tappable. Rebuilds its own subtrees on each
 * update. Only four small regions, so there's nothing worth diffing yet.
 */
export class SevensView implements GameView {
  private api: GameClientApi;
  private root = h("div", { class: "sevens" });
  private status = h("div", { class: "sv-status", role: "status", "aria-live": "polite" });
  private board = h("div", { class: "sv-board" });
  private players = h("div", { class: "sv-players" });
  private log = h("div", { class: "sv-log" });
  private hand = h("div", { class: "sv-hand", role: "group", "aria-label": "Your hand" });
  private pending = new Map<string, string>(); // clientActionId → cardId

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(this.status, this.board, this.players, this.log, h("h2", { class: "sv-hand-title" }, "Your hand"), this.hand);
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
    const btn = cardId && this.hand.querySelector<HTMLElement>(`[data-card="${cardId}"]`);
    if (btn) {
      btn.classList.remove("shake");
      void btn.offsetWidth; // restart the animation
      btn.classList.add("shake");
    }
    this.log.textContent = message;
  }

  update(props: GameViewProps) {
    const game = props.game as SevensPublicState;
    const priv = props.private as SevensPrivateState | null;
    const myTurn = game.currentPlayerId === props.playerId;

    // Status line
    // Once finished, the room's results panel announces the winner.
    this.status.hidden = game.currentPlayerId === null;
    const awaited = props.room.seats.find((s) => s.id === game.currentPlayerId);
    const awaitedAway = awaited && awaited.presence !== "connected" ? ` (${PRESENCE_LABEL[awaited.presence]})` : "…";
    this.status.textContent = this.status.hidden ? "" : myTurn ? "Your turn" : `Waiting for ${seatName(props.room, game.currentPlayerId)}${awaitedAway}`;
    this.status.classList.toggle("mine", myTurn);

    // Board: fixed columns so the seven lines up across suits (§15).
    const { min, max } = rowBounds(game.acePosition);
    replaceChildren(
      this.board,
      SUITS.map((suit) => {
        const row = game.board[suit];
        const cells = [];
        for (let r = min; r <= max; r++) {
          const played = row && r >= row.low && r <= row.high;
          cells.push(
            played
              ? cardFace({ suit, rank: r })
              : h("span", { class: `sv-slot${r === SEVEN ? " seven" : ""}`, "aria-hidden": "true" }),
          );
        }
        return h(
          "div",
          { class: "sv-row", "aria-label": `${SUIT_NAME[suit]}: ${row ? `${formatRank(row.low)} to ${formatRank(row.high)}` : "not started"}` },
          h("span", { class: `sv-row-suit${isRed(suit) ? " red" : ""}`, "aria-hidden": "true" }, SUIT_SYMBOL[suit]),
          cells,
        );
      }),
    );

    // Players, joined with room seats for names/presence (§7).
    replaceChildren(
      this.players,
      game.players.map((p) => {
        const seat = props.room.seats.find((s) => s.id === p.id);
        const away = seat && seat.presence !== "connected" && !p.removed;
        return h(
          "div",
          {
            class: `sv-player${p.id === game.currentPlayerId ? " current" : ""}${p.id === props.playerId ? " me" : ""}${away ? " away" : ""}`,
          },
          h("span", { class: "name" }, p.id === props.playerId ? "You" : (seat?.name ?? "?")),
          p.id === game.dealerId ? h("span", { class: "dealer", title: "Dealer" }, "D") : null,
          h("span", { class: "count" }, p.removed ? "left" : `${p.cardCount}`),
          away ? h("span", { class: "away-label" }, PRESENCE_LABEL[seat.presence]) : null,
        );
      }),
    );

    // Log: latest thing that happened
    const lines = (props.events as SevensEvent[]).map((e) => describe(e, props)).filter(Boolean);
    if (lines.length) this.log.textContent = lines.join(" ");

    // Hand
    const playable = new Set(priv?.playableCardIds ?? []);
    replaceChildren(
      this.hand,
      (priv?.hand ?? []).map((card) => {
        const canPlay = myTurn && playable.has(card.id);
        const btn = cardFace(card, "button");
        btn.dataset.card = card.id;
        if (canPlay) btn.classList.add("playable");
        btn.addEventListener("click", () => {
          if (!myTurn) {
            this.log.textContent = "Not your turn yet.";
            return;
          }
          this.pending.set(this.api.act({ type: "play-card", cardId: card.id }), card.id);
        });
        return btn;
      }),
      priv?.canPass
        ? h("button", { class: "sv-pass", onclick: () => this.api.act({ type: "pass" }) }, "Pass")
        : null,
    );
  }
}
