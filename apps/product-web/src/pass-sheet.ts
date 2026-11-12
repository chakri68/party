import { plansFor, type PlanId } from "@games/product-server/billing-plans";
import { h } from "@games/ui";
import { loadConfig, me, redeem, upgradeRoom } from "./api.ts";
import { PAY_DONE, PAY_DOWN, PAY_LATE, PAY_PENDING, PAY_SLOW, buy, planButtons, sheetMode } from "./buy.ts";
import { hostKeyFor } from "./host-keys.ts";
import { fadeIn, morph, swapIn } from "./motion.ts";

const NOT_HOST = "Only the host can do this. Ask the person who made the room.";

async function upgradeHere(code: string): Promise<string | null> {
  const key = hostKeyFor(code);
  if (!key) return NOT_HOST;
  const r = await upgradeRoom(code, key);
  return r.ok ? null : r.error;
}

/**
 * Shown when someone taps a game that needs Host Pass. `opts.buy` starts
 * that plan's checkout as soon as the sheet knows it can (back from sign-in).
 */
export function openPassSheet(_gameId: string, code: string, opts: { buy?: PlanId } = {}): void {
  const dlg = h("dialog", { class: "cp-sheet", "aria-labelledby": "cp-sheet-title" });
  const body = h("div", { class: "cp-sheet-body" });
  const error = h("p", { class: "cp-sheet-error", role: "alert" });
  const close = h("button", { type: "button", class: "link", onclick: () => dlg.close() }, "Close");
  const title = h("h2", { id: "cp-sheet-title" }, "This game needs Host Pass");
  const lead = h("p", {}, "Host Pass opens all games for your whole room. Your friends do not need to pay.");
  const soon = h("p", { class: "cp-muted" }, "Buying opens soon.");
  dlg.append(title, lead, body, error, soon, close);
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();

  const fail = (msg: string | null) => void (error.textContent = msg ?? "");

  const LEADS = {
    code: "Your code worked. All games are open now, for everyone in this room, and up to 16 players can join when the game allows it.",
    pass: "All games are open now, for everyone in this room, and up to 16 players can join when the game allows it.",
    paid: PAY_DONE,
  };

  /** It worked: say so, in the same sheet, and let them close it. */
  const done = (how: keyof typeof LEADS) => {
    fail(null);
    soon.remove();
    title.textContent = "This room has Host Pass";
    lead.textContent = LEADS[how];
    const ok = h("button", { type: "button", class: "primary", onclick: () => dlg.close() }, "Back to the room");
    body.replaceChildren(ok);
    close.remove();
    fadeIn(title);
    fadeIn(lead);
    ok.focus();
  };

  const useButton = (label: string) => {
    const btn = h("button", { type: "button", class: "primary" }, label);
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const err = await upgradeHere(code);
      if (err) {
        fail(err);
        btn.disabled = false;
      } else done("pass");
    });
    return btn;
  };

  const codeForm = () => {
    const input = h("input", { name: "code", placeholder: "Enter code", autocomplete: "off", autocapitalize: "characters", required: true });
    const submit = h("button", { type: "submit", class: "primary" }, "Use code");
    const form = h("form", { class: "cp-redeem" }, h("label", { class: "field" }, h("span", {}, "Have a code?"), input), submit);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      fail(null);
      if (!hostKeyFor(code)) return fail(NOT_HOST); // do not spend the code
      submit.disabled = true;
      const r = await redeem(input.value.trim());
      const err = r.ok ? await upgradeHere(code) : r.error;
      if (err) {
        fail(err);
        submit.disabled = false;
      } else done("code");
    });
    return form;
  };

  void Promise.all([me(), loadConfig().then((c) => c.billing ?? null, () => null)]).then(([m, billing]) => {
    const mode = sheetMode(m, !!hostKeyFor(code), billing);
    // With buying open, "opens soon" goes in the same eased step that fills the body.
    const show = (...kids: HTMLElement[]) =>
      billing
        ? morph(dlg, () => {
            soon.remove();
            body.replaceChildren(...kids);
            kids.forEach(fadeIn);
          })
        : swapIn(body, ...kids);
    if (mode === "sign-in") {
      const next = encodeURIComponent(`/room/${code}?upgrade=1`);
      show(h("a", { class: "cp-link-btn primary", href: `/account?next=${next}` }, "Sign in"));
    } else if (mode === "use-pass" || (mode === "not-host" && m.tier === "pass")) {
      // A non-host sees what they always did; the "only the host" line comes up when they try.
      show(useButton("Use my Host Pass here"));
    } else if (mode === "buy" && billing) {
      const plans = h("div", { class: "cp-plans" });
      const showButtons = () => planButtons(billing, (p) => void pick(p));
      const note = (text: string) => h("p", { class: "cp-muted", role: "status" }, text);
      const pick = async (plan: PlanId) => {
        fail(null);
        swapIn(plans, note(PAY_PENDING));
        let error = PAY_DOWN;
        // buy() shouldn't reject; if it does, nothing was charged, so the buttons come back.
        const outcome = await buy(plan, {
          returnTo: `/room/${code}?upgrade=1`,
          onError: (msg) => void (error = msg),
          onWait: () => swapIn(plans, note(PAY_SLOW)),
        }).catch((): "failed" => "failed");
        if (outcome === "closed") return swapIn(plans, showButtons());
        if (outcome === "failed") {
          swapIn(plans, showButtons());
          return fail(error);
        }
        if (outcome === "pending") return swapIn(plans, note(PAY_LATE));
        const err = await upgradeHere(code);
        if (!err) return done("paid");
        // Paid, but the room didn't take it. The pass is theirs; let them try again.
        swapIn(plans, useButton("Use my Host Pass here"));
        fail(err);
      };
      plans.append(showButtons());
      show(plans, codeForm());
      if (opts.buy && plansFor(billing.provider).includes(opts.buy)) void pick(opts.buy);
    } else {
      show(codeForm());
    }
  });
}
