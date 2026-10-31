import { AnimationQueue, bubble, fly, once } from "@games/animation";
import { audio } from "@games/audio";
import type { Presence } from "@games/protocol";
import { avatar, DIE_NAMES, dieSvg, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import { deadDice, diceToRoll, formatPoints, scoreDice } from "../shared/rules.ts";
import type { FarkleEvent, FarklePublicState, KeptGroup } from "../shared/types.ts";

const PRESENCE_LABEL: Record<Presence, string> = {
  connected: "",
  reconnecting: "reconnecting…",
  disconnected: "disconnected",
  left: "left",
};

/** How long the dice tumble before they land, and the stagger between them. */
const TUMBLE_MS = 520;
const TUMBLE_STAGGER = 55;
/** How fast a tumbling die flicks between faces. */
const FLICK_MS = 75;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pts = formatPoints;

/** "That 3 doesn't score", "Those 2s don't score", "The 3 and 4 don't score". */
function deadText(faces: number[]): string {
  const unique = [...new Set(faces)].sort();
  if (faces.length === 1) return `That ${faces[0]} doesn't score`;
  if (unique.length === 1) return `Those ${unique[0]}s don't score`;
  return `The ${unique.slice(0, -1).join(", ")} and ${unique.at(-1)} don't score`;
}

const facesText = (dice: number[]) => dice.join(" ");

function describe(e: FarkleEvent, props: GameViewProps): string | null {
  const me = props.playerId;
  const who = (id: string | null) => (id === me ? "You" : seatName(props.room, id));
  switch (e.type) {
    case "rolled":
      return e.hot ? `Hot dice! ${who(e.playerId)} rolled all 6 dice again: ${facesText(e.dice)}.` : null;
    case "kept":
      return `${who(e.playerId)} kept ${facesText(e.dice)} for ${pts(e.points)}.`;
    case "banked":
      return `${who(e.playerId)} banked ${pts(e.points)}. ${e.playerId === me ? "You have" : `${who(e.playerId)} has`} ${pts(e.score)} now.`;
    case "farkle": {
      const lost = e.lost ? ` ${pts(e.lost)} gone.` : "";
      const pen = e.penalty ? ` That is 3 in a row: −${pts(e.penalty)}.` : "";
      return `Farkle! ${who(e.playerId)} rolled ${facesText(e.dice)}.${lost}${pen}`;
    }
    case "final-round":
      return `${who(e.playerId)} reached ${pts(e.score)}. Last round. Every other player gets 1 more turn.`;
    case "turn-skipped":
      return `The host skipped ${who(e.playerId)}. The game kept the best dice.`;
    case "player-removed":
      return `${who(e.playerId)} left the game.`;
    case "game-over":
      if (e.reason === "abandoned") return "Everyone else left.";
      if (e.winnerIds.includes(me)) return e.winnerIds.length > 1 ? "You tied for first. You share the win!" : "You have the highest score. You win!";
      return e.winnerIds.length > 1 ? "Players tied for first." : `${who(e.winnerIds[0] ?? null)} wins.`;
  }
}

/**
 * Which sounds a render makes. "all": nothing was acted out, so the events'
 * sounds play here. "cues": the animations made those, only the turn chime
 * and the ending are left. "none": a redraw mid-show, or of the same state.
 */
type Sounds = "all" | "cues" | "none";

interface Stream {
  roll: number;
  picked: number[];
}

export class FarkleView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "farkle" });
  private status = h("div", { class: "fk-status", role: "status", "aria-live": "polite" });
  private boardHead = h("div", { class: "fk-board-head" });
  private final = h("p", { class: "fk-final" });
  private scores = h("ul", { class: "fk-scores", "aria-label": "Scores" });
  private total = h("span", { class: "fk-total" });
  private hotTag = h("span", { class: "fk-hot" }, "Hot dice!");
  private kept = h("div", { class: "fk-kept", role: "list", "aria-label": "Dice kept this turn" });
  private roll = h("div", { class: "fk-roll", role: "group", "aria-label": "This roll" });
  private stamp = h("span", { class: "fk-stamp", "aria-hidden": "true" }, "Farkle!");
  private pick = h("p", { class: "fk-pick", "aria-live": "polite" });
  private log = h("p", { class: "fk-log", "aria-live": "polite" });
  private actions = h("div", { class: "fk-actions" });
  private note = h("p", { class: "fk-note" });

  private dice: HTMLButtonElement[] = [];
  /** My picks, by index into the current roll. */
  private selected: number[] = [];
  /** The roller's picks, as streamed to everyone else. */
  private watched: number[] = [];
  /** Which roll the picks belong to. */
  private pickRoll = -1;
  /** Sent and not yet answered: the dice and buttons stay locked meanwhile. */
  private pending = new Set<string>();

  /** Events act out first, settled state lands after. */
  private queue = new AnimationQueue();
  private wasMyTurn = false;
  /** Mid-show: the dice on screen aren't settled yet, so taps wait. */
  private busy = false;

  constructor(api: GameClientApi) {
    this.api = api;
    this.root.append(
      this.status,
      h("section", { class: "fk-board", "aria-label": "Scoreboard" }, this.boardHead, this.final, this.scores),
      h(
        "section",
        { class: "fk-table", "aria-label": "Table" },
        h("div", { class: "fk-turn-line" }, h("span", { class: "fk-label" }, "This turn"), this.total, this.hotTag),
        this.kept,
        h("div", { class: "fk-roll-wrap" }, this.roll, this.stamp),
        this.pick,
      ),
      this.log,
      h("div", { class: "fk-dock" }, this.note, this.actions),
    );
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    this.queue.clear();
    this.root.remove();
  }

  whenIdle() {
    return this.queue.idle();
  }

  rejected(clientActionId: string, message: string) {
    if (this.pending.delete(clientActionId)) {
      this.roll.classList.remove("shake");
      void this.roll.offsetWidth; // restart the animation
      this.roll.classList.add("shake");
    }
    this.rerender();
    this.log.textContent = message;
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    const events = props.events as FarkleEvent[];
    this.pending.clear();
    // Reconnects, and joining mid-game: show it as it is, no replaying history.
    // A brand-new view for the opening roll is the exception: that's the show.
    const opening = !this.props && events.some((e) => e.type === "rolled");
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

  /** The roller's picks, live. Anyone else's, or for an old roll, are ignored. */
  stream(from: string, data: unknown) {
    const game = this.props?.game as FarklePublicState | undefined;
    const d = data as Stream | null;
    if (!game || from !== game.currentPlayerId || !d || d.roll !== game.rollNumber || !Array.isArray(d.picked)) return;
    this.pickRoll = d.roll;
    this.watched = d.picked.filter((i) => Number.isInteger(i) && i >= 0 && i < game.roll.length);
    this.rerender();
  }

  private myTurn(game: FarklePublicState, me: string): boolean {
    return game.step === "rolled" && game.currentPlayerId === me;
  }

  private render(props: GameViewProps, sounds: Sounds) {
    this.props = props;
    const game = props.game as FarklePublicState;
    const myTurn = this.myTurn(game, props.playerId);
    if (game.rollNumber !== this.pickRoll) {
      this.pickRoll = game.rollNumber;
      this.selected = [];
      this.watched = [];
    }
    if (!myTurn) this.selected = [];
    const finished = game.step === "finished";
    this.root.classList.toggle("my-turn", myTurn);
    this.root.classList.toggle("bust", game.step === "bust");
    this.root.classList.toggle("finished", finished);

    this.renderStatus(props, game, myTurn);
    this.renderBoard(props, game);
    this.renderTable(props, game, myTurn);
    this.renderDock(props, game, myTurn);

    const events = props.events as FarkleEvent[];
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

  // ---- animation ------------------------------------------------------------

  /** Acts out one update's events, in order, against the still-old DOM. */
  private async act(events: FarkleEvent[], props: GameViewProps) {
    // Nothing to press while the show's on: the buttons belong to the old state.
    this.busy = true;
    try {
      await this.actEach(events, props);
    } finally {
      this.busy = false;
    }
  }

  private async actEach(events: FarkleEvent[], props: GameViewProps) {
    for (const e of events) {
      replaceChildren(this.actions);
      this.note.textContent = "";
      switch (e.type) {
        case "kept":
          await this.flyKept(e);
          break;
        case "banked":
          await this.showBank(e, props);
          break;
        case "final-round":
          audio.play("nudge");
          audio.buzz([30, 50, 30]);
          await bubble(this.anchorFor(e.playerId), "Last round!", "anim-bubble fk-callout", 1100);
          break;
        case "rolled": {
          // The table repaints for the new roll; the dice tumble in on top of it.
          this.render(props, "none");
          const bust = events.some((x) => x.type === "farkle");
          this.stamp.hidden = true;
          this.total.classList.remove("struck");
          this.root.classList.remove("bust");
          if (bust) this.pick.textContent = "";
          await this.tumble(e.playerId === props.playerId);
          if (e.hot) {
            once(this.hotTag, "pop");
            audio.play("correct");
          }
          break;
        }
        case "farkle":
          await this.showFarkle(e, props);
          break;
        case "turn-skipped":
          audio.play("pass");
          await bubble(this.anchorFor(e.playerId), "Skipped");
          break;
        default:
          break;
      }
    }
  }

  private eventSounds(events: FarkleEvent[], props: GameViewProps) {
    const types = new Set(events.map((e) => e.type));
    if (types.has("rolled")) audio.play("shuffle");
    if (types.has("kept")) audio.play("card-place");
    if (types.has("banked")) audio.play("correct");
    if (types.has("final-round")) audio.play("nudge");
    if (types.has("turn-skipped")) audio.play("pass");
    const bust = events.find((e) => e.type === "farkle");
    if (bust?.type === "farkle") {
      audio.play("reject");
      if (bust.playerId === props.playerId) audio.buzz([60, 40, 90]);
    }
  }

  /** A player's chip on the scoreboard. */
  private anchorFor(playerId: string): Element {
    return this.scores.querySelector(`[data-player="${CSS.escape(playerId)}"] .avatar`) ?? this.status;
  }

  /** The kept dice leave the roll and land in a new group on the set-aside shelf. */
  private async flyKept(e: Extract<FarkleEvent, { type: "kept" }>) {
    const sources = e.indices.map((i) => this.dice[i]).filter((d): d is HTMLButtonElement => !!d);
    const group = this.groupEl({ dice: e.dice, points: e.points }, true);
    const spots = [...group.querySelectorAll<HTMLElement>(".fk-mini")];
    for (const s of spots) s.style.visibility = "hidden";
    this.kept.querySelector(".fk-empty")?.remove();
    this.kept.append(group);
    await Promise.all(
      spots.map(async (spot, i) => {
        const src = sources[i];
        if (!src) {
          spot.style.visibility = "";
          return;
        }
        const from = src.getBoundingClientRect();
        src.style.visibility = "hidden";
        await wait(i * 50);
        const ghost = h("span", { class: "fk-ghost" });
        ghost.innerHTML = dieSvg(e.dice[i]!);
        await fly(ghost, from, spot.getBoundingClientRect(), 300, { handoff: true });
        spot.style.visibility = "";
        once(spot, "landed");
        if (i % 2 === 0) audio.play("card-place");
      }),
    );
    this.total.textContent = pts(e.turnTotal);
    once(this.total, "pop");
  }

  /** The turn total goes up to the player's chip. */
  private async showBank(e: Extract<FarkleEvent, { type: "banked" }>, props: GameViewProps) {
    audio.play("correct");
    if (e.playerId === props.playerId) audio.buzz(30);
    const chip = this.scores.querySelector<HTMLElement>(`[data-player="${CSS.escape(e.playerId)}"]`);
    const score = chip?.querySelector<HTMLElement>(".fk-score");
    void bubble(this.anchorFor(e.playerId), `+${pts(e.points)}`, "anim-bubble fk-gain", 1000);
    await wait(250);
    if (score) {
      score.textContent = pts(e.score);
      score.classList.remove("off");
      once(score, "pop");
    }
    await wait(450);
  }

  /** The dead roll, stamped. The turn total gets struck out. */
  private async showFarkle(e: Extract<FarkleEvent, { type: "farkle" }>, props: GameViewProps) {
    this.root.classList.add("bust");
    this.stamp.hidden = false;
    once(this.stamp, "stamp");
    this.total.classList.add("struck");
    this.pick.textContent = describe(e, props) ?? "";
    audio.play("reject");
    if (e.playerId === props.playerId) audio.buzz([60, 40, 90]);
    if (e.penalty) void bubble(this.anchorFor(e.playerId), `−${pts(e.penalty)}`, "anim-bubble fk-loss", 1100);
    await wait(900);
  }

  /** The new roll rattles through random faces, then each die lands on its real one. */
  private async tumble(mine: boolean) {
    const game = this.props?.game as FarklePublicState | undefined;
    if (!game) return;
    audio.play("shuffle");
    await Promise.all(
      this.dice.map(async (die, i) => {
        const face = game.roll[i]!;
        die.classList.add("tumbling");
        const flick = setInterval(() => (die.innerHTML = dieSvg(1 + Math.floor(Math.random() * 6))), FLICK_MS);
        await wait(TUMBLE_MS + i * TUMBLE_STAGGER);
        clearInterval(flick);
        die.innerHTML = dieSvg(face);
        die.classList.remove("tumbling");
        once(die, "landed");
        if (i % 2 === 1 || i === this.dice.length - 1) audio.play("card-place");
      }),
    );
    if (mine) audio.buzz(15);
  }

  // ---- regions ----------------------------------------------------------------

  private renderStatus(props: GameViewProps, game: FarklePublicState, myTurn: boolean) {
    // Once finished, the room's results panel announces the winner.
    this.status.hidden = game.step === "finished";
    if (this.status.hidden) return;
    const seat = props.room.seats.find((s) => s.id === game.currentPlayerId);
    const name = seat?.name ?? "Someone";
    const away = seat && seat.presence !== "connected" ? ` (${PRESENCE_LABEL[seat.presence]})` : "";
    const lastTurn = !!game.finalRound;
    const leader = this.leader(game);
    const beat = lastTurn && leader && leader.id !== game.currentPlayerId ? `: beat ${pts(leader.score)}` : "";
    let text: string;
    if (game.step === "bust") {
      const lost = game.lastTurn?.kind === "farkle" ? game.lastTurn.points : 0;
      text = myTurn || game.currentPlayerId === props.playerId
        ? `Farkle!${lost ? ` ${pts(lost)} gone` : ""}`
        : `Farkle! ${name} ${lost ? `loses ${pts(lost)}` : "scores nothing"}`;
    } else if (myTurn) {
      text = game.hot ? "Hot dice! Roll again or bank" : lastTurn ? `Your last turn${beat}` : "Your turn. Keep at least 1 scoring die.";
    } else {
      text = `${name}${away} ${lastTurn ? `is playing a last turn${beat}` : "is rolling"}`;
    }
    replaceChildren(
      this.status,
      !myTurn && game.currentPlayerId !== props.playerId && seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
      h("span", {}, text),
    );
  }

  private leader(game: FarklePublicState) {
    const live = game.players.filter((p) => !p.removed);
    return live.reduce<(typeof live)[number] | null>((a, p) => (!a || p.score > a.score ? p : a), null);
  }

  private renderBoard(props: GameViewProps, game: FarklePublicState) {
    const { target, entry, threeFarkles } = game.settings;
    replaceChildren(
      this.boardHead,
      h("span", {}, h("b", {}, `First to ${pts(target)}`)),
      entry ? h("span", { class: "fk-muted" }, `${pts(entry)} to start scoring`) : null,
      threeFarkles ? h("span", { class: "fk-muted" }, "3 farkles −500") : null,
    );

    const fr = game.finalRound;
    this.final.hidden = !fr || game.step === "finished";
    if (fr && !this.final.hidden) {
      const name = (id: string) => (id === props.playerId ? "you" : seatName(props.room, id));
      const owed = fr.owed.map(name);
      const trigger = game.players.find((p) => p.id === fr.triggerId);
      const triggerName = fr.triggerId === props.playerId ? "You" : seatName(props.room, fr.triggerId);
      replaceChildren(
        this.final,
        h("b", {}, "Last round. "),
        `${triggerName} hit ${pts(trigger?.score ?? target)}. `,
        owed.length ? `Still to play: ${owed.join(", ")}.` : "",
      );
    }

    const winners = new Set(game.winnerIds);
    replaceChildren(
      this.scores,
      game.players.map((p) => {
        const seat = props.room.seats.find((s) => s.id === p.id);
        const name = seat?.name ?? "?";
        const away = seat && seat.presence !== "connected" && !p.removed;
        const current = p.id === game.currentPlayerId;
        const done = !!fr && p.id !== fr.triggerId && !fr.owed.includes(p.id);
        const cls = [
          "fk-chip",
          current && "current",
          p.id === props.playerId && "me",
          winners.has(p.id) && "winner",
          (away || p.removed) && "away",
          done && "done",
        ].filter(Boolean).join(" ");
        const off = !p.onBoard && entry > 0;
        const fill = Math.min(1, p.score / target);
        const label = [
          name,
          p.removed ? "left" : off ? "no score yet" : `${pts(p.score)} points`,
          current && !p.removed ? "rolling now" : "",
          fr?.triggerId === p.id ? "started the final round" : "",
          threeFarkles && p.farkles ? `${p.farkles} farkle${p.farkles > 1 ? "s" : ""} in a row` : "",
          away ? PRESENCE_LABEL[seat!.presence] : "",
        ].filter(Boolean).join(", ");
        return h(
          "li",
          { class: cls, "data-player": p.id, "aria-label": label, "aria-current": current ? "true" : null },
          seat ? avatar(name, seat.avatarSeed, "sm") : null,
          h(
            "span",
            { class: "fk-chip-text", "aria-hidden": "true" },
            h("span", { class: "fk-name" }, name),
            h(
              "span",
              { class: "fk-chip-line" },
              h("span", { class: `fk-score${off ? " off" : ""}` }, p.removed ? "left" : off ? "—" : pts(p.score)),
              threeFarkles && p.farkles ? h("span", { class: "fk-strikes" }, "✕".repeat(p.farkles)) : null,
              fr?.triggerId === p.id ? h("span", { class: "fk-flag" }, "★") : null,
            ),
          ),
          h("span", { class: "fk-bar", "aria-hidden": "true" }, h("span", { style: `transform: scaleX(${fill})` })),
        );
      }),
    );
  }

  private groupEl(g: KeptGroup, fresh = false): HTMLElement {
    const el = h(
      "div",
      { class: "fk-group", role: "listitem", "aria-label": `${g.dice.map((d) => DIE_NAMES[d]).join(", ")}: ${pts(g.points)}` },
      h(
        "span",
        { class: "fk-group-dice", "aria-hidden": "true" },
        g.dice.map((d) => {
          const s = h("span", { class: "fk-mini" });
          s.innerHTML = dieSvg(d);
          return s;
        }),
      ),
      h("span", { class: "fk-group-pts", "aria-hidden": "true" }, `+${pts(g.points)}`),
    );
    if (fresh) el.dataset.fresh = "1";
    return el;
  }

  private renderTable(props: GameViewProps, game: FarklePublicState, myTurn: boolean) {
    const finished = game.step === "finished";
    const bust = game.step === "bust";

    // Turn total, struck out on a bust.
    const lost = bust && game.lastTurn?.kind === "farkle" ? game.lastTurn.points : 0;
    this.total.textContent = pts(bust ? lost : game.turnTotal);
    this.total.classList.toggle("struck", bust);
    this.hotTag.hidden = !game.hot || bust || finished;

    // Set aside, by the roll each group came from.
    const keyOf = (gs: KeptGroup[]) => gs.map((g) => g.dice.join("")).join("|");
    const key = `${game.currentPlayerId}:${keyOf(game.kept)}`;
    if (this.kept.dataset.key !== key || this.kept.querySelector("[data-fresh]")) {
      replaceChildren(
        this.kept,
        game.kept.length ? game.kept.map((g) => this.groupEl(g)) : h("span", { class: "fk-empty" }, finished ? "" : "No dice kept yet"),
      );
      this.kept.dataset.key = key;
    }

    // The roll: rebuilt for each new one, restyled otherwise.
    const rollKey = String(game.rollNumber);
    if (this.roll.dataset.key !== rollKey || this.dice.length !== game.roll.length) {
      this.dice = game.roll.map((face, i) => {
        const btn = h("button", { type: "button", class: "fk-die", "data-i": i });
        btn.innerHTML = dieSvg(face);
        btn.addEventListener("click", () => this.onDieTap(i));
        return btn;
      });
      replaceChildren(this.roll, this.dice);
      this.roll.dataset.key = rollKey;
    }
    const picks = myTurn ? this.selected : bust ? [] : this.watched;
    const faces = picks.map((i) => game.roll[i]!);
    const dead = new Set(deadDice(faces).map((j) => picks[j]!));
    this.dice.forEach((btn, i) => {
      const face = game.roll[i]!;
      const picked = picks.includes(i);
      btn.style.visibility = "";
      btn.classList.toggle("picked", picked);
      btn.classList.toggle("dead", dead.has(i));
      btn.classList.toggle("live", myTurn && !this.pending.size);
      btn.setAttribute("aria-pressed", String(picked));
      btn.setAttribute("aria-disabled", String(!myTurn || this.pending.size > 0));
      btn.setAttribute("aria-label", `${DIE_NAMES[face]}${dead.has(i) ? ", doesn't score" : ""}`);
    });
    this.roll.setAttribute("aria-label", finished ? "No roll" : `This roll: ${game.roll.map((f) => DIE_NAMES[f]).join(", ")}${bust ? ". No dice score" : ""}`);
    this.stamp.hidden = !bust;

    // What the selection's worth.
    const name = game.currentPlayerId === props.playerId ? "You" : seatName(props.room, game.currentPlayerId);
    const score = scoreDice(faces);
    let line = "";
    if (finished) line = "";
    else if (bust) line = `No dice score.${lost ? ` ${pts(lost)} lost.` : ""}`;
    else if (!picks.length) line = myTurn ? "Tap the dice you want to keep" : `${name} is picking dice…`;
    else if (dead.size) line = deadText([...dead].map((i) => game.roll[i]!));
    else {
      const all = picks.length === game.roll.length;
      const keeping = myTurn ? `Keeping ${pts(score)}` : `${name} is keeping ${pts(score)}`;
      line = `${keeping} · turn ${pts(game.turnTotal + score)}${all ? " · hot dice!" : ""}`;
    }
    this.pick.textContent = line;
    this.pick.classList.toggle("bad", dead.size > 0 || bust);
  }

  private renderDock(props: GameViewProps, game: FarklePublicState, myTurn: boolean) {
    const hint = (text: string, strong = false) => h("span", { class: `hint${strong ? " strong" : ""}` }, text);
    this.note.textContent = "";
    if (game.step === "finished") {
      replaceChildren(this.actions);
      return;
    }
    if (this.pending.size) {
      replaceChildren(this.actions, hint("…"));
      return;
    }
    if (!myTurn) {
      const name = seatName(props.room, game.currentPlayerId);
      const mine = game.currentPlayerId === props.playerId;
      const seated = game.players.some((p) => p.id === props.playerId && !p.removed);
      replaceChildren(
        this.actions,
        hint(game.step === "bust" ? (mine ? "No score. Passing the dice…" : `${name} farkled`) : seated ? `${name}'s turn` : `Watching ${name}`),
      );
      return;
    }

    const faces = this.selected.map((i) => game.roll[i]!);
    const score = scoreDice(faces);
    const legal = score > 0;
    const me = game.players.find((p) => p.id === props.playerId);
    const bankTotal = game.turnTotal + score;
    const tooLow = !!me && !me.onBoard && bankTotal < game.settings.entry;
    const n = legal ? diceToRoll(game.roll.length, faces.length) : game.roll.length - faces.length;
    const rollLabel = legal ? `Keep & roll ${n}` : "Keep & roll";
    const bankLabel = legal ? `Keep & bank ${pts(bankTotal)}` : "Keep & bank";
    replaceChildren(
      this.actions,
      h("button", { type: "button", class: "fk-roll-btn", disabled: !legal, onclick: () => this.send("keep-and-roll") }, rollLabel),
      h("button", { type: "button", class: "primary fk-bank-btn", disabled: !legal || tooLow, onclick: () => this.send("keep-and-bank") }, bankLabel),
    );
    if (legal && tooLow) this.note.textContent = `You need ${pts(game.settings.entry)} to start scoring. Keep rolling.`;
  }

  // ---- interaction --------------------------------------------------------------

  private onDieTap(i: number) {
    const props = this.props;
    const game = props?.game as FarklePublicState | undefined;
    if (this.busy) return;
    if (!props || !game || !this.myTurn(game, props.playerId) || this.pending.size) {
      if (game?.step !== "finished") this.log.textContent = game?.step === "bust" ? "That roll is a farkle." : "Wait for your turn.";
      return;
    }
    const at = this.selected.indexOf(i);
    if (at >= 0) this.selected.splice(at, 1);
    else this.selected.push(i);
    this.selected.sort((a, b) => a - b);
    this.api.stream({ roll: game.rollNumber, picked: this.selected } satisfies Stream);
    this.rerender();
  }

  private send(type: "keep-and-roll" | "keep-and-bank") {
    if (this.busy || !this.selected.length) return;
    this.pending.add(this.api.act({ type, keep: [...this.selected] }));
    this.rerender();
  }
}
