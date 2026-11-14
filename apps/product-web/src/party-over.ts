// After the party: the slot the shell leaves under the recap, and under "this
// room is closed". Everyone here just played (or nearly did), so it's the
// moment to ask them to host the next one. Room creation is free; Host Pass
// gets a line, never a wall.

import { h } from "@games/ui";
import type { ShellOptions } from "@games/web/shell";
import { me, type Me } from "./api.ts";
import { morph } from "./motion.ts";

export type Who = "joinee" | "host" | "host-pass" | "closed";

/** What the shell hands the hook: who's looking, and the recap (null for a closed room). */
type PartyCtx = Parameters<NonNullable<ShellOptions["partyOver"]>>[1];

export interface PartyOverCopy {
  heading?: string;
  body?: string;
  cta: { label: string; href: string };
  /** Small print. `link` sits between `before` and `after`. */
  note?: { before: string; link?: string; href?: string; after?: string };
}

const PLAY = "/play";
const PRICING = "/pricing";

export function partyOverCopy(who: Who): PartyOverCopy {
  switch (who) {
    case "joinee":
      return {
        heading: "Your turn to host.",
        body: "Start your own party. It is free, and your friends do not need an app.",
        cta: { label: "Start a room", href: PLAY },
        note: { before: "Want every game and 16 players? ", link: "See Host Pass", href: PRICING, after: "" },
      };
    case "host":
      return {
        cta: { label: "Start a new room", href: PLAY },
        note: { before: "Get ", link: "Host Pass", href: PRICING, after: " for every game and up to 16 players." },
      };
    case "host-pass":
      return { cta: { label: "Start a new room", href: PLAY } };
    case "closed":
      return {
        heading: "This party is over.",
        cta: { label: "Start your own room", href: PLAY },
        note: { before: "It is free. No app needed." },
      };
  }
}

export function whoIsThis(ctx: PartyCtx, tier: Me["tier"]): Who {
  if (!ctx.recap) return "closed";
  if (!ctx.isHost) return "joinee";
  return tier === "pass" ? "host-pass" : "host";
}

function render(copy: PartyOverCopy): HTMLElement[] {
  const n = copy.note;
  const out: HTMLElement[] = [];
  if (copy.heading) out.push(h("h3", { class: "cp-po-heading" }, copy.heading));
  if (copy.body) out.push(h("p", { class: "cp-po-body" }, copy.body));
  out.push(h("a", { class: "cp-cta", href: copy.cta.href }, copy.cta.label));
  if (n) out.push(h("p", { class: "cp-muted cp-po-note" }, n.before, n.link ? h("a", { href: n.href! }, n.link) : null, n.after ?? ""));
  return out;
}

/** The shell's partyOver hook. A host is checked for a pass; until that answers they see the no-pass version. */
export function partyOver(outlet: HTMLElement, ctx: PartyCtx): void {
  const first = whoIsThis(ctx, "free");
  outlet.replaceChildren(...render(partyOverCopy(first)));
  if (first !== "host") return;
  void me().then((m) => {
    const who = whoIsThis(ctx, m.tier);
    if (who !== first && outlet.isConnected) morph(outlet, () => outlet.replaceChildren(...render(partyOverCopy(who))));
  });
}
