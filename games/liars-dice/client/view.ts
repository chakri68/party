import { AnimationQueue, bubble, once } from "@games/animation";
import { audio } from "@games/audio";
import type { Presence } from "@games/protocol";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { bidText, matches, minQuantity, skipBid, smallestRaise } from "../shared/rules.ts";
import type {
  Face,
  LiarsDiceEvent,
  LiarsDicePrivateState,
  LiarsDicePublicPlayer,
  LiarsDicePublicState,
  Reveal,
} from "../shared/types.ts";
import { FACES } from "../shared/types.ts";
import { diceLabel, die, setFace } from "./dice.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
  left: "left",
};

/** The reveal's last seconds tick, for anyone who hasn't tapped through. */
const TICK_FROM = 2;
/** However many dice are on the table, the flip takes about this long. */
const FLIP_SPREAD_MS = 1400;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Sounds = "all" | "cues" | "none";
type Called = Extract<LiarsDiceEvent, { type: "called" }>;

/** Everyone but me, starting from my left: reads like the table, clockwise. */
function fromMyLeft<T extends { id: string }>(players: T[], me: string): T[] {
  const i = players.findIndex((p) => p.id === me);
  return i < 0 ? players : [...players.slice(i + 1), ...players.slice(0, i)];
}

function verdictText(r: Reveal): string {
  if (r.call === "liar") return r.success ? "Liar!" : "It's there";
  return r.success ? "Spot on!" : "Not quite";
}

/** What the reveal cost, in words: "Ana loses a die", "Bo is out", "Cy gets a die back". */
function outcomeText(r: Reveal, name: (id: string) => string, me: string): string {
  const you = (id: string) => id === me;
  if (r.eliminatedId) return you(r.eliminatedId) ? "You lose your last die. You're out." : `${name(r.eliminatedId)} loses their last die and is out.`;
  if (r.loserId) return you(r.loserId) ? "You lose a die." : `${name(r.loserId)} loses a die.`;
  if (r.gainerId) return you(r.gainerId) ? "You get a die back." : `${name(r.gainerId)} gets a die back.`;
  return you(r.callerId) ? "Spot on, but your cup's already full." : `Spot on, but ${name(r.callerId)}'s cup is already full.`;
}

function describe(e: LiarsDiceEvent, props: GameViewProps): string | null {
  const me = props.playerId;
  const who = (id: string | null) => (id === me ? "You" : seatName(props.room, id));
  const whose = (id: string) => (id === me ? "your" : `${seatName(props.room, id)}'s`);
  switch (e.type) {
    case "rolled":
      if (e.reason === "void") return `Round void: everyone re-rolls. ${who(e.starterId)} ${e.starterId === me ? "open" : "opens"}.`;
      return `Round ${e.round}: cups shaken. ${who(e.starterId)} ${e.starterId === me ? "open" : "opens"}.`;
    case "you-rolled":
      return null;
    case "bid":
      return `${who(e.playerId)} ${e.playerId === me ? "bid" : "bids"} ${bidText(e.quantity, e.face)}.`;
    case "called": {
      const head = `${who(e.callerId)} called ${e.call === "liar" ? "Liar" : "Spot on"} on ${whose(e.bid.playerId)} ${bidText(e.bid.quantity, e.bid.face)}: there ${e.count === 1 ? "was" : "were"} ${e.count}.`;
      return `${head} ${outcomeText(e, (id) => seatName(props.room, id), me)}`;
    }
    case "ready":
      return null;
    case "turn-skipped":
      return `${who(e.playerId)} got skipped by the host, so the smallest bid went in for them.`;
    case "player-removed":
      return `${who(e.playerId)} left.${e.voided ? " Their dice are off the table, so the round starts over." : ""}`;
    case "game-over":
      if (!e.winnerId) return "Game over.";
      return e.winnerId === me ? "Last cup standing. You win!" : `${who(e.winnerId)} is the last with dice.`;
  }
}

