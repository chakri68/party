import { AnimationQueue, bubble, fly, once } from "@games/animation";
import { audio } from "@games/audio";
import type { Presence } from "@games/protocol";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { discName, discsText, pointsText } from "../shared/rules.ts";
import type { Disc, Flip, ThornsEvent, ThornsPrivateState, ThornsPublicPlayer, ThornsPublicState } from "../shared/types.ts";
import { discEl, discLabel, handDisc } from "./discs.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
  left: "left",
};

/** The beat after each flip. A thorn gets longer: let it land. */
const ROSE_PAUSE = 520;
const THORN_PAUSE = 950;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Me first, then clockwise from my left: reads like the table. */
function tableOrder<T extends { id: string }>(players: T[], me: string): T[] {
  const i = players.findIndex((p) => p.id === me);
  return i < 0 ? players : [...players.slice(i), ...players.slice(0, i)];
}

function describe(e: ThornsEvent, props: GameViewProps): string | null {
  const me = props.playerId;
  const who = (id: string | null) => (id === me ? "You" : seatName(props.room, id));
  const whose = (id: string | null) => (id === me ? "your own" : `${seatName(props.room, id)}'s`);
  switch (e.type) {
    case "round-start":
      return `Round ${e.round}. Everyone puts down a disc. ${e.startId === me ? "You start" : `${who(e.startId)} starts`}.`;
    case "placed":
      return e.playerId === me ? null : `${who(e.playerId)} put a disc down.`;
    case "you-placed":
      return `You put down ${discName(e.disc, true)}.`;
    case "bid":
      return `${who(e.playerId)} bid ${e.amount}.`;
    case "passed":
      return `${who(e.playerId)} passed.`;
    case "challenge":
      return `${who(e.challengerId)} ${e.challengerId === me ? "turn" : "turns"} over ${e.amount} discs.`;
    case "flipped":
      return null;
    case "success":
      return `${who(e.challengerId)} found only roses. Score: ${pointsText(e.points)}.`;
    case "failure": {
      const thorn = e.thornOwnerId === e.challengerId ? "their own thorn" : `${whose(e.thornOwnerId)} thorn`;
      const hit = e.challengerId === me ? `You hit ${e.thornOwnerId === me ? "your own thorn" : thorn}` : `${who(e.challengerId)} hit ${thorn}`;
      return e.eliminated ? `${hit} and ${e.challengerId === me ? "you're" : "they're"} out of discs.` : `${hit} and lost 1 disc.`;
    }
    case "you-lost":
      return `You lost ${discName(e.lostDisc, true)}. Only you know this.`;
    case "ready":
      return null;
    case "round-void":
      return `${who(e.playerId)} left the game. This round does not count. Everyone gets their discs back.`;
    case "turn-skipped":
      return e.playerId === me ? "The host skipped your turn." : `The host skipped ${who(e.playerId)}'s turn.`;
    case "player-removed":
      return `${who(e.playerId)} left the table.`;
    case "game-over":
      if (e.reason === "abandoned") return "Everyone else left.";
      if (e.reason === "last-standing") return e.winnerId === me ? "Only you have discs left. You win!" : `Only ${who(e.winnerId)} has discs left.`;
      return e.winnerId === me ? "You win!" : `${who(e.winnerId)} wins.`;
  }
}

/** See Cheat: "all" plays the events' sounds here, "cues" only the turn chime and ending. */
type Sounds = "all" | "cues" | "none";

/** Mid-show: how much of the challenge to draw, and which flip just turned. */
interface Show {
  flips: number;
  fresh: number;
}

