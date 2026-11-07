import { AnimationQueue, bubble, fly, once } from "@games/animation";
import { audio } from "@games/audio";
import type { Presence } from "@games/protocol";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { bankScore, cardLabel, colourBonus, enginePoints, isAimed } from "../shared/rules.ts";
import { HEATWAVE_DROP, VENT_HEAT, type Card, type Colour, type EngineCard, type OverheatEvent, type OverheatPlayerState, type OverheatPublicState, type Pending } from "../shared/types.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
  left: "left",
};

/** Colour is never the only signal: each colour has its own shape. */
const SHAPES: Record<Colour, string> = {
  red: '<circle cx="12" cy="12" r="9"/>',
  amber: '<path d="M12 2.5 22 20.5H2z"/>',
  blue: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/>',
  green: '<path d="M12 1.5 22.5 12 12 22.5 1.5 12z"/>',
};
const FUSE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="15" r="7"/><path d="M14.5 9.5 18 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="19.5" cy="4.5" r="2" class="spark"/></svg>';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const an = (label: string) => (/^[AEIOU]/.test(label) ? `an ${label}` : `a ${label}`);

function shapeEl(colour: Colour): HTMLElement {
  const s = h("span", { class: "oh-shape", "aria-hidden": "true" });
  s.innerHTML = `<svg viewBox="0 0 24 24">${SHAPES[colour]}</svg>`;
  return s;
}

function cardText(e: EngineCard): string {
  return `${cardLabel(e.card)}${e.mult === 2 ? ", counts double" : ""}`;
}

/** An engine card. A button when it can be picked (Wrench). */
function engineCard(e: EngineCard, onPick?: () => void): HTMLElement {
  const parts = [
    h("b", { class: "oh-val", "aria-hidden": "true" }, String(e.card.value)),
    shapeEl(e.card.colour),
    e.mult === 2 ? h("i", { class: "oh-x2", "aria-hidden": "true" }, "×2") : null,
  ];
  const cls = `oh-card oh-${e.card.colour}`;
  if (onPick) {
    return h("button", { type: "button", class: `${cls} pickable`, "data-card": e.card.id, "aria-label": cardText(e), onclick: onPick }, parts);
  }
  return h("span", { class: cls, "data-card": e.card.id, role: "img", "aria-label": cardText(e) }, parts);
}

/** Any card face, for flights and the short look at a flipped power card. */
function cardFace(card: Card, mult: 1 | 2 = 1): HTMLElement {
  if (card.kind === "number") return engineCard({ card, mult });
  return h("span", { class: "oh-card oh-power", role: "img", "aria-label": cardLabel(card) }, h("b", { class: "oh-pname" }, cardLabel(card)));
}

/** Who the pending card can be aimed at: other players still flipping (Wrench: with cards). */
function validTargets(game: OverheatPublicState, pending: Pending): string[] {
  const chooser = game.players.find((p) => p.id === pending.chooserId);
  if (pending.kind === "wrench" && !chooser?.engine.length) return [];
  return game.players
    .filter((p) => p.id !== pending.chooserId && p.status === "flipping" && (pending.kind !== "wrench" || p.engine.length > 0))
    .map((p) => p.id);
}

