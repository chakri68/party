// The card that shows you your role. Face down until you tap it, and face down
// again the moment the tab loses focus: phones get passed around and left on
// tables, and a role that's still showing when you come back is a role someone
// else just read. Hidden means out of the DOM, not just out of sight, so a
// screen reader or a stray text selection can't find it either.
//
// DOM code, so it lives at its own subpath: the deck half of this package is
// parsed by the server, whose typecheck has no DOM.

export type RevealState = "hidden" | "shown";

/** Tap toggles; anything that takes the tab away turns the card back over. */
export function nextRevealState(state: RevealState, event: "tap" | "background"): RevealState {
  if (event === "background") return "hidden";
  return state === "hidden" ? "shown" : "hidden";
}

function el(tag: string, cls: string, ...children: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.append(...children);
  return e;
}

/**
 * Mount `el` where the role goes; call `destroy` when the view goes, or the
 * window listeners outlive it. Styles: `@games/hidden-roles/reveal.css`.
 */
export function roleReveal(opts: { title: string; body: Node | string; warning?: string }): {
  el: HTMLElement;
  update(body: Node | string): void;
  destroy(): void;
} {
  let state: RevealState = "hidden";
  let body = opts.body;

  const card = el("div", "role-reveal-card");
  card.setAttribute("role", "button");
  card.tabIndex = 0;
  const root = el("section", "role-reveal", el("h2", "role-reveal-title", opts.title), card);

  const render = () => {
    root.dataset.state = state;
    card.setAttribute("aria-pressed", String(state === "shown"));
    if (state === "shown") {
      card.replaceChildren(el("div", "role-reveal-body", body), el("span", "role-reveal-prompt", "Tap to hide"));
    } else {
      card.replaceChildren(
        el("span", "role-reveal-prompt", "Tap to reveal"),
        el("span", "role-reveal-warning", opts.warning ?? "Check nobody's looking"),
      );
    }
  };
  const send = (event: "tap" | "background") => {
    const next = nextRevealState(state, event);
    if (next === state) return;
    state = next;
    render();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault(); // Space would scroll the page
    send("tap");
  };
  const onVisibility = () => document.hidden && send("background");
  const onBlur = () => send("background");

  card.addEventListener("click", () => send("tap"));
  card.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onBlur);
  render();

  return {
    el: root,
    update(next) {
      body = next;
      if (state === "shown") render();
    },
    destroy() {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      root.remove();
    },
  };
}
