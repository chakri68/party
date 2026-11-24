import { h } from "@games/ui";
import type { ShellHome } from "@games/web/shell";
import { me, type Me } from "./api.ts";
import { wireMenu } from "./menu.ts";
import { swapIn } from "./motion.ts";

/** The logo, as in partials/header.html. */
const MARK = `<svg class="cp-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g transform="rotate(-14 32 36)"><rect x="11" y="10" width="30" height="42" rx="5" fill="#c6f432"/></g><g transform="rotate(10 32 36)"><rect x="23" y="12" width="30" height="42" rx="5" fill="#fffdf8" class="cp-mark-card"/><path d="M38 44s-9-5.6-11.6-10.6C24.5 29.6 26.8 25 31.2 25c2.6 0 4.6 1.4 6.8 3.8 2.2-2.4 4.2-3.8 6.8-3.8 4.4 0 6.7 4.6 4.8 8.4C47 38.4 38 44 38 44z" fill="#0e0e0c"/></g></svg>`;
const MENU_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;

function svg(markup: string): Element {
  const t = document.createElement("template");
  t.innerHTML = markup;
  return t.content.firstElementChild!;
}

/** The footer's links, the same as partials/footer.html (header.test.ts checks). */
export const FOOT_LINKS: ReadonlyArray<readonly [label: string, href: string]> = [
  ["Host Pass", "/pricing"],
  ["Account", "/account"],
  ["Terms", "/terms"],
  ["Privacy", "/privacy"],
  ["Refunds", "/refunds"],
  // The licences of open source code the site ships (the My sounds encoder).
  ["Licences", "/THIRD_PARTY.md"],
  ["hello@couchpartygames.com", "mailto:hello@couchpartygames.com"],
];

/** The tab and search title of /play's start page (play.html has it too; header.test.ts checks). */
export const PLAY_TITLE = "Start a room - CouchParty";

/** A link to the account page that comes back here after sign-in. */
function accountLink(cls: string, text: string): HTMLAnchorElement {
  const link = h("a", { class: cls }, text) as HTMLAnchorElement;
  // The shell moves between rooms without a page load, so the room to come
  // back to is read when the link is used (or hovered, focused, copied).
  const aim = () => void (link.href = `/account?next=${encodeURIComponent(location.pathname + location.search)}`);
  aim();
  for (const ev of ["pointerenter", "focus", "pointerdown", "click", "contextmenu"]) link.addEventListener(ev, aim);
  return link;
}

const brand = () => h("a", { class: "cp-brand", href: "/", "aria-label": "CouchParty home" }, svg(MARK), h("span", {}, "CouchParty"));

/**
 * The site's header above the shell: logo, Games, Host Pass, then sign-in or
 * the signed-in email. On phones Games and Host Pass fold into a menu. In a
 * room (product.css) only the logo and the account part show, so the game
 * keeps its space.
 */
export function mountHeader(outlet: HTMLElement, account: Promise<Me> = me()): void {
  const right = h("span", { class: "cp-bar-right" });
  const menuAccount = h("a", { href: "/account" }, "Account");
  const panel = h(
    "div",
    { class: "cp-menu", id: "cp-menu", hidden: true },
    h("a", { href: "/#games" }, "Games"),
    h("a", { href: "/pricing" }, "Host Pass"),
    menuAccount,
  );
  const button = h(
    "button",
    { type: "button", class: "cp-menu-btn", "aria-expanded": "false", "aria-controls": "cp-menu", "aria-label": "Menu" },
    svg(MENU_ICON),
  );
  const nav = h(
    "nav",
    { class: "cp-nav", "aria-label": "Main" },
    h("a", { class: "cp-nav-wide", href: "/#games" }, "Games"),
    h("a", { class: "cp-nav-wide", href: "/pricing" }, "Host Pass"),
    right,
    button,
    panel,
  );
  outlet.before(h("header", { class: "cp-bar" }, brand(), nav));
  wireMenu(button, panel, nav);
  void account.then((m) => {
    if (m.email === null) {
      menuAccount.replaceWith(accountLink("", "Sign in"));
      swapIn(right, accountLink("cp-signin", "Sign in"));
      return;
    }
    swapIn(right, h("a", { class: "cp-email", href: "/account" }, m.email), ...(m.tier === "pass" ? [h("span", { class: "cp-badge" }, "Host Pass")] : []));
  });
}

/** The site's footer under the shell. product.css shows it on the start page only. */
export function mountFooter(outlet: HTMLElement): void {
  outlet.after(
    h(
      "footer",
      { class: "cp-foot" },
      h(
        "div",
        { class: "cp-foot-inner" },
        brand(),
        h("nav", { class: "cp-foot-links", "aria-label": "Footer" }, FOOT_LINKS.map(([label, href]) => h("a", { href }, label))),
        h("p", { class: "cp-foot-note" }, "© 2026 CouchParty"),
      ),
    ),
  );
}

/**
 * The start page follows the phone's light or dark (product.css keys on
 * html.cp-start); a room is always dark. play.html sets this once on load;
 * the shell moves between them without a load, so it is set again on each move.
 */
function startColours(start: boolean): void {
  document.documentElement.classList.toggle("cp-start", start);
  const light = start && matchMedia("(prefers-color-scheme: light)").matches;
  document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')?.setAttribute("content", start ? "light dark" : "dark");
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", light ? "#fffdf8" : "#0e0e0c");
}

/** The start page's words, passed to the shell as `home` and `createText` (play.ts). */
export const PLAY_HOME = {
  title: "Start a room",
  subtitle: "Type your name. Then start a new room, or join a friend's room with its code.",
  pageTitle: PLAY_TITLE,
} satisfies ShellHome;
export const PLAY_CREATE_TEXT = "Start a room";

/**
 * Keeps the start page's colours in step as the shell moves between /play
 * and a room without a page load (see startColours).
 */
export function watchStartPage(outlet: HTMLElement): void {
  let home: Element | null = null;
  const sync = () => {
    const now = outlet.querySelector(":scope > main.home");
    if (now === home) return;
    home = now;
    startColours(!!home);
  };
  new MutationObserver(sync).observe(outlet, { childList: true });
  sync();
}
