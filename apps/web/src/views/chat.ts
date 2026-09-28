import { REACTIONS, type ChatMessage, type Reaction } from "@games/protocol";
import { avatar, h, replaceChildren } from "@games/ui";
import { icon } from "../brand.ts";

/** Lines from the same person this close together share one name tag. */
const GROUP_MS = 2 * 60_000;
/** Drag the panel this far (a share of its size), or flick it, and it closes. */
const DISMISS_SHARE = 0.3;
const FLICK_PX_PER_MS = 0.5;
/** Up to this many emoji and nothing else: shown big, like every chat app does. */
const BIG_EMOJI_MAX = 3;
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|\s)+$/u;

export interface RoomChatOptions {
  send(text: string): void;
  react(messageId: number, emoji: Reaction): void;
  me(): string | null;
  /** Current seat name for a player id, for "who reacted" tooltips. */
  nameOf(playerId: string): string;
  /** A line arrived while the panel was shut. */
  peek(message: ChatMessage): void;
}

function isBigEmoji(text: string): boolean {
  if (!EMOJI_ONLY.test(text)) return false;
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...seg.segment(text.replace(/\s/g, ""))].length <= BIG_EMOJI_MAX;
}

/**
 * The room's chat: a header button with an unread count, and a panel that
 * stays out of the way (a bottom sheet on phones, a side panel on wide
 * screens). Not modal, so the table stays playable with it open.
 */
export class RoomChat {
  readonly button = h("button", { type: "button", class: "icon-btn chat-btn", "aria-label": "Chat", "aria-expanded": "false" });
  readonly panel = h("aside", { class: "chat-panel", "aria-label": "Room chat", hidden: true });

