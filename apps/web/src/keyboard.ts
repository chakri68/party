// The on-screen keyboard. Phones don't shrink the page when it opens:
// they shrink the *visual* viewport and pan it to keep the focused box in view,
// so half the screen is keyboard and the page has no idea. This watches the
// visual viewport and tells CSS what's actually visible:
//
//   html.kb-open   a text box has focus and the keyboard is covering the page
//   --vvh          visible height, px
//   --vv-top       how far the visible area is panned down the page, px
//   --kb           how much of the bottom is keyboard, px
//
// Games read these from their stylesheets (`html.kb-open .my-game { … }`); no
// game code needs to know. Desktop never trips it: no keyboard, no shrink.

/** Less than this and it's a browser toolbar sliding, not a keyboard. */
const MIN_KEYBOARD = 120;

function typing(): boolean {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (!(el instanceof HTMLInputElement) || el.readOnly) return false;
  return !["button", "checkbox", "radio", "range", "color", "file", "submit", "reset", "image"].includes(el.type);
}

export function watchKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let frame = 0;

  const measure = () => {
    frame = 0;
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    // Pinch-zoom shrinks the visual viewport too; that's not a keyboard.
    const open = typing() && vv.scale < 1.05 && window.innerHeight - vv.height > MIN_KEYBOARD;
    root.style.setProperty("--vvh", `${vv.height}px`);
    root.style.setProperty("--vv-top", `${vv.offsetTop}px`);
    root.style.setProperty("--kb", `${open ? kb : 0}px`);
    root.classList.toggle("kb-open", open);
  };
  const schedule = () => (frame ||= requestAnimationFrame(measure));

  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
  // Focus moves before the keyboard animates; measure again once it settles.
  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", () => setTimeout(schedule, 50));
  measure();
}
