import { h } from "@games/ui";

// What you see while Godot boots: real bytes from Godot's own preloader
// (godot/web/shell.html posts them up), never a made-up percentage. Copied
// from Blind Rally's StageLoader. Four states: downloading (total known, or
// not), starting, failed.

const MB = 1024 * 1024;
const mb = (n: number) => (n / MB).toFixed(1);

const TITLE = "Loading the map";
const HINT = "The round starts when everyone has the map.";

export class StageLoader {
  readonly el: HTMLElement;
  private title = h("p", { class: "th-load-title" }, TITLE);
  private fill = h("span", { class: "th-load-fill" });
  private bar = h("span", { class: "th-load-bar", role: "progressbar", "aria-label": "Map download" }, this.fill);
  private count = h("p", { class: "th-load-count" });
  private hint = h("p", { class: "th-load-hint" }, HINT);
  private retryBtn = h("button", { type: "button", class: "primary th-load-retry", hidden: true }, "Try again");

  constructor(onRetry: () => void) {
    this.el = h("div", { class: "th-boot", role: "status", "aria-live": "polite" }, h("div", { class: "th-load" }, this.title, this.bar, this.count, this.hint, this.retryBtn));
    this.retryBtn.addEventListener("click", () => {
      this.reset();
      onRetry();
    });
    this.reset();
  }

  progress(loaded: number, total: number) {
    if (total > 0) {
      const f = Math.min(1, loaded / total);
      this.el.dataset.state = "known";
      this.fill.style.transform = `scaleX(${f})`;
      this.bar.setAttribute("aria-valuemin", "0");
      this.bar.setAttribute("aria-valuemax", String(total));
      this.bar.setAttribute("aria-valuenow", String(loaded));
      this.bar.setAttribute("aria-valuetext", `${mb(loaded)} of ${mb(total)} MB`);
      this.count.textContent = `${mb(loaded)} of ${mb(total)} MB`;
      if (f >= 1) this.started();
    } else {
      // Godot only knows the total when every file's size does: say what's in, not how far.
      this.el.dataset.state = "unknown";
      for (const a of ["aria-valuemin", "aria-valuemax", "aria-valuenow"]) this.bar.removeAttribute(a);
      this.bar.setAttribute("aria-valuetext", `${mb(loaded)} MB loaded`);
      this.count.textContent = loaded > 0 ? `${mb(loaded)} MB loaded` : "Getting the files";
    }
  }

  /** Downloaded: the engine's compiling and the world's being built. No bytes left to count. */
  started() {
    this.el.dataset.state = "starting";
    this.fill.style.transform = "scaleX(1)";
    this.title.textContent = "Building the map";
    this.count.textContent = "";
  }

  failed(why: string) {
    this.el.dataset.state = "failed";
    this.title.textContent = "The map did not load";
    this.count.textContent = why;
    this.hint.textContent = "Try again.";
    this.retryBtn.hidden = false;
    this.el.setAttribute("role", "alert");
  }

  private reset() {
    this.el.dataset.state = "unknown";
    this.el.setAttribute("role", "status");
    this.title.textContent = TITLE;
    this.fill.style.transform = "scaleX(0)";
    this.count.textContent = "Getting the files";
    this.hint.textContent = HINT;
    this.retryBtn.hidden = true;
  }
}