export class ThornsView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "thorns" });
  private status = h("div", { class: "th-status", role: "status", "aria-live": "polite" });
  private info = h("div", { class: "th-info" });
  private mats = h("div", { class: "th-mats", role: "list", "aria-label": "Mats" });
  private verdict = h("div", { class: "th-verdict", "aria-hidden": "true" });
  private log = h("p", { class: "th-log", "aria-live": "polite" });
  private me = h("div", { class: "th-me" });
  private note = h("div", { class: "th-note" });
  private hand = h("div", { class: "th-hand", role: "toolbar", "aria-label": "Your hand" });
  private controls = h("div", { class: "th-controls" });
  private bar = h("div", { class: "th-bar", "aria-hidden": "true" }, h("span"));

  private pending = new Set<string>();
  private queue = new AnimationQueue();
  private wasMyTurn = false;
  private bidValue = 1;
  /** The minimum bid last time we looked: a new bid resets the stepper. */
  private lastMin = 0;
  private clock: ReturnType<typeof setInterval>;
  private show: Show | null = null;

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(
      this.status,
      this.info,
      h("div", { class: "th-table" }, this.mats, this.verdict),
      this.log,
      h("div", { class: "th-dock" }, h("div", { class: "th-dock-head" }, this.me, this.note), this.hand, this.controls),
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
      this.controls.classList.remove("shake");
      void this.controls.offsetWidth;
      this.controls.classList.add("shake");
    }
    this.rerender();
    this.log.textContent = message;
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    const events = props.events as ThornsEvent[];
    this.pending.clear();
    // Reconnects and joining mid-game: show it as it is. A brand-new game is the exception.
    const fresh = !this.props && events.some((e) => e.type === "round-start" && e.round === 1);
    if (props.snapshot || !this.props) {
      this.queue.clear();
      this.render(props, fresh && !props.snapshot ? "all" : "none");
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
    const game = props.game as ThornsPublicState;
    const priv = props.private as ThornsPrivateState | null;
    const myTurn = !!(priv && (priv.canPlace || priv.canBid || priv.canFlip.length));
    this.root.classList.toggle("my-turn", myTurn && !this.show);
    this.root.classList.toggle("finished", game.phase === "over");

    if (game.minBid !== this.lastMin) {
      this.lastMin = game.minBid;
      this.bidValue = game.minBid;
    }
    this.bidValue = Math.max(game.minBid, Math.min(this.bidValue, game.tableTotal));

    this.api.setTurn(
      this.show || !priv ? null
      : priv.canFlip.length ? "Flip a disc"
      : game.phase === "placing-first" && priv.canPlace ? "Put down a disc"
      : game.phase === "turns" && myTurn ? "Put down or bid"
      : game.phase === "bidding" && myTurn ? "Raise or pass"
      : null,
    );

    this.renderStatus(props, game, priv);
    this.renderInfo(props, game);
    this.renderMats(props, game, priv);
    this.renderVerdict(props, game);
    this.renderDock(props, game, priv);
    this.renderClock();

    const events = props.events as ThornsEvent[];
    if (sounds !== "none") {
      // A bid of the whole table goes straight to flipping: one line says it.
      const shown = events.some((e) => e.type === "bid") ? events.filter((e) => e.type !== "challenge") : events;
      const lines = shown.map((e) => describe(e, props)).filter(Boolean);
      if (lines.length) this.log.textContent = lines.slice(-2).join(" ");
      if (sounds === "all") this.eventSounds(events);
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
    }
    if (sounds !== "none" || props.snapshot) this.wasMyTurn = myTurn;
  }

  private rerender() {
    if (this.props) this.render(this.props, "none");
  }

  // ---- animation ------------------------------------------------------------

  /** Acts out one update's events, in order. */
  private async act(events: ThornsEvent[], props: GameViewProps) {
    replaceChildren(this.controls);
    try {
      for (const e of events) {
        switch (e.type) {
          case "round-start":
            audio.play("shuffle");
            break;
          case "placed": {
            const own = e.playerId === props.playerId ? events.find((x) => x.type === "you-placed") : undefined;
            await this.flyDisc(e.playerId, own?.type === "you-placed" ? own.disc : null, props);
            break;
          }
          case "bid":
            audio.play("nudge");
            await bubble(this.anchorFor(e.playerId), `Bid ${e.amount}`, "anim-bubble th-bubble", 900);
            break;
          case "passed":
            audio.play("pass");
            void bubble(this.anchorFor(e.playerId), "Pass", "anim-bubble", 700);
            break;
          case "challenge":
            audio.play("nudge");
            audio.buzz(20);
            await bubble(this.anchorFor(e.challengerId), `Turning ${e.amount}`, "anim-bubble th-bubble", 1000);
            this.show = { flips: 0, fresh: -1 };
            this.render(props, "none");
            break;
          case "flipped": {
            this.show = { flips: e.count, fresh: e.count - 1 };
            this.render(props, "none");
            if (e.disc === "thorn") {
              audio.play("boom");
              audio.buzz([60, 40, 90]);
              const mat = this.mats.querySelector(`[data-player="${CSS.escape(e.owner)}"]`);
              if (mat) once(mat, "sting");
              await wait(THORN_PAUSE);
            } else {
              audio.play("card-place");
              await wait(ROSE_PAUSE);
            }
            break;
          }
          case "success":
            audio.play("correct");
            break;
          case "you-lost":
            audio.buzz([50, 40, 50]);
            break;
          case "turn-skipped":
            audio.play("pass");
            await bubble(this.anchorFor(e.playerId), "Skipped");
            break;
          default:
            break;
        }
      }
    } finally {
      this.show = null;
    }
  }

  private eventSounds(events: ThornsEvent[]) {
    const types = new Set(events.map((e) => e.type));
    if (types.has("round-start")) audio.play("shuffle");
    if (types.has("placed")) audio.play("card-place");
    if (types.has("bid") || types.has("challenge")) audio.play("nudge");
    if (types.has("passed") || types.has("turn-skipped")) audio.play("pass");
    if (events.some((e) => e.type === "flipped" && e.disc === "thorn")) audio.play("boom");
    if (types.has("success")) audio.play("correct");
    if (types.has("you-lost")) audio.buzz([50, 40, 50]);
  }

  private anchorFor(playerId: string): Element {
    return this.mats.querySelector(`[data-player="${CSS.escape(playerId)}"] .avatar`) ?? this.status;
  }

  /** A disc goes from the hand (yours, face up) or the seat (theirs, face down) onto the stack. */
  private async flyDisc(playerId: string, disc: Disc | null, props: GameViewProps) {
    const stack = this.mats.querySelector(`[data-player="${CSS.escape(playerId)}"] .th-stack`);
    if (!stack) return;
    const target = stack.getBoundingClientRect();
    const slot = stack.querySelector(".th-disc:last-child") ?? stack;
    const size = slot.getBoundingClientRect();
    const end = new DOMRect(target.right - size.width, target.top + target.height / 2 - size.height / 2, size.width, size.height);
    const handBtn = disc ? this.hand.querySelector<HTMLElement>(`[data-disc="${disc}"]`) : null;
    const from = handBtn ? handBtn.getBoundingClientRect() : this.anchorFor(playerId).getBoundingClientRect();
    if (handBtn) handBtn.style.visibility = "hidden";
    await fly(discEl(playerId === props.playerId && disc ? disc : "back"), from, end, 320);
    audio.play("card-place");
  }

  // ---- regions --------------------------------------------------------------

  private name(props: GameViewProps, id: string | null): string {
    return id === props.playerId ? "You" : seatName(props.room, id);
  }

  private renderStatus(props: GameViewProps, game: ThornsPublicState, priv: ThornsPrivateState | null) {
    this.status.hidden = game.phase === "over";
    if (this.status.hidden) return;
    const seat = props.room.seats.find((s) => s.id === game.currentPlayerId);
    const away = seat && seat.presence !== "connected" ? ` (${PRESENCE_LABEL[seat.presence]})` : "";
    const them = (text: string) => [seat ? avatar(seat.name, seat.avatarSeed, "sm") : null, h("span", {}, `${seat?.name ?? "Someone"}${away} ${text}`)];
    const mine = game.currentPlayerId === props.playerId;
    const c = game.challenge;
    let body: Node | (Node | null)[];

    if (this.show && c) {
      const left = c.amount - this.show.flips;
      body = mine ? h("span", {}, left ? `Turning over… ${left} left` : "Turning over…") : them(`is turning over discs: ${this.show.flips} of ${c.amount}`);
    } else if (game.phase === "placing-first") {
      const waiting = game.players.filter((p) => !p.removed && !p.out && !p.height);
      body = priv?.canPlace
        ? h("span", {}, "Put down your first disc")
        : h("span", {}, waiting.length === 1 ? `Waiting for ${this.name(props, waiting[0]!.id)}` : `Waiting for ${waiting.length} players`);
    } else if (game.phase === "turns") {
      body = mine ? h("span", {}, priv?.hand.length ? "Your turn. Put down a disc or bid." : "No discs in your hand. You must bid.") : them("must put down a disc or bid");
    } else if (game.phase === "bidding" && game.bid) {
      body = mine ? h("span", {}, `Say more than ${game.bid.amount}, or pass`) : them(`must say more than ${game.bid.amount} or pass`);
    } else if (game.phase === "flipping" && c) {
      const left = c.amount - c.flips.length;
      body = mine ? h("span", {}, `Turn over ${left} more. Tap a mat.`) : them(`is turning over discs: ${c.flips.length} of ${c.amount}`);
    } else if (game.phase === "result" && game.result) {
      const r = game.result;
      body = h("span", {}, r.outcome === "success" ? `${this.name(props, r.challengerId)} made ${r.amount}` : `Thorn! ${this.name(props, r.challengerId)} lost a disc`);
    } else body = h("span", {}, "…");
    replaceChildren(this.status, body);
  }

  private renderInfo(props: GameViewProps, game: ThornsPublicState) {
    const chip = (text: string, strong = false) => h("span", { class: `th-chip${strong ? " strong" : ""}` }, text);
    const c = game.challenge;
    const flipped = this.show ? this.show.flips : (c?.flips.length ?? 0);
    replaceChildren(
      this.info,
      chip(`First to ${game.pointsToWin}`),
      game.phase !== "over" ? chip(`Round ${game.round}`) : null,
      chip(`${game.tableTotal} on the mats`),
      game.bid && !c ? chip(`Bid ${game.bid.amount} · ${this.name(props, game.bid.bidderId)}`, true) : null,
      c ? chip(`${flipped} of ${c.amount} flipped`, true) : null,
    );
  }

  /** Which flips to draw: all of them, or as far as the show has got. */
  private visibleFlips(game: ThornsPublicState): Flip[] {
    const flips = game.challenge?.flips ?? [];
    return this.show ? flips.slice(0, this.show.flips) : flips;
  }

  private renderMats(props: GameViewProps, game: ThornsPublicState, priv: ThornsPrivateState | null) {
    const flips = this.visibleFlips(game);
    const canFlip = this.show || this.pending.size ? [] : (priv?.canFlip ?? []);
    const players = tableOrder(game.players, props.playerId);
    this.mats.dataset.count = String(players.length);
    replaceChildren(
      this.mats,
      players.map((p) => this.mat(props, game, priv, p, flips, canFlip.includes(p.id))),
    );
  }

  private mat(
    props: GameViewProps,
    game: ThornsPublicState,
    priv: ThornsPrivateState | null,
    p: ThornsPublicPlayer,
    flips: Flip[],
    flippable: boolean,
  ): HTMLElement {
    const seat = props.room.seats.find((s) => s.id === p.id);
    const isMe = p.id === props.playerId;
    const name = isMe ? "You" : (seat?.name ?? "?");
    const away = !!seat && seat.presence !== "connected" && !p.removed;
    const current = p.id === game.currentPlayerId && game.phase !== "result";
    const bidder = game.bid?.bidderId === p.id;

    // The stack, bottom first. Flips come off the top.
    const mine = flips.map((f, i) => ({ ...f, i })).filter((f) => f.owner === p.id);
    const discs: HTMLElement[] = [];
    for (let i = 0; i < p.height; i++) {
      const fromTop = p.height - 1 - i;
      const f = mine[fromTop];
      let el: HTMLElement;
      if (f) {
        el = discEl(f.disc);
        el.classList.add("up");
        if (this.show?.fresh === f.i) once(el, f.disc === "thorn" ? "flip-thorn" : "flip");
      } else if (isMe && priv?.stack[i]) {
        // Yours: face up to you only, and dimmed so it reads as "still hidden".
        el = discEl(priv.stack[i]!);
        el.classList.add("peek");
      } else el = discEl("back");
      discs.push(el);
    }
    const flippedHere = mine.map((f) => discLabel(f.disc).toLowerCase());
    const stackLabel = p.height
      ? `${p.height} face down${flippedHere.length ? `, turned over: ${flippedHere.join(", ")}` : ""}${isMe && priv?.stack.length ? `. Yours, bottom to top: ${priv.stack.map((d) => discLabel(d).toLowerCase()).join(", ")}` : ""}`
      : "Empty mat";
    const stackKids = discs.length ? discs : h("span", { class: "th-slot", "aria-hidden": "true" });
    const stack = flippable
      ? h(
          "button",
          { type: "button", class: "th-stack flippable", "aria-label": `Turn over the top disc of ${name}. ${stackLabel}`, onclick: () => this.send({ type: "flip", owner: p.id }) },
          stackKids,
          h("span", { class: "th-flip-tag", "aria-hidden": "true" }, "Flip"),
        )
      : h("div", { class: "th-stack", role: "img", "aria-label": stackLabel }, stackKids);

    const pips = Array.from({ length: game.pointsToWin }, (_, i) => h("span", { class: `th-pip${i < p.points ? " on" : ""}` }));
    const dots = Array.from({ length: 4 }, (_, i) => h("span", { class: `th-dot${i < p.discs ? " on" : ""}` }));
    const tag =
      p.removed ? "left"
      : p.out ? "out"
      : away ? PRESENCE_LABEL[seat!.presence]
      : game.phase === "result" && p.ready ? "ready"
      : bidder && game.phase === "bidding" ? `bid ${game.bid!.amount}`
      : game.challenge?.challengerId === p.id ? `trying ${game.challenge.amount}`
      : p.passed && game.phase !== "placing-first" ? "passed"
      : p.id === game.startId && game.phase === "placing-first" ? "starts"
      : "";
    const status = [
      `${pointsText(p.points)} of ${game.pointsToWin}`,
      p.removed ? "left" : p.out ? "out of discs" : discsText(p.discs),
      current ? "playing now" : "",
      tag && tag !== "left" && tag !== "out" ? tag : "",
    ].filter(Boolean);

    return h(
      "div",
      {
        class: `th-mat${isMe ? " me" : ""}${current ? " current" : ""}${flippable ? " can-flip" : ""}${p.passed ? " passed" : ""}${away || p.removed || p.out ? " away" : ""}${p.id === game.winnerId ? " winner" : ""}`,
        role: "listitem",
        "data-player": p.id,
        "aria-label": `${name}: ${status.join(", ")}`,
      },
      h(
        "div",
        { class: "th-mat-head", "aria-hidden": "true" },
        seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
        h("span", { class: "name" }, name),
        h("span", { class: "th-pips", title: pointsText(p.points) }, pips),
      ),
      stack,
      h(
        "div",
        { class: "th-mat-foot", "aria-hidden": "true" },
        h("span", { class: "th-dots", title: discsText(p.discs) }, dots),
        h("span", { class: "count" }, p.removed ? "" : `${p.discs}`),
        tag ? h("span", { class: `th-tag${tag === "out" || tag === "left" ? " dim" : ""}` }, tag) : null,
      ),
    );
  }

  private renderVerdict(props: GameViewProps, game: ThornsPublicState) {
    const r = game.result;
    const showIt = !this.show && !!r && (game.phase === "result" || game.phase === "over");
    this.verdict.hidden = !showIt;
    if (!showIt || !r) return;
    const key = `${game.round}:${r.outcome}:${r.challengerId}`;
    if (this.verdict.dataset.key === key) return;
    this.verdict.dataset.key = key;
    const who = this.name(props, r.challengerId);
    const success = r.outcome === "success";
    const you = r.challengerId === props.playerId;
    replaceChildren(
      this.verdict,
      h("span", { class: `th-stamp ${success ? "good" : "bad"}` }, success ? "All roses" : "Thorn!"),
      h(
        "span",
        { class: "th-verdict-line" },
        success ? `${who} ${you ? "score" : "scores"}.` : r.eliminated ? `${who} ${you ? "lose your" : "loses their"} last disc.` : `${who} ${you ? "lose" : "loses"} a disc.`,
      ),
    );
    once(this.verdict.firstElementChild!, "stamp");
  }

  private renderDock(props: GameViewProps, game: ThornsPublicState, priv: ThornsPrivateState | null) {
    const me = game.players.find((p) => p.id === props.playerId);
    replaceChildren(
      this.me,
      h("span", { class: "you" }, "Your hand"),
      me && !me.removed ? h("span", { class: "count" }, me.out ? "out of discs" : `${priv?.hand.length ?? 0} of ${discsText(me.discs)}`) : null,
    );

    // Your hand: tap a disc to put it down.
    const hand = priv?.hand ?? [];
    const placeable = !!priv?.canPlace && !this.pending.size && !this.show;
    replaceChildren(
      this.hand,
      hand.length
        ? hand.map((d) => {
            const btn = handDisc(d);
            btn.disabled = !placeable;
            btn.classList.toggle("playable", placeable);
            btn.addEventListener("click", () => this.send({ type: "place", disc: d }));
            return btn;
          })
        : h("span", { class: "th-empty" }, me?.out ? "You have no discs left. You can watch." : priv && game.phase !== "result" && game.phase !== "over" ? "All your discs are down." : ""),
    );
    this.hand.hidden = !priv;

    const lost = priv?.lostDisc;
    const hint = (text: string, strong = false) => h("span", { class: `hint${strong ? " strong" : ""}` }, text);
    replaceChildren(
      this.note,
      lost && (game.phase === "result" || game.phase === "over")
        ? h("span", { class: "th-lost" }, discEl(lost), lost === "rose" ? "You lost a rose" : "You lost your thorn")
        : placeable
          ? hint(game.phase === "placing-first" ? "Tap a disc to put it down" : "Tap a disc or bid", true)
          : null,
    );

    let controls: Node | (Node | null)[] | null = null;
    if (this.show || game.phase === "over") controls = null;
    else if (this.pending.size) controls = hint("…");
    else if (priv?.canBid) {
      const min = game.minBid;
      const max = game.tableTotal;
      const step = (d: number) => () => {
        this.bidValue = Math.max(min, Math.min(max, this.bidValue + d));
        this.rerender();
        (this.controls.querySelector(d < 0 ? ".th-minus" : ".th-plus") as HTMLButtonElement | null)?.focus();
      };
      controls = [
        h(
          "div",
          { class: "th-stepper", role: "group", "aria-label": "Bid amount" },
          h("button", { type: "button", class: "th-minus", "aria-label": "One less", disabled: this.bidValue <= min, onclick: step(-1) }, "−"),
          h("output", { class: "th-amount", "aria-live": "polite", "aria-label": `Bid ${this.bidValue} of ${max}` }, String(this.bidValue)),
          h("button", { type: "button", class: "th-plus", "aria-label": "One more", disabled: this.bidValue >= max, onclick: step(1) }, "+"),
        ),
        h("button", { type: "button", class: "primary th-bid", onclick: () => this.send({ type: "bid", amount: this.bidValue }) }, this.bidValue === max ? `Bid all ${max}` : `Bid ${this.bidValue}`),
        priv.canPass ? h("button", { type: "button", class: "th-pass", onclick: () => this.send({ type: "pass" }) }, "Pass") : null,
      ];
    } else if (priv?.canFlip.length) controls = hint("Tap a mat marked Flip. Its top disc turns over.", true);
    else if (game.phase === "result") {
      controls = [
        this.bar,
        priv?.canReady
          ? h("button", { type: "button", class: "primary th-ready", onclick: () => this.send({ type: "ready" }) }, "Ready")
          : hint(priv ? "Waiting for the others…" : "The next round starts soon"),
      ];
    } else if (game.phase === "placing-first") controls = hint(priv?.canPlace ? "Everyone chooses at the same time" : "Done. Waiting for the others…");
    else if (game.currentPlayerId) controls = hint(`${this.name(props, game.currentPlayerId)} ${game.currentPlayerId === props.playerId ? "are" : "is"} up`);
    replaceChildren(this.controls, controls);
    this.controls.classList.toggle("bidding", !!priv?.canBid && !this.pending.size && !this.show);
  }

  /** The result's countdown: a bar that drains until the next round. */
  private renderClock() {
    const game = this.props?.game as ThornsPublicState | undefined;
    if (!game || game.phase !== "result" || !game.resultMs) return;
    const left = Math.max(0, game.resultEndsAt - this.api.serverNow());
    (this.bar.firstElementChild as HTMLElement).style.transform = `scaleX(${Math.min(1, left / game.resultMs)})`;
  }

  // ---- interaction ----------------------------------------------------------

  private send(action: unknown) {
    if (this.pending.size) return;
    this.pending.add(this.api.act(action));
    this.rerender();
  }
}
