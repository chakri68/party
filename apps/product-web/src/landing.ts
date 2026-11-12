// The public pages: landing (/) and pricing. The HTML carries the words and,
// since the build writes it in (src/gallery.ts), the game list. This file
// fills in what changes per visitor: the prices and the Buy buttons.

import { PLANS, isPlanId, plansFor, priceLabel, providerFor, type PlanId } from "@games/product-server/billing-plans";
import { FREE_MAX_PLAYERS } from "@games/product-server/catalog-data";
import { loadConfig, meOrNull, type Billing } from "./api.ts";
import { PAY_DOWN, PAY_LATE, PAY_SLOW, buy, foreverPass, takeBuyParam } from "./buy.ts";
import { fadeIn, morph, revealOnScroll, riseIn, rollText, slideDetails, whenSettled } from "./motion.ts";

/**
 * Spec §2 placeholder prices. India pays in rupees, everyone else in dollars.
 * No day pass in dollars: Paddle's fixed 50c fee would take about a third of
 * $1.99, so outside India the pass is sold by the month or year only.
 */
export function priceTable(country: string | null): Array<{ plan: string; length: string; price: string }> {
  const provider = providerFor(country);
  return plansFor(provider).map((p) => ({
    plan: p[0]!.toUpperCase() + p.slice(1),
    length: PLANS[p].length,
    price: priceLabel(p, provider),
  }));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Where a strip says what happened to a purchase: an error, "we got it", or the "pass is late" line. */
function say(root: HTMLElement, text: string, error: boolean): void {
  let msg = root.nextElementSibling?.matches(".prices-msg") ? (root.nextElementSibling as HTMLElement) : null;
  if (!msg) {
    msg = el("p", "prices-msg");
    root.after(msg);
  }
  msg.className = error ? "prices-msg alert" : "prices-msg muted";
  msg.setAttribute("role", error ? "alert" : "status");
  msg.textContent = text;
  fadeIn(msg);
}

let buying = false;

/** One purchase from a price strip. Done goes to the account page, where the pass shows. */
async function startBuy(plan: PlanId, root: HTMLElement): Promise<void> {
  if (buying) return;
  buying = true;
  const buttons = document.querySelectorAll<HTMLButtonElement>(".price-buy");
  buttons.forEach((b) => (b.disabled = true));
  const old = root.nextElementSibling;
  if (old?.matches(".prices-msg")) old.textContent = "";
  let error = PAY_DOWN;
  let outcome: Awaited<ReturnType<typeof buy>> = "failed";
  try {
    outcome = await buy(plan, {
      returnTo: location.pathname,
      onError: (m) => void (error = m),
      onWait: () => say(root, PAY_SLOW, false),
    });
  } catch {
    // nothing was charged if buy() itself threw
  }
  // paid=1 makes the account page say "Payment done." once.
  if (outcome === "done") return void location.assign("/account?paid=1");
  // Money moved: leave the buttons off so a second tap can't charge again.
  if (outcome === "pending") return say(root, PAY_LATE, false);
  buying = false;
  buttons.forEach((b) => (b.disabled = false));
  if (outcome === "failed") say(root, error, true);
}

function renderPrices(country: string | null, roll: boolean, billing: Billing | null = null): void {
  const byPlan = new Map(priceTable(country).map((p) => [p.plan, p.price]));
  const buyButtons: Array<[HTMLElement, HTMLElement, PlanId]> = [];
  for (const root of document.querySelectorAll<HTMLElement>("[data-prices]")) {
    // The HTML ships every plan; change the numbers in place so they can
    // roll, and fold away a plan this country doesn't sell.
    let i = 0;
    for (const li of root.querySelectorAll<HTMLElement>(".price")) {
      const price = byPlan.get(li.querySelector(".price-plan")?.textContent ?? "");
      if (price === undefined) {
        foldAway(li);
        continue;
      }
      const planName = li.querySelector(".price-plan")?.textContent ?? "";
      if (billing && !li.querySelector(".price-buy")) {
        const plan = planName.toLowerCase();
        if (isPlanId(plan) && plansFor(billing.provider).includes(plan)) buyButtons.push([root, li, plan]);
      }
      const amount = li.querySelector<HTMLElement>(".price-amount")!;
      if (roll) rollText(amount, price, 90 * i);
      else amount.textContent = price;
      i++;
    }
  }
  if (!billing) return;
  for (const note of document.querySelectorAll(".prices-note")) note.textContent = "One payment. Nothing renews.";
  // The strip eases to its taller size and the buttons fade up, so nothing jumps.
  for (const root of new Set(buyButtons.map(([r]) => r))) {
    morph(root, () => {
      for (const [r, li, plan] of buyButtons) {
        if (r !== root) continue;
        const btn = el("button", "btn price-buy", "Buy");
        btn.type = "button";
        btn.setAttribute("aria-label", `Buy ${PLANS[plan].length} pass`);
        btn.addEventListener("click", () => void startBuy(plan, root));
        li.append(btn);
        fadeIn(btn);
      }
    });
  }
}

/** Fades a price column out, then drops it so the others widen to fill. */
function foldAway(li: HTMLElement): void {
  if (li.hidden || "gone" in li.dataset) return;
  li.dataset.gone = "";
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return void (li.hidden = true);
  const out = li.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "ease-in", fill: "forwards" });
  out.onfinish = () => {
    li.hidden = true;
    out.cancel();
  };
}

/**
 * The HTML ships rupees. Hold the numbers back for a moment so a visitor
 * outside India doesn't watch ₹ turn into $: they rise in once, already
 * right. A config call slower than that rolls them over instead.
 */
function showPrices(): void {
  let shown = false;
  const reveal = () => {
    if (shown) return;
    shown = true;
    whenSettled(() =>
      document.querySelectorAll<HTMLElement>("[data-prices] .price:not([data-gone]) .price-amount").forEach((a, i) => {
        a.style.opacity = "1";
        riseIn(a, 90 * i);
      }),
    );
  };
  const timer = setTimeout(reveal, 400);
  // Taken before anything else, so a reload can't start a second purchase.
  const wanted = takeBuyParam(new URL(location.href));
  loadConfig()
    .then(async (c) => {
      // Prices first, so they never wait on /api/me.
      renderPrices(c.country ?? null, shown);
      clearTimeout(timer);
      reveal();
      // A pass with no end can't get more time, so its holder sees the strip as
      // if buying were off. Only asked when billing is on: off, there's nothing to hide.
      const billing = c.billing && (await sellsTo()) ? c.billing : null;
      if (billing) renderPrices(c.country ?? null, false, billing);
      const root = document.querySelector<HTMLElement>("[data-prices]");
      if (wanted && billing && root && plansFor(billing.provider).includes(wanted)) void startBuy(wanted, root);
    })
    .catch(() => {})
    .finally(reveal);
}

/** False for a signed-in forever-pass holder. A failed /api/me sells, as before. */
async function sellsTo(): Promise<boolean> {
  const m = await meOrNull().catch(() => null);
  return !(m && foreverPass(m));
}

function fillFreeCap(): void {
  for (const c of document.querySelectorAll("[data-free-cap]")) c.textContent = String(FREE_MAX_PLAYERS);
}

/** Wire up whatever data slots this page has. */
export function boot(): void {
  fillFreeCap();
  // The HTML ships the rupee table, so a slow or failed config call still shows prices.
  if (document.querySelector("[data-prices]")) showPrices();
  slideDetails();
  revealOnScroll();
}
