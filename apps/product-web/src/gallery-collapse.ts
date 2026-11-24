// On a phone the games list is long. Show the first few games and a button
// for the rest. The HTML lists every game, so with JS off nothing is hidden:
// this script is what hides them.

/** How many games a phone sees before "Show all". */
export const PHONE_FIRST = 8;

/** Hides every game after the first `first`, and adds a button that shows them all. Returns a function that does the same as the button. */
export function collapseList(list: HTMLElement, first: number): () => void {
  const games = [...list.querySelectorAll<HTMLElement>("li.game")];
  if (games.length <= first) return () => {};
  games.slice(first).forEach((g) => (g.hidden = true));
  const shelves = [...list.querySelectorAll<HTMLElement>(".shelf")];
  for (const s of shelves) s.hidden = s.querySelectorAll("li.game").length > 0 && [...s.querySelectorAll<HTMLElement>("li.game")].every((g) => g.hidden);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-small gallery-more";
  button.textContent = `Show all ${games.length} games`;
  button.setAttribute("aria-expanded", "false");
  const open = () => {
    button.setAttribute("aria-expanded", "true");
    games.forEach((g) => (g.hidden = false));
    shelves.forEach((s) => (s.hidden = false));
    button.remove();
  };
  button.addEventListener("click", open);
  list.append(button);
  return open;
}

/** Phones only. A visit to #games (the hero link) shows the whole list. */
export function bootGallery(list: HTMLElement | null = document.querySelector<HTMLElement>("[data-gallery]")): void {
  if (!list) return;
  const phone = matchMedia("(max-width: 599px)");
  if (!phone.matches) return;
  const open = collapseList(list, PHONE_FIRST);
  const wanted = () => location.hash === "#games" && open();
  wanted();
  addEventListener("hashchange", wanted);
  phone.addEventListener("change", () => !phone.matches && open());
}
