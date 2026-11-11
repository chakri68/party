import { h } from "@games/ui";
import { me } from "./api.ts";
import { swapIn } from "./motion.ts";

/** A thin bar above the shell: wordmark, then sign-in or the signed-in email. */
export function mountHeader(outlet: HTMLElement): void {
  const right = h("span", { class: "cp-bar-right" });
  const bar = h(
    "header",
    { class: "cp-bar" },
    h("a", { class: "cp-wordmark", href: "/" }, "CouchParty"),
    right,
  );
  outlet.before(bar);
  void me().then((m) => {
    if (m.email === null) {
      const next = encodeURIComponent(location.pathname + location.search);
      swapIn(right, h("a", { class: "cp-signin", href: `/account?next=${next}` }, "Sign in"));
      return;
    }
    swapIn(right, h("a", { class: "cp-email", href: "/account" }, m.email), ...(m.tier === "pass" ? [h("span", { class: "cp-badge" }, "Host Pass")] : []));
  });
}
