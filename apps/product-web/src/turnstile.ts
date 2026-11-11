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

let widget: string | null = null;
let pending: { ok(t: string): void; fail(e: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;

function settle(f: (p: NonNullable<typeof pending>) => void): void {
  const p = pending;
  if (!p) return;
  clearTimeout(p.timer);
  pending = null;
  f(p);
}

/** One invisible challenge, one fresh token. Rejects if the script or the check fails. */
export async function getTurnstileToken(): Promise<string> {
  const [api, cfg] = await Promise.all([loadScript(), loadConfig()]);
  settle((p) => p.fail(new Error("replaced")));
  return new Promise<string>((ok, fail) => {
    // The widget is made once, so its callbacks read the current `pending`.
    const timer = setTimeout(() => settle((p) => p.fail(new Error("timeout"))), TIMEOUT_MS);
    pending = { ok, fail, timer };
    if (widget === null) {
      const host = document.createElement("div");
      document.body.append(host);
      widget = api.render(host, {
        sitekey: cfg.turnstileSiteKey,
        size: "invisible",
        execution: "execute",
        callback: (t: string) => settle((p) => p.ok(t)),
        "error-callback": () => settle((p) => p.fail(new Error("turnstile error"))),
        "timeout-callback": () => settle((p) => p.fail(new Error("turnstile timeout"))),
      });
    } else {
      api.reset(widget);
    }
    api.execute(widget);
  });
}
