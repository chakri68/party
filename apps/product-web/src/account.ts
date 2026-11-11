// /account: sign in when signed out; plan, codes, sign out and delete when signed in.

import { deleteAccount, loadConfig, logout, me, meOrNull, redeem, startEmailSignIn, type Me } from "./api.ts";
import { getTurnstileToken } from "./turnstile.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Host Pass until 12 Dec 2026", "Host Pass, no end date" or "Free". Local date. */
export function planLine(m: Me): string {
  if (m.tier !== "pass") return "Free";
  const end = m.plan?.endsAt ?? null;
  if (end === null) return "Host Pass, no end date";
  const d = new Date(end);
  return `Host Pass until ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Only same-site paths. Anything else goes back to this page. */
export function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/account";
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
  if (error === "link") say($("[data-out-error]"), "That link did not work. Ask for a new one.");

  void loadConfig().then((c) => {
    if (!c.googleEnabled) return;
    const google = $("[data-google]") as HTMLAnchorElement;
    google.href = `/api/auth/google?next=${encodeURIComponent(next)}`;
    google.hidden = false;
    $("[data-or]").hidden = false;
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
      form.hidden = true;
      status.dataset.tone = "good";
      say(status, `Check your email. We sent a sign-in link to ${email}. It works for 15 minutes.`);
    } else {
      status.dataset.tone = "bad";
      say(status, r.error);
    }
  });
}

function signedIn(m: Me): void {
  showView("in", true);
  $("[data-email]").textContent = m.email ?? "";
  const plan = $("[data-plan]");
  const show = (who: Me) => {
    plan.textContent = planLine(who);
    plan.dataset.tier = who.tier;
  };
  show(m);

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
      showView("in", false);
      showView("deleted", true);
      return;
    }
    yes.disabled = false;
    say(deleteStatus, r.error);
  });
}

export async function mountAccount(): Promise<void> {
  const url = new URL(location.href);
  const next = safeNext(url.searchParams.get("next"));
  const error = url.searchParams.get("error");
  const m = await meOrNull();
  if (m === null) {
    $("[data-view=loading]").textContent = "We could not load your account. Please refresh the page.";
    return;
  }
  showView("loading", false);
  if (m.email === null) signedOut(next, error);
  else signedIn(m);
}
