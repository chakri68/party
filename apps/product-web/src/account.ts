// /account: sign in when signed out; plan, codes, sign out and delete when signed in.

import { deleteAccount, loadConfig, logout, me, meOrNull, redeem, spendLink, startEmailSignIn, type Billing, type Me, type Purchase } from "./api.ts";
import { getTurnstileToken } from "./turnstile.ts";
import { FREE_MAX_PLAYERS } from "@games/product-server/catalog-data";
import { PLANS, isPlanId, plansFor, type PlanId } from "@games/product-server/billing-plans";
import { PAY_DONE_ACCOUNT, PAY_DOWN, PAY_LATE, PAY_PENDING, PAY_SLOW, buy, foreverPass, planButtons, takeBuyParam, takePaidParam } from "./buy.ts";
import { fadeIn, growBar, morph, swapIn } from "./motion.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Host Pass until 12 Dec 2026", "Host Pass, no end date" or "Free". Local date. */
const DAY = 86_400_000;

export type PlanFacts =
  | { tier: "free" }
  | {
      tier: "pass";
      /** Big line: "31 days left", "1 day left", or "No end date". */
      headline: string;
      /** "Ends 12 Dec 2026", or null when it doesn't end. */
      ends: string | null;
      /** Share of the pass still left, 0–1, or null with no end or no start. */
      left: number | null;
    };

