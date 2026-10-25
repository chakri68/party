import { h } from "@games/ui";

// What the Navigator sees while Godot boots: real bytes from Godot's own
// preloader (godot/web/shell.html posts them up), never a made-up percentage.
// Four states: downloading (total known, or not), starting, failed.

const MB = 1024 * 1024;
const mb = (n: number) => (n / MB).toFixed(1);

export class StageLoader {
  readonly el: HTMLElement;
  private title = h("p", { class: "br-load-title" }, "Loading the stage");
  private stage = h("p", { class: "br-load-stage" });
  private fill = h("span", { class: "br-load-fill" });
  private bar = h("span", { class: "br-load-bar", role: "progressbar", "aria-label": "Stage download" }, this.fill);
  private count = h("p", { class: "br-load-count" });
  private hint = h("p", { class: "br-load-hint" }, "The Driver can't move until this is in.");
  private retryBtn = h("button", { type: "button", class: "primary br-load-retry", hidden: true }, "Try again");

  constructor(onRetry: () => void) {
    this.el = h("div", { class: "br-boot", role: "status", "aria-live": "polite" }, h("div", { class: "br-load" }, this.stage, this.title, this.bar, this.count, this.hint, this.retryBtn));
    this.retryBtn.addEventListener("click", () => {
      this.reset();
      onRetry();
    });
    this.reset();
  }

  /** The stage's name, under the title, like the card at a stage start. */
  setStage(name: string) {
    this.stage.textContent = name;
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
      this.bar.setAttribute("aria-valuetext", `${mb(loaded)} MB so far`);
      this.count.textContent = loaded > 0 ? `${mb(loaded)} MB so far` : "Asking for the files";
    }
  }

  /** Downloaded: the engine's compiling and the scene's coming up. No bytes left to count. */
  started() {
    this.el.dataset.state = "starting";
    this.fill.style.transform = "scaleX(1)";
    this.title.textContent = "Starting the engine";
  }

  failed(why: string) {
    this.el.dataset.state = "failed";
    this.title.textContent = "The stage didn't load";
    this.count.textContent = why;
    this.hint.textContent = "Your Driver waits while you try again.";
    this.retryBtn.hidden = false;
    this.el.setAttribute("role", "alert");
  }

  private reset() {
    this.el.dataset.state = "unknown";
    this.el.setAttribute("role", "status");
    this.title.textContent = "Loading the stage";
    this.fill.style.transform = "scaleX(0)";
    this.count.textContent = "Asking for the files";
    this.hint.textContent = "The Driver can't move until this is in.";
    this.retryBtn.hidden = true;
  }
}
