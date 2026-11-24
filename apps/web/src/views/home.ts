import { isValidRoomCode, MAX_NAME_LENGTH, normalizeName, normalizeRoomCode } from "@games/protocol";
import { avatar, h, replaceChildren, type View } from "@games/ui";
import { brandMark, icon } from "../brand.ts";
import { getIdentity, recentRooms, rerollAvatar, setDisplayName, setOwnerKey } from "../identity.ts";
import { randomName } from "../names.ts";
import { navigate } from "../router.ts";
import { createLabel, type RoomSetup, type ShellHome, setupFromUrl, shellConfig } from "../shell.ts";
import { hasMySounds, mySoundsApi } from "../sounds/library.ts";
import { MY_SOUNDS_COPY } from "./my-sounds-model.ts";

export function nameInput(value: string) {
  return h("input", {
    name: "name",
    placeholder: "Your name",
    autocomplete: "nickname",
    maxlength: MAX_NAME_LENGTH,
    required: true,
    value,
  });
}

/**
 * Face + name + dice. Tap the face for a new one; the dice rolls both. The face
 * is saved straight away (it's just a seed); the name waits for submit, like
 * anything typed would.
 */
export function identityField(input: HTMLInputElement): HTMLElement {
  const face = h("button", { type: "button", class: "face-btn", "aria-label": "Change face" });
  const showFace = (spin: boolean) => {
    const me = getIdentity();
    replaceChildren(face, avatar(me.displayName, me.avatarSeed, "lg"));
    if (spin) face.firstElementChild?.animate([{ transform: "rotate(-200deg) scale(.6)" }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1.2)" });
  };
  face.addEventListener("click", () => {
    rerollAvatar();
    showFace(true);
  });
  showFace(false);

  const dice = h("button", { type: "button", class: "icon-btn dice-btn", "aria-label": "Random name and face" }, icon("dice"));
  dice.addEventListener("click", () => {
    input.value = randomName(input.value);
    rerollAvatar();
    showFace(true);
    dice.animate([{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }], { duration: 360, easing: "ease-out" });
  });

  return h(
    "div",
    { class: "identity" },
    face,
    h("label", { class: "field" }, h("span", {}, "Name"), input),
    dice,
  );
}

/** Set by the self-host CLI (scripts/host.mjs). There, everyone is a guest of the host. */
const SELF_HOSTED = import.meta.env.VITE_SELF_HOSTED === "1";
const HOST_COMMAND = "npx github:chakri68/party";

/**
 * On the main site only the owner creates rooms, so everyone else without a
 * code gets the one-liner to run their own.
 */
function hostYourOwn(): HTMLElement {
  const command = h("code", {}, HOST_COMMAND);
  const copy = h("button", { type: "button", class: "copy-btn" }, "Copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(HOST_COMMAND);
      copy.textContent = "Copied";
    } catch {
      // Clipboard blocked: select it so a long-press/Ctrl+C does the rest.
      getSelection()?.selectAllChildren(command);
    }
  });
  return h(
    "section",
    { class: "host-own" },
    h("h2", {}, "Host your own room"),
    h("p", {}, "You need an invite to make a room here. To get your own link, run this command on your laptop. It is free. You don't need an account."),
    h("div", { class: "command" }, command, copy),
    h(
      "p",
      { class: "fine" },
      "You need ",
      h("a", { href: "https://nodejs.org", target: "_blank", rel: "noopener" }, "Node.js 22+"),
      ". Keep the window open while you play.",
    ),
  );
}

export type HomePart = "hero" | "identity" | "create" | "my-sounds" | "join" | "error" | "recent" | "host";

/**
 * What the home page shows, top to bottom. Guests came to join, so the join form comes
 * first and the host card waits below it. The owner gets Create room first,
 * then My sounds when this phone owns a sound library.
 */
export function homeParts(isOwner: boolean, pitch: boolean, mySounds = false): HomePart[] {
  const create: HomePart[] = isOwner ? ["create", ...(mySounds ? (["my-sounds"] as const) : [])] : [];
  return ["hero", "identity", ...create, "join", "error", "recent", ...(pitch ? (["host"] as const) : [])];
}

/** The hero's words: a host app's own title and subtitle when set, else the logo and the usual line. */
export function heroWords(home: ShellHome | undefined, tagline: string): { title: string | null; tagline: string } {
  return { title: home?.title ?? null, tagline: home?.subtitle ?? tagline };
}

/** The create button's text: a room setup always names its game; else the host app's text, else "Create room". */
export function createText(setup: RoomSetup | undefined): string {
  return setup ? createLabel(setup) : (shellConfig().createText ?? createLabel(setup));
}

/** Logo over a lowercase wordmark with a lime full stop, or the host app's own title. */
function hero(usual: string) {
  const { title, tagline } = heroWords(shellConfig().home, usual);
  if (title !== null) return h("header", { class: "hero" }, h("h1", {}, title), h("p", { class: "tagline" }, tagline));
  return h(
    "header",
    { class: "hero" },
    brandMark(),
    h(
      "h1",
      { "aria-label": shellConfig().appTitle },
      shellConfig().brand.wordmark.split(" ").flatMap((w, i) => (i ? [h("br"), w] : [w])),
      h("span", { class: "dot", "aria-hidden": "true" }, "."),
    ),
    h("p", { class: "tagline" }, tagline),
  );
}