/** What the account page's plan card says. Pure, so it's tested without a page. */
export function planFacts(m: Me, now: number): PlanFacts {
  if (m.tier !== "pass") return { tier: "free" };
  const end = m.plan?.endsAt ?? null;
  if (end === null) return { tier: "pass", headline: "No end date", ends: null, left: null };
  const days = Math.max(1, Math.ceil((end - now) / DAY));
  const d = new Date(end);
  const start = m.plan?.startsAt;
  const left = start !== undefined && end > start ? Math.min(1, Math.max(0, (end - now) / (end - start))) : null;
  return {
    tier: "pass",
    headline: days === 1 ? "1 day left" : `${days} days left`,
    ends: `Ends ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    left,
  };
}

/** "12 Nov 2026 · 30 days · ₹149". UTC date, so it reads the same everywhere. */
export function purchaseLine(p: Pick<Purchase, "plan" | "amount" | "currency" | "createdAt">): string {
  const d = new Date(p.createdAt);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const length = isPlanId(p.plan) ? PLANS[p.plan].length : p.plan;
  const money = new Intl.NumberFormat(p.currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency: p.currency,
    minimumFractionDigits: 0,
  }).format(p.amount / 100);
  return `${date} · ${length} · ${money}`;
}

/** Only same-site paths. Anything else goes back to this page. */
export function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/account";
}

const OUT_ERRORS: Record<string, string> = {
  link: "That link did not work. Ask for a new one.",
  google: "Google sign-in did not work. Please try again.",
};

/** The message for ?error= on the signed-out view, or "" for none or an unknown one. */
export function outErrorMessage(error: string | null): string {
  return error && Object.hasOwn(OUT_ERRORS, error) ? OUT_ERRORS[error]! : "";
}

function $(sel: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(sel);
  if (!node) throw new Error(`missing ${sel}`);
  return node;
}

function showView(name: string, on: boolean): void {
  for (const v of document.querySelectorAll<HTMLElement>(`[data-view=${name}]`)) v.hidden = !on;
}

function say(node: HTMLElement, text: string): void {
  node.textContent = text;
  node.hidden = text === "";
}

function signedOut(next: string, error: string | null): void {
  showView("out", true);
  say($("[data-out-error]"), outErrorMessage(error));

  void loadConfig().then((c) => {
    if (!c.googleEnabled) return;
    const google = $("[data-google]") as HTMLAnchorElement;
    google.href = `/api/auth/google?next=${encodeURIComponent(next)}`;
    morph(google.parentElement!, () => {
      google.hidden = false;
      $("[data-or]").hidden = false;
    });
  }).catch(() => {});

  const form = $("[data-email-form]") as HTMLFormElement;
  const input = form.querySelector("input")!;
  const button = form.querySelector("button")!;
  const status = $("[data-email-status]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    say($("[data-out-error]"), "");
    say(status, "");
    const email = input.value.trim();
    if (!email) return;
    button.disabled = true;
    button.textContent = "Sending…";
    let token: string;
    try {
      token = await getTurnstileToken();
    } catch {
      say(status, "Could not check you are human. Please try again.");
      status.dataset.tone = "bad";
      button.disabled = false;
      button.textContent = "Email me a link";
      return;
    }
    const r = await startEmailSignIn(email, next, token);
    button.disabled = false;
    button.textContent = "Email me a link";
    if (r.ok) {
      morph(form.parentElement!, () => {
        form.hidden = true;
        status.dataset.tone = "good";
        say(status, `Check your email. We sent a sign-in link to ${email}. It works for 15 minutes.`);
      });
    } else {
      status.dataset.tone = "bad";
      say(status, r.error);
    }
  });
}

function renderPlan(card: HTMLElement, f: PlanFacts): void {
  card.dataset.tier = f.tier;
  if (f.tier === "free") {
    card.replaceChildren(
      el("p", "plan-kind", "Free"),
      el("p", "plan-perks", `Up to ${FREE_MAX_PLAYERS} players. Most games.`),
      Object.assign(el("a", "plan-cta", "Get Host Pass"), { href: "/pricing" }),
    );
    return;
  }
  const head = el("div", "plan-top");
  head.append(brand(), el("span", "plan-status", "Active"));
  const parts: Node[] = [head, el("p", "plan-kind", "Host Pass"), el("p", "plan-left", f.headline)];
  if (f.left !== null) {
    const bar = el("div", "plan-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", `${Math.round(f.left * 100)}% of your pass is left`);
    const fillEl = el("span", "plan-bar-fill");
    fillEl.style.width = `${(f.left * 100).toFixed(1)}%`;
    bar.append(fillEl);
    parts.push(bar);
    growBar(fillEl);
  }
  const foot = el("div", "plan-foot");
  if (f.ends) foot.append(el("p", "plan-ends", f.ends));
  foot.append(el("p", "plan-perks", "All games, 16 players"));
  parts.push(foot);
  card.replaceChildren(...parts);
}

// The header's two-card mark, so the pass reads like a card we issued.
const MARK =
  '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g transform="rotate(-14 32 36)"><rect x="11" y="10" width="30" height="42" rx="5" fill="#c6f432"/></g><g transform="rotate(10 32 36)"><rect x="23" y="12" width="30" height="42" rx="5" fill="#fffdf8"/><path d="M38 44s-9-5.6-11.6-10.6C24.5 29.6 26.8 25 31.2 25c2.6 0 4.6 1.4 6.8 3.8 2.2-2.4 4.2-3.8 6.8-3.8 4.4 0 6.7 4.6 4.8 8.4C47 38.4 38 44 38 44z" fill="#0e0e0c"/></g></svg>';

function brand(): HTMLElement {
  const b = el("span", "plan-brand");
  b.innerHTML = MARK;
  b.append("CouchParty");
  return b;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function signedIn(m: Me, billing: Billing | null, autoBuy: PlanId | null, paidOnLoad: boolean): void {
  showView("in", true);
  $("[data-email]").textContent = m.email ?? "";
  const card = $("[data-plan]");
  let first = true;
  const panel = $("[data-buy]");
  const panelTitle = $("[data-buy-title]");
  const panelBody = $("[data-buy-body]");
  const list = $("[data-purchases]");
  const rows = $("[data-purchases-list]");

  const note = (text: string, tone?: "bad") => {
    const p = el("p", "status", text);
    p.setAttribute("role", tone ? "alert" : "status");
    if (tone) p.dataset.tone = tone;
    else p.classList.add("muted");
    return p;
  };

  /** Plan buttons for this provider. Only called with buying on. */
  const buyContent = (who: Me): HTMLElement[] => {
    if (!billing) return [];
    panelTitle.textContent = who.tier === "pass" ? "Add more time" : "Buy Host Pass";
    return [planButtons(billing, (p) => void start(p))];
  };

  const start = async (plan: PlanId) => {
    let error = PAY_DOWN;
    swapIn(panelBody, note(PAY_PENDING));
    let outcome: Awaited<ReturnType<typeof buy>> = "failed";
    try {
      outcome = await buy(plan, {
        returnTo: "/account",
        onError: (msg) => void (error = msg),
        onWait: () => swapIn(panelBody, note(PAY_SLOW)),
      });
    } catch {
      // nothing was charged if buy() itself threw
    }
    if (outcome === "pending") return swapIn(panelBody, note(PAY_LATE));
    if (outcome === "done") {
      try {
        return show(await me(), true);
      } catch {
        return location.reload();
      }
    }
    swapIn(panelBody, ...buyContent(me0), ...(outcome === "failed" ? [note(error, "bad")] : []));
  };

  // "Payment done." sits at the top of the buy box, or under the plan card if the box is hidden.
  let paidLine: HTMLElement | null = null;
  const sayPaid = () => {
    if (!paidLine) {
      paidLine = note(PAY_DONE_ACCOUNT);
      paidLine.classList.remove("muted");
      paidLine.dataset.tone = "good";
      paidLine.hidden = false;
    }
    if (panel.hidden) card.after(paidLine);
    else panelTitle.before(paidLine);
    fadeIn(paidLine);
  };

  let me0: Me = m;
  const show = (who: Me, paid = false) => {
    me0 = who;
    const purchases = who.purchases ?? [];
    // A pass with no end can't be added to. With buying off, a pass hides the box as it always did.
    const hidePanel = who.tier === "pass" && (billing === null || foreverPass(who));
    const fill = () => {
      renderPlan(card, planFacts(who, Date.now()));
      if (billing) panelBody.replaceChildren(...buyContent(who)); // off: the HTML's own "opens soon" stays
      panel.hidden = hidePanel;
      list.hidden = purchases.length === 0;
      rows.replaceChildren(
        ...purchases.map((p) => {
          const li = el("li", "purchase", purchaseLine(p));
          if (p.status === "refunded") li.append(" ", el("span", "purchase-tag", "Refunded"));
          return li;
        }),
      );
      if (paid) sayPaid();
    };
    // First time it rides the page's own reveal; after a redeem or a purchase it eases to its new size.
    if (first) fill();
    else morph($("main"), fill);
    first = false;
  };
  show(m, paidOnLoad);
  if (autoBuy && billing && plansFor(billing.provider).includes(autoBuy) && !panel.hidden) void start(autoBuy);

  const form = $("[data-redeem]") as HTMLFormElement;
  const input = form.querySelector("input")!;
  const button = form.querySelector("button")!;
  const status = $("[data-redeem-status]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (!code) return;
    button.disabled = true;
    say(status, "");
    const r = await redeem(code);
    button.disabled = false;
    if (r.ok) {
      input.value = "";
      status.dataset.tone = "good";
      say(status, "Code added.");
      show(await me());
    } else {
      status.dataset.tone = "bad";
      say(status, r.error);
    }
  });

  $("[data-logout]").addEventListener("click", async () => {
    await logout();
    location.replace("/account");
  });

  // Two steps, all on the page: no browser dialog.
  const ask = $("[data-delete]") as HTMLButtonElement;
  const confirm = $("[data-delete-confirm]");
  const yes = $("[data-delete-yes]") as HTMLButtonElement;
  const deleteStatus = $("[data-delete-status]");
  ask.addEventListener("click", () => {
    ask.hidden = true;
    confirm.hidden = false;
    yes.focus();
  });
  $("[data-delete-no]").addEventListener("click", () => {
    confirm.hidden = true;
    ask.hidden = false;
    ask.focus();
  });
  yes.addEventListener("click", async () => {
    yes.disabled = true;
    const r = await deleteAccount();
    if (r.ok) {
      morph($("main"), () => {
        showView("in", false);
        showView("deleted", true);
      });
      return;
    }
    yes.disabled = false;
    say(deleteStatus, r.error);
  });
}

export async function mountAccount(): Promise<void> {
  const url = new URL(location.href);
  const next = safeNext(url.searchParams.get("next"));
  let error = url.searchParams.get("error");

  // Back from the email link: spend the token here, with a POST, so a mail
  // scanner that opened the link first did not use it up.
  const token = url.searchParams.get("token");
  if (token) {
    url.searchParams.delete("token");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    const r = await spendLink(token);
    if ("next" in r) {
      location.replace(safeNext(r.next));
      return;
    }
    error = "link";
  }

  const autoBuy = takeBuyParam(url);
  // Back from buying on the landing or pricing page.
  const paid = takePaidParam(new URL(location.href));
  const [m, billing] = await Promise.all([meOrNull(), loadConfig().then((c) => c.billing, () => null)]);
  if (m === null) {
    $("[data-view=loading]").textContent = "We could not load your account. Please refresh the page.";
    return;
  }
  morph($("main"), () => {
    showView("loading", false);
    if (m.email === null) signedOut(next, error);
    else signedIn(m, billing, autoBuy, paid);
  });
}
