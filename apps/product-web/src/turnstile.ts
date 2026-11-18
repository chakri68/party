import { loadConfig } from "./api.ts";

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TIMEOUT_MS = 15_000;

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  execute(id: string): void;
  reset(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;
function loadScript(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("no turnstile")));
    s.onerror = () => reject(new Error("load failed"));
    document.head.append(s);
  });
  loading.catch(() => (loading = null));
  return loading;
}

/** Documented options only. interaction-only shows the widget when a visitor must act. */
export function renderOptions(sitekey: string, callbacks: { ok(t: string): void; fail(): void }): Record<string, unknown> {
  return {
    sitekey,
    execution: "execute",
    appearance: "interaction-only",
    callback: callbacks.ok,
    "error-callback": callbacks.fail,
    "timeout-callback": callbacks.fail,
  };
}

let widget: string | null = null;
let pending: { ok(t: string): void; fail(e: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;

function settle(f: (p: NonNullable<typeof pending>) => void): void {
  const p = pending;
  if (!p) return;
  clearTimeout(p.timer);
  pending = null;
  f(p);
}

/** The widget, made once; its callbacks read the current `pending`. execution "execute": rendering runs no check. */
function ensureWidget(api: TurnstileApi, sitekey: string): string {
  if (widget !== null) return widget;
  const host = document.createElement("div");
  // Fixed in a corner: an interactive challenge stays visible without moving the page.
  host.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647";
  document.body.append(host);
  widget = api.render(
    host,
    renderOptions(sitekey, {
      ok: (t) => settle((p) => p.ok(t)),
      fail: () => settle((p) => p.fail(new Error("turnstile failed"))),
    }),
  );
  return widget;
}

/**
 * Loads the script and makes the widget ahead of time, so a tap on "Create
 * room" only runs the check. Runs no check itself; failures are left for
 * getTurnstileToken to retry and report.
 */
export function warmTurnstile(): void {
  Promise.all([loadScript(), loadConfig()]).then(
    ([api, cfg]) => void ensureWidget(api, cfg.turnstileSiteKey),
    () => {},
  );
}

/** One invisible challenge, one fresh token. Rejects if the script or the check fails. */
export async function getTurnstileToken(): Promise<string> {
  const [api, cfg] = await Promise.all([loadScript(), loadConfig()]);
  settle((p) => p.fail(new Error("replaced")));
  return new Promise<string>((ok, fail) => {
    const timer = setTimeout(() => settle((p) => p.fail(new Error("timeout"))), TIMEOUT_MS);
    pending = { ok, fail, timer };
    const fresh = widget === null;
    const id = ensureWidget(api, cfg.turnstileSiteKey);
    // A used (or warmed and idle) widget is reset before it runs again.
    if (!fresh) api.reset(id);
    api.execute(id);
  });
}
