import { AnimationQueue } from "@games/animation";
import { audio } from "@games/audio";
import { avatar, h, replaceChildren, seatName, type GameClientApi, type GameView, type GameViewProps } from "@games/ui";
import {
  MAX_ANSWER,
  type PublicGroup,
  type SamePageEvent,
  type SamePagePrivateState,
  type SamePagePublicState,
} from "../shared/types.ts";

type Pub = SamePagePublicState;
type Priv = SamePagePrivateState;

/** The answer clock's last seconds tick, for anyone still without an answer. */
const TICK_FROM = 5;
/** Typed but never sent: it goes in by itself this close to the end. */
const AUTO_SEND_MS = 1200;
/** The reveal's groups pop in one after another. */
const POP_STEP_MS = 110;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function replay(el: Element, cls: string) {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

/** "Ana", "Ana and Bo", "Ana, Bo and Cy". */
function list(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

/** A mouse and a real keyboard: focusing the box costs nothing. On a phone it'd throw a keyboard over the page. */
const finePointer = () => typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches;

export class SamePageView implements GameView {
  private api: GameClientApi;
  private props: GameViewProps | null = null;

  private root = h("div", { class: "sp" });
  private roundLabel = h("span", { class: "sp-round" });
  private secs = h("span", { class: "sp-secs", role: "timer", "aria-live": "off" });
  private bar = h("div", { class: "sp-bar", "aria-hidden": "true" }, h("span"));
  private prompt = h("p", { class: "sp-prompt", id: "sp-prompt" });
  private status = h("p", { class: "sp-status", role: "status", "aria-live": "polite" });

  // Answering. The box lives for the whole game, so focus and half-typed
  // text survive every update.
  private input = h("input", {
    class: "sp-input",
    id: "sp-input",
    type: "text",
    maxlength: MAX_ANSWER,
    autocomplete: "off",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
    enterkeyhint: "done",
    placeholder: "Your answer",
    "aria-describedby": "sp-prompt",
  });
  private send = h("button", { type: "submit", class: "primary sp-send" }, "Send");
  private form = h(
    "form",
    { class: "sp-form" },
    h("label", { class: "sp-sr", for: "sp-input" }, "Your answer"),
    this.input,
    this.send,
  );
  private locked = h("button", { type: "button", class: "sp-locked", onclick: () => this.edit() });
  private count = h("p", { class: "sp-count" });
  private answer = h("section", { class: "sp-answer", "aria-label": "Your answer" }, this.form, this.locked, this.count);
  private ticks = h("ul", { class: "sp-ticks", "aria-label": "Who's answered" });

  // Tidying and reveal.
  private groups = h("ul", { class: "sp-groups", "aria-label": "Answers" });
  private blanks = h("p", { class: "sp-blanks" });
  private actions = h("div", { class: "sp-actions" });
  private board = h("ol", { class: "sp-board", "aria-label": "Scores" });

  private queue = new AnimationQueue();
  private ticker: ReturnType<typeof setInterval>;

  /** The round the answer box was last reset for. */
  private boxRound = -1;
  /** Showing the box rather than the locked-in answer. */
  private editing = true;
  /** Sent and not yet confirmed: shown as locked in meanwhile. */
  private pending: string | null = null;
  private autoSent = false;
  private lastTick = -1;
  /** The host's first tap in a merge: the group to fold into the next one tapped. */
  private pick: string | null = null;
  private readyRound = -1;

  constructor(api: GameClientApi) {
    this.api = api;
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submit();
    });
    this.root.append(
      h("div", { class: "sp-top" }, this.roundLabel, this.secs),
      this.bar,
      this.prompt,
      this.status,
      this.answer,
      this.ticks,
      this.groups,
      this.blanks,
      this.actions,
      this.board,
    );
    this.ticker = setInterval(() => this.renderClock(), 200);
  }

  mount(container: HTMLElement) {
    container.append(this.root);
  }

  destroy() {
    clearInterval(this.ticker);
    this.queue.clear();
    this.root.remove();
  }

  whenIdle() {
    return this.queue.idle();
  }

  rejected(_clientActionId: string, message: string) {
    // A refused answer goes back to the box, text intact, to fix or retry.
    if (this.pending !== null) {
      this.pending = null;
      this.editing = true;
      if (this.props) this.settle(this.props);
    }
    this.status.textContent = message;
    replay(this.status, "sp-shake");
    audio.play("reject");
    audio.buzz([30, 40, 30]);
  }

  update(props: GameViewProps) {
    const events = props.events as SamePageEvent[];
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
        await this.act(events);
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

  private name(id: string, props: GameViewProps = this.props!): string {
    return id === props.playerId ? "You" : seatName(props.room, id);
  }

  private isHost(props: GameViewProps = this.props!): boolean {
    return props.room.hostId === props.playerId;
  }

  private perform(action: unknown) {
    this.api.act(action);
    audio.buzz(15);
  }

  /** What counts as my answer right now: what I just sent, or what the server has. */
  private mine(): string | null {
    return this.pending ?? (this.props?.private as Priv | null)?.answer ?? null;
  }

  private submit() {
    const game = this.game();
    const me = this.props?.private as Priv | null;
    if (!game || game.phase !== "answering" || !me?.canAnswer) return;
    const text = this.input.value.trim().replace(/\s+/g, " ");
    const current = this.mine();
    if (!text && !current) return;
    if (text !== (current ?? "")) {
      this.pending = text || null;
      this.perform({ type: "answer", text });
    }
    this.editing = !text;
    // Down goes the keyboard, so the locked-in line is what they see.
    this.input.blur();
    this.settle(this.props!);
  }

  private edit() {
    this.editing = true;
    this.input.value = this.mine() ?? "";
    this.settle(this.props!);
    // A tap is a user gesture: on a phone this is what brings the keyboard up.
    this.input.focus();
    this.input.select();
  }

  // ---- the clock ----------------------------------------------------------

  private renderClock() {
    const game = this.game();
    if (!game) return;
    const timed = game.phase !== "over" && game.deadline > 0;
    this.bar.hidden = !timed;
    if (!timed) {
      this.secs.textContent = "";
      return;
    }
    const left = Math.max(0, game.deadline - this.api.serverNow());
    const secs = Math.ceil(left / 1000);
    (this.bar.firstElementChild as HTMLElement).style.transform = `scaleX(${Math.min(1, left / Math.max(game.phaseMs, 1))})`;
    this.secs.textContent = `${secs} s`;
    const answering = game.phase === "answering";
    this.bar.classList.toggle("low", answering && secs <= TICK_FROM);
    if (!answering) return;
    const me = this.props?.private as Priv | null;
    if (me?.canAnswer && !this.mine() && secs > 0 && secs <= TICK_FROM && secs !== this.lastTick) {
      this.lastTick = secs;
      audio.play("tick");
    }
    // Typed something and never hit Enter: send it before the door shuts.
    const typed = this.input.value.trim();
    if (me?.canAnswer && this.editing && typed && typed !== this.mine() && left < AUTO_SEND_MS && !this.autoSent) {
      this.autoSent = true;
      this.submit();
    }
  }

  // ---- settled state ------------------------------------------------------

  private settle(props: GameViewProps) {
    this.props = props;
    const game = props.game as Pub;
    const me = props.private as Priv | null;
    if (game.round !== this.boxRound) this.newRound(game);
    // The server's word replaces a guess once it agrees.
    if (this.pending !== null && me?.answer === this.pending) this.pending = null;
    if (game.phase !== "answering") {
      this.pending = null;
      if (document.activeElement === this.input) this.input.blur();
    }
    if (game.phase !== "tidying" || !this.isHost(props)) this.pick = null;
    if (this.pick && !game.groups?.some((g) => g.id === this.pick)) this.pick = null;

    this.root.dataset.phase = game.phase;
    this.roundLabel.textContent = game.phase === "over" ? "Final scores" : `Round ${game.round} of ${game.rounds}`;
    this.prompt.textContent = game.prompt;
    this.prompt.hidden = game.phase === "over";
    this.renderAnswer(game, me);
    this.renderTicks(props, game);
    this.renderGroups(props, game);
    this.renderActions(props, game);
    this.renderBoard(props, game);
    this.renderStatus(props, game, me);
    this.renderClock();
  }

  private newRound(game: Pub) {
    this.boxRound = game.round;
    this.input.value = "";
    this.editing = true;
    this.pending = null;
    this.autoSent = false;
    this.lastTick = -1;
    this.pick = null;
    // Only where a box with focus doesn't mean half the screen gone.
    if (game.phase === "answering" && finePointer()) queueMicrotask(() => this.input.focus({ preventScroll: true }));
  }

  private renderAnswer(game: Pub, me: Priv | null) {
    const answering = game.phase === "answering" && !!me?.canAnswer;
    this.answer.hidden = game.phase !== "answering";
    const mine = this.mine();
    const showBox = answering && (this.editing || !mine);
    this.form.hidden = !showBox;
    this.input.disabled = !answering;
    this.send.disabled = !answering;
    this.send.textContent = mine ? "Change" : "Send";
    this.locked.hidden = showBox || !mine;
    if (mine) {
      replaceChildren(
        this.locked,
        h("span", { class: "sp-locked-k" }, "Your answer"),
        h("strong", { class: "sp-locked-v" }, mine),
        h("span", { class: "sp-locked-k" }, answering ? "tap to change" : ""),
      );
      this.locked.setAttribute("aria-label", `Your answer: ${mine}. Tap to change.`);
      this.locked.disabled = !answering;
    }
    const live = game.players.filter((p) => !p.removed);
    const inCount = live.filter((p) => p.answered).length;
    this.count.textContent = `${inCount} of ${live.length} in`;
  }

  private renderTicks(props: GameViewProps, game: Pub) {
    this.ticks.hidden = game.phase !== "answering";
    if (this.ticks.hidden) return;
    replaceChildren(
      this.ticks,
      game.players
        .filter((p) => !p.removed)
        .map((p) => {
          const seat = props.room.seats.find((s) => s.id === p.id);
          const away = seat && seat.presence !== "connected";
          return h(
            "li",
            { class: ["sp-tick", p.answered && "in", away && "away", p.id === props.playerId && "me"].filter(Boolean).join(" ") },
            seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
            h("span", { class: "sp-tick-name" }, this.name(p.id, props)),
            h("span", { class: "sp-tick-mark", "aria-label": p.answered ? "answered" : "thinking" }, p.answered ? "✓" : "…"),
          );
        }),
    );
  }

  private groupItem(props: GameViewProps, game: Pub, g: PublicGroup, i: number): HTMLElement {
    const reveal = game.phase === "reveal" || game.phase === "over";
    const res = game.result;
    const won = reveal && !!res?.winners.includes(g.id);
    const host = game.phase === "tidying" && this.isHost(props);
    const picked = this.pick === g.id;
    const label = g.label.toLowerCase();

    // Spans, not a list: inside the host's button only phrasing content is allowed.
    const members = h(
      "span",
      { class: "sp-members" },
      g.members.map((m) => {
        const pts = reveal ? (res?.points[m.id] ?? 0) : 0;
        return h(
          "span",
          { class: ["sp-member", m.id === props.playerId && "me"].filter(Boolean).join(" ") },
          h("span", { class: "sp-member-name" }, this.name(m.id, props)),
          m.text.toLowerCase() !== label ? h("span", { class: "sp-member-text" }, `“${m.text}”`) : null,
          pts ? h("span", { class: `sp-pts ${pts > 0 ? "up" : "down"}` }, pts > 0 ? `+${pts}` : `−${-pts}`) : null,
        );
      }),
    );
    const head = [
      h("strong", { class: "sp-label" }, g.label),
      h("span", { class: "sp-size", "aria-label": `${g.members.length} ${g.members.length === 1 ? "answer" : "answers"}` }, String(g.members.length)),
    ];
    const body = h("span", { class: "sp-group-head" }, ...head);

    const main = host
      ? h(
          "button",
          {
            type: "button",
            class: "sp-group-main",
            "aria-pressed": picked ? "true" : "false",
            onclick: () => this.tapGroup(g.id),
          },
          body,
          members,
          this.pick && !picked ? h("span", { class: "sp-into" }, "Join here") : null,
        )
      : h("div", { class: "sp-group-main" }, body, members);

    return h(
      "li",
      {
        class: ["sp-group", won && "win", picked && "picked", host && "tappable"].filter(Boolean).join(" "),
        "data-id": g.id,
        style: `--i: ${i}`,
      },
      main,
      host && g.merged
        ? h("button", { type: "button", class: "sp-split", onclick: () => this.perform({ type: "split", group: g.id }), "aria-label": `Split ${g.label}` }, "Split")
        : null,
    );
  }

  private tapGroup(id: string) {
    if (!this.pick) this.pick = id;
    else if (this.pick === id) this.pick = null;
    else {
      this.perform({ type: "merge", from: this.pick, into: id });
      this.pick = null;
    }
    this.settle(this.props!);
  }

  private renderGroups(props: GameViewProps, game: Pub) {
    const groups = game.groups;
    this.groups.hidden = !groups || game.phase === "answering";
    const res = game.result;
    const showBlanks = (game.phase === "reveal" || game.phase === "over") && !!res?.blanks.length;
    this.blanks.hidden = !showBlanks;
    if (showBlanks) this.blanks.textContent = `No answer: ${list(res!.blanks.map((id) => this.name(id, props)))}`;
    if (!groups || this.groups.hidden) return;
    replaceChildren(
      this.groups,
      groups.map((g, i) => this.groupItem(props, game, g, i)),
    );
  }

  private renderActions(props: GameViewProps, game: Pub) {
    const parts: HTMLElement[] = [];
    if (game.phase === "tidying" && this.isHost(props)) {
      if (this.pick) parts.push(h("button", { type: "button", class: "sp-cancel", onclick: () => this.tapGroup(this.pick!) }, "Cancel"));
      parts.push(h("button", { type: "button", class: "primary sp-done", onclick: () => this.perform({ type: "done" }) }, "Done. Show"));
    }
    if (game.phase === "reveal" && game.players.some((p) => p.id === props.playerId && !p.removed)) {
      const tapped = this.readyRound === game.round;
      parts.push(
        h(
          "button",
          {
            type: "button",
            class: "primary sp-ready",
            "aria-pressed": tapped ? "true" : "false",
            disabled: tapped,
            onclick: () => {
              this.readyRound = game.round;
              this.perform({ type: "ready" });
              this.settle(this.props!);
            },
          },
          tapped ? "Waiting for the others" : game.round >= game.rounds ? "Final scores" : "Next prompt",
        ),
      );
    }
    this.actions.hidden = !parts.length;
    replaceChildren(this.actions, parts);
  }

  private renderBoard(props: GameViewProps, game: Pub) {
    const live = game.players.filter((p) => !p.removed);
    const ranked = [...live].sort((a, b) => b.score - a.score);
    const top = ranked[0]?.score ?? 0;
    const reveal = game.phase === "reveal" || game.phase === "over";
    replaceChildren(
      this.board,
      ranked.map((p) => {
        const seat = props.room.seats.find((s) => s.id === p.id);
        const pts = reveal ? (game.result?.points[p.id] ?? 0) : 0;
        return h(
          "li",
          { class: ["sp-row", p.id === props.playerId && "me", top > 0 && p.score === top && "lead"].filter(Boolean).join(" ") },
          seat ? avatar(seat.name, seat.avatarSeed, "sm") : null,
          h("span", { class: "sp-row-name" }, this.name(p.id, props)),
          pts ? h("span", { class: `sp-pts ${pts > 0 ? "up" : "down"}` }, pts > 0 ? `+${pts}` : `−${-pts}`) : null,
          h("span", { class: "sp-row-score", "aria-label": `${p.score} points` }, String(p.score)),
        );
      }),
    );
  }

  private renderStatus(props: GameViewProps, game: Pub, me: Priv | null) {
    let text = "";
    const host = seatName(props.room, props.room.hostId);
    switch (game.phase) {
      case "answering": {
        const left = game.deadline - this.api.serverNow();
        const hurried = game.players.filter((p) => !p.removed).every((p) => p.answered) && left <= 5_500;
        if (!me?.canAnswer) text = "Everyone is answering.";
        else if (hurried) text = "Everyone has answered. You have a few seconds to change your answer.";
        else if (this.mine()) text = "Answer sent. You can change your answer until time is up.";
        else text = "Guess what most players will answer. Give that answer.";
        break;
      }
      case "tidying":
        if (!this.isHost(props)) text = `${host} is joining answers with the same meaning.`;
        else if (this.pick) {
          const label = game.groups?.find((g) => g.id === this.pick)?.label ?? "";
          text = `Now tap the group to join with “${label}”.`;
        } else text = "Do 2 groups mean the same thing? Tap 1 group. Then tap the other group.";
        break;
      case "reveal":
      case "over": {
        const res = game.result;
        if (game.phase === "over") {
          text = this.finalLine(props, game);
          break;
        }
        if (!res) break;
        const winners = (game.groups ?? []).filter((g) => res.winners.includes(g.id));
        if (!winners.length) text = "Nobody matched. No points.";
        else {
          const labels = list(winners.map((g) => `“${g.label}”`));
          const mineWon = winners.some((g) => g.members.some((m) => m.id === props.playerId));
          text = mineWon ? `You matched: ${labels}. +1 for you.` : `Most people said ${labels}.`;
        }
        if (res.loneId) text += ` ${res.loneId === props.playerId ? "You were" : `${seatName(props.room, res.loneId)} was`} the lone answer${res.points[res.loneId] ? ": −1" : ""}.`;
        break;
      }
    }
    this.status.textContent = text;
  }

  private finalLine(props: GameViewProps, game: Pub): string {
    if (game.endReason === "abandoned") return "Too many players left the game.";
    const live = game.players.filter((p) => !p.removed);
    const top = Math.max(0, ...live.map((p) => p.score));
    if (top === 0) return "Nobody scored. Every answer was different.";
    const winners = live.filter((p) => p.score === top).map((p) => this.name(p.id, props));
    const verb = winners.length === 1 && winners[0] !== "You" ? "wins" : "win";
    return `${list(winners)} ${verb} with ${top}.`;
  }

  // ---- what just happened -------------------------------------------------

  private sounds(events: SamePageEvent[], props: GameViewProps) {
    const game = props.game as Pub;
    for (const e of events) {
      switch (e.type) {
        case "round":
          audio.play("deal");
          break;
        case "you-answered":
          audio.play("card-place");
          break;
        case "hurry":
          audio.play("nudge");
          break;
        case "tidying":
          audio.play("shuffle");
          if (this.isHost(props)) audio.buzz([40, 30, 40]);
          break;
        case "merged":
        case "split":
          audio.play("card-place");
          break;
        case "revealed": {
          const res = game.result;
          const won = !!res && (res.points[props.playerId] ?? 0) > 0;
          audio.play(won ? "correct" : res?.loneId === props.playerId ? "reject" : "pass");
          if (won) audio.buzz(40);
          break;
        }
        case "game-over": {
          const live = game.players.filter((p) => !p.removed);
          const top = Math.max(0, ...live.map((p) => p.score));
          audio.play(top > 0 && live.some((p) => p.id === props.playerId && p.score === top) ? "win" : "game-over");
          break;
        }
        default:
          break;
      }
    }
  }

  private async act(events: SamePageEvent[]) {
    for (const e of events) {
      if (e.type === "revealed") {
        const n = this.groups.children.length;
        replay(this.groups, "sp-pop");
        await wait(Math.min(n, 8) * POP_STEP_MS + 320);
        // Off again, or every re-render after (a Ready tap) would pop the lot anew.
        this.groups.classList.remove("sp-pop");
      }
      if (e.type === "merged") {
        const el = this.groups.querySelector(`[data-id="${CSS.escape(e.into)}"]`);
        if (el) replay(el, "sp-flash");
      }
    }
  }
}