export class LiarsDiceView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "liars-dice" });
  private status = h("div", { class: "ld-status", role: "status", "aria-live": "polite" });
  private opponents = h("div", { class: "ld-opponents", role: "list", "aria-label": "Other players" });
  private table = h("div", { class: "ld-table", role: "group", "aria-label": "Table" });
  private bar = h("div", { class: "ld-bar", "aria-hidden": "true" }, h("span"));
  private log = h("p", { class: "ld-log", "aria-live": "polite" });
  private me = h("div", { class: "ld-me" });
  private myDice = h("div", { class: "ld-my-dice", role: "img" });
  private action = h("div", { class: "ld-action" });

  /** The bid being built on your turn. Reset to the smallest legal raise whenever the standing bid moves. */
  private pick: { quantity: number; face: Face } = { quantity: 1, face: 2 };
  private pickKey = "";
  private pending = new Set<string>();

  private queue = new AnimationQueue();
  private wasMyTurn = false;
  private clock: ReturnType<typeof setInterval>;
  private lastTick = -1;

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(
      this.status,
      this.opponents,
      this.table,
      this.log,
      h("div", { class: "ld-dock" }, h("div", { class: "ld-dock-head" }, this.me, this.myDice), this.action),
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
      this.action.classList.remove("shake");
      void this.action.offsetWidth;
      this.action.classList.add("shake");
    }
    this.rerender();
    this.log.textContent = message;
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    const events = props.events as LiarsDiceEvent[];
    this.pending.clear();
    const freshRoll = !this.props && events.some((e) => e.type === "rolled");
    if (props.snapshot || (!this.props && !freshRoll)) {
      this.queue.clear();
      this.table.dataset.key = "";
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
    const game = props.game as LiarsDicePublicState;
    const priv = props.private as LiarsDicePrivateState | null;
    const myTurn = !!(priv?.canBid || priv?.canCallLiar);
    this.root.classList.toggle("my-turn", myTurn);
    this.root.classList.toggle("revealing", game.phase === "reveal");
    this.root.classList.toggle("finished", game.phase === "over");

    this.resetPick(game, priv);
    this.renderStatus(props, game, myTurn);
    this.renderOpponents(props, game);
    this.renderTable(props, game);
    this.renderDock(props, game, priv, myTurn);
    this.renderClock();

    const events = props.events as LiarsDiceEvent[];
    const lines = events.map((e) => describe(e, props)).filter(Boolean);
    if (lines.length && sounds !== "none") this.log.textContent = lines.slice(-2).join(" ");

    if (sounds !== "none") {
      if (sounds === "all") this.eventSounds(events, props);
      const over = events.find((e) => e.type === "game-over");
      if (over?.type === "game-over") {
        const won = over.winnerId === props.playerId;
        audio.play(won ? "win" : "game-over");
        if (won) audio.buzz([40, 60, 40, 60, 90]);
      }
      if (myTurn && !this.wasMyTurn) {
        audio.play("your-turn");
        audio.buzz(25);
      }
      if (events.some((e) => e.type === "called")) this.lastTick = -1;
    }
    if (sounds !== "none" || props.snapshot) this.wasMyTurn = myTurn;
  }

  private rerender() {
    if (this.props) this.render(this.props, "none");
  }

  // ---- animation ------------------------------------------------------------

  private async act(events: LiarsDiceEvent[], props: GameViewProps) {
    replaceChildren(this.action);
    for (const e of events) {
      switch (e.type) {
        case "rolled":
          this.render(props, "none");
          await this.shake(props);
          break;
        case "bid":
          audio.play("card-place");
          await bubble(this.anchorFor(e.playerId, props), bidText(e.quantity, e.face), "anim-bubble ld-bid-bubble", 1000);
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

  private eventSounds(events: LiarsDiceEvent[], props: GameViewProps) {
    const types = new Set(events.map((e) => e.type));
    if (types.has("rolled")) audio.play("shuffle");
    if (types.has("bid")) audio.play("card-place");
    if (types.has("turn-skipped")) audio.play("pass");
    const call = events.find((e): e is Called => e.type === "called");
    if (call) {
      audio.play(call.success ? "correct" : "reject");
      if (call.loserId === props.playerId) audio.buzz([50, 40, 50]);
    }
  }

  private anchorFor(playerId: string, props: GameViewProps): Element {
    if (playerId === props.playerId) return this.myDice.firstElementChild ?? this.me;
    return this.opponents.querySelector(`[data-player="${CSS.escape(playerId)}"] .avatar`) ?? this.status;
  }

  /** Cups shaken: every die you can see tumbles, with a rattle. */
  private async shake(props: GameViewProps) {
    const mine = [...this.myDice.querySelectorAll<HTMLElement>(".ld-die")];
    const theirs = [...this.opponents.querySelectorAll<HTMLElement>(".ld-die")];
    audio.play("shuffle");
    audio.buzz(20);
    mine.forEach((_, i) => setTimeout(() => audio.play("deal"), 120 + i * 70));
    const priv = props.private as LiarsDicePrivateState | null;
    const flights = [...mine, ...theirs].map((el, i) => {
      const own = i < mine.length;
      // Your own dice flicker through faces before landing on the real ones.
      if (own && priv?.dice[i]) {
        const real = priv.dice[i]!;
        for (let k = 0; k < 4; k++) setTimeout(() => setFace(el, ((real + k * 2) % 6 + 1) as Face), k * 90);
        setTimeout(() => setFace(el, real), 380);
      }
      return el.animate(
        [
          { transform: "translateY(0) rotate(0)" },
          { transform: `translateY(-${own ? 14 : 4}px) rotate(${i % 2 ? 160 : -160}deg)`, offset: 0.4 },
          { transform: `translateY(0) rotate(${i % 2 ? 360 : -360}deg)` },
        ],
        { duration: own ? 520 : 420, delay: own ? i * 40 : (i % 5) * 30, easing: "cubic-bezier(.2,.8,.2,1)" },
      ).finished;
    });
    await Promise.all(flights).catch(() => {});
  }

  /**
   * The call. The caller shouts, every cup comes up one die at a time, the
   * matches light and count up against the bid, then the verdict lands and
   * the loser's die drops away.
   */
  private async showCall(e: Called, props: GameViewProps) {
    audio.play("nudge");
    audio.buzz(30);
    await bubble(this.anchorFor(e.callerId, props), e.call === "liar" ? "Liar!" : "Spot on!", "anim-bubble ld-shout", 1100);

    const built = this.buildReveal(e, props, true);
    this.table.dataset.key = "";
    replaceChildren(this.table, built.el);
    const n = built.dice.length;
    const step = Math.min(90, FLIP_SPREAD_MS / Math.max(n, 1));
    let found = 0;
    for (const [i, d] of built.dice.entries()) {
      setFace(d.el, d.face, d.label);
      once(d.el, "flip");
      if (d.hit) {
        d.el.classList.add("hit");
        if (d.wild) d.el.classList.add("wild");
        found++;
        built.count.textContent = String(found);
        once(built.count, "bump");
        audio.play("tick");
      } else d.el.classList.add("miss");
      if (i % 3 === 0) audio.play("deal");
      await wait(step);
    }
    await wait(450);

    built.verdict.hidden = false;
    once(built.verdict, "stamp");
    audio.play(e.success ? "correct" : "reject");
    if (e.loserId === props.playerId) audio.buzz([50, 40, 50]);
    await wait(600);
    built.outcome.hidden = false;
    built.lost?.classList.add("lost");
    built.gained?.classList.remove("pending");
    if (built.gained) once(built.gained, "flip");
    if (e.eliminatedId) audio.play("boom");
    await wait(900);
    this.table.dataset.key = this.revealKey(e, props);
  }

  private revealKey(r: Reveal, props: GameViewProps) {
    return `reveal:${(props.game as LiarsDicePublicState).round}:${r.callerId}:${r.bid.quantity}:${r.bid.face}`;
  }

  /**
   * The reveal panel. `hidden`: every die face down and the verdict tucked
   * away, for `showCall` to turn over. Otherwise it's the settled record.
   */
  private buildReveal(r: Reveal, props: GameViewProps, hidden: boolean) {
    const me = props.playerId;
    const name = (id: string) => (id === me ? "You" : seatName(props.room, id));
    const game = props.game as LiarsDicePublicState;
    const order = [me, ...fromMyLeft(game.players, me).map((p) => p.id)].filter((id) => id in r.dice);
    const dice: { el: HTMLElement; face: Face; hit: boolean; wild: boolean; label: string }[] = [];
    let lost: HTMLElement | null = null;
    let gained: HTMLElement | null = null;

    const rows = order.map((id) => {
      const faces = r.dice[id]!;
      const els = faces.map((face) => {
        const hit = matches(face, r.bid.face, game.settings.wildOnes);
        const wild = hit && face !== r.bid.face;
        const label = `${face}${hit ? (wild ? ", wild, counts" : ", counts") : ""}`;
        const el = hidden ? die(null, "", "face down") : die(face, hit ? `hit${wild ? " wild" : ""}` : "miss", label);
        dice.push({ el, face, hit, wild, label });
        return el;
      });
      // The die that goes: their last one, crossed out once the verdict's in.
      if (id === r.loserId) {
        lost = els.at(-1) ?? null;
        if (lost && !hidden) lost.classList.add("lost");
      }
      if (id === r.gainerId) {
        gained = die(null, `gained${hidden ? " pending" : ""}`, "a die back");
        els.push(gained);
      }
      return h(
        "div",
        { class: `ld-row${id === r.loserId ? " loser" : ""}${id === r.gainerId ? " gainer" : ""}`, role: "listitem", "aria-label": `${name(id)}: ${diceLabel(faces)}` },
        h("span", { class: "ld-row-name" }, name(id), id === r.bid.playerId ? h("span", { class: "ld-tag" }, "bid") : null, id === r.callerId ? h("span", { class: "ld-tag call" }, "called") : null),
        h("span", { class: "ld-row-dice", "aria-hidden": "true" }, els),
      );
    });

    const count = h("b", { class: "ld-count" }, hidden ? "0" : String(r.count));
    const wildNote = r.wild ? "1s count" : r.bid.face === 1 && game.settings.wildOnes ? "only 1s count" : "";
    const verdict = h("span", { class: `ld-verdict ${r.success ? "right" : "wrong"}`, hidden }, verdictText(r));
    const outcome = h("p", { class: "ld-outcome", hidden }, outcomeText(r, (id) => seatName(props.room, id), me));
    const head = h(
      "p",
      { class: "ld-reveal-head" },
      `${name(r.callerId)} called `,
      h("strong", {}, r.call === "liar" ? "Liar" : "Spot on"),
      ` on ${r.bid.playerId === me ? "your" : `${seatName(props.room, r.bid.playerId)}'s`} `,
      h("strong", {}, bidText(r.bid.quantity, r.bid.face)),
    );
    const el = h(
      "div",
      { class: "ld-reveal" },
      head,
      h("div", { class: "ld-rows", role: "list", "aria-label": "Everyone's dice" }, rows),
      h(
        "div",
        { class: "ld-tally", "aria-label": `Counted ${r.count} against a bid of ${r.bid.quantity}. ${verdictText(r)}` },
        h("span", { class: "ld-tally-num", "aria-hidden": "true" }, count, h("span", { class: "ld-of" }, ` / ${r.bid.quantity}`)),
        h("span", { class: "ld-tally-sub", "aria-hidden": "true" }, die(r.bid.face, "tiny"), wildNote ? ` ${wildNote}` : ""),
        verdict,
      ),
      outcome,
    );
    return { el, dice, count, verdict, outcome, lost: lost as HTMLElement | null, gained: gained as HTMLElement | null };
  }

  // ---- regions --------------------------------------------------------------

  private renderStatus(props: GameViewProps, game: LiarsDicePublicState, myTurn: boolean) {
    this.status.hidden = game.phase === "over";
    if (this.status.hidden) return;
    if (game.phase === "reveal") {
      const starter = game.nextStarterId === props.playerId ? "You open" : `${seatName(props.room, game.nextStarterId)} opens`;
      replaceChildren(this.status, h("span", {}, `Cups up. ${starter} next round.`));
      return;
    }
    if (myTurn) {
      replaceChildren(this.status, h("span", {}, game.bid ? "Your turn: raise, or call it" : "Your turn: open the bidding"));
      return;
    }
    const seat = props.room.seats.find((s) => s.id === game.currentPlayerId);
    const away = seat && seat.presence !== "connected" ? ` (${PRESENCE_LABEL[seat.presence]})` : "";
    replaceChildren(
      this.status,
      seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
      h("span", {}, `${seat?.name ?? "Someone"}${away} is ${game.bid ? "thinking" : "opening"}…`),
    );
  }

  private renderOpponents(props: GameViewProps, game: LiarsDicePublicState) {
    replaceChildren(
      this.opponents,
      fromMyLeft(game.players, props.playerId).map((p) => this.opponentChip(p, props, game)),
    );
  }

  private opponentChip(p: LiarsDicePublicPlayer, props: GameViewProps, game: LiarsDicePublicState) {
    const seat = props.room.seats.find((s) => s.id === p.id);
    const away = seat && seat.presence !== "connected" && !p.removed;
    const name = seat?.name ?? "?";
    const current = p.id === game.currentPlayerId;
    const winner = p.id === game.winnerId;
    const holding = p.removed ? "left" : p.out ? "out" : `${p.diceCount} ${p.diceCount === 1 ? "die" : "dice"}`;
    const bidder = game.phase === "bidding" && game.bid?.playerId === p.id;
    return h(
      "div",
      {
        class: `ld-opp${current ? " current" : ""}${winner ? " winner" : ""}${p.out || p.removed ? " out" : ""}${away ? " away" : ""}`,
        role: "listitem",
        "data-player": p.id,
        "aria-label": `${name}: ${holding}${current ? ", bidding now" : ""}${bidder ? ", made the last bid" : ""}${p.ready ? ", ready" : ""}${away ? `, ${PRESENCE_LABEL[seat!.presence]}` : ""}`,
      },
      seat ? avatar(name, seat.avatarSeed) : null,
      h(
        "div",
        { class: "ld-opp-text", "aria-hidden": "true" },
        h("span", { class: "name" }, name, p.ready ? h("span", { class: "ld-ready" }, "✓") : null),
        h(
          "span",
          { class: "cup" },
          p.out || p.removed
            ? holding
            : [h("span", { class: "minis" }, Array.from({ length: p.diceCount }, () => die(null, "mini"))), away ? h("span", { class: "away-label" }, PRESENCE_LABEL[seat!.presence]) : null],
        ),
      ),
    );
  }

  private renderTable(props: GameViewProps, game: LiarsDicePublicState) {
    // A call stays up (the record) through the reveal and the end.
    if (game.phase !== "bidding" && game.reveal) {
      const key = this.revealKey(game.reveal, props);
      if (this.table.dataset.key !== key) {
        replaceChildren(this.table, this.buildReveal(game.reveal, props, false).el);
        this.table.dataset.key = key;
      }
      this.table.append(this.bar);
      return;
    }
    const me = props.playerId;
    const name = (id: string) => (id === me ? "You" : seatName(props.room, id));
    const key = `bid:${game.round}:${game.history.length}:${game.totalDice}`;
    if (this.table.dataset.key === key) return;
    const fresh = this.table.dataset.key?.startsWith(`bid:${game.round}:`) && game.bid;
    this.table.dataset.key = key;

    const meta = h(
      "div",
      { class: "ld-meta" },
      h("span", {}, h("b", {}, String(game.totalDice)), ` ${game.totalDice === 1 ? "die" : "dice"} on the table`),
      game.settings.wildOnes ? h("span", { class: "ld-wild-chip" }, die(1, "tiny"), "wild") : null,
    );
    let main: HTMLElement;
    if (game.bid) {
      const b = game.bid;
      main = h(
        "div",
        { class: "ld-bid", role: "img", "aria-label": `Standing bid: ${name(b.playerId)}, ${bidText(b.quantity, b.face)}` },
        h("span", { class: "ld-bid-who", "aria-hidden": "true" }, `${name(b.playerId)} ${b.playerId === me ? "bid" : "bids"}`),
        h("span", { class: "ld-bid-main", "aria-hidden": "true" }, h("b", {}, String(b.quantity)), h("span", { class: "x" }, "×"), die(b.face, "big")),
      );
      if (fresh) once(main, "stamp");
    } else {
      const opener = game.currentPlayerId;
      main = h(
        "div",
        { class: "ld-bid empty" },
        h("span", { class: "ld-bid-who" }, "No bid yet"),
        h("span", { class: "ld-bid-open" }, opener === me ? "You open" : `${seatName(props.room, opener)} opens`),
      );
    }
    const history = game.history.slice(0, -1);
    replaceChildren(
      this.table,
      meta,
      main,
      history.length
        ? h(
            "ol",
            { class: "ld-history", "aria-label": "Earlier bids this round" },
            history.map((b) =>
              h(
                "li",
                { "aria-label": `${name(b.playerId)}: ${bidText(b.quantity, b.face)}` },
                h("span", { class: "q", "aria-hidden": "true" }, `${b.quantity}×`),
                die(b.face, "tiny"),
                h("span", { class: "n", "aria-hidden": "true" }, name(b.playerId)),
              ),
            ),
          )
        : null,
    );
  }

  /** The reveal's pause, draining. A tick near the end for anyone who could still tap through. */
  private renderClock() {
    const game = this.props?.game as LiarsDicePublicState | undefined;
    const ends = game?.phase === "reveal" ? game.revealEndsAt : null;
    this.bar.hidden = ends === null || ends === undefined;
    if (ends === null || ends === undefined || !game) return;
    const left = Math.max(0, ends - this.api.serverNow());
    (this.bar.firstElementChild as HTMLElement).style.transform = `scaleX(${Math.min(1, left / Math.max(game.revealMs, 1))})`;
    const secs = Math.ceil(left / 1000);
    const priv = this.props?.private as LiarsDicePrivateState | null;
    if (priv?.canReady && secs > 0 && secs <= TICK_FROM && secs !== this.lastTick) {
      this.lastTick = secs;
      audio.play("tick");
    }
  }

  private resetPick(game: LiarsDicePublicState, priv: LiarsDicePrivateState | null) {
    const key = `${game.round}:${game.history.length}:${game.totalDice}`;
    if (key === this.pickKey) return;
    this.pickKey = key;
    const wild = game.settings.wildOnes;
    // Opening: one of whatever you hold most of. Otherwise the least step up.
    const opening = priv?.dice.length ? (skipBid(priv.dice, null, wild, game.totalDice)?.face ?? 2) : 2;
    const raise = smallestRaise(game.bid, wild, game.totalDice, opening);
    if (raise) this.pick = { ...raise };
  }

  private minFor(face: Face): number {
    const game = this.props!.game as LiarsDicePublicState;
    return minQuantity(game.bid, face, game.settings.wildOnes);
  }

  private renderDock(props: GameViewProps, game: LiarsDicePublicState, priv: LiarsDicePrivateState | null, myTurn: boolean) {
    const mine = game.players.find((p) => p.id === props.playerId);
    const dice = priv?.dice ?? [];
    replaceChildren(
      this.me,
      h("span", { class: "you" }, "Your cup"),
      mine ? h("span", { class: "count" }, mine.out ? "out" : mine.removed ? "left" : `${mine.diceCount} ${mine.diceCount === 1 ? "die" : "dice"}`) : null,
    );
    // During a reveal your cup's up too: the same dice, lit the same way.
    const r = game.phase !== "bidding" ? game.reveal : null;
    replaceChildren(
      this.myDice,
      dice.map((face) => {
        const hit = r ? matches(face, r.bid.face, game.settings.wildOnes) : false;
        return die(face, r ? (hit ? `hit${face !== r.bid.face ? " wild" : ""}` : "miss") : "");
      }),
    );
    this.myDice.setAttribute("aria-label", dice.length ? `Your dice: ${diceLabel(dice)}` : "No dice");
    this.myDice.hidden = !dice.length;

    const hint = (text: string, strong = false) => h("span", { class: `hint${strong ? " strong" : ""}` }, text);
    let action: Node | Node[] | null = null;
    if (game.phase === "over") action = null;
    else if (this.pending.size) action = hint("…");
    else if (game.phase === "reveal") {
      action = priv?.canReady
        ? h("button", { type: "button", class: "primary ld-next", onclick: () => this.send({ type: "ready" }) }, "Next round")
        : hint(mine?.out ? "You're out. Watching the table." : "Waiting for the others…");
    } else if (myTurn && priv) action = this.picker(game, priv);
    else if (mine?.out || mine?.removed) action = hint("You're out. Watching the table.");
    else action = hint(game.bid ? "Not your turn yet" : "Waiting for the opening bid");
    replaceChildren(this.action, action);
    this.action.classList.toggle("picking", myTurn && game.phase === "bidding");
  }

  /** Quantity stepper, six faces, and the three moves. Always holds a legal bid, so Raise is one tap. */
  private picker(game: LiarsDicePublicState, priv: LiarsDicePrivateState): Node[] {
    const { quantity, face } = this.pick;
    const total = game.totalDice;
    const min = this.minFor(face);
    const set = (q: number, f: Face) => {
      this.pick = { quantity: q, face: f };
      this.rerender();
    };
    const stepper = h(
      "div",
      { class: "ld-stepper", role: "group", "aria-label": "How many" },
      h("button", { type: "button", class: "ld-step", "aria-label": "One fewer", disabled: !priv.canBid || quantity <= min, onclick: () => set(quantity - 1, face) }, "−"),
      h("output", { class: "ld-qty", "aria-live": "polite" }, h("b", {}, String(quantity)), h("span", {}, "×")),
      h("button", { type: "button", class: "ld-step", "aria-label": "One more", disabled: !priv.canBid || quantity >= total, onclick: () => set(quantity + 1, face) }, "+"),
    );
    const faces = h(
      "div",
      { class: "ld-faces", role: "group", "aria-label": "Which face" },
      FACES.map((f) => {
        const fmin = this.minFor(f);
        const possible = priv.canBid && fmin <= total;
        const btn = h("button", {
          type: "button",
          class: `ld-face${f === face ? " on" : ""}`,
          "aria-pressed": String(f === face),
          "aria-label": `${f}s${possible ? "" : ", can't beat the bid"}`,
          disabled: !possible,
          onclick: () => set(Math.max(quantity, fmin), f),
        });
        btn.append(die(f));
        return btn;
      }),
    );
    const moves = h(
      "div",
      { class: "ld-moves" },
      priv.canCallLiar ? h("button", { type: "button", class: "ld-liar", onclick: () => this.send({ type: "liar" }) }, "Liar!") : null,
      priv.canSpotOn ? h("button", { type: "button", class: "ld-spot", onclick: () => this.send({ type: "spot-on" }) }, "Spot on") : null,
      priv.canBid
        ? h("button", { type: "button", class: "primary ld-raise", onclick: () => this.send({ type: "bid", quantity, face }) }, `Bid ${bidText(quantity, face)}`)
        : null,
    );
    return priv.canBid ? [stepper, faces, moves] : [moves];
  }

  private send(action: unknown) {
    this.pending.add(this.api.act(action));
    this.rerender();
  }
}
