// Loaded as a classic script in every page's <head>, so it runs before the
// first frame (see page-motion.css for the fade itself).
//
// - html.js lets the head CSS hide the rupee prices until landing.ts picks
//   the currency.
// - pagereveal hands over the incoming page fade, so content entrances can
//   wait for it (motion.ts whenSettled). document.activeViewTransition says
//   the same thing, but only in newer browsers; this event is older.
document.documentElement.classList.add("js");
addEventListener("pagereveal", (e) => {
  const vt = e.viewTransition;
  if (!vt) return;
  window.__pageTransition = vt;
  vt.finished.finally(() => {
    if (window.__pageTransition === vt) window.__pageTransition = null;
  });
});
