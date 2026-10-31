import { AnimationQueue, bubble, fly, once } from "@games/animation";
import { audio } from "@games/audio";
import type { Presence, RoomPublicState } from "@games/protocol";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { formatChips } from "../shared/rules.ts";
import type {
  Card,
  HandSummary,
  HoldemEvent,
  HoldemPrivateState,
  HoldemPublicPlayer,
  HoldemPublicState,
  LegalActions,
} from "../shared/types.ts";
import { cardFace, cardLabel, cardMini, cardShort, cardSlot, chip, miniBack } from "./cards.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
  left: "left",
};

/** Your clock ticks through its last seconds. */
const TICK_FROM = 5;
/** A dealt card is mostly see-through for its first ~80ms of rise. */
const DEAL_SOUND_LAG = 80;
/** Ghost chips per pot that slides to a winner: enough to read as a pile. */
const POT_GHOSTS = 4;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isStreet = (step: string) => step === "preflop" || step === "flop" || step === "turn" || step === "river";

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

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
function names(list: string[]): string {
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : (list[0] ?? "");
}

/** "Ana wins 1,240 · Two pair, Kings and Fives". One clause per pot that someone won. */
function summaryText(summary: HandSummary, props: GameViewProps): string {
  const me = props.playerId;
  const who = (id: string) => (id === me ? "You" : seatName(props.room, id));
  const pots = summary.pots.filter((p) => !p.uncalled);
  return pots
    .map((pot, i) => {
      const winners = names(pot.winners.map(who));
      const single = pot.winners.length === 1;
      const verb = single ? (pot.winners[0] === me ? "win" : "wins") : "split";
      const which = pots.length > 1 ? `${i === 0 ? "Main pot" : `Side pot${pots.length > 2 ? ` ${i}` : ""}`}: ` : "";
      return `${which}${winners} ${verb} ${formatChips(pot.amount)}${pot.label ? ` · ${pot.label}` : ""}`;
    })
    .join(". ");
}

function describe(e: HoldemEvent, props: GameViewProps): string | null {
  const me = props.playerId;
  const who = (id: string | null) => (id === me ? "You" : seatName(props.room, id));
  const verb = (id: string, you: string, they: string) => (id === me ? you : they);
  switch (e.type) {
    case "hand-start":
      return `Hand ${e.handNumber}. Blinds ${formatChips(e.sb)}/${formatChips(e.bb)}; ${who(e.buttonId)} ${verb(e.buttonId, "have", "has")} the button.`;
    case "level-up":
      return `Blinds up: ${formatChips(e.sb)}/${formatChips(e.bb)}.`;
    case "your-cards":
      return `You're dealt the ${cardLabel(e.cards[0]!)} and the ${cardLabel(e.cards[1]!)}.`;
    case "bet": {
      const name = who(e.playerId);
      const why = e.auto === "timer" ? " (out of time)" : e.auto === "skip" ? " (skipped)" : e.auto === "sitting-out" ? " (sitting out)" : "";
      switch (e.kind) {
        case "fold": return `${name} ${verb(e.playerId, "fold", "folds")}${why}.`;
        case "check": return `${name} ${verb(e.playerId, "check", "checks")}${why}.`;
        case "call": return `${name} ${verb(e.playerId, "call", "calls")} ${formatChips(e.to)}.`;
        case "bet": return `${name} ${verb(e.playerId, "bet", "bets")} ${formatChips(e.to)}.`;
        case "raise": return `${name} ${verb(e.playerId, "raise", "raises")} to ${formatChips(e.to)}.`;
        case "all-in": return `${name} ${verb(e.playerId, "are", "is")} all-in for ${formatChips(e.to)}.`;
      }
      return null;
    }
    case "board":
      return `The ${e.street}: ${e.cards.map(cardShort).join(" ")}.`;
    case "returned":
      return `${formatChips(e.amount)} uncalled back to ${e.playerId === me ? "you" : seatName(props.room, e.playerId)}.`;
    case "reveal":
      return null;
    case "awarded":
      return `${summaryText(e.summary, props)}.`;
    case "sitting-out":
      return `${who(e.playerId)} ${verb(e.playerId, "are", "is")} sitting out.`;
    case "back":
      return `${who(e.playerId)} ${verb(e.playerId, "are", "is")} back.`;
    case "busted": {
      const out = e.playerIds.filter((id) => !e.rebuy.includes(id));
      const parts = [];
      if (out.length) parts.push(`${names(out.map(who))} ${out.length === 1 && out[0] !== me ? "is" : "are"} out.`);
      if (e.rebuy.length) parts.push(`${names(e.rebuy.map(who))} can rebuy.`);
      return parts.join(" ");
    }
    case "rebuy":
      return `${who(e.playerId)} bought back in for ${formatChips(e.chips)}.`;
    case "player-removed":
      return `${who(e.playerId)} left. Their cards are folded.`;
    case "game-over":
      if (e.reason === "abandoned") return "Everyone else left.";
      if (e.reason === "time") return "Time's up. Biggest stack wins.";
      return e.winnerIds.includes(me) ? "Every chip is yours." : `${names(e.winnerIds.map(who))} has every chip.`;
  }
}