  private log = h("ol", { class: "chat-log", "aria-live": "polite" });
  private input = h("input", { class: "chat-input", placeholder: "Say something…", "aria-label": "Message", autocomplete: "off", enterkeyhint: "send" });
  private sendBtn = h("button", { type: "submit", class: "primary chat-send" }, "Send");
  private empty = h("p", { class: "muted chat-empty" }, "Nothing yet. Say hi 👋");
  private messages: ChatMessage[] = [];
  private lines = new Map<number, HTMLLIElement>();
  private unread = 0;
  /** The line whose reaction picker is open. */
  private picking: number | null = null;
  private opts: RoomChatOptions;
  private head = h("header", { class: "chat-head" });
  /** Where the drag started, and the last move, for flick speed. */
  private drag: { x: number; y: number; lastD: number; lastT: number; speed: number } | null = null;
  /** A dismiss sliding out. A timer, not transitionend: that one doesn't always come. */
  private closing: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: RoomChatOptions) {
    this.opts = opts;
    this.button.addEventListener("click", () => this.toggle());
    const form = h("form", { class: "chat-form" }, this.input, this.sendBtn);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      this.opts.send(text);
      this.input.value = "";
    });
    // Forms send on Enter by themselves, mostly. Not every keyboard (or IME) agrees.
    this.input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      e.preventDefault();
      form.requestSubmit();
    });
    this.panel.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (this.picking !== null) this.pick(null);
      else this.toggle(false);
    });
    this.head.append(
      h("span", { class: "chat-grip", "aria-hidden": "true" }),
      h("h2", {}, "Chat"),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close chat", onclick: () => this.toggle(false) }, icon("close")),
    );
    this.head.addEventListener("pointerdown", this.onDragStart);
    this.head.addEventListener("pointermove", this.onDragMove);
    this.head.addEventListener("pointerup", this.onDragEnd);
    this.head.addEventListener("pointercancel", this.onDragEnd);
    this.panel.append(
      this.head,
      this.empty,
      this.log,
      form,
    );
    this.renderButton();
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  toggle(open = !this.isOpen) {
    const was = this.isOpen;
    clearTimeout(this.closing);
    this.panel.style.translate = "";
    this.panel.hidden = !open;
    this.button.setAttribute("aria-expanded", String(open));
    if (open) {
      this.unread = 0;
      this.renderButton();
      this.scrollToEnd();
      this.input.focus();
    } else if (was) {
      this.pick(null);
      if (this.panel.contains(document.activeElement)) this.button.focus();
    }
  }

  /** Read-only with a reason (a game with its own chat is running), or open again with null. */
  lock(reason: string | null) {
    this.input.disabled = this.sendBtn.disabled = reason !== null;
    this.input.placeholder = reason ?? "Say something…";
  }

  receive(incoming: ChatMessage[], replace: boolean) {
    const stick = this.nearEnd();
    if (replace) {
      this.messages = incoming;
      this.lines.clear();
      this.picking = null;
      replaceChildren(this.log, incoming.map((m, i) => this.line(m, incoming[i - 1])));
    } else {
      for (const m of incoming) {
        const at = this.messages.findIndex((x) => x.id === m.id);
        if (at >= 0) {
          this.messages[at] = m;
          this.lines.get(m.id)?.replaceWith(this.line(m, this.messages[at - 1]));
          continue;
        }
        this.messages.push(m);
        this.log.append(this.line(m, this.messages.at(-2)));
        if (m.from !== this.opts.me() && !this.isOpen) {
          this.unread++;
          this.opts.peek(m);
        }
      }
      // Mirror the server's cap, so a long session doesn't grow the DOM forever.
      while (this.messages.length > 100) this.lines.get(this.messages.shift()!.id)?.remove();
    }
    this.empty.hidden = this.messages.length > 0;
    this.renderButton();
    // Your own line always scrolls into view; others' only if you were already at the bottom.
    if (stick || incoming.some((m) => m.from === this.opts.me())) this.scrollToEnd();
  }

  destroy() {
    clearTimeout(this.closing);
    this.panel.remove();
  }

  private renderButton() {
    replaceChildren(
      this.button,
      icon("chat"),
      this.unread ? h("span", { class: "chat-badge" }, this.unread > 9 ? "9+" : String(this.unread)) : null,
    );
    this.button.setAttribute("aria-label", this.unread ? `Chat, ${this.unread} unread` : "Chat");
  }

  private line(m: ChatMessage, prev: ChatMessage | undefined): HTMLLIElement {
    const me = this.opts.me();
    const mine = m.from === me;
    const grouped = prev?.from === m.from && m.at - prev.at < GROUP_MS;
    const reacted = REACTIONS.filter((r) => m.reactions[r]?.length);

    const li = h(
      "li",
      { class: `chat-line${mine ? " mine" : ""}${grouped ? " grouped" : ""}` },
      grouped || mine ? null : avatar(m.name, m.avatarSeed, "sm"),
      h(
        "div",
        { class: "chat-bubble-wrap" },
        grouped || mine ? null : h("span", { class: "chat-name" }, m.name),
        h(
          "div",
          { class: "chat-row" },
          h("p", { class: `chat-bubble${isBigEmoji(m.text) ? " big" : ""}`, title: new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }, m.text),
          h("button", {
            type: "button",
            class: "chat-react-btn",
            "aria-label": "React",
            "aria-expanded": String(this.picking === m.id),
            onclick: () => this.pick(this.picking === m.id ? null : m.id),
          }, icon("smile")),
        ),
        this.picking === m.id
          ? h(
              "div",
              { class: "chat-picker", role: "group", "aria-label": "Pick a reaction" },
              REACTIONS.map((r) =>
                h("button", {
                  type: "button",
                  "aria-pressed": String(!!me && !!m.reactions[r]?.includes(me)),
                  onclick: () => {
                    this.opts.react(m.id, r);
                    this.pick(null);
                  },
                }, r),
              ),
            )
          : null,
        reacted.length
          ? h(
              "div",
              { class: "chat-reactions" },
              reacted.map((r) => {
                const who = m.reactions[r]!;
                return h("button", {
                  type: "button",
                  class: "chat-reaction",
                  "aria-pressed": String(!!me && who.includes(me)),
                  title: who.map((id) => (id === me ? "You" : this.opts.nameOf(id))).join(", "),
                  onclick: () => this.opts.react(m.id, r),
                }, `${r} ${who.length}`);
              }),
            )
          : null,
      ),
    );
    this.lines.set(m.id, li);
    return li;
  }

  private pick(id: number | null) {
    const was = this.picking;
    this.picking = id;
    for (const which of [was, id]) {
      if (which === null) continue;
      const at = this.messages.findIndex((m) => m.id === which);
      if (at >= 0) this.lines.get(which)?.replaceWith(this.line(this.messages[at]!, this.messages[at - 1]));
    }
    if (id !== null) this.lines.get(id)?.querySelector<HTMLButtonElement>(".chat-picker button")?.focus();
  }

  // ---- drag to dismiss ------------------------------------------------------
  // Down on phones (it's a bottom sheet), right on wide screens (a side panel).

  private get wide(): boolean {
    return matchMedia("(min-width: 760px)").matches;
  }

  private onDragStart = (e: PointerEvent) => {
    if (e.button !== 0 || this.panel.hidden || (e.target as Element).closest("button")) return;
    this.head.setPointerCapture(e.pointerId);
    this.drag = { x: e.clientX, y: e.clientY, lastD: 0, lastT: e.timeStamp, speed: 0 };
    this.panel.classList.add("dragging");
  };

  private onDragMove = (e: PointerEvent) => {
    const drag = this.drag;
    if (!drag) return;
    const wide = this.wide;
    // Only away from the edge it's docked to; pulling the other way does nothing.
    const d = Math.max(0, wide ? e.clientX - drag.x : e.clientY - drag.y);
    const dt = e.timeStamp - drag.lastT;
    if (dt > 0) drag.speed = (d - drag.lastD) / dt;
    drag.lastD = d;
    drag.lastT = e.timeStamp;
    this.panel.style.translate = wide ? `${d}px 0` : `0 ${d}px`;
  };

  private onDragEnd = (e: PointerEvent) => {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.panel.classList.remove("dragging");
    const size = this.wide ? this.panel.offsetWidth : this.panel.offsetHeight;
    const dismiss = e.type === "pointerup" && drag.lastD > 0 &&
      (drag.lastD > size * DISMISS_SHARE || (drag.lastD > 24 && drag.speed > FLICK_PX_PER_MS));
    if (!dismiss) {
      this.panel.style.translate = ""; // springs back (see .chat-panel's transition)
      return;
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return this.toggle(false);
    // Off it goes the rest of the way (the panel's 200ms transition), then it's really closed.
    this.panel.style.translate = this.wide ? "calc(100% + 24px) 0" : "0 100%";
    this.closing = setTimeout(() => this.toggle(false), 200);
  };

  private nearEnd(): boolean {
    return this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 48;
  }

  private scrollToEnd() {
    this.log.scrollTop = this.log.scrollHeight;
  }
}