function describe(e: OverheatEvent, props: GameViewProps): string | null {
  const me = props.playerId;
  const who = (id: string | null | undefined) => (id === me ? "You" : seatName(props.room, id));
  const whom = (id: string | null | undefined) => (id === me ? "you" : seatName(props.room, id));
  switch (e.type) {
    case "round-start":
      return `Round ${e.round}. The heat limit is ${e.gauge}.`;
    case "flip": {
      const x2 = e.mult === 2 ? " (counts double)" : "";
      if (e.by) return `${who(e.by)} shoved ${an(cardLabel(e.card))}${x2} onto ${whom(e.playerId)}.`;
      if (e.card.kind === "power" && !isAimed(e.card.power)) return null;
      return `${who(e.playerId)} flipped ${an(cardLabel(e.card))}${x2}.`;
    }
    case "vent":
      return `Vent: −${VENT_HEAT} heat for ${whom(e.playerId)}. Heat is ${e.heat} now.`;
    case "turbo":
      return `Turbo: the next number card for ${whom(e.playerId)} counts double.`;
    case "shove":
      return null; // The flip that follows says it.
    case "wrench":
      return `${who(e.playerId)} gave ${whom(e.targetId)} ${an(cardLabel(e.gave.card))} and took ${an(cardLabel(e.got.card))}.`;
    case "fuse":
      return `${who(e.playerId)} put a Fuse on ${whom(e.targetId)}. Each Fuse adds 1 heat at the start of each turn.`;
    case "fuse-tick":
      return `Fuse: +${e.fuses} heat for ${whom(e.playerId)}. Heat is ${e.heat} now.`;
    case "heatwave":
      return `Heatwave! The limit is ${HEATWAVE_DROP} lower for ${e.hit.length === 1 ? whom(e.hit[0]) : "every player still flipping"}.`;
    case "fizzle":
      return e.card ? `Nobody to aim the ${cardLabel(e.card)} at. It does nothing.` : "No cards left to flip.";
    case "bust":
      return `Bust! ${who(e.playerId)} went over the limit (${e.heat} / ${e.gauge}).`;
    case "redline":
      return `${who(e.playerId)} hit the limit exactly. +10!`;
    case "bank":
      return `${who(e.playerId)} banked ${e.points}. Score: ${e.score}.`;
    case "reshuffle":
      return "The used cards were shuffled into a new deck.";
    case "round-end":
      return `Round ${e.round} is over.`;
    case "turn-skipped":
      return `The host skipped ${whom(e.playerId)}.`;
    case "player-removed":
      return `${who(e.playerId)} left the game.`;
    case "game-over":
      if (e.reason === "abandoned") return "Everyone else left.";
      if (e.winnerIds.includes(me)) return e.winnerIds.length > 1 ? "You tied for first. You share the win!" : "You have the highest score. You win!";
      return e.winnerIds.length > 1 ? "Players tied for first." : `${who(e.winnerIds[0])} wins.`;
  }
}

/** See Farkle: "all" plays the events' sounds, "cues" only the turn chime and ending, "none" nothing. */
type Sounds = "all" | "cues" | "none";

interface WrenchPick {
  /** Which pending card the picks belong to. */
  key: string;
  mine: number | null;
  theirs: { targetId: string; id: number } | null;
}

