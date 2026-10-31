import { AnimationQueue, bubble } from "@games/animation";
import { audio } from "@games/audio";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import type { Choice, FaceOffEvent, FaceOffPrivateState, FaceOffPublicState, Outcome } from "../shared/types.ts";

type Pub = FaceOffPublicState;
type Priv = FaceOffPrivateState;

/** Restarts a one-off animation class, even if it's already on. */
function replay(el: Element, cls: string) {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

/** Keys that buzz, when nothing that takes text has focus. */
const BUZZ_KEYS = new Set(["Enter", " "]);

/** Anything that takes Enter or Space for itself. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return textEntry(target) || target.tagName === "BUTTON";
}

function textEntry(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export class FaceOffView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "fo" });
  private target = h("span", { class: "fo-target" });
  private clock = h("span", { class: "fo-clock", role: "timer" });
  private mine = h("section", { class: "fo-mine", "aria-label": "Your card" });
  private headline = h("p", { class: "fo-headline", role: "status", "aria-live": "polite" });
  private sub = h("p", { class: "fo-sub" });
  private table = h("ul", { class: "fo-table", "aria-label": "Players" });

  private overlay = h("section", { class: "fo-duel", "aria-live": "assertive", hidden: true });
  private overlayBar = h("div", { class: "fo-duel-bar" });
  private overlayBody = h("div", { class: "fo-duel-body" });
  // The body is rebuilt on every update, except the buzzer: it stays in the
  // DOM for the whole duel, so a Space held across an update still clicks it
  // (taking a focused button out of the document drops its focus and the press).
  private duelHead = h("div", { class: "fo-duel-part" });
  private buzzer = h("button", { type: "button", class: "fo-buzzer", "aria-keyshortcuts": "Enter Space", hidden: true, onclick: () => this.buzz() }, "Buzz");
  private duelTail = h("div", { class: "fo-duel-part" });
  /** The duel (by game.duels, which counts sparks, redos included) the buzzer last took focus for. */
  private focusedDuel = -1;

  private queue = new AnimationQueue();
  private ticker: ReturnType<typeof setInterval>;
  private onKey = (e: KeyboardEvent) => {
    if (!BUZZ_KEYS.has(e.key) || e.repeat || typing(e.target)) return;
    const me = this.props?.private as Priv | null | undefined;
    if (!me?.canBuzz) return;
    e.preventDefault();
    this.buzz();
  };

  constructor(api: GameClientApi) {
    this.api = api;
    this.overlayBody.append(this.duelHead, this.buzzer, this.duelTail);
    this.overlay.append(h("div", { class: "fo-duel-track", "aria-hidden": "true" }, this.overlayBar), this.overlayBody);
    this.root.append(
      h("div", { class: "fo-top" }, this.target, this.clock),
      this.mine,
      this.headline,
      this.sub,
      this.table,
      this.overlay,
    );
    this.ticker = setInterval(() => this.renderClock(), 200);
    document.addEventListener("keydown", this.onKey);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    clearInterval(this.ticker);
    document.removeEventListener("keydown", this.onKey);
    this.queue.clear();
    this.root.remove();
  }

  whenIdle() {
    return this.queue.idle();
  }

  rejected(_clientActionId: string, message: string) {
    const live = !this.overlay.hidden;
    const line = live ? this.overlayBody.querySelector(".fo-note") : this.sub;
    if (line) line.textContent = message;
    replay(live ? this.overlayBody : this.sub, "shake");
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    const events = props.events as FaceOffEvent[];
    if (props.snapshot || !this.props) {
      this.queue.clear();
      this.settle(props);
      return;
    }
    this.props = props;
    let animated = false;
    this.queue.push({
      animate: async () => {
        animated = true;
        this.sounds(events, props);
        this.settle(props);
        this.act(events);
      },
      settle: () => {
        if (!animated) this.sounds(events, props);
        this.settle(props);
      },
    });
  }

  // ---- helpers ------------------------------------------------------------

  private game(): Pub | null {
    return (this.props?.game as Pub | undefined) ?? null;
  }

  private name(id: string | null | undefined, props: GameViewProps = this.props!): string {
    return id === props.playerId ? "You" : seatName(props.room, id);
  }

  /** Mid-sentence: "you", or the name. */
  private lower(id: string, props: GameViewProps): string {
    return id === props.playerId ? "you" : seatName(props.room, id);
  }

  /** "You draw" / "Bo draws". */
  private does(id: string, verb: string, props: GameViewProps): string {
    return id === props.playerId ? `You ${verb}` : `${seatName(props.room, id)} ${verb}s`;
  }

  private category(game: Pub, id: string): string {
    return game.players.find((p) => p.id === id)?.category ?? "";
  }

  private send(action: unknown) {
    this.api.act(action);
    audio.buzz(15);
  }

  private typingNow(): boolean {
    return textEntry(document.activeElement);
  }

  private buzz() {
    this.buzzer.classList.add("pressed");
    this.send({ type: "buzz" });
  }

  // ---- the clocks ---------------------------------------------------------

  private renderClock() {
    const game = this.game();
    if (!game) return;
    const now = this.api.serverNow();
    if (game.phase === "finished") this.clock.textContent = "";
    else this.clock.textContent = now >= game.endsAt ? "Last duel" : `${mmss(game.endsAt - now)} left`;
    if (game.phase === "duel" || game.phase === "confirm") {
      const left = Math.max(0, game.deadline - now);
      this.overlayBar.style.transform = `scaleX(${game.phaseMs ? Math.min(1, left / game.phaseMs) : 0})`;
      const secs = this.overlayBody.querySelector(".fo-secs");
      if (secs) secs.textContent = `${Math.ceil(left / 1000)} s`;
    }
  }

  // ---- settled state ------------------------------------------------------

  private settle(props: GameViewProps) {
    this.props = props;
    const game = props.game as Pub;
    const me = props.private as Priv | null;
    this.root.dataset.phase = game.phase;
    this.target.textContent = `First to ${game.target}`;
    this.renderMine(props, game);
    this.renderStatus(props, game);
    this.renderTable(props, game);
    this.renderDuel(props, game, me);
    this.renderClock();
  }

  private renderMine(props: GameViewProps, game: Pub) {
    const mine = game.players.find((p) => p.id === props.playerId && !p.removed);
    this.mine.hidden = !mine || game.phase === "finished";
    if (!mine) return;
    replaceChildren(
      this.mine,
      h("span", { class: "fo-kicker" }, "Your card"),
      h("strong", { class: "fo-category" }, mine.category),
      h("span", { class: "fo-score" }, `${mine.score} ${mine.score === 1 ? "point" : "points"}`),
    );
  }

  private outcomeText(o: Outcome, props: GameViewProps): [string, string] {
    switch (o.kind) {
      case "point":
        return [`${this.name(o.winnerId, props)} +1`, `${this.does(o.loserId!, "get", props)} a new card.${o.confirm ? ` Votes: ${o.confirm} yes, ${o.overturn} no.` : ""}`];
      case "overturned":
        return [`Rejected. ${this.name(o.winnerId, props)} +1`, `Votes: ${o.overturn} no, ${o.confirm} yes. ${this.does(o.loserId!, "get", props)} a new card.`];
      case "void":
        return ["Nobody buzzed", `${this.name(o.a, props)} and ${this.lower(o.b, props)} get new cards.`];
      case "left":
        return ["Duel cancelled", "A player in the duel left. Nobody scores."];
      case "dropped":
        return ["Duel cancelled", "A player in the duel lost connection. Nobody scores."];
    }
  }

  private renderStatus(props: GameViewProps, game: Pub) {
    let headline = "";
    let sub = "";
    if (game.phase === "finished") {
      const here = game.players.filter((p) => !p.removed);
      const top = Math.max(0, ...here.map((p) => p.score));
      const winners = top > 0 ? here.filter((p) => p.score === top).map((p) => this.name(p.id, props)) : [];
      const names = winners.length > 1 ? `${winners.slice(0, -1).join(", ")} and ${winners.at(-1)}` : (winners[0] ?? "");
      const win = winners.length === 1 && winners[0] !== "You" ? "wins" : "win";
      if (game.endReason === "target") headline = `${names} ${win}, first to ${game.target}`;
      else if (!winners.length) headline = game.endReason === "time" ? "Time is up. Nobody scored." : "Not enough players are left.";
      else headline = `${game.endReason === "time" ? "Time is up." : "Not enough players are left."} ${names} ${win} with ${top}.`;
    } else if (game.queued) {
      headline = `Redo: ${this.name(game.queued[0], props)} and ${this.lower(game.queued[1], props)} again`;
      sub = "Get ready.";
    } else if (game.last && game.phase === "lull") {
      [headline, sub] = this.outcomeText(game.last, props);
    } else {
      headline = "Wait for the next duel";
      sub = "The game can choose any 2 players at any time. Read your card.";
    }
    if (game.reshuffled && game.phase === "lull" && !sub) sub = "The game used all the cards. Now old cards can come again.";
    this.headline.textContent = headline;
    this.sub.textContent = sub;
  }

  private renderTable(props: GameViewProps, game: Pub) {
    const d = game.duel;
    const ranked = [...game.players].filter((p) => !p.removed).sort((a, b) => b.score - a.score);
    const lead = ranked[0]?.score ?? 0;
    replaceChildren(
      this.table,
      game.players
        .filter((p) => !p.removed)
        .map((p) => {
          const seat = props.room.seats.find((s) => s.id === p.id);
          const away = seat && seat.presence !== "connected";
          const dueling = !!d && (d.a === p.id || d.b === p.id);
          return h(
            "li",
            { class: ["fo-player", away && "away", p.id === props.playerId && "me", dueling && "dueling", lead > 0 && p.score === lead && "leading"].filter(Boolean).join(" ") },
            seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
            h("span", { class: "fo-player-name" }, this.name(p.id, props)),
            h("span", { class: "fo-player-score", "aria-label": `${p.score} points` }, String(p.score)),
            h("span", { class: "fo-player-cat" }, p.category),
          );
        }),
    );
  }

  private renderDuel(props: GameViewProps, game: Pub, me: Priv | null) {
    const d = game.duel;
    const live = !!d && (game.phase === "duel" || game.phase === "confirm");
    this.overlay.hidden = !live;
    this.root.classList.toggle("dueling", live);
    if (!live || !d) return;
    const mine = d.a === props.playerId || d.b === props.playerId;
    const confirm = game.phase === "confirm";
    const kicker = h("p", { class: "fo-duel-kicker" }, d.redone ? "Face-off, redo" : "Face-off", " ", h("span", { class: "fo-secs" }));
    const parts: (Node | null)[] = [kicker];
    const tail: (Node | null)[] = [];
    const fresh = game.duels !== this.focusedDuel;
    if (fresh) this.buzzer.classList.remove("pressed");

    if (mine) {
      const opp = d.a === props.playerId ? d.b : d.a;
      parts.push(
        h("p", { class: "fo-say-kicker" }, "Say out loud"),
        h("strong", { class: "fo-say" }, this.category(game, opp)),
        h("p", { class: "fo-say-from" }, "From ", h("strong", {}, `${seatName(props.room, opp)}'s card`)),
        h("p", { class: "fo-say-back" }, `${seatName(props.room, opp)} says one for `, h("strong", {}, this.category(game, props.playerId)), " (your card)"),
      );
    } else {
      parts.push(
        h(
          "div",
          { class: "fo-pairs" },
          [
            [d.a, d.b],
            [d.b, d.a],
          ].map(([who, whose]) =>
            h(
              "div",
              { class: ["fo-pair", d.claimId === who && "claimed"].filter(Boolean).join(" ") },
              h("span", { class: "fo-pair-who" }, `${this.name(who, props)} says one for `, h("strong", {}, `${seatName(props.room, whose)}'s card`)),
              h("strong", { class: "fo-pair-cat" }, this.category(game, whose!)),
            ),
          ),
        ),
      );
    }

    const canBuzz = !confirm && !!me?.canBuzz;
    this.buzzer.hidden = !canBuzz;
    if (!confirm) {
      tail.push(h("p", { class: "fo-note" }, canBuzz ? "Said it? Press Buzz, Enter or Space." : "Listen. The first player to answer and buzz gets the point."));
    } else {
      const claim = d.claimId!;
      const other = claim === d.a ? d.b : d.a;
      tail.push(h("p", { class: "fo-claim" }, `${this.name(claim, props)} buzzed first`));
      if (me?.canVote) {
        const choice = (c: Choice, label: string, kind: string) =>
          h(
            "button",
            { type: "button", class: `fo-vote ${kind}`, "aria-pressed": me.myVote === c ? "true" : "false", onclick: () => this.send({ type: "vote", choice: c }) },
            label,
          );
        tail.push(
          h("div", { class: "fo-votes" }, choice("confirm", `Accept: ${seatName(props.room, claim)}`, "primary"), choice("overturn", `Reject: ${seatName(props.room, other)}`, "danger")),
          h("p", { class: "fo-note" }, `Did ${seatName(props.room, claim)} say a right answer first? ${d.voted} of ${d.voters} voted.`),
        );
      } else {
        tail.push(h("p", { class: "fo-note" }, d.voters ? `The others are voting: ${d.voted} of ${d.voters} voted.` : "The others are voting."));
      }
    }
    if (me?.canRedo) tail.push(h("button", { type: "button", class: "fo-redo", onclick: () => this.send({ type: "redo" }) }, "Redo (no score)"));
    replaceChildren(this.duelHead, parts);
    replaceChildren(this.duelTail, tail);
    // Space and Enter go to whatever has focus: make that the buzzer, once,
    // as the duel opens, unless the player is typing somewhere. Later updates
    // leave focus alone: a reaction or the chat toggle is somewhere they went.
    if (fresh) {
      this.focusedDuel = game.duels;
      if (canBuzz && !this.typingNow()) this.buzzer.focus({ preventScroll: true });
    }
    this.overlay.classList.toggle("mine", mine);
    this.overlay.classList.toggle("confirm", confirm);
  }

  // ---- what just happened -------------------------------------------------

  private sounds(events: FaceOffEvent[], props: GameViewProps) {
    for (const e of events) {
      switch (e.type) {
        case "spark":
          if (e.a === props.playerId || e.b === props.playerId) {
            audio.play("your-turn");
            audio.buzz([60, 40, 60]);
          } else {
            audio.play("nudge");
          }
          break;
        case "buzzed":
          audio.play("boom");
          audio.buzz(40);
          break;
        case "redo":
          audio.play("shuffle");
          break;
        case "outcome":
          if (e.outcome.kind === "void") audio.play("pass");
          else if (e.outcome.kind === "left" || e.outcome.kind === "dropped") audio.play("nudge");
          else audio.play(e.outcome.winnerId === props.playerId ? "correct" : "card-place");
          break;
        case "game-over": {
          const game = props.game as Pub;
          const here = game.players.filter((p) => !p.removed);
          const top = Math.max(0, ...here.map((p) => p.score));
          const won = top > 0 && here.some((p) => p.id === props.playerId && p.score === top);
          audio.play(won ? "win" : "game-over");
          break;
        }
        default:
          break;
      }
    }
  }

  private act(events: FaceOffEvent[]) {
    for (const e of events) {
      if (e.type === "spark") replay(this.overlay, "fo-in");
      if (e.type === "buzzed") replay(this.overlayBody, "fo-flash");
      if (e.type === "outcome" && e.outcome.winnerId) void bubble(this.headline, "+1", "anim-bubble fo-bubble", 900);
    }
  }
}
