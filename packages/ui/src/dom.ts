// The DOM helpers every view uses. Its own file so other ui modules (cards.ts)
// can use them without importing index.ts back.

export type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;
export type Child = Node | string | number | null | undefined | false;

/**
 * `h("button", { class: "x", onclick: fn }, "Play")`. Keys starting with `on`
 * become listeners; `false`/`null`/`undefined` attributes are skipped.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/** Replaces an element's children in one go. */
export function replaceChildren(el: Element, ...children: (Child | Child[])[]): void {
  el.replaceChildren(
    ...children.flat().filter((c): c is Node | string | number => c !== null && c !== undefined && c !== false).map((c) => (c instanceof Node ? c : String(c))),
  );
}