export class OverheatView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "overheat" });
  private status = h("div", { class: "oh-status", role: "status", "aria-live": "polite" });
  private head = h("div", { class: "oh-head" });
  private roundEl = h("span", { class: "oh-round" });
  private gaugeEl = h("span", { class: "oh-gauge" });
  private deckEl = h("span", { class: "oh-deck" });
  private targetEl = h("span", { class: "oh-muted" });
  private rows = h("ul", { class: "oh-rows", "aria-label": "Players" });
  private log = h("p", { class: "oh-log", "aria-live": "polite" });
  private actions = h("div", { class: "oh-actions" });
  private note = h("p", { class: "oh-note" });
  private clock = 0;

  /** Sent and not yet answered: the buttons stay locked meanwhile. */
  private pending = new Set<string>();
  private wrench: WrenchPick = { key: "", mine: null, theirs: null };

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
      h("section", { class: "oh-table", "aria-label": "Table" }, this.rows),
      this.log,
      h("div", { class: "oh-dock" }, this.note, this.actions),
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
      this.wrench = { key: "", mine: null, theirs: null };
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

  private wrenchPick(pending: Pending): WrenchPick {
    const key = `${pending.chooserId}:${pending.card.id}`;
    if (this.wrench.key !== key) this.wrench = { key, mine: null, theirs: null };
    return this.wrench;
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
      : choice?.kind === "wrench" ? "Pick 2 cards"
      : choice ? "Pick a player"
      : "Flip or bank",
    );

    this.renderStatus(props, game, mine);
    this.renderHead(game);
    this.renderRows(props, game);
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
      replaceChildren(this.status, h("span", {}, `Round ${game.round} is over. `), h("span", { class: "oh-clock" }, this.countdown(game)));
      return;
    }
    const pending = game.pending;
    let text: string;
    if (mine && game.step === "choosing" && pending) {
      text =
        pending.kind === "wrench" ? "Pick one of your cards, then one of theirs."
        : pending.kind === "fuse" ? "Pick a player to get the Fuse."
        : "Pick a player to shove a card onto.";
    } else if (mine) {
      text = "Your turn. Flip a card or bank.";
    } else {
      const id = game.awaitedId ?? game.currentPlayerId;
      const seat = props.room.seats.find((s) => s.id === id);
      const name = seat?.name ?? "Someone";
      const away = seat && seat.presence !== "connected" ? ` (${PRESENCE_LABEL[seat.presence]})` : "";
      text = game.step === "choosing" && pending ? `${name}${away} is playing a ${cardLabel(pending.card)}` : `${name}${away} is flipping`;
      replaceChildren(this.status, seat ? avatar(seat.name, seat.avatarSeed, "sm") : null, h("span", {}, text));
      return;
    }
    replaceChildren(this.status, h("span", {}, text));
  }

  private countdown(game: OverheatPublicState): string {
    const s = Math.max(0, Math.ceil((game.roundEndsAt - this.api.serverNow()) / 1000));
    return s > 0 ? `Next round in ${s}.` : "Next round…";
  }

  private tick() {
    const game = this.props?.game as OverheatPublicState | undefined;
    if (game?.step !== "round-end") return;
    const el = this.status.querySelector(".oh-clock");
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
    if (p.status === "busted") return "Bust";
    if (p.status === "banked") return `${p.redline ? "Redline" : "Banked"} +${p.roundPoints}`;
    return "Flipping";
  }

  private renderRows(props: GameViewProps, game: OverheatPublicState) {
    const me = props.playerId;
    const choice = this.choosing(game, me);
    const aimable = choice && !this.pending.size ? new Set(validTargets(game, choice)) : new Set<string>();
    const pick = choice?.kind === "wrench" ? this.wrenchPick(choice) : null;
    const winners = new Set(game.winnerIds);

    replaceChildren(
      this.rows,
      game.players.map((p) => {
        const seat = props.room.seats.find((s) => s.id === p.id);
        const name = seat?.name ?? "?";
        const away = !!seat && seat.presence !== "connected" && !p.removed;
        const acting = game.step !== "round-end" && game.step !== "finished" && p.id === game.awaitedId;
        const status = this.statusText(p);
        const cls = [
          "oh-row",
          p.id === me && "me",
          acting && "current",
          `st-${p.removed ? "out" : p.status}`,
          winners.has(p.id) && "winner",
          away && "away",
          aimable.has(p.id) && "aim",
        ].filter(Boolean).join(" ");

        // Wrench: my cards, and the cards of anyone I can aim at, can be picked.
        const pickHere = pick && (p.id === me || aimable.has(p.id));
        const cards = p.engine.length
          ? p.engine.map((e) => {
              if (!pickHere) return engineCard(e);
              const el = engineCard(e, () => this.onWrenchCard(p.id, e.card.id));
              const picked = p.id === me ? pick.mine === e.card.id : pick.theirs?.targetId === p.id && pick.theirs.id === e.card.id;
              el.classList.toggle("picked", picked);
              el.setAttribute("aria-pressed", String(picked));
              return el;
            })
          : [h("span", { class: "oh-empty" }, p.status === "flipping" ? "No cards yet" : "")];

        const bar = h(
          "div",
          { class: "oh-heat" },
          h("span", { class: "oh-track", "aria-hidden": "true" }, h("span", { class: "oh-fill" }), h("span", { class: "oh-mark" })),
          h("span", { class: "oh-heat-text" }),
        );
        const parts = [
          h(
            "div",
            { class: "oh-row-top" },
            seat ? avatar(name, seat.avatarSeed, "sm") : null,
            h(
              "span",
              { class: "oh-who" },
              h("span", { class: "oh-name" }, name, away ? h("span", { class: "oh-muted" }, ` (${PRESENCE_LABEL[seat!.presence]})`) : null),
              h(
                "span",
                { class: "oh-tags" },
                h("span", { class: "oh-chip" }, status),
                p.turbo && p.status === "flipping" ? h("span", { class: "oh-chip oh-turbo" }, "Next ×2") : null,
                h("span", { class: "oh-fuse", hidden: p.fuses === 0, "aria-hidden": "true" }, h("span", { class: "oh-fuse-icon" }), `×${p.fuses}`),
              ),
            ),
            h("span", { class: "oh-score", "aria-hidden": "true" }, String(p.score)),
          ),
          bar,
          h("div", { class: "oh-engine" }, cards),
        ];
        const fuseIcon = parts[0]!.querySelector(".oh-fuse-icon");
        if (fuseIcon) fuseIcon.innerHTML = FUSE_SVG;

        const label = [
          p.id === me ? `${name} (you)` : name,
          `score ${p.score}`,
          status,
          p.status === "flipping" || p.engine.length ? `heat ${p.heat} of ${p.gauge}` : "",
          p.fuses ? `${p.fuses} fuse${p.fuses > 1 ? "s" : ""}` : "",
          p.turbo && p.status === "flipping" ? "next number card counts double" : "",
          acting ? "playing now" : "",
          away ? PRESENCE_LABEL[seat!.presence] : "",
        ].filter(Boolean).join(", ");

        const verb = choice?.kind === "fuse" ? "Put the Fuse on" : "Shove a card onto";
        const body = aimable.has(p.id) && choice?.kind !== "wrench"
          ? h("button", { type: "button", class: "oh-row-body", "aria-label": `${verb} ${name}. ${label}`, onclick: () => this.onTarget(p.id) }, parts)
          : h("div", { class: "oh-row-body" }, parts);
        const li = h("li", { class: cls, "data-player": p.id, "aria-label": aimable.has(p.id) && choice?.kind !== "wrench" ? null : label, "aria-current": acting ? "true" : null }, body);
        li.dataset.heat = String(p.heat);
        li.dataset.gauge = String(p.gauge);
        li.dataset.flipping = String(p.status === "flipping");
        this.paintBar(li, game.gauge);
        return li;
      }),
    );
  }

  /** The heat bar from the row's data: fill = heat, line = this player's limit. */
  private paintBar(row: HTMLElement, roundGauge: number) {
    const heat = Number(row.dataset.heat);
    const gauge = Number(row.dataset.gauge);
    const flipping = row.dataset.flipping === "true";
    const bar = row.querySelector<HTMLElement>(".oh-heat");
    if (!bar) return;
    const scale = Math.max(roundGauge, gauge, heat, 1);
    bar.style.setProperty("--oh-fill", String(Math.min(1, heat / scale)));
    bar.style.setProperty("--oh-mark", String(gauge / scale));
    bar.style.setProperty("--oh-t", String(Math.min(1, heat / Math.max(gauge, 1))));
    bar.classList.toggle("near", flipping && heat <= gauge && gauge - heat <= 3);
    bar.classList.toggle("over", heat > gauge);
    const text = bar.querySelector(".oh-heat-text");
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
    if (choice?.kind === "wrench") {
      const pick = this.wrenchPick(choice);
      const card = (id: number | undefined, owner: string | undefined) => {
        const e = game.players.find((p) => p.id === owner)?.engine.find((x) => x.card.id === id);
        return e ? cardLabel(e.card) : "";
      };
      replaceChildren(
        this.actions,
        hint(
          pick.mine === null && !pick.theirs ? "Tap one of your cards"
          : pick.mine === null ? `Theirs: ${card(pick.theirs?.id, pick.theirs?.targetId)}. Now tap one of yours`
          : `Yours: ${card(pick.mine, props.playerId)}. Now tap one of theirs`,
        ),
      );
      return;
    }
    if (choice) {
      replaceChildren(this.actions, hint(choice.kind === "fuse" ? "Tap a player to get the Fuse" : "Tap a player to shove a card onto"));
      return;
    }
    const points = bankScore(me.engine, false);
    replaceChildren(
      this.actions,
      h("button", { type: "button", class: "oh-flip-btn", onclick: () => this.send({ type: "flip" }) }, "Flip"),
      h("button", { type: "button", class: "primary oh-bank-btn", disabled: !me.flipped, onclick: () => this.send({ type: "bank" }) }, `Bank +${points}`),
    );
    if (!me.flipped) this.note.textContent = "You must flip first.";
    else {
      const bonus = colourBonus(me.engine);
      this.note.textContent = `${enginePoints(me.engine)} from cards${bonus ? ` + ${bonus} colour bonus` : ""}. Heat ${me.heat} of ${me.gauge}.`;
    }
  }

  // ---- interaction ----------------------------------------------------------------

  private send(action: { type: "flip" } | { type: "bank" } | { type: "target"; targetId: string } | { type: "wrench"; targetId: string; mine: number; theirs: number }) {
    if (this.busy || this.pending.size) return;
    this.pending.add(this.api.act(action));
    this.rerender();
  }

  private onTarget(targetId: string) {
    if (this.busy) return;
    this.send({ type: "target", targetId });
  }

  private onWrenchCard(owner: string, id: number) {
    const props = this.props;
    const game = props?.game as OverheatPublicState | undefined;
    if (this.busy || !props || !game || this.pending.size) return;
    const choice = this.choosing(game, props.playerId);
    if (choice?.kind !== "wrench") return;
    const pick = this.wrenchPick(choice);
    if (owner === props.playerId) pick.mine = pick.mine === id ? null : id;
    else pick.theirs = pick.theirs?.targetId === owner && pick.theirs.id === id ? null : { targetId: owner, id };
    if (pick.mine !== null && pick.theirs) {
      const { mine, theirs } = pick;
      this.send({ type: "wrench", targetId: theirs.targetId, mine, theirs: theirs.id });
      return;
    }
    this.rerender();
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
        await bubble(this.gaugeEl, `Limit ${e.gauge}`, "anim-bubble oh-callout", 1100);
        break;
      case "flip":
        await this.showFlip(e);
        break;
      case "shove":
        audio.play("deal");
        once(this.row(e.targetId) ?? this.rows, "aimed");
        await bubble(this.anchorFor(e.playerId), `Shove → ${e.targetId === me ? "you" : seatName(props.room, e.targetId)}`, "anim-bubble oh-callout", 1000);
        break;
      case "vent":
        audio.play("pass");
        this.setHeat(e.playerId, e.heat);
        await bubble(this.anchorFor(e.playerId), `Vent −${VENT_HEAT}`, "anim-bubble oh-cool", 900);
        break;
      case "turbo":
        audio.play("nudge");
        await bubble(this.anchorFor(e.playerId), "Turbo: next ×2", "anim-bubble oh-callout", 900);
        break;
      case "heatwave": {
        audio.play("nudge");
        audio.buzz([20, 40, 20]);
        for (const id of e.hit) {
          const row = this.row(id);
          if (!row) continue;
          this.setHeat(id, Number(row.dataset.heat), Number(row.dataset.gauge) - HEATWAVE_DROP);
          const mark = row.querySelector(".oh-heat");
          if (mark) once(mark, "flash");
        }
        await bubble(this.gaugeEl, `Heatwave! Limit −${HEATWAVE_DROP}`, "anim-bubble oh-hot", 1200);
        await wait(300);
        break;
      }
      case "fuse": {
        audio.play("deal");
        const fuse = this.row(e.targetId)?.querySelector<HTMLElement>(".oh-fuse");
        if (fuse) {
          fuse.hidden = false;
          fuse.lastChild!.textContent = `×${e.fuses}`;
          once(fuse, "pulse");
        }
        await bubble(this.anchorFor(e.targetId), "Fuse!", "anim-bubble oh-hot", 1000);
        break;
      }
      case "fuse-tick": {
        audio.play("tick");
        const fuse = this.row(e.playerId)?.querySelector(".oh-fuse");
        if (fuse) once(fuse, "pulse");
        this.setHeat(e.playerId, e.heat);
        await bubble(this.anchorFor(e.playerId), `Fuse +${e.fuses}`, "anim-bubble oh-hot", 900);
        break;
      }
      case "wrench":
        await this.showWrench(e);
        break;
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
          const chip = row.querySelector(".oh-chip");
          if (chip) chip.textContent = "Bust";
        }
        await bubble(this.anchorFor(e.playerId), "Bust!", "anim-bubble oh-loss", 1100);
        await wait(300);
        break;
      }
      case "redline": {
        audio.play("correct");
        if (e.playerId === me) audio.buzz([30, 30, 30]);
        const row = this.row(e.playerId);
        if (row) once(row, "redline");
        await bubble(this.anchorFor(e.playerId), "Redline! +10", "anim-bubble oh-gain", 1100);
        break;
      }
      case "bank": {
        audio.play("correct");
        if (e.playerId === me) audio.buzz(30);
        const row = this.row(e.playerId);
        void bubble(this.anchorFor(e.playerId), `+${e.points}`, "anim-bubble oh-gain", 1000);
        await wait(250);
        if (row) {
          row.dataset.flipping = "false";
          this.paintBar(row, this.roundGauge());
          row.classList.add("st-banked");
          row.classList.remove("st-flipping");
          const chip = row.querySelector(".oh-chip");
          if (chip) chip.textContent = `${e.redline ? "Redline" : "Banked"} +${e.points}`;
          const score = row.querySelector<HTMLElement>(".oh-score");
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
    const engine = row?.querySelector<HTMLElement>(".oh-engine");
    if (!row || !engine) return;
    const from = (e.by ? this.anchorFor(e.by) : this.deckEl).getBoundingClientRect();
    engine.querySelector(".oh-empty")?.remove();
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
      await bubble(spot, cardLabel(e.card), "anim-bubble oh-callout", 900);
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
    const a = mineRow?.querySelector<HTMLElement>(`.oh-card[data-card="${e.gave.card.id}"]`);
    const b = theirRow?.querySelector<HTMLElement>(`.oh-card[data-card="${e.got.card.id}"]`);
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
    if (types.has("flip") || types.has("wrench")) audio.play("card-place");
    if (types.has("shove") || types.has("fuse")) audio.play("deal");
    if (types.has("fuse-tick")) audio.play("tick");
    if (types.has("heatwave") || types.has("turbo")) audio.play("nudge");
    if (types.has("bank") || types.has("redline")) audio.play("correct");
    if (types.has("fizzle") || types.has("turn-skipped") || types.has("vent")) audio.play("pass");
    const bust = events.find((e) => e.type === "bust" && e.playerId === props.playerId);
    if (types.has("bust")) audio.play("boom");
    if (bust) audio.buzz([60, 40, 90]);
  }
}
