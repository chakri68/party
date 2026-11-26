import { AnimationQueue, bubble, fly, once } from "@games/animation";
import { audio } from "@games/audio";
import type { Presence } from "@games/protocol";
import { avatar, formatSeconds, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { bankScore, cardLabel, colourBonus, enginePoints } from "../shared/rules.ts";
import {
  HEATWAVE_DROP,
  VENT_HEAT,
  type Card,
  type EngineCard,
  type OverheatAction,
  type OverheatEvent,
  type OverheatPlayerState,
  type OverheatPrivateState,
  type OverheatPublicState,
  type Pending,
} from "../shared/types.ts";
import {
  an,
  CHOICE_TEXT,
  cardsPickable,
  describe,
  emptyPick,
  faceSpec,
  handCardClass,
  handModel,
  pickKey,
  rowPick,
  rowTags,
  savedTurn,
  tapCard,
  tapPlayer,
  targetsFor,
  type FaceSpec,
  type Pick,
} from "./model.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
  left: "left",
};

const FUSE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="15" r="7"/><path d="M14.5 9.5 18 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="19.5" cy="4.5" r="2" class="spark"/></svg>';

/** The leader mark: a crown, always with the word. */
const LEADER_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18h18l-1.5-10-4.5 4-3-7-3 7-4.5-4z"/></svg>';
/** The hand badge: two cards. */
const HAND_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="11" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="10" y="3" width="11" height="15" rx="2"/></svg>';

