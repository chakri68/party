import { AnimationQueue, bubble, fly, once } from "@games/animation";
import { audio } from "@games/audio";
import { formatChips } from "@games/game-core";
import type { Presence } from "@games/protocol";
import { avatar, formatSeconds, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { displayOrder } from "../shared/rules.ts";
import type { Card, HandSummary, TeenPattiEvent, TeenPattiPrivateState, TeenPattiPublicPlayer, TeenPattiPublicState } from "../shared/types.ts";
import { cardBack, cardFace, cardList, cardMini, chip, miniBack } from "./cards.ts";
import { MOVE_WORD, describe, moveButtons, seatTag, summaryText } from "./model.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
  left: "left",
};

/** Your clock ticks through its last seconds. */
const TICK_FROM = 5;
/** Ghost chips per winner as the pot slides over. */
const POT_GHOSTS = 4;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const handOn = (step: string) => step === "betting" || step === "sideshow";

/** Eye icon for See. Line drawing, 24 grid. */
const EYE_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
/** Eye with a line through: Blind. */
const BLIND_SVG =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><path d="M4 20 20 4"/></svg>';
const SEEN_SVG =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

function svg(markup: string, cls = ""): HTMLElement {
  const el = h("span", { class: `tp-icon ${cls}`.trim(), "aria-hidden": "true" });
  el.innerHTML = markup;
  return el;
}

/** Everyone but me, starting from my left: reads like the table, clockwise. */
function fromMyLeft<T extends { id: string }>(players: T[], me: string): T[] {
  const i = players.findIndex((p) => p.id === me);
  return i < 0 ? players : [...players.slice(i + 1), ...players.slice(0, i)];
}

/** "BLIND" or "SEEN", with its icon: every seat in the hand shows one. */
function sightBadge(seen: boolean): HTMLElement {
  return h("span", { class: `tp-sight${seen ? " seen" : ""}` }, svg(seen ? SEEN_SVG : BLIND_SVG), seen ? "Seen" : "Blind");
}

/**
 * Which sounds a render makes. "all": nothing was acted out, so the events'
 * sounds play here. "cues": the animations made those. "none": a redraw.
 */
type Sounds = "all" | "cues" | "none";

