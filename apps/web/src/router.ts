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

function render() {
  current?.destroy();
  const found = match(location.pathname) ?? match("/")!;
  current = found.factory(found.params);
  current.mount(outlet);
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

export function start(el: HTMLElement) {
  outlet = el;
  window.addEventListener("popstate", render);
  render();
}