export class HomeView implements View {
  private root = h("main", { class: "home" });
  // Kept across re-renders so typed values survive unlocking/forgetting the key.
  private name = nameInput(getIdentity().displayName);
  private identity = identityField(this.name);
  private code = h("input", {
    name: "code",
    placeholder: "ABCD",
    autocomplete: "off",
    autocapitalize: "characters",
    spellcheck: "false",
    maxlength: 4,
    class: "code-input",
    "aria-label": "Room code",
  });
  private error = h("p", { class: "form-error", role: "alert" });
  // Read once, so a failed create leaves the same button for a retry.
  private setup: RoomSetup | undefined;
  /** This phone owns a sound library: show My sounds under Create. */
  private mySounds = false;
  private gone = false;
  /** The "or join one" line under Create (owner only): My sounds goes just before it. */
  private orJoin: HTMLElement | null = null;
  /** Closes an open My sounds dialog. */
  private closeMySounds: (() => void) | null = null;

  constructor() {
    void hasMySounds().then((yes) => {
      if (!yes || this.gone) return;
      this.mySounds = true;
      // In place, not a re-render: the focused field and the phone keyboard stay.
      if (this.orJoin?.isConnected) this.orJoin.before(this.mySoundsButton());
    });
  }

  mount(container: HTMLElement) {
    this.setup = setupFromUrl(new URL(location.href));
    this.render();
    const pageTitle = shellConfig().home?.pageTitle;
    if (pageTitle) document.title = pageTitle;
    container.append(this.root);
    (this.name.value ? this.code : this.name).focus();
  }

  private takeName(): boolean {
    const n = normalizeName(this.name.value);
    if (!n) {
      this.error.textContent = "Enter your name first.";
      this.name.focus();
      return false;
    }
    setDisplayName(n);
    return true;
  }

  private async createRoom(btn: HTMLButtonElement) {
    if (!this.takeName()) return;
    btn.disabled = true;
    // Waiting on the server: stays lime, not the greyed "can't press" look.
    btn.setAttribute("aria-busy", "true");
    this.error.textContent = "";
    try {
      const res = await shellConfig().createRoom(this.setup);
      if ("error" in res) {
        // Wrong or rotated key: forget it so the unlock form comes back.
        if (res.forgetKey) {
          setOwnerKey(null);
          this.render();
        }
        throw new Error(res.error);
      }
      navigate(`/room/${res.code}`);
    } catch (e) {
      this.error.textContent = e instanceof Error && e.message ? e.message : "Couldn't create a room.";
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
  }

  private render() {
    const isOwner = shellConfig().canCreate();
    const pitch = !isOwner && !SELF_HOSTED;

    const joinForm = h("form", { class: "join" }, this.code, h("button", { type: "submit", class: isOwner ? "" : "primary" }, "Join"));
    joinForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const c = normalizeRoomCode(this.code.value);
      if (!isValidRoomCode(c)) {
        this.error.textContent = "A room code has 4 letters or numbers.";
        this.code.focus();
        return;
      }
      if (this.takeName()) navigate(`/room/${c}`);
    });

    const create = h("button", { type: "button", class: "primary" }, createText(this.setup));
    create.addEventListener("click", () => void this.createRoom(create));
    const orJoin = h("div", { class: "or" }, "or join one");
    this.orJoin = orJoin;

    const recent = recentRooms();
    const parts: Record<HomePart, Node | Node[] | null> = {
      hero: hero(isOwner ? "You don't need an account. Enter a name and a room code." : pitch ? "Play card games and drawing games with friends. Use any phone." : "Have a room code? Enter it here."),
      identity: this.identity,
      create: this.mySounds ? create : [create, orJoin],
      "my-sounds": [this.mySoundsButton(), orJoin],
      join: joinForm,
      error: this.error,
      recent: recent.length
        ? h(
            "div",
            { class: "recent" },
            h("span", { class: "muted" }, "Go back to your last room"),
            recent.map((c) =>
              h("a", { href: `/room/${c}`, class: "recent-room", "aria-label": `Rejoin room ${c}` }, h("span", {}, "Rejoin ", h("b", {}, c)), icon("arrow-right")),
            ),
          )
        : null,
      host: [h("div", { class: "or" }, "want your own room?"), hostYourOwn()],
    };
    replaceChildren(this.root, ...homeParts(isOwner, pitch, this.mySounds).map((k) => parts[k]));
  }

  private mySoundsButton(): HTMLButtonElement {
    const btn = h("button", { type: "button", class: "home-my-sounds" }, MY_SOUNDS_COPY.title);
    btn.addEventListener("click", () => {
      this.error.textContent = "";
      // The dialog and its mp3 encoder load only when asked for.
      void import("./my-sounds.ts")
        .then((m) => {
          if (this.gone) return;
          this.closeMySounds = m.openMySounds({ api: mySoundsApi(), onClose: () => (this.closeMySounds = null) });
        })
        .catch(() => (this.error.textContent = MY_SOUNDS_COPY.loadFailed));
    });
    return btn;
  }

  update() {}

  destroy() {
    this.gone = true;
    this.closeMySounds?.();
    this.root.remove();
  }
}