export class HoldemView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "holdem" });
  private info = h("div", { class: "he-info" });
  private levelText = h("span", {});
  private capText = h("span", { class: "he-cap" });
  private status = h("div", { class: "he-status", role: "status", "aria-live": "polite" });
  private seats = h("div", { class: "he-seats", role: "list", "aria-label": "Other players" });
  private board = h("div", { class: "he-board", role: "img" });
  private potLine = h("div", { class: "he-pot" });
  private potsLine = h("div", { class: "he-pots" });
  private summary = h("p", { class: "he-summary" });
  /** The showdown, one row per hand that went the distance. */
  private showdown = h("ol", { class: "he-showdown", "aria-label": "Showdown" });
  private stepNote = h("p", { class: "he-step" });
  private log = h("p", { class: "he-log", "aria-live": "polite" });

  private dock = h("div", { class: "he-dock" });
  private hole = h("div", { class: "he-hole", role: "img" });
  private meText = h("div", { class: "he-me-text" });
  private myBar = h("div", { class: "he-bar", "aria-hidden": "true" }, h("span"));
  private actions = h("div", { class: "he-actions" });

  // The raise panel lives across renders so a drag on the slider survives updates.
  private raisePanel = h("div", { class: "he-raise", role: "group", "aria-label": "Raise amount" });
  private raiseOut = h("output", { class: "he-raise-amount" });
  private raiseHead = h("span", {});
  private slider = h("input", { type: "range", class: "he-slider", "aria-label": "Raise to" });
  private quick = h("div", { class: "he-quick" });
  private raiseOpen = false;
  private raiseTo = 0;

  /** Sent and not yet answered: the buttons stay locked meanwhile. */
  private pending = new Set<string>();
  private queue = new AnimationQueue();
  private wasMyTurn = false;
  private clock: ReturnType<typeof setInterval>;
  private lastTick = -1;

  constructor(api: GameClientApi) {
    this.api = api;
    this.info.append(this.levelText, this.capText);
    this.slider.addEventListener("input", () => this.setRaise(Number(this.slider.value), true));
    const step = (dir: number) => () => this.setRaise(this.raiseTo + dir * this.bb());
    this.raisePanel.append(
      h("div", { class: "he-raise-head" }, this.raiseHead, this.raiseOut),
      h(
        "div",
        { class: "he-raise-row" },
        h("button", { type: "button", class: "he-step-btn", "aria-label": "Less", onclick: step(-1) }, "−"),
        this.slider,
        h("button", { type: "button", class: "he-step-btn", "aria-label": "More", onclick: step(1) }, "+"),
      ),
      this.quick,
    );
    this.raisePanel.hidden = true;

    this.dock.append(
      this.raisePanel,
      h("div", { class: "he-me" }, this.hole, this.meText),
      this.myBar,
      this.actions,
    );
    this.root.append(
      this.info,
      this.status,
      this.seats,
      h(
        "div",
        { class: "he-table", role: "group", "aria-label": "Table" },
        this.board,
        this.showdown,
        h("div", { class: "he-middle" }, this.potLine, this.potsLine),
        this.summary,
        this.stepNote,
      ),
      this.log,
      this.dock,
    );
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
      this.actions.classList.remove("shake");
      void this.actions.offsetWidth; // restart the animation
      this.actions.classList.add("shake");
    }
    this.rerender();
    this.log.textContent = message;
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    const events = props.events as HoldemEvent[];
    this.pending.clear();
    // Reconnects and late arrivals: show it as it is. A fresh deal is the show.
    const fresh = !this.props && events.some((e) => e.type === "hand-start");
    if (props.snapshot || (!this.props && !fresh)) {
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
    const game = props.game as HoldemPublicState;
    const priv = props.private as HoldemPrivateState | null;
    const legal = priv?.legal ?? null;
    const myTurn = !!legal;
    if (!myTurn) this.raiseOpen = false;
    this.root.classList.toggle("my-turn", myTurn);
    this.root.classList.toggle("over", game.step === "over");
    this.api.setTurn(myTurn ? "Your turn" : priv?.canRebuy ? "Rebuy?" : null);

    this.renderInfo(game);
    this.renderStatus(props, game, priv);
    this.renderSeats(props, game);
    this.renderTable(props, game);
    this.renderDock(props, game, priv);
    this.renderClock();

    const events = props.events as HoldemEvent[];
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
        this.lastTick = -1;
      }
    }
    if (sounds !== "none" || props.snapshot) this.wasMyTurn = myTurn;
  }

  private rerender() {
    if (this.props) this.render(this.props, "none");
  }

  private bb(): number {
    return (this.props?.game as HoldemPublicState | undefined)?.bb ?? 20;
  }

  // ---- animation (§18) ----------------------------------------------------

  private async act(events: HoldemEvent[], props: GameViewProps) {
    // Nothing to press while the show's on: the buttons belong to the old state.
    replaceChildren(this.actions);
    this.raisePanel.hidden = true;
    // A real showdown plays hand by hand, so the all-at-once flip sits this one out.
    const live = events.some((e) => e.type === "awarded" && !e.summary.byFold && e.summary.order.length > 0);
    for (const e of events) {
      switch (e.type) {
        case "hand-start":
          audio.play("shuffle");
          this.render(props, "none");
          await this.dealIn(props, e.dealt, 300);
          break;
        case "bet":
          await this.showBet(e, props);
          break;
        case "board":
          await this.dealBoard(e.street, e.cards);
          break;
        case "reveal":
          if (!live) await this.revealSeats(e.hands, props);
          break;
        case "awarded":
          if (live && !e.summary.byFold) await this.playShowdown(e.summary, props);
          await this.potToWinners(e.summary, props);
          break;
        case "game-over":
          // A beat on the final table before the results take over.
          await wait(1500);
          break;
        default:
          break;
      }
    }
  }

  private eventSounds(events: HoldemEvent[], props: GameViewProps) {
    for (const e of events) {
      if (e.type === "hand-start") audio.play("shuffle");
      else if (e.type === "board") audio.play("deal");
      else if (e.type === "bet") audio.play(e.kind === "fold" || e.kind === "check" ? "pass" : "card-place");
      else if (e.type === "awarded" && e.summary.won[props.playerId]) audio.play("win");
    }
  }

  /** Where a player "sits" on screen: their seat, or your cards. */
  private anchorFor(playerId: string, props: GameViewProps): Element {
    if (playerId === props.playerId) return this.hole;
    return this.seats.querySelector(`[data-player="${CSS.escape(playerId)}"] .avatar`) ?? this.status;
  }

  private smallRect(anchor: Element, size = 22): DOMRect {
    const r = anchor.getBoundingClientRect();
    return new DOMRect(r.left + r.width / 2 - size / 2, r.top + r.height / 2 - size / 2, size, size);
  }

  /** Your two cards rise in, and everyone else's backs pop on their seats. */
  private async dealIn(props: GameViewProps, dealt: string[], after = 0) {
    const flights: Promise<unknown>[] = [];
    dealt.forEach((id, i) => {
      const targets =
        id === props.playerId
          ? ([...this.hole.children] as HTMLElement[])
          : ([...(this.seats.querySelector(`[data-player="${CSS.escape(id)}"] .he-seat-cards`)?.children ?? [])] as HTMLElement[]);
      targets.forEach((el, j) => {
        const delay = after + (j * dealt.length + i) * 60;
        if (id === props.playerId) setTimeout(() => audio.play("deal"), delay + DEAL_SOUND_LAG);
        flights.push(
          el.animate(
            [
              { transform: id === props.playerId ? "translateY(80%) rotate(-6deg)" : "scale(.4)", opacity: 0 },
              { transform: "none", opacity: 1 },
            ],
            { duration: 320, delay, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
          ).finished,
        );
      });
    });
    await Promise.all(flights).catch(() => {});
  }

  private async showBet(e: Extract<HoldemEvent, { type: "bet" }>, props: GameViewProps) {
    const anchor = this.anchorFor(e.playerId, props);
    const words: Record<string, string> = {
      fold: "Fold",
      check: "Check",
      call: `Call ${formatChips(e.to)}`,
      bet: `Bet ${formatChips(e.to)}`,
      raise: `Raise ${formatChips(e.to)}`,
      "all-in": "All-in",
    };
    if (e.kind === "fold" || e.kind === "check") {
      audio.play("pass");
      await bubble(anchor, words[e.kind]!, "anim-bubble", 800);
      return;
    }
    if (e.kind === "all-in") {
      audio.play("nudge");
      audio.buzz(30);
    }
    const target = this.potLine.querySelector(".he-chip") ?? this.potLine;
    const flight = fly(chip("he-chip-fly"), this.smallRect(anchor), this.smallRect(target, 18), 360);
    void bubble(anchor, words[e.kind]!, `anim-bubble${e.kind === "all-in" ? " he-allin-bubble" : ""}`, 900);
    await flight;
    audio.play("card-place");
  }

  /** New shared cards turn over one by one in their slots. */
  private async dealBoard(street: string, cards: Card[]) {
    const start = street === "flop" ? 0 : street === "turn" ? 3 : 4;
    for (let i = 0; i < cards.length; i++) {
      const slot = this.board.children[start + i];
      const face = once(cardFace(cards[i]!), "flip");
      if (slot) slot.replaceWith(face);
      else this.board.append(face);
      audio.play("deal");
      await wait(150);
    }
    await wait(250);
  }

  private async revealSeats(hands: Record<string, Card[]>, props: GameViewProps) {
    let any = false;
    for (const [id, cards] of Object.entries(hands)) {
      if (id === props.playerId) continue;
      const box = this.seats.querySelector(`[data-player="${CSS.escape(id)}"] .he-seat-cards`);
      if (!box) continue;
      replaceChildren(box, cards.map((c) => once(cardMini(c), "flip")));
      any = true;
    }
    if (any) {
      audio.play("deal");
      await wait(550);
    }
  }

  /**
   * Hands turn over one at a time, from the button's left. Each gets its
   * moment: cards flip, the label lands, the board lights up its five. Then
   * the winners get stamped and everyone else dims.
   */
  private async playShowdown(summary: HandSummary, props: GameViewProps) {
    // The old state still says whose turn it was. Nobody's, now.
    this.root.classList.remove("my-turn");
    this.api.setTurn(null);
    replaceChildren(this.status, h("span", {}, "Showdown"));
    this.summary.hidden = true;
    this.showdown.hidden = false;
    replaceChildren(this.showdown);
    const rows = new Map<string, HTMLElement>();
    for (const id of summary.order) {
      const row = this.showdownRow(id, summary, props, true);
      rows.set(id, row);
      this.showdown.append(once(row, "enter"));
      for (const r of rows.values()) r.classList.toggle("on", r === row);
      const box = this.seats.querySelector(`[data-player="${CSS.escape(id)}"] .he-seat-cards`);
      if (box && summary.shown[id]) replaceChildren(box, summary.shown[id]!.map((c) => once(cardMini(c), "flip")));
      this.markBoard(new Set(summary.fives[id] ?? []));
      audio.play("deal");
      await wait(1100);
    }
    for (const [id, row] of rows) {
      row.classList.remove("on");
      this.stampRow(row, id, summary);
    }
    this.markBoard(new Set(Object.values(summary.bestCards).flat()));
    this.summary.textContent = summaryText(summary, props);
    this.summary.classList.add("now");
    this.summary.hidden = false;
    once(this.summary, "pop");
    await wait(600);
  }

  private markBoard(lit: Set<string>) {
    for (const el of this.board.querySelectorAll<HTMLElement>(".he-card[data-card]")) {
      el.classList.toggle("best", lit.has(el.dataset.card!));
      el.classList.toggle("dim", lit.size > 0 && !lit.has(el.dataset.card!));
    }
  }

  private showdownRow(id: string, summary: HandSummary, props: GameViewProps, flip: boolean): HTMLElement {
    const seat = props.room.seats.find((s) => s.id === id);
    const me = id === props.playerId;
    const cards = (summary.shown[id] ?? []).map((c) => {
      const el = cardMini(c);
      return flip ? once(el, "flip") : el;
    });
    const label = summary.labels[id] ?? "";
    return h(
      "li",
      { class: `he-sd-row${me ? " me" : ""}`, "aria-label": `${me ? "You" : (seat?.name ?? "?")}: ${label}` },
      seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
      h("span", { class: "he-sd-who" }, h("b", {}, me ? "You" : (seat?.name ?? "?")), h("span", {}, label)),
      h("span", { class: "he-sd-cards" }, cards),
      h("span", { class: "he-sd-won" }),
    );
  }

  private stampRow(row: HTMLElement, id: string, summary: HandSummary) {
    const won = summary.won[id];
    row.classList.toggle("won", !!won);
    row.classList.toggle("lost", !won);
    const best = new Set(summary.bestCards[id] ?? []);
    for (const el of row.querySelectorAll<HTMLElement>(".he-mini[data-card]")) el.classList.toggle("best", best.has(el.dataset.card!));
    const tag = row.querySelector(".he-sd-won")!;
    tag.textContent = won ? `+${formatChips(won)}` : "";
  }

  /** The pot slides to whoever won it. */
  private async potToWinners(summary: HandSummary, props: GameViewProps) {
    const from = this.smallRect(this.potLine.querySelector(".he-chip") ?? this.potLine, 18);
    const winners = Object.keys(summary.won);
    await Promise.all(
      winners.map(async (id, w) => {
        const anchor = this.anchorFor(id, props);
        await wait(w * 120);
        await Promise.all(
          Array.from({ length: POT_GHOSTS }, async (_, i) => {
            await wait(i * 60);
            await fly(chip("he-chip-fly"), from, this.smallRect(anchor, 18), 420);
          }),
        );
        void bubble(anchor, `+${formatChips(summary.won[id]!)}`, "anim-bubble he-win-bubble", 1100);
      }),
    );
    if (summary.won[props.playerId]) {
      audio.play("win");
      audio.buzz([30, 40, 60]);
    } else audio.play("card-place");
    await wait(300);
  }

  // ---- regions ------------------------------------------------------------

  private renderInfo(game: HoldemPublicState) {
    const hands = game.handsToNextLevel;
    this.levelText.textContent =
      game.step === "over"
        ? `Level ${game.level} · Blinds ${formatChips(game.sb)}/${formatChips(game.bb)}`
        : `Hand ${game.handNumber} · Blinds ${formatChips(game.sb)}/${formatChips(game.bb)} · ${formatChips(game.next.sb)}/${formatChips(game.next.bb)} ${hands === 1 ? "next hand" : `in ${hands} hands`}`;
  }

  private renderStatus(props: GameViewProps, game: HoldemPublicState, priv: HoldemPrivateState | null) {
    this.status.hidden = game.step === "over";
    if (this.status.hidden) return;
    const room: RoomPublicState = props.room;
    const legal = priv?.legal;
    if (legal) {
      const owed = legal.call ? `${formatChips(legal.call)} to call` : "Check or bet";
      replaceChildren(this.status, h("span", {}, `Your turn · ${owed}`));
      return;
    }
    if (game.currentPlayerId) {
      const seat = room.seats.find((s) => s.id === game.currentPlayerId);
      const away = seat && seat.presence !== "connected" ? ` (${PRESENCE_LABEL[seat.presence]})` : "";
      replaceChildren(this.status, seat ? avatar(seat.name, seat.avatarSeed, "sm") : null, h("span", {}, `${seat?.name ?? "Someone"}${away} to act`));
      return;
    }
    let text = "";
    if (game.runout) text = "All in. Running out the board";
    else if ((game.step === "showdown" || game.step === "awarded") && game.lastHand) text = summaryText(game.lastHand, props);
    else if (game.step === "between-hands") text = priv?.canRebuy ? "You're bust. Rebuy?" : "Next hand coming";
    replaceChildren(this.status, h("span", {}, text));
  }

  private renderSeats(props: GameViewProps, game: HoldemPublicState) {
    const won = this.showingResult(game) ? (game.lastHand?.won ?? {}) : {};
    const best = this.bestCards(game);
    replaceChildren(
      this.seats,
      fromMyLeft(game.players, props.playerId).map((p) => this.seat(p, props, game, won, best)),
    );
  }

  /** Last hand's result is on the table: showdown, fold-out, or the pause after. */
  private showingResult(game: HoldemPublicState): boolean {
    return game.step === "showdown" || game.step === "awarded" || game.step === "between-hands" || game.step === "over";
  }

  /** The winning fives, for the highlight. */
  private bestCards(game: HoldemPublicState): Set<string> {
    const lh = game.lastHand;
    if (!lh || !this.showingResult(game) || lh.handNumber !== game.handNumber) return new Set();
    return new Set(Object.values(lh.bestCards).flat());
  }

  private seat(p: HoldemPublicPlayer, props: GameViewProps, game: HoldemPublicState, won: Record<string, number>, best: Set<string>): HTMLElement {
    const seat = props.room.seats.find((s) => s.id === p.id);
    const name = seat?.name ?? "?";
    const presence = seat && seat.presence !== "connected" && !p.removed ? PRESENCE_LABEL[seat.presence] : "";
    const current = p.id === game.currentPlayerId;
    const status = p.removed
      ? "Left"
      : p.out
        ? "Out"
        : p.pendingRebuy
          ? "Bust"
          : !p.inHand
            ? ""
            : p.folded
              ? "Folded"
              : p.allIn
                ? "All-in"
                : "";
    const extras = [p.sittingOut && !p.removed && !p.out ? "sitting out" : "", presence].filter(Boolean);
    const role = p.id === game.buttonId ? "D" : null;
    const blind = p.id === game.sbId ? "SB" : p.id === game.bbId ? "BB" : null;
    const showRoles = game.step !== "over" && p.inHand;
    const cards = p.cards
      ? p.cards.map((c) => {
          const el = cardMini(c);
          if (best.has(c.id)) el.classList.add("best");
          return el;
        })
      : p.inHand && !p.folded && game.step !== "over"
        ? [miniBack(), miniBack()]
        : [];
    const gain = won[p.id];
    const label = [
      name,
      `${formatChips(p.stack)} chips`,
      p.bet ? `bet ${formatChips(p.bet)}` : "",
      showRoles && role ? "dealer button" : "",
      showRoles && blind ? (blind === "SB" ? "small blind" : "big blind") : "",
      status.toLowerCase(),
      ...extras,
      p.cards ? `showing ${p.cards.map(cardLabel).join(" and ")}` : "",
      gain ? `won ${formatChips(gain)}` : "",
      current ? "to act" : "",
    ]
      .filter(Boolean)
      .join(", ");
    return h(
      "div",
      {
        class: `he-seat${current ? " current" : ""}${p.folded || !p.inHand ? " idle" : ""}${p.out || p.removed ? " gone" : ""}${gain ? " won" : ""}${presence ? " away" : ""}`,
        role: "listitem",
        "data-player": p.id,
        "aria-label": label,
      },
      seat ? avatar(name, seat.avatarSeed, "sm") : h("span", { class: "avatar avatar-sm" }),
      h("span", { class: "he-seat-name", "aria-hidden": "true" }, h("span", { class: "he-name" }, name)),
      h("span", { class: "he-seat-cards", "aria-hidden": "true" }, cards),
      h(
        "span",
        { class: "he-seat-stack", "aria-hidden": "true" },
        h("span", {}, formatChips(p.stack)),
        showRoles && role ? h("span", { class: "he-badge d", title: "Dealer button" }, "D") : null,
        showRoles && blind ? h("span", { class: "he-badge", title: blind === "SB" ? "Small blind" : "Big blind" }, blind) : null,
      ),
      h(
        "span",
        { class: "he-seat-bet", "aria-hidden": "true" },
        gain
          ? h("span", { class: "he-gain" }, `+${formatChips(gain)}`)
          : p.bet
            ? [chip(), h("span", {}, formatChips(p.bet))]
            : status
              ? h("span", { class: `he-tag${status === "All-in" ? " hot" : ""}` }, status)
              : extras.length
                ? h("span", { class: "he-tag" }, extras[0] === "sitting out" ? "Out for now" : "Away")
                : null,
      ),
      current ? h("span", { class: "he-seat-bar" }, h("span")) : null,
    );
  }

  private renderTable(props: GameViewProps, game: HoldemPublicState) {
    const best = this.bestCards(game);
    const key = `${game.handNumber}:${game.board.map((c) => c.id).join()}:${[...best].join()}`;
    if (this.board.dataset.key !== key) {
      this.board.dataset.key = key;
      replaceChildren(
        this.board,
        Array.from({ length: 5 }, (_, i) => {
          const c = game.board[i];
          if (!c) return cardSlot();
          const el = cardFace(c);
          if (best.size) el.classList.add(best.has(c.id) ? "best" : "dim");
          return el;
        }),
      );
    }
    this.board.setAttribute(
      "aria-label",
      game.board.length ? `Shared cards: ${game.board.map(cardLabel).join(", ")}` : "No shared cards yet",
    );

    const live = isStreet(game.step);
    this.potLine.hidden = !live;
    if (live) replaceChildren(this.potLine, chip(), h("span", {}, `Pot ${formatChips(game.pot)}`));
    this.potsLine.hidden = !live || game.pots.length < 2;
    replaceChildren(
      this.potsLine,
      game.pots.map((p, i) =>
        h("span", { class: "he-side" }, `${i === 0 ? "Main" : game.pots.length > 2 ? `Side ${i}` : "Side"} ${formatChips(p.amount)}`),
      ),
    );

    const lh = game.lastHand;
    const thisHand = lh && lh.handNumber === game.handNumber && this.showingResult(game);
    this.summary.textContent = lh ? `${thisHand ? "" : "Last hand: "}${summaryText(lh, props)}` : "";
    this.summary.classList.toggle("now", !!thisHand);
    this.summary.hidden = !lh || game.step === "over";

    const sd = thisHand && !lh.byFold && lh.order.length > 0;
    this.showdown.hidden = !sd;
    if (sd) {
      const key = `${lh.handNumber}:${lh.order.join()}`;
      if (this.showdown.dataset.key !== key || !this.showdown.children.length) {
        this.showdown.dataset.key = key;
        replaceChildren(
          this.showdown,
          lh.order.map((id) => {
            const row = this.showdownRow(id, lh, props, false);
            this.stampRow(row, id, lh);
            return row;
          }),
        );
      }
    } else {
      this.showdown.dataset.key = "";
      replaceChildren(this.showdown);
    }
  }

  private renderDock(props: GameViewProps, game: HoldemPublicState, priv: HoldemPrivateState | null) {
    const me = game.players.find((p) => p.id === props.playerId);
    const hole = priv?.hole ?? [];
    const best = this.bestCards(game);
    const key = `${hole.map((c) => c.id).join()}:${[...best].join()}:${me?.folded}`;
    if (this.hole.dataset.key !== key) {
      this.hole.dataset.key = key;
      replaceChildren(
        this.hole,
        hole.length
          ? hole.map((c) => {
              const el = cardFace(c);
              if (best.has(c.id)) el.classList.add("best");
              return el;
            })
          : [cardSlot(), cardSlot()],
      );
    }
    this.hole.classList.toggle("folded", !!me?.folded);
    this.hole.setAttribute("aria-label", hole.length ? `Your cards: ${hole.map(cardLabel).join(" and ")}` : "No cards this hand");

    const badges: (HTMLElement | null)[] = me && me.inHand && game.step !== "over"
      ? [
          me.id === game.buttonId ? h("span", { class: "he-badge d", title: "Dealer button" }, "D") : null,
          me.id === game.sbId ? h("span", { class: "he-badge", title: "Small blind" }, "SB") : null,
          me.id === game.bbId ? h("span", { class: "he-badge", title: "Big blind" }, "BB") : null,
        ]
      : [];
    const state = !me
      ? "Watching"
      : me.out
        ? "You're out"
        : me.pendingRebuy
          ? "Bust"
          : me.folded
            ? "Folded"
            : me.allIn
              ? "All-in"
              : "";
    replaceChildren(
      this.meText,
      h("span", { class: "he-label" }, priv?.best && !me?.folded ? priv.best.label : (state || (hole.length ? "Your hand" : ""))),
      me
        ? h(
            "span",
            { class: "he-me-stack" },
            chip(),
            h("span", {}, formatChips(me.stack)),
            me.bet ? h("span", { class: "he-me-bet" }, ` · ${formatChips(me.bet)} in`) : null,
            badges,
          )
        : null,
      priv?.best && !me?.folded && state ? h("span", { class: "he-tag hot" }, state) : null,
    );

    this.renderActions(props, game, priv, me);
  }

  private renderActions(props: GameViewProps, game: HoldemPublicState, priv: HoldemPrivateState | null, me: HoldemPublicPlayer | undefined) {
    const legal = priv?.legal ?? null;
    const hint = (text: string) => h("span", { class: "hint" }, text);
    const busy = this.pending.size > 0;
    let nodes: (Node | null)[] = [];

    if (game.step === "over") nodes = [];
    else if (legal && this.raiseOpen) {
      nodes = [
        h("button", { type: "button", class: "he-cancel", onclick: () => this.closeRaise() }, "Back"),
        h(
          "button",
          { type: "button", class: "primary he-confirm", disabled: busy, onclick: () => this.confirmRaise(legal) },
          this.raiseTo >= (legal.maxRaiseTo ?? 0) ? `All-in ${formatChips(legal.maxRaiseTo ?? 0)}` : `${legal.opening ? "Bet" : "Raise to"} ${formatChips(this.raiseTo)}`,
        ),
      ];
    } else if (legal) {
      const myStack = me?.stack ?? 0;
      const callAllIn = legal.call > 0 && legal.call >= myStack;
      nodes = [
        h("button", { type: "button", class: "he-fold", disabled: busy, onclick: () => this.send({ type: "fold" }) }, "Fold"),
        legal.check
          ? h("button", { type: "button", class: "he-check", disabled: busy, onclick: () => this.send({ type: "check" }) }, "Check")
          : h(
              "button",
              { type: "button", class: "he-call", disabled: busy, onclick: () => this.send({ type: callAllIn ? "all-in" : "call" }) },
              callAllIn ? `All-in ${formatChips(legal.call)}` : `Call ${formatChips(legal.call)}`,
            ),
        legal.minRaiseTo !== null && legal.maxRaiseTo !== null
          ? legal.minRaiseTo >= legal.maxRaiseTo
            ? h("button", { type: "button", class: "primary", disabled: busy, onclick: () => this.send({ type: "all-in" }) }, `All-in ${formatChips(legal.maxRaiseTo)}`)
            : h("button", { type: "button", class: "primary", disabled: busy, onclick: () => this.openRaise(legal) }, legal.opening ? "Bet" : "Raise")
          : null,
      ];
    } else if (priv?.canRebuy) {
      nodes = [
        hint("Bust. Buy back in once?"),
        h("button", { type: "button", class: "primary", disabled: busy, onclick: () => this.send({ type: "rebuy" }) }, `Rebuy ${formatChips(game.startingChips)}`),
      ];
    } else if (priv?.canBack) {
      nodes = [
        hint("Sitting out: your hands fold"),
        h("button", { type: "button", class: "primary", disabled: busy, onclick: () => this.send({ type: "back" }) }, "I'm back"),
      ];
    } else if (priv?.canShow) {
      nodes = [
        hint(game.step === "awarded" ? "Nobody called. Show them?" : "Show your cards?"),
        h("button", { type: "button", disabled: busy, onclick: () => this.send({ type: "show" }) }, "Show"),
      ];
    } else if (busy) nodes = [hint("…")];
    else if (game.currentPlayerId && me?.inHand && !me.folded && !me.allIn) nodes = [hint(`Waiting on ${seatName(props.room, game.currentPlayerId)}`)];
    else if (me?.inHand && !me.folded && me.allIn && isStreet(game.step)) nodes = [hint("You're all-in")];
    else if (game.currentPlayerId) nodes = [hint(`${seatName(props.room, game.currentPlayerId)} to act`)];

    this.actions.classList.toggle("bet-row", !!legal && !this.raiseOpen);
    this.actions.classList.toggle("raise-row", !!legal && this.raiseOpen);
    replaceChildren(this.actions, nodes);
    this.raisePanel.hidden = !(legal && this.raiseOpen);
    if (legal && this.raiseOpen) this.renderRaise(game, legal);
  }

  // ---- raise panel ----------------------------------------------------------

  private openRaise(legal: LegalActions) {
    this.raiseOpen = true;
    this.raiseTo = legal.minRaiseTo ?? 0;
    this.rerender();
    this.slider.focus({ preventScroll: true });
  }

  private closeRaise() {
    this.raiseOpen = false;
    this.rerender();
  }

  /** Quick amounts. Pot-sized means the pot after you call, on top of the call. */
  private quickAmounts(game: HoldemPublicState, legal: LegalActions): { label: string; to: number }[] {
    const me = game.players.find((p) => p.id === this.props?.playerId);
    const owed = Math.max(0, game.currentBet - (me?.bet ?? 0));
    const after = game.pot + owed;
    const min = legal.minRaiseTo!;
    const max = legal.maxRaiseTo!;
    const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
    return [
      { label: "Min", to: min },
      { label: "½ pot", to: clamp(game.currentBet + after / 2) },
      { label: "Pot", to: clamp(game.currentBet + after) },
      { label: "All-in", to: max },
    ];
  }

  private renderRaise(game: HoldemPublicState, legal: LegalActions) {
    const min = legal.minRaiseTo!;
    const max = legal.maxRaiseTo!;
    this.slider.min = String(min);
    this.slider.max = String(max);
    this.slider.step = "1";
    this.raiseTo = Math.min(max, Math.max(min, this.raiseTo));
    this.slider.value = String(this.raiseTo);
    this.raiseHead.textContent = legal.opening ? "Bet" : "Raise to";
    this.raiseOut.textContent = this.raiseTo >= max ? `${formatChips(max)} · all-in` : formatChips(this.raiseTo);
    this.slider.setAttribute("aria-valuetext", `${formatChips(this.raiseTo)} chips${this.raiseTo >= max ? ", all-in" : ""}`);
    replaceChildren(
      this.quick,
      this.quickAmounts(game, legal).map((q) =>
        h(
          "button",
          { type: "button", class: q.to === this.raiseTo ? "on" : "", "aria-pressed": String(q.to === this.raiseTo), onclick: () => this.setRaise(q.to) },
          q.label,
        ),
      ),
    );
  }

  /** From the slider, ± or a quick button. Slider values snap to the small blind, except the ends. */
  private setRaise(value: number, fromSlider = false) {
    const legal = (this.props?.private as HoldemPrivateState | null)?.legal;
    if (!legal || legal.minRaiseTo === null || legal.maxRaiseTo === null) return;
    const min = legal.minRaiseTo;
    const max = legal.maxRaiseTo;
    const unit = Math.max(1, Math.round(this.bb() / 2));
    let v = value;
    if (fromSlider && v > min && v < max) v = Math.round(v / unit) * unit;
    this.raiseTo = Math.min(max, Math.max(min, v));
    this.rerender();
  }

  private confirmRaise(legal: LegalActions) {
    const max = legal.maxRaiseTo ?? 0;
    this.raiseOpen = false;
    this.send(this.raiseTo >= max ? { type: "all-in" } : { type: "raise", to: this.raiseTo });
  }

  // ---- clocks -----------------------------------------------------------------

  private renderClock() {
    const game = this.props?.game as HoldemPublicState | undefined;
    if (!game) return;
    const now = this.api.serverNow();
    const priv = this.props?.private as HoldemPrivateState | null;
    const t = game.turn;
    const left = t ? Math.max(0, t.endsAt - now) : 0;
    const frac = t ? Math.min(1, left / Math.max(t.ms, 1)) : 0;
    const secs = Math.ceil(left / 1000);

    const mine = !!priv?.legal && !!t;
    this.myBar.hidden = !mine;
    if (mine) {
      (this.myBar.firstElementChild as HTMLElement).style.transform = `scaleX(${frac})`;
      this.myBar.classList.toggle("low", secs <= TICK_FROM);
      if (secs > 0 && secs <= TICK_FROM && secs !== this.lastTick) {
        this.lastTick = secs;
        audio.play("tick");
        if (secs <= 2) audio.buzz(15);
      }
    }
    const bar = this.seats.querySelector<HTMLElement>(".he-seat.current .he-seat-bar span");
    if (bar && t) {
      bar.style.transform = `scaleX(${frac})`;
      bar.parentElement!.classList.toggle("low", secs <= TICK_FROM);
    }

    // Pauses between cards and hands.
    const pause = Math.max(0, Math.ceil((game.stepEndsAt - now) / 1000));
    let note = "";
    if (game.step === "between-hands") {
      const rebuying = game.players.some((p) => p.pendingRebuy);
      note = pause ? `${rebuying ? "Rebuy window · next hand" : "Next hand"} in ${pause}s` : "Dealing…";
    } else if (game.step === "showdown" && priv?.canShow) note = pause ? `Show within ${pause}s` : "";
    this.stepNote.textContent = note;
    this.stepNote.hidden = !note;

    if (game.capEndsAt !== null && game.step !== "over") {
      const mins = Math.ceil((game.capEndsAt - now) / 60_000);
      this.capText.textContent = mins > 0 ? ` · ${mins} min left` : " · Last hand";
    } else this.capText.textContent = "";
  }

  private send(action: unknown) {
    this.pending.add(this.api.act(action));
    this.rerender();
  }
}