export class TeenPattiView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "teen-patti" });
  private info = h("div", { class: "tp-info" });
  private levelText = h("span", {});
  private capText = h("span", { class: "tp-cap" });
  private status = h("div", { class: "tp-status", role: "status", "aria-live": "polite" });
  private seats = h("div", { class: "tp-seats", role: "list", "aria-label": "Other players" });
  private potLine = h("div", { class: "tp-pot" });
  private stakeLine = h("div", { class: "tp-stake" });
  private potsLine = h("div", { class: "tp-pots" });
  private summary = h("p", { class: "tp-summary" });
  private showdown = h("ol", { class: "tp-showdown", "aria-label": "Show" });
  private stepNote = h("p", { class: "tp-step" });
  private log = h("p", { class: "tp-log", "aria-live": "polite" });

  private dock = h("div", { class: "tp-dock" });
  private hand = h("div", { class: "tp-hand", role: "img" });
  private meText = h("div", { class: "tp-me-text" });
  private peeks = h("div", { class: "tp-peeks" });
  private myBar = h("div", { class: "tp-bar", "aria-hidden": "true" }, h("span"));
  private actions = h("div", { class: "tp-actions" });

  /** Sent and not yet answered: the buttons stay locked meanwhile. */
  private pending = new Set<string>();
  private queue = new AnimationQueue();
  private wasMyTurn = false;
  private clock: ReturnType<typeof setInterval>;
  private lastTick = -1;

  constructor(api: GameClientApi) {
    this.api = api;
    this.info.append(this.levelText, this.capText);
    this.dock.append(this.peeks, h("div", { class: "tp-me" }, this.hand, this.meText), this.myBar, this.actions);
    this.root.append(
      this.info,
      this.status,
      this.seats,
      h(
        "div",
        { class: "tp-table", role: "group", "aria-label": "Table" },
        h("div", { class: "tp-middle" }, this.potLine, this.stakeLine, this.potsLine),
        this.showdown,
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
    const events = props.events as TeenPattiEvent[];
    this.pending.clear();
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
    const game = props.game as TeenPattiPublicState;
    const priv = props.private as TeenPattiPrivateState | null;
    const myTurn = !!priv?.legal || !!priv?.answer;
    this.root.classList.toggle("my-turn", myTurn);
    this.root.classList.toggle("over", game.step === "over");
    this.api.setTurn(priv?.answer ? "Sideshow?" : priv?.legal ? "Your turn" : null);

    this.renderInfo(game);
    this.renderStatus(props, game, priv);
    this.renderSeats(props, game);
    this.renderTable(props, game);
    this.renderDock(props, game, priv);
    this.renderClock();

    const events = props.events as TeenPattiEvent[];
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

  // ---- animation ------------------------------------------------------------

  private async act(events: TeenPattiEvent[], props: GameViewProps) {
    replaceChildren(this.actions);
    for (const e of events) {
      switch (e.type) {
        case "hand-start":
          audio.play("shuffle");
          this.render(props, "none");
          await this.dealIn(props, e.dealt);
          break;
        case "your-cards":
          audio.play("deal");
          break;
        case "bet":
          await this.showBet(e, props);
          break;
        case "pack":
          audio.play("pass");
          await bubble(this.anchorFor(e.playerId, props), e.reason === "sideshow" ? "Lost Sideshow" : "Pack", "anim-bubble", 800);
          break;
        case "sideshow-ask":
          audio.play("nudge");
          await bubble(this.anchorFor(e.toId, props), "Sideshow?", "anim-bubble", 900);
          break;
        case "sideshow-answer":
          await bubble(this.anchorFor(e.toId, props), e.accepted ? "Yes" : "No", "anim-bubble", 800);
          break;
        case "reveal":
          await this.revealSeats(e.hands, props);
          break;
        case "awarded":
          await this.potToWinners(e.summary, props);
          break;
        case "game-over":
          await wait(1500);
          break;
        default:
          break;
      }
    }
  }

  private eventSounds(events: TeenPattiEvent[], props: GameViewProps) {
    for (const e of events) {
      if (e.type === "hand-start") audio.play("shuffle");
      else if (e.type === "bet") audio.play("card-place");
      else if (e.type === "pack") audio.play("pass");
      else if (e.type === "awarded" && e.summary.won[props.playerId]) audio.play("win");
    }
  }

  private anchorFor(playerId: string, props: GameViewProps): Element {
    if (playerId === props.playerId) return this.hand;
    return this.seats.querySelector(`[data-player="${CSS.escape(playerId)}"] .avatar`) ?? this.status;
  }

  private smallRect(anchor: Element, size = 22): DOMRect {
    const r = anchor.getBoundingClientRect();
    return new DOMRect(r.left + r.width / 2 - size / 2, r.top + r.height / 2 - size / 2, size, size);
  }

  private async dealIn(props: GameViewProps, dealt: string[]) {
    const flights: Promise<unknown>[] = [];
    dealt.forEach((id, i) => {
      const targets =
        id === props.playerId
          ? ([...this.hand.children] as HTMLElement[])
          : ([...(this.seats.querySelector(`[data-player="${CSS.escape(id)}"] .tp-seat-cards`)?.children ?? [])] as HTMLElement[]);
      targets.forEach((el, j) => {
        const delay = 200 + (j * dealt.length + i) * 50;
        if (id === props.playerId) setTimeout(() => audio.play("deal"), delay + 80);
        flights.push(
          el.animate(
            [
              { transform: id === props.playerId ? "translateY(80%) rotate(-6deg)" : "scale(.4)", opacity: 0 },
              { transform: "none", opacity: 1 },
            ],
            { duration: 300, delay, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
          ).finished,
        );
      });
    });
    await Promise.all(flights).catch(() => {});
  }

  private async showBet(e: Extract<TeenPattiEvent, { type: "bet" }>, props: GameViewProps) {
    const anchor = this.anchorFor(e.playerId, props);
    if (e.kind === "all-in" || e.kind === "double") {
      audio.play("nudge");
      audio.buzz(30);
    }
    const target = this.potLine.querySelector(".tp-chip") ?? this.potLine;
    const flight = fly(chip("tp-chip-fly"), this.smallRect(anchor), this.smallRect(target, 18), 340);
    const word = `${MOVE_WORD[e.kind]} ${formatChips(e.amount)}`;
    void bubble(anchor, word, `anim-bubble${e.kind === "all-in" ? " tp-hot-bubble" : ""}`, 850);
    await flight;
    audio.play("card-place");
  }

  private async revealSeats(hands: Record<string, Card[]>, props: GameViewProps) {
    let any = false;
    for (const [id, cards] of Object.entries(hands)) {
      if (id === props.playerId) {
        replaceChildren(this.hand, displayOrder(cards).map((c) => once(cardFace(c), "flip")));
        any = true;
        continue;
      }
      const box = this.seats.querySelector(`[data-player="${CSS.escape(id)}"] .tp-seat-cards`);
      if (!box) continue;
      replaceChildren(box, displayOrder(cards).map((c) => once(cardMini(c), "flip")));
      any = true;
    }
    if (any) {
      audio.play("deal");
      await wait(900);
    }
  }

  private async potToWinners(summary: HandSummary, props: GameViewProps) {
    const from = this.smallRect(this.potLine.querySelector(".tp-chip") ?? this.potLine, 18);
    const winners = Object.keys(summary.won);
    await Promise.all(
      winners.map(async (id, w) => {
        const anchor = this.anchorFor(id, props);
        await wait(w * 120);
        await Promise.all(
          Array.from({ length: POT_GHOSTS }, async (_, i) => {
            await wait(i * 60);
            await fly(chip("tp-chip-fly"), from, this.smallRect(anchor, 18), 420);
          }),
        );
        void bubble(anchor, `+${formatChips(summary.won[id]!)}`, "anim-bubble tp-win-bubble", 1100);
      }),
    );
    if (summary.won[props.playerId]) {
      audio.play("win");
      audio.buzz([30, 40, 60]);
    } else audio.play("card-place");
    await wait(300);
  }

  // ---- regions ----------------------------------------------------------------

  private renderInfo(game: TeenPattiPublicState) {
    const hands = game.handsToNextLevel;
    this.levelText.textContent =
      game.step === "over"
        ? `Boot ${formatChips(game.boot)}`
        : `Hand ${game.handNumber} · Boot ${formatChips(game.boot)} · ${formatChips(game.nextBoot)} ${hands === 1 ? "next hand" : `in ${hands} hands`}`;
  }

  private renderStatus(props: GameViewProps, game: TeenPattiPublicState, priv: TeenPattiPrivateState | null) {
    this.status.hidden = game.step === "over";
    if (this.status.hidden) return;
    const name = (id: string) => seatName(props.room, id);
    if (priv?.answer) {
      replaceChildren(this.status, h("span", {}, `${name(priv.answer.fromId)} asks you for a Sideshow`));
      return;
    }
    if (priv?.legal) {
      const me = game.players.find((p) => p.id === props.playerId);
      replaceChildren(this.status, h("span", {}, `Your turn · You are ${me?.seen ? "Seen" : "Blind"}`));
      return;
    }
    if (game.sideshow) {
      const { fromId, toId } = game.sideshow;
      const asker = fromId === props.playerId ? "You ask" : `${name(fromId)} asks`;
      replaceChildren(this.status, h("span", {}, `${asker} ${toId === props.playerId ? "you" : name(toId)} for a Sideshow`));
      return;
    }
    if (game.currentPlayerId) {
      const seat = props.room.seats.find((s) => s.id === game.currentPlayerId);
      const away = seat && seat.presence !== "connected" ? ` (${PRESENCE_LABEL[seat.presence]})` : "";
      replaceChildren(this.status, seat ? avatar(seat.name, seat.avatarSeed, "sm") : null, h("span", {}, `${seat?.name ?? "Someone"}${away} is playing`));
      return;
    }
    let text = "";
    if ((game.step === "showdown" || game.step === "awarded") && game.lastHand) text = summaryText(game.lastHand, props);
    else if (game.step === "between-hands") text = "The next hand starts soon";
    replaceChildren(this.status, h("span", {}, text));
  }

  private showingResult(game: TeenPattiPublicState): boolean {
    return game.step === "showdown" || game.step === "awarded" || game.step === "between-hands" || game.step === "over";
  }

  private renderSeats(props: GameViewProps, game: TeenPattiPublicState) {
    const won = this.showingResult(game) ? (game.lastHand?.won ?? {}) : {};
    replaceChildren(
      this.seats,
      fromMyLeft(game.players, props.playerId).map((p) => this.seat(p, props, game, won)),
    );
  }

  private seat(p: TeenPattiPublicPlayer, props: GameViewProps, game: TeenPattiPublicState, won: Record<string, number>): HTMLElement {
    const seat = props.room.seats.find((s) => s.id === p.id);
    const name = seat?.name ?? "?";
    const presence = seat && seat.presence !== "connected" && !p.removed ? PRESENCE_LABEL[seat.presence] : "";
    const current = p.id === game.currentPlayerId || p.id === game.sideshow?.toId;
    const live = p.inHand && !p.packed && game.step !== "over";
    const tag = seatTag(p);
    const extras = [p.sittingOut && !p.removed && !p.out ? "sitting out" : "", presence].filter(Boolean);
    const dealer = p.id === game.dealerId && p.inHand && game.step !== "over";
    const cards = p.cards ? displayOrder(p.cards).map(cardMini) : live ? Array.from({ length: 3 }, miniBack) : [];
    const gain = won[p.id];
    const label = [
      name,
      `${formatChips(p.stack)} chips`,
      live ? (p.seen ? "seen" : "blind") : "",
      p.inPot && game.step !== "over" ? `${formatChips(p.inPot)} in the pot` : "",
      dealer ? "dealer" : "",
      tag?.text.toLowerCase() ?? "",
      ...extras,
      p.cards ? `showing ${cardList(p.cards)}` : "",
      gain ? `won ${formatChips(gain)}` : "",
      current ? "their turn" : "",
    ]
      .filter(Boolean)
      .join(", ");
    return h(
      "div",
      {
        class: `tp-seat${current ? " current" : ""}${!live ? " idle" : ""}${p.out || p.removed ? " gone" : ""}${gain ? " won" : ""}${presence ? " away" : ""}`,
        role: "listitem",
        "data-player": p.id,
        "aria-label": label,
      },
      seat ? avatar(name, seat.avatarSeed, "sm") : h("span", { class: "avatar avatar-sm" }),
      h(
        "span",
        { class: "tp-seat-name", "aria-hidden": "true" },
        h("span", { class: "tp-name" }, name),
        dealer ? h("span", { class: "tp-badge d", title: "Dealer" }, "D") : null,
      ),
      h("span", { class: "tp-seat-cards", "aria-hidden": "true" }, cards),
      h("span", { class: "tp-seat-stack", "aria-hidden": "true" }, h("span", {}, formatChips(p.stack))),
      live && !p.cards ? sightBadge(p.seen) : null,
      h(
        "span",
        { class: "tp-seat-bet", "aria-hidden": "true" },
        gain
          ? h("span", { class: "tp-gain" }, `+${formatChips(gain)}`)
          : tag
            ? h("span", { class: `tp-tag${tag.hot ? " hot" : ""}` }, tag.text)
            : extras.length
              ? h("span", { class: "tp-tag" }, extras[0] === "sitting out" ? "Out for now" : "Away")
              : null,
      ),
      current ? h("span", { class: "tp-seat-bar" }, h("span")) : null,
    );
  }

  private renderTable(props: GameViewProps, game: TeenPattiPublicState) {
    const on = handOn(game.step);
    this.potLine.hidden = !on;
    if (on) replaceChildren(this.potLine, chip(), h("span", {}, `Pot ${formatChips(game.pot)}`));
    this.stakeLine.hidden = !on;
    this.stakeLine.textContent = on
      ? `Stake ${formatChips(game.stake)}: Blind ${formatChips(game.stake)}, Seen ${formatChips(game.stake * 2)} · Limit ${formatChips(game.potLimit)}`
      : "";
    this.potsLine.hidden = !on || game.pots.length < 2;
    replaceChildren(
      this.potsLine,
      game.pots.map((p, i) => h("span", { class: "tp-side" }, `${i === 0 ? "Main" : game.pots.length > 2 ? `Side ${i}` : "Side"} ${formatChips(p.amount)}`)),
    );

    const lh = game.lastHand;
    const thisHand = !!lh && lh.handNumber === game.handNumber && this.showingResult(game);
    this.summary.textContent = lh ? `${thisHand ? "" : "Last hand: "}${summaryText(lh, props)}` : "";
    this.summary.classList.toggle("now", thisHand);
    this.summary.hidden = !lh || game.step === "over";

    const rows = thisHand && lh.order.length > 0 ? lh.order : [];
    this.showdown.hidden = !rows.length;
    replaceChildren(
      this.showdown,
      rows.map((id) => {
        const seat = props.room.seats.find((s) => s.id === id);
        const me = id === props.playerId;
        const gain = lh!.won[id];
        const who = me ? "You" : (seat?.name ?? "?");
        const label = lh!.labels[id] ?? "";
        return h(
          "li",
          { class: `tp-sd-row${gain ? " won" : " lost"}${me ? " me" : ""}`, "aria-label": `${who}: ${label}${gain ? `, won ${formatChips(gain)}` : ""}` },
          seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
          h("span", { class: "tp-sd-who" }, h("b", {}, who), h("span", {}, label)),
          h("span", { class: "tp-sd-cards" }, displayOrder(lh!.shown[id] ?? []).map(cardMini)),
          h("span", { class: "tp-sd-won" }, gain ? `+${formatChips(gain)}` : ""),
        );
      }),
    );
  }

  private renderDock(props: GameViewProps, game: TeenPattiPublicState, priv: TeenPattiPrivateState | null) {
    const me = game.players.find((p) => p.id === props.playerId);
    const cards = priv?.cards ?? [];
    const inHand = !!me?.inHand && game.step !== "over";
    const key = `${game.handNumber}:${cards.map((c) => c.id).join()}:${inHand}`;
    if (this.hand.dataset.key !== key) {
      this.hand.dataset.key = key;
      replaceChildren(this.hand, cards.length ? displayOrder(cards).map(cardFace) : inHand ? Array.from({ length: 3 }, cardBack) : []);
    }
    this.hand.classList.toggle("packed", !!me?.packed);
    this.hand.setAttribute("aria-label", cards.length ? `Your cards: ${cardList(cards)}` : inHand ? "Your cards, face down" : "No cards this hand");

    const state = !me ? "Watching" : me.out ? "You're out" : me.packed ? "Packed" : me.allIn ? "All-in" : "";
    const title = priv?.label && !me?.packed ? priv.label : state || (inHand ? "Your cards" : "");
    replaceChildren(
      this.meText,
      h("span", { class: "tp-label" }, title),
      me
        ? h(
            "span",
            { class: "tp-me-stack" },
            chip(),
            h("span", {}, formatChips(me.stack)),
            me.inPot && inHand ? h("span", { class: "tp-me-bet" }, ` · ${formatChips(me.inPot)} in`) : null,
            me.id === game.dealerId && inHand ? h("span", { class: "tp-badge d", title: "Dealer" }, "D") : null,
          )
        : null,
      inHand && !me!.packed ? sightBadge(me!.seen) : null,
    );

    const peeks = priv?.peeks ?? [];
    this.peeks.hidden = !peeks.length || !handOn(game.step);
    replaceChildren(
      this.peeks,
      peeks.map((pk) =>
        h(
          "div",
          { class: "tp-peek", "aria-label": `Sideshow: ${seatName(props.room, pk.playerId)} has ${cardList(pk.cards)}, ${pk.label}` },
          h("span", { class: "tp-peek-who", "aria-hidden": "true" }, `Sideshow: ${seatName(props.room, pk.playerId)}`),
          h("span", { class: "tp-sd-cards", "aria-hidden": "true" }, displayOrder(pk.cards).map(cardMini)),
          h("span", { class: "tp-peek-label", "aria-hidden": "true" }, pk.label),
        ),
      ),
    );

    this.renderActions(props, game, priv, me);
  }

  private renderActions(props: GameViewProps, game: TeenPattiPublicState, priv: TeenPattiPrivateState | null, me: TeenPattiPublicPlayer | undefined) {
    const legal = priv?.legal ?? null;
    const hint = (text: string) => h("span", { class: "hint" }, text);
    const busy = this.pending.size > 0;
    const see = priv?.canSee
      ? h("button", { type: "button", class: "tp-see", disabled: busy, onclick: () => this.send({ type: "see" }) }, svg(EYE_SVG), "See")
      : null;
    let nodes: (Node | null)[] = [];
    let grid = false;

    if (game.step === "over") nodes = [];
    else if (priv?.answer) {
      grid = true;
      nodes = [
        h("button", { type: "button", disabled: busy, onclick: () => this.send({ type: "refuse" }) }, "No"),
        h("button", { type: "button", class: "primary", disabled: busy, onclick: () => this.send({ type: "accept" }) }, "Yes, compare"),
      ];
    } else if (legal) {
      grid = true;
      nodes = [
        see,
        ...moveButtons(legal).map((b) =>
          h(
            "button",
            {
              type: "button",
              class: `${b.primary ? "primary " : ""}tp-${b.action}`,
              disabled: busy,
              onclick: () => this.send({ type: b.action }),
            },
            b.label,
          ),
        ),
      ];
    } else if (priv?.canBack) {
      nodes = [
        hint("You are sitting out. The game packs your hands."),
        h("button", { type: "button", class: "primary", disabled: busy, onclick: () => this.send({ type: "back" }) }, "I'm back"),
      ];
    } else if (busy) nodes = [hint("…")];
    else {
      const waitingOn = game.sideshow?.toId ?? game.currentPlayerId;
      const text = waitingOn ? `Waiting for ${seatName(props.room, waitingOn)}` : me?.allIn && handOn(game.step) ? "You're all-in" : "";
      nodes = [text ? hint(text) : null, see];
    }

    this.actions.classList.toggle("move-grid", grid);
    replaceChildren(this.actions, nodes);
    this.actions.setAttribute("aria-busy", String(busy));
  }

  // ---- clocks -----------------------------------------------------------------

  private renderClock() {
    const game = this.props?.game as TeenPattiPublicState | undefined;
    if (!game) return;
    const now = game.pausedAt ?? this.api.serverNow();
    const priv = this.props?.private as TeenPattiPrivateState | null;
    const t = game.sideshow ? { endsAt: game.sideshow.endsAt, ms: game.sideshow.ms } : game.turn;
    const left = t ? Math.max(0, t.endsAt - now) : 0;
    const frac = t ? Math.min(1, left / Math.max(t.ms, 1)) : 0;
    const secs = Math.ceil(left / 1000);

    const mine = !!t && (game.sideshow ? !!priv?.answer : !!priv?.legal);
    this.myBar.hidden = !mine;
    if (mine) {
      (this.myBar.firstElementChild as HTMLElement).style.transform = `scaleX(${frac})`;
      this.myBar.classList.toggle("low", secs <= TICK_FROM);
      if (secs > 0 && secs <= TICK_FROM && secs !== this.lastTick && game.pausedAt === null) {
        this.lastTick = secs;
        audio.play("tick");
        if (secs <= 2) audio.buzz(15);
      }
    }
    const bar = this.seats.querySelector<HTMLElement>(".tp-seat.current .tp-seat-bar span");
    if (bar && t) {
      bar.style.transform = `scaleX(${frac})`;
      bar.parentElement!.classList.toggle("low", secs <= TICK_FROM);
    }

    const pause = game.stepEndsAt - now;
    const note = game.step === "between-hands" ? (pause > 0 ? `Next hand in ${formatSeconds(pause)}` : "Dealing…") : "";
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
