// A tiny History API router (§31). Patterns like "/room/:code".

import type { View } from "@games/ui";
import { devAs } from "./identity.ts";

type Params = Record<string, string>;
type Factory = (params: Params) => View;

const routes: { parts: string[]; factory: Factory }[] = [];
let current: View | null = null;
let outlet: HTMLElement;

export function register(pattern: string, factory: Factory) {
  routes.push({ parts: pattern.split("/").filter(Boolean), factory });
}

function match(path: string): { factory: Factory; params: Params } | null {
  const parts = path.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.parts.length !== parts.length) continue;
    const params: Params = {};
    const ok = route.parts.every((p, i) => {
      if (p.startsWith(":")) {
        params[p.slice(1)] = decodeURIComponent(parts[i]!);
        return true;
      }
      return p === parts[i];
    });
    if (ok) return { factory: route.factory, params };
  }
  return null;
}

export const APP_TITLE = "Party Games";

function render() {
  const found = match(location.pathname);
  if (!found) return navigate("/", { replace: true });
  current?.destroy();
  document.title = APP_TITLE; // views may refine it
  current = found.factory(found.params);
  current.mount(outlet);
  window.scrollTo(0, 0);
  // Screen readers otherwise stay parked on whatever was clicked (§38). Views
  // that focus something useful themselves (an input) win.
  if (!outlet.contains(document.activeElement)) {
    const main = outlet.querySelector("main");
    if (main) {
      main.tabIndex = -1;
      main.focus({ preventScroll: true });
    }
  }
}

/** Keeps the dev-only `?as=` identity namespace across navigation. */
function withDevQuery(path: string): string {
  return devAs ? `${path}?as=${encodeURIComponent(devAs)}` : path;
}

export function navigate(path: string, { replace = false } = {}) {
  const url = withDevQuery(path);
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  render();
}

/** Plain same-origin <a href="/…"> links navigate in-app; no per-link wiring needed. */
function onLinkClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element).closest("a");
  if (!a || a.target || a.origin !== location.origin || a.hasAttribute("download")) return;
  e.preventDefault();
  if (a.pathname !== location.pathname) navigate(a.pathname);
}

export function start(el: HTMLElement) {
  outlet = el;
  window.addEventListener("popstate", render);
  document.addEventListener("click", onLinkClick);
  render();
}
