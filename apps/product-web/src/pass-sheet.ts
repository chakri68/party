import { h } from "@games/ui";
import { me, redeem, upgradeRoom } from "./api.ts";
import { hostKeyFor } from "./host-keys.ts";
import { fadeIn, swapIn } from "./motion.ts";

const NOT_HOST = "Only the host can do this. Ask the person who made the room.";

async function upgradeHere(code: string): Promise<string | null> {
  const key = hostKeyFor(code);
  if (!key) return NOT_HOST;
  const r = await upgradeRoom(code, key);
  return r.ok ? null : r.error;
}

/** Shown when someone taps a game that needs Host Pass. */
export function openPassSheet(_gameId: string, code: string): void {
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

  /** It worked: say so, in the same sheet, and let them close it. */
  const done = (codeUsed: boolean) => {
    fail(null);
    soon.remove();
    title.textContent = "This room has Host Pass";
    lead.textContent = codeUsed
      ? "Your code worked. All games are open now, for everyone in this room, and up to 16 players can join when the game allows it."
      : "All games are open now, for everyone in this room, and up to 16 players can join when the game allows it.";
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
      } else done(false);
    });
    return btn;
  };

  void me().then((m) => {
    if (m.email === null) {
      const next = encodeURIComponent(`/room/${code}?upgrade=1`);
      swapIn(body, h("a", { class: "cp-link-btn primary", href: `/account?next=${next}` }, "Sign in"));
    } else if (m.tier === "pass") {
      swapIn(body, useButton("Use my Host Pass here"));
    } else {
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
        } else done(true);
      });
      swapIn(body, form);
    }
  });
}