/** The row button's words for each aimed card. */
const AIM_VERB: Record<Pending["kind"], string> = {
  shove: "Push a card onto",
  fuse: "Put the Burn on",
  audit: "Audit",
  dump: "Give your card to",
  wrench: "Swap with",
  steal: "Take from",
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function svgSpan(cls: string, svg: string): HTMLElement {
  const s = h("span", { class: cls, "aria-hidden": "true" });
  s.innerHTML = svg;
  return s;
}

/**
 * A card face from `faceSpec`: the one path every card face takes (row, picks,
 * flight ghosts, hand), so a card in flight matches the card once it lands.
 * A button when it can be picked (Swap, Steal, Dump). "decorative": a picture
 * only, hidden from screen readers, for when words beside it say the same.
 */
function faceEl(f: FaceSpec, id: number, opts: { onPick?: () => void; decorative?: boolean } = {}): HTMLElement {
  const { onPick, decorative } = opts;
  const el = onPick
    ? h("button", { type: "button", class: `${f.cls} pickable`, "data-card": id, "aria-label": f.label, onclick: onPick })
    : decorative
      ? h("span", { class: f.cls, "aria-hidden": "true" })
      : h("span", { class: f.cls, "data-card": id, role: "img", "aria-label": f.label });
  el.innerHTML = f.html;
  return el;
}

/** An engine card. A button when it can be picked (Swap, Steal, Dump). */
function engineCard(e: EngineCard, onPick?: () => void): HTMLElement {
  return faceEl(faceSpec(e.card, e.mult), e.card.id, { onPick });
}

/** Any card face, for flights and the short look at a flipped power card. */
function cardFace(card: Card, mult: 1 | 2 = 1): HTMLElement {
  return faceEl(faceSpec(card, mult), card.id);
}

/** See Farkle: "all" plays the events' sounds, "cues" only the turn chime and ending, "none" nothing. */
type Sounds = "all" | "cues" | "none";

export class OverheatView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "overheat" });
  private status = h("div", { class: "ov-status", role: "status", "aria-live": "polite" });
  private head = h("div", { class: "ov-head" });
  private roundEl = h("span", { class: "ov-round" });
  private gaugeEl = h("span", { class: "ov-gauge" });
  private deckEl = h("span", { class: "ov-deck" });
  private targetEl = h("span", { class: "ov-muted" });
  private rows = h("ul", { class: "ov-rows", "aria-label": "Players" });
  private log = h("p", { class: "ov-log", "aria-live": "polite" });
  private actions = h("div", { class: "ov-actions" });
  private note = h("p", { class: "ov-note" });
  private clock = 0;

  /** Sent and not yet answered: the buttons stay locked meanwhile. */
  private pending = new Set<string>();
  private pick: Pick = { key: "", mine: null, theirs: null, targetId: null };
  /** "Your cards": only in Cutthroat, for a seated player. */
  private handEl = h("section", { class: "ov-hand", "aria-label": "Your cards" });

  private queue = new AnimationQueue();
  private wasMine = false;
  /** Mid-show: what's on screen isn't settled yet, so taps wait. */
  private busy = false;

  constructor(api: GameClientApi) {
    this.api = api;
    this.head.append(this.roundEl, this.gaugeEl, this.deckEl, this.targetEl);
    this.root.append(
      this.status,
      this.head,
      h("section", { class: "ov-table", "aria-label": "Table" }, this.rows),
      this.handEl,
      this.log,
      h("div", { class: "ov-dock" }, this.note, this.actions),
    );
  }

  mount(container: HTMLElement) {
    container.append(this.root);
    this.clock = window.setInterval(() => this.tick(), 250);
  }

  destroy() {
    window.clearInterval(this.clock);
    this.queue.clear();
    this.root.remove();
  }

  whenIdle() {
    return this.queue.idle();
  }

  rejected(clientActionId: string, message: string) {
    if (this.pending.delete(clientActionId)) {
      this.pick = { key: "", mine: null, theirs: null, targetId: null };
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
    const events = props.events as OverheatEvent[];
    this.pending.clear();
    // Reconnects, and joining mid-game: show it as it is. A brand-new view for
    // the first round is the exception: the round start is the show.
    const opening = !this.props && events.some((e) => e.type === "round-start");
    if (props.snapshot || (!this.props && !opening)) {
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

  // ---- state helpers ------------------------------------------------------------

  /** It's my move: my turn, or my choice for an aimed card. */
  private mine(game: OverheatPublicState, me: string): boolean {
    return (game.step === "turn" || game.step === "choosing") && game.awaitedId === me;
  }

  private choosing(game: OverheatPublicState, me: string): Pending | null {
    return game.step === "choosing" && game.pending?.chooserId === me ? game.pending : null;
  }

  /** What I've tapped so far for this pending card. A new card starts fresh. */
  private pickFor(pending: Pending): Pick {
    if (this.pick.key !== pickKey(pending)) this.pick = emptyPick(pending);
    return this.pick;
  }

  private hand(props: GameViewProps) {
    return (props.private as OverheatPrivateState | null)?.hand ?? [];
  }

  // ---- render -------------------------------------------------------------------

  private render(props: GameViewProps, sounds: Sounds) {
    this.props = props;
    const game = props.game as OverheatPublicState;
    const me = props.playerId;
    const mine = this.mine(game, me);
    const choice = this.choosing(game, me);
    const finished = game.step === "finished";
    this.root.classList.toggle("my-turn", mine);
    this.root.classList.toggle("finished", finished);

    this.api.setTurn(
      !mine ? null
      : choice ? CHOICE_TEXT[choice.kind].turn
      : savedTurn(game, me) ? "Play a card or pass"
      : "Flip or save",
    );

    this.renderStatus(props, game, mine);
    this.renderHead(game);
    this.renderRows(props, game);
    this.renderHand(props, game);
    this.renderDock(props, game, mine);

    const events = props.events as OverheatEvent[];
    if (sounds !== "none") {
      const lines = events.map((e) => describe(e, props)).filter(Boolean);
      if (lines.length) this.log.textContent = lines.slice(-2).join(" ");
      if (sounds === "all") this.eventSounds(events, props);
      const over = events.find((e) => e.type === "game-over");
      if (over?.type === "game-over") {
        const won = over.winnerIds.includes(me);
        audio.play(won ? "win" : "game-over");
        if (won) audio.buzz([40, 60, 40, 60, 90]);
      }
      if (mine && !this.wasMine) {
        audio.play("your-turn");
        audio.buzz(25);
      }
    }
    if (sounds !== "none" || props.snapshot) this.wasMine = mine;
  }

  private rerender() {
    if (this.props) this.render(this.props, "none");
  }

  private renderStatus(props: GameViewProps, game: OverheatPublicState, mine: boolean) {
    // Once finished, the room's results panel says who won.
    this.status.hidden = game.step === "finished";
    if (this.status.hidden) return;
    this.root.classList.remove("round-over");
    if (game.step === "round-end") {
      this.root.classList.add("round-over");
      replaceChildren(this.status, h("span", {}, `Round ${game.round} is over. `), h("span", { class: "ov-clock" }, this.countdown(game)));
      return;
    }
    const pending = game.pending;
    let text: string;
    if (mine && game.step === "choosing" && pending) {
      text = CHOICE_TEXT[pending.kind].status;
    } else if (savedTurn(game, props.playerId)) {
      text = "Play a card or pass.";
    } else if (mine) {
      text = "Your turn. Flip a card or save.";
    } else {
      const id = game.awaitedId ?? game.currentPlayerId;
      const seat = props.room.seats.find((s) => s.id === id);
      const name = seat?.name ?? "Someone";
      const away = seat && seat.presence !== "connected" ? ` (${PRESENCE_LABEL[seat.presence]})` : "";
      const flipping = game.players.find((p) => p.id === id)?.status === "flipping";
      text =
        game.step === "choosing" && pending ? `${name}${away} is playing ${an(cardLabel(pending.card))}`
        : flipping ? `${name}${away} is flipping`
        : `${name}${away} can play a card`;
      replaceChildren(this.status, seat ? avatar(seat.name, seat.avatarSeed, "sm") : null, h("span", {}, text));
      return;
    }
    replaceChildren(this.status, h("span", {}, text));
  }

  private countdown(game: OverheatPublicState): string {
    const left = game.roundEndsAt - this.api.serverNow();
    return left > 0 ? `Next round in ${formatSeconds(left)}.` : "Next round…";
  }

  private tick() {
    const game = this.props?.game as OverheatPublicState | undefined;
    if (game?.step !== "round-end") return;
    const el = this.status.querySelector(".ov-clock");
    if (el) el.textContent = this.countdown(game);
  }

  private renderHead(game: OverheatPublicState) {
    this.roundEl.textContent = `Round ${game.round}`;
    replaceChildren(this.gaugeEl, "Limit ", h("b", {}, String(game.gauge)));
    this.gaugeEl.setAttribute("aria-label", `Heat limit this round: ${game.gauge}`);
    replaceChildren(this.deckEl, "Deck ", h("b", {}, String(game.deckCount)));
    this.deckEl.setAttribute("aria-label", `${game.deckCount} cards in the deck`);
    this.targetEl.textContent = `First to ${game.settings.target}`;
  }

  private statusText(p: OverheatPlayerState): string {
    if (p.removed || p.status === "out") return "Left";
    if (p.status === "busted") return "Too hot";
    if (p.status === "banked") return `${p.redline ? "Perfect" : "Saved"} +${p.roundPoints}`;
    return "Flipping";
  }

  private renderRows(props: GameViewProps, game: OverheatPublicState) {
    const me = props.playerId;
    const choice = this.choosing(game, me);
    const aimable = choice && !this.pending.size ? new Set(targetsFor(game, me, choice.kind)) : new Set<string>();
    const pick = choice ? this.pickFor(choice) : null;
    const winners = new Set(game.winnerIds);

    replaceChildren(
      this.rows,
      game.players.map((p) => {
        const seat = props.room.seats.find((s) => s.id === p.id);
        const name = seat?.name ?? "?";
        const away = !!seat && seat.presence !== "connected" && !p.removed;
        const acting = game.step !== "round-end" && game.step !== "finished" && p.id === game.awaitedId;
        const status = this.statusText(p);
        const tags = rowTags(game, p.id);
        const picked = !!pick && (pick.targetId === p.id || pick.theirs?.targetId === p.id);
        const cls = [
          "ov-row",
          p.id === me && "me",
          acting && "current",
          `st-${p.removed ? "out" : p.status}`,
          winners.has(p.id) && "winner",
          away && "away",
          aimable.has(p.id) && "aim",
          picked && "picked",
        ].filter(Boolean).join(" ");

        // Swap, Steal, Dump: the cards I may take or give are buttons.
        const pickHere = !!choice && !this.pending.size && cardsPickable(choice.kind, p.id === me) && (p.id === me || aimable.has(p.id));
        const cards = p.engine.length
          ? p.engine.map((e) => {
              if (!pickHere || !pick) return engineCard(e);
              const el = engineCard(e, () => this.onCard(p.id, e.card.id));
              const on = p.id === me ? pick.mine === e.card.id : pick.theirs?.targetId === p.id && pick.theirs.id === e.card.id;
              el.classList.toggle("picked", on);
              el.setAttribute("aria-pressed", String(on));
              return el;
            })
          : [h("span", { class: "ov-empty" }, p.status === "flipping" ? "No cards yet" : "")];

        const bar = h(
          "div",
          { class: "ov-heat" },
          h("span", { class: "ov-track", "aria-hidden": "true" }, h("span", { class: "ov-fill" }), h("span", { class: "ov-mark" })),
          h("span", { class: "ov-heat-text" }),
        );
        const parts = [
          h(
            "div",
            { class: "ov-row-top" },
            seat ? avatar(name, seat.avatarSeed, "sm") : null,
            h(
              "span",
              { class: "ov-who" },
              h("span", { class: "ov-name" }, name, away ? h("span", { class: "ov-muted" }, ` (${PRESENCE_LABEL[seat!.presence]})`) : null),
              h(
                "span",
                { class: "ov-tags" },
                h("span", { class: "ov-chip" }, status),
                p.turbo && p.status === "flipping" ? h("span", { class: "ov-chip ov-turbo" }, "Next ×2") : null,
                h("span", { class: "ov-fuse", hidden: p.fuses === 0 || p.status !== "flipping", "aria-hidden": "true" }, h("span", { class: "ov-fuse-icon" }), `×${p.fuses}`),
                tags.leader ? h("span", { class: "ov-leader", "aria-hidden": "true" }, svgSpan("ov-icon", LEADER_SVG), "Leader") : null,
                tags.hand ? h("span", { class: "ov-hand-count", "aria-hidden": "true" }, svgSpan("ov-icon", HAND_SVG), tags.hand) : null,
              ),
            ),
            h("span", { class: "ov-score", "aria-hidden": "true" }, String(p.score)),
          ),
          bar,
          h("div", { class: "ov-engine" }, cards),
        ];
        const fuseIcon = parts[0]!.querySelector(".ov-fuse-icon");
        if (fuseIcon) fuseIcon.innerHTML = FUSE_SVG;

        const label = [
          p.id === me ? `${name} (you)` : name,
          tags.leader ? "leader" : "",
          `score ${p.score}`,
          status,
          p.status === "flipping" || p.engine.length ? `heat ${p.heat} of ${p.gauge}` : "",
          p.fuses ? `${p.fuses} burn${p.fuses > 1 ? "s" : ""}` : "",
          p.turbo && p.status === "flipping" ? "next number card counts double" : "",
          tags.hand ? `holds ${tags.hand}` : "",
          acting ? "playing now" : "",
          away ? PRESENCE_LABEL[seat!.presence] : "",
        ].filter(Boolean).join(", ");

        const rowButton = aimable.has(p.id) && !!choice && rowPick(choice.kind);
        const body = rowButton
          ? h(
              "button",
              { type: "button", class: "ov-row-body", "aria-label": `${AIM_VERB[choice.kind]} ${name}. ${label}`, "aria-pressed": choice.kind === "dump" ? String(picked) : null, onclick: () => this.onPlayer(p.id) },
              parts,
            )
          : h("div", { class: "ov-row-body" }, parts);
        const li = h("li", { class: cls, "data-player": p.id, "aria-label": rowButton ? null : label, "aria-current": acting ? "true" : null }, body);
        li.dataset.heat = String(p.heat);
        li.dataset.gauge = String(p.gauge);
        li.dataset.flipping = String(p.status === "flipping");
        this.paintBar(li, game.gauge);
        return li;
      }),
    );
  }

  /** "Your cards": my hand, each card a button when I can play it now. */
  private renderHand(props: GameViewProps, game: OverheatPublicState) {
    const me = game.players.find((p) => p.id === props.playerId);
    this.handEl.hidden = game.settings.powers !== "cutthroat" || !me || me.removed || game.step === "finished";
    if (this.handEl.hidden) return;
    const locked = this.pending.size > 0;
    const cards = handModel(game, props.playerId, this.hand(props));
    const items = cards.map((c) => {
      // The face is a picture of the card; the name, line and reason say it in words.
      const face = faceEl(faceSpec(c.card), c.card.id, { decorative: true });
      const inner = [
        face,
        h(
          "span",
          { class: "ov-hand-text" },
          h("b", { class: "ov-hand-name" }, c.name),
          h("span", { class: "ov-hand-line" }, c.line),
          c.reason ? h("span", { class: "ov-hand-why" }, c.reason) : null,
        ),
      ];
      if (!c.playable) return h("li", { class: handCardClass(c), "data-card": c.card.id }, inner);
      return h(
        "li",
        {},
        h("button", { type: "button", class: handCardClass(c), "data-card": c.card.id, disabled: locked, onclick: () => this.send(c.action) }, inner),
      );
    });
    replaceChildren(
      this.handEl,
      h("h2", { class: "ov-hand-title" }, "Your cards"),
      items.length ? h("ul", { class: "ov-hand-list" }, items) : h("p", { class: "ov-empty" }, "No cards yet. Power cards you flip go here."),
    );
  }

  /** The heat bar from the row's data: fill = heat, line = this player's limit. */
  private paintBar(row: HTMLElement, roundGauge: number) {
    const heat = Number(row.dataset.heat);
    const gauge = Number(row.dataset.gauge);
    const flipping = row.dataset.flipping === "true";
    const bar = row.querySelector<HTMLElement>(".ov-heat");
    if (!bar) return;
    const scale = Math.max(roundGauge, gauge, heat, 1);
    bar.style.setProperty("--ov-fill", String(Math.min(1, heat / scale)));
    bar.style.setProperty("--ov-mark", String(gauge / scale));
    bar.style.setProperty("--ov-t", String(Math.min(1, heat / Math.max(gauge, 1))));
    bar.classList.toggle("near", flipping && heat <= gauge && gauge - heat <= 3);
    bar.classList.toggle("over", heat > gauge);
    const text = bar.querySelector(".ov-heat-text");
    if (text) text.textContent = `${heat} / ${gauge}`;
  }

  private renderDock(props: GameViewProps, game: OverheatPublicState, mine: boolean) {
    const hint = (text: string) => h("span", { class: "hint" }, text);
    this.note.textContent = "";
    if (game.step === "finished") {
      replaceChildren(this.actions);
      return;
    }
    if (this.pending.size) {
      replaceChildren(this.actions, hint("…"));
      return;
    }
    if (game.step === "round-end") {
      replaceChildren(this.actions, hint("Wait for the next round"));
      return;
    }
    const me = game.players.find((p) => p.id === props.playerId);
    if (!mine || !me) {
      const id = game.awaitedId ?? game.currentPlayerId;
      const name = seatName(props.room, id);
      const seated = !!me && !me.removed;
      const done = me && me.status !== "flipping" ? `${this.statusText(me)}. ` : "";
      replaceChildren(this.actions, hint(seated ? `${done}${name}'s turn` : `Watching ${name}`));
      return;
    }
    const choice = this.choosing(game, props.playerId);
    if (choice) {
      replaceChildren(this.actions, hint(this.pickHint(game, choice, props.playerId)));
      return;
    }
    if (savedTurn(game, props.playerId)) {
      replaceChildren(this.actions, h("button", { type: "button", class: "ov-pass-btn", onclick: () => this.send({ type: "pass" }) }, "Pass"));
      this.note.textContent = "Tap one of your cards to play it, or pass.";
      return;
    }
    const points = bankScore(me.engine, false);
    replaceChildren(
      this.actions,
      h("button", { type: "button", class: "ov-flip-btn", onclick: () => this.send({ type: "flip" }) }, "Flip"),
      h("button", { type: "button", class: "primary ov-bank-btn", disabled: !me.flipped, onclick: () => this.send({ type: "bank" }) }, `Save +${points}`),
    );
    if (!me.flipped) this.note.textContent = "You must flip first.";
    else {
      const bonus = colourBonus(me.engine);
      this.note.textContent = `${enginePoints(me.engine)} from cards${bonus ? ` + ${bonus} colour bonus` : ""}. Heat ${me.heat} of ${me.gauge}.`;
    }
  }

  /** What to tap next for my pending card. */
  private pickHint(game: OverheatPublicState, choice: Pending, me: string): string {
    const pick = this.pickFor(choice);
    const label = (id: number | null | undefined, owner: string | null | undefined) => {
      const e = game.players.find((p) => p.id === owner)?.engine.find((x) => x.card.id === id);
      return e ? cardLabel(e.card) : "";
    };
    const name = (id: string | null) => seatName(this.props!.room, id);
    switch (choice.kind) {
      case "wrench":
        return pick.mine === null && !pick.theirs ? "Pick one of your cards"
          : pick.mine === null ? `Theirs: ${label(pick.theirs?.id, pick.theirs?.targetId)}. Now pick one of yours`
          : `Yours: ${label(pick.mine, me)}. Now pick one of theirs`;
      case "dump":
        return pick.mine === null && !pick.targetId ? "Pick one of your cards, then a player"
          : pick.mine === null ? `To ${name(pick.targetId)}. Now pick one of your cards`
          : `Give ${label(pick.mine, me)}. Now pick a player`;
      case "steal":
        return "Pick a card from a player's row";
      case "audit":
        return "Pick a player who saved";
      case "fuse":
        return "Pick a player to get the Burn";
      case "shove":
        return "Pick a player to push a card onto";
    }
  }

  // ---- interaction ----------------------------------------------------------------

  private send(action: OverheatAction) {
    if (this.busy || this.pending.size) return;
    this.pending.add(this.api.act(action));
    this.rerender();
  }

  /** The pending card I'm choosing for, if taps count now. */
  private tapChoice(): Pending | null {
    const props = this.props;
    const game = props?.game as OverheatPublicState | undefined;
    if (this.busy || !props || !game || this.pending.size) return null;
    return this.choosing(game, props.playerId);
  }

  private onPlayer(targetId: string) {
    const choice = this.tapChoice();
    if (!choice) return;
    this.apply(tapPlayer(choice, this.pickFor(choice), this.props!.playerId, targetId));
  }

  private onCard(owner: string, id: number) {
    const choice = this.tapChoice();
    if (!choice) return;
    this.apply(tapCard(choice, this.pickFor(choice), this.props!.playerId, owner, id));
  }

  private apply(tap: ReturnType<typeof tapCard>) {
    this.pick = tap.pick;
    if (tap.action) this.send(tap.action);
    else this.rerender();
  }

  // ---- animation ------------------------------------------------------------------

  private async act(events: OverheatEvent[], props: GameViewProps) {
    // Nothing to press while the show's on: the buttons belong to the old state.
    this.busy = true;
    try {
      for (const e of events) {
        replaceChildren(this.actions);
        this.note.textContent = "";
        const line = describe(e, props);
        if (line) this.log.textContent = line;
        await this.actOne(e, props);
      }
    } finally {
      this.busy = false;
    }
  }

  private row(id: string): HTMLElement | null {
    return this.rows.querySelector<HTMLElement>(`[data-player="${CSS.escape(id)}"]`);
  }

  private anchorFor(id: string): Element {
    return this.row(id)?.querySelector(".avatar") ?? this.row(id) ?? this.status;
  }

  private roundGauge(): number {
    return (this.props?.game as OverheatPublicState | undefined)?.gauge ?? 0;
  }

  private setHeat(id: string, heat: number, gauge?: number) {
    const row = this.row(id);
    if (!row) return;
    row.dataset.heat = String(heat);
    if (gauge !== undefined) row.dataset.gauge = String(gauge);
    this.paintBar(row, this.roundGauge());
  }

  private async actOne(e: OverheatEvent, props: GameViewProps) {
    const me = props.playerId;
    switch (e.type) {
      case "round-start":
        // A new round is a clean table: draw it, then point at the new limit.
        this.render(props, "none");
        replaceChildren(this.actions);
        audio.play("shuffle");
        once(this.gaugeEl, "pop");
        await bubble(this.gaugeEl, `Limit ${e.gauge}`, "anim-bubble ov-callout", 1100);
        break;
      case "flip":
        await this.showFlip(e);
        break;
      case "shove":
        audio.play("deal");
        once(this.row(e.targetId) ?? this.rows, "aimed");
        await bubble(this.anchorFor(e.playerId), `Push → ${e.targetId === me ? "you" : seatName(props.room, e.targetId)}`, "anim-bubble ov-callout", 1000);
        break;
      case "vent":
        audio.play("pass");
        this.setHeat(e.playerId, e.heat);
        await bubble(this.anchorFor(e.playerId), `Cool −${VENT_HEAT}`, "anim-bubble ov-cool", 900);
        break;
      case "turbo":
        audio.play("nudge");
        await bubble(this.anchorFor(e.playerId), "Double: next ×2", "anim-bubble ov-callout", 900);
        break;
      case "heatwave": {
        audio.play("nudge");
        audio.buzz([20, 40, 20]);
        for (const id of e.hit) {
          const row = this.row(id);
          if (!row) continue;
          this.setHeat(id, Number(row.dataset.heat), Number(row.dataset.gauge) - HEATWAVE_DROP);
          const mark = row.querySelector(".ov-heat");
          if (mark) once(mark, "flash");
        }
        await bubble(this.gaugeEl, `Limit −${HEATWAVE_DROP}`, "anim-bubble ov-hot", 1200);
        await wait(300);
        break;
      }
      case "fuse": {
        audio.play("deal");
        const fuse = this.row(e.targetId)?.querySelector<HTMLElement>(".ov-fuse");
        if (fuse) {
          fuse.hidden = false;
          fuse.lastChild!.textContent = `×${e.fuses}`;
          once(fuse, "pulse");
        }
        await bubble(this.anchorFor(e.targetId), "Burn!", "anim-bubble ov-hot", 1000);
        break;
      }
      case "fuse-tick": {
        audio.play("tick");
        const fuse = this.row(e.playerId)?.querySelector(".ov-fuse");
        if (fuse) once(fuse, "pulse");
        this.setHeat(e.playerId, e.heat);
        await bubble(this.anchorFor(e.playerId), `Burn +${e.fuses}`, "anim-bubble ov-hot", 900);
        break;
      }
      case "wrench":
        await this.showWrench(e);
        break;
      case "keep":
        audio.play("deal");
        await bubble(this.anchorFor(e.playerId), "Kept a card", "anim-bubble", 700);
        break;
      case "play":
        audio.play("deal");
        await bubble(this.anchorFor(e.playerId), cardLabel(e.card), "anim-bubble ov-callout", 900);
        break;
      case "pass":
        audio.play("pass");
        await bubble(this.anchorFor(e.playerId), "Pass", "anim-bubble", 700);
        break;
      case "steal":
        audio.play("card-place");
        await bubble(this.anchorFor(e.targetId), `Lost ${cardLabel(e.card.card)}`, "anim-bubble ov-loss", 1000);
        break;
      case "dump":
        audio.play("card-place");
        await bubble(this.anchorFor(e.targetId), `Got ${cardLabel(e.card.card)}`, "anim-bubble ov-hot", 1000);
        break;
      case "audit":
        audio.play("card-place");
        await bubble(this.anchorFor(e.targetId), `Lost ${cardLabel(e.card.card)}`, "anim-bubble ov-loss", 1000);
        break;
      case "block":
        audio.play("pass");
        once(this.row(e.playerId) ?? this.rows, "aimed");
        await bubble(this.anchorFor(e.playerId), "Block!", "anim-bubble ov-cool", 1000);
        break;
      case "bounty":
        audio.play("correct");
        if (e.playerId === me) audio.buzz([30, 30, 30]);
        await bubble(this.anchorFor(e.playerId), `Leader too hot +${e.points}`, "anim-bubble ov-gain", 1200);
        break;
      case "rescore": {
        const score = this.row(e.playerId)?.querySelector<HTMLElement>(".ov-score");
        if (score) {
          score.textContent = String(e.score);
          once(score, "pop");
        }
        await wait(300);
        break;
      }
      case "fizzle":
        audio.play("pass");
        await bubble(this.anchorFor(e.playerId), e.card ? "No target" : "No cards left", "anim-bubble", 900);
        break;
      case "bust": {
        audio.play("boom");
        if (e.playerId === me) audio.buzz([60, 40, 90]);
        const row = this.row(e.playerId);
        if (row) {
          row.dataset.flipping = "false";
          this.setHeat(e.playerId, e.heat, e.gauge);
          row.classList.add("st-busted");
          row.classList.remove("st-flipping");
          once(row, "shake");
          const chip = row.querySelector(".ov-chip");
          if (chip) chip.textContent = "Too hot";
        }
        await bubble(this.anchorFor(e.playerId), "Too hot!", "anim-bubble ov-loss", 1100);
        await wait(300);
        break;
      }
      case "redline": {
        audio.play("correct");
        if (e.playerId === me) audio.buzz([30, 30, 30]);
        const row = this.row(e.playerId);
        if (row) once(row, "redline");
        await bubble(this.anchorFor(e.playerId), "Perfect! +10", "anim-bubble ov-gain", 1100);
        break;
      }
      case "bank": {
        audio.play("correct");
        if (e.playerId === me) audio.buzz(30);
        const row = this.row(e.playerId);
        void bubble(this.anchorFor(e.playerId), `+${e.points}`, "anim-bubble ov-gain", 1000);
        await wait(250);
        if (row) {
          row.dataset.flipping = "false";
          this.paintBar(row, this.roundGauge());
          row.classList.add("st-banked");
          row.classList.remove("st-flipping");
          const chip = row.querySelector(".ov-chip");
          if (chip) chip.textContent = `${e.redline ? "Perfect" : "Saved"} +${e.points}`;
          const score = row.querySelector<HTMLElement>(".ov-score");
          if (score) {
            score.textContent = String(e.score);
            once(score, "pop");
          }
        }
        await wait(400);
        break;
      }
      case "reshuffle":
        audio.play("shuffle");
        replaceChildren(this.deckEl, "Deck ", h("b", {}, String(e.deckCount)));
        once(this.deckEl, "pop");
        await wait(400);
        break;
      case "turn-skipped":
        audio.play("pass");
        await bubble(this.anchorFor(e.playerId), "Skipped");
        break;
      case "round-end":
        await wait(250);
        break;
      default:
        break;
    }
  }

  /** The card comes off the deck (or from the shover) and lands in the row. */
  private async showFlip(e: Extract<OverheatEvent, { type: "flip" }>) {
    const row = this.row(e.playerId);
    const engine = row?.querySelector<HTMLElement>(".ov-engine");
    if (!row || !engine) return;
    const from = (e.by ? this.anchorFor(e.by) : this.deckEl).getBoundingClientRect();
    engine.querySelector(".ov-empty")?.remove();
    const spot = cardFace(e.card, e.mult);
    spot.style.visibility = "hidden";
    engine.append(spot);
    audio.play("card-place");
    await fly(cardFace(e.card, e.mult), from, spot.getBoundingClientRect(), 320, { handoff: true });
    spot.style.visibility = "";
    once(spot, "landed");
    if (e.card.kind === "number") {
      this.setHeat(e.playerId, e.heat);
      await wait(200);
    } else {
      // Power cards don't stay: a short look, then it goes.
      await bubble(spot, cardLabel(e.card), "anim-bubble ov-callout", 900);
      await wait(250);
      spot.classList.add("leaving");
      await wait(200);
      spot.remove();
    }
  }

  /** The two cards trade places, and both heat bars follow. */
  private async showWrench(e: Extract<OverheatEvent, { type: "wrench" }>) {
    audio.play("card-place");
    const mineRow = this.row(e.playerId);
    const theirRow = this.row(e.targetId);
    const a = mineRow?.querySelector<HTMLElement>(`.ov-card[data-card="${e.gave.card.id}"]`);
    const b = theirRow?.querySelector<HTMLElement>(`.ov-card[data-card="${e.got.card.id}"]`);
    const worth = (x: EngineCard) => x.card.value * x.mult;
    if (a && b && mineRow && theirRow) {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const na = engineCard(e.got);
      const nb = engineCard(e.gave);
      na.style.visibility = "hidden";
      nb.style.visibility = "hidden";
      a.replaceWith(na);
      b.replaceWith(nb);
      await Promise.all([
        fly(engineCard(e.got), rb, na.getBoundingClientRect(), 360, { handoff: true }),
        fly(engineCard(e.gave), ra, nb.getBoundingClientRect(), 360, { handoff: true }),
      ]);
      for (const n of [na, nb]) {
        n.style.visibility = "";
        once(n, "landed");
      }
      const shift = worth(e.got) - worth(e.gave);
      this.setHeat(e.playerId, Math.max(0, Number(mineRow.dataset.heat) + shift));
      this.setHeat(e.targetId, Math.max(0, Number(theirRow.dataset.heat) - shift));
    }
    await wait(350);
  }

  private eventSounds(events: OverheatEvent[], props: GameViewProps) {
    const types = new Set(events.map((e) => e.type));
    if (types.has("round-start") || types.has("reshuffle")) audio.play("shuffle");
    if (types.has("flip") || types.has("wrench") || types.has("steal") || types.has("dump") || types.has("audit")) audio.play("card-place");
    if (types.has("shove") || types.has("fuse") || types.has("keep") || types.has("play")) audio.play("deal");
    if (types.has("fuse-tick")) audio.play("tick");
    if (types.has("heatwave") || types.has("turbo")) audio.play("nudge");
    if (types.has("bank") || types.has("redline") || types.has("bounty")) audio.play("correct");
    if (types.has("fizzle") || types.has("turn-skipped") || types.has("vent") || types.has("pass") || types.has("block")) audio.play("pass");
    const bust = events.find((e) => e.type === "bust" && e.playerId === props.playerId);
    if (types.has("bust")) audio.play("boom");
    if (bust) audio.buzz([60, 40, 90]);
  }
}
