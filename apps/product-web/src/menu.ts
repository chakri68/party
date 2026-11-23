// The phone menu: one button that opens the nav links in a small panel.
// The site header (partials/header.html) loads this file; /play's header
// (header.ts) calls wireMenu itself. Without JS the button stays hidden
// (site.css shows it under html.js only) and the links stay in the bar.

/**
 * Opens and closes `panel` from `button`. Escape closes it and puts focus back
 * on the button; so does a tap outside `area` or focus leaving it, and a tap
 * on a link inside. Opening moves focus to the first link.
 */
export function wireMenu(button: HTMLButtonElement, panel: HTMLElement, area: HTMLElement): () => void {
  const isOpen = () => button.getAttribute("aria-expanded") === "true";
  const set = (open: boolean, refocus = false) => {
    if (open === isOpen()) return;
    button.setAttribute("aria-expanded", String(open));
    panel.hidden = !open;
    if (open) panel.querySelector<HTMLElement>("a, button")?.focus();
    else if (refocus) button.focus();
  };
  button.addEventListener("click", () => set(!isOpen()));
  panel.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a")) set(false);
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && isOpen()) {
      e.preventDefault();
      set(false, true);
    }
  };
  const onDown = (e: PointerEvent) => {
    if (isOpen() && !area.contains(e.target as Node)) set(false);
  };
  area.addEventListener("focusout", (e) => {
    const to = e.relatedTarget as Node | null;
    if (isOpen() && to && !area.contains(to)) set(false);
  });
  // A phone turned sideways past the breakpoint shows the links in the bar: the panel goes.
  const wide = matchMedia("(min-width: 600px)");
  const onWide = () => wide.matches && set(false);
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onDown);
  wide.addEventListener("change", onWide);
  return () => {
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onDown);
    wide.removeEventListener("change", onWide);
  };
}

/** The static pages' header, if this page has it. */
export function bootSiteMenu(root: ParentNode = document): void {
  const button = root.querySelector<HTMLButtonElement>(".site-bar .menu-btn");
  const panel = root.querySelector<HTMLElement>("#site-menu");
  const nav = root.querySelector<HTMLElement>(".site-bar .site-nav");
  if (button && panel && nav) wireMenu(button, panel, nav);
}

if (typeof document !== "undefined") bootSiteMenu();
