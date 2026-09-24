import { isValidRoomCode, MAX_NAME_LENGTH, normalizeName, normalizeRoomCode } from "@games/protocol";
import { avatar, h, replaceChildren, type View } from "@games/ui";
import { brandMark, icon } from "../brand.ts";
import { getIdentity, getOwnerKey, recentRooms, rerollAvatar, setDisplayName, setOwnerKey } from "../identity.ts";
import { randomName } from "../names.ts";
import { navigate } from "../router.ts";

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
  const face = h("button", { type: "button", class: "face-btn", "aria-label": "New face" });
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

/** Logo over a lowercase wordmark with a lime full stop. */
function hero(tagline: string) {
  return h(
    "header",
    { class: "hero" },
    brandMark(),
    h("h1", { "aria-label": "Party Games" }, "party", h("br"), "games", h("span", { class: "dot", "aria-hidden": "true" }, ".")),
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

  mount(container: HTMLElement) {
    this.render();
    container.append(this.root);
    (this.name.value ? this.code : this.name).focus();
  }

  private takeName(): boolean {
    const n = normalizeName(this.name.value);
    if (!n) {
      this.error.textContent = "Pick a name first.";
      this.name.focus();
      return false;
    }
    setDisplayName(n);
    return true;
  }

  private async createRoom(btn: HTMLButtonElement) {
    if (!this.takeName()) return;
    btn.disabled = true;
    this.error.textContent = "";
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { authorization: `Bearer ${getOwnerKey() ?? ""}` },
      });
      const body = (await res.json()) as { code?: string; error?: string };
      if (res.status === 403) {
        // Wrong or rotated key: forget it so the unlock form comes back.
        setOwnerKey(null);
        this.render();
      }
      if (!res.ok || !body.code) throw new Error(body.error ?? "Couldn't create a room.");
      navigate(`/room/${body.code}`);
    } catch (e) {
      this.error.textContent = e instanceof Error && e.message ? e.message : "Couldn't create a room.";
      btn.disabled = false;
    }
  }

  private render() {
    const isOwner = !!getOwnerKey();

    const joinForm = h("form", { class: "join" }, this.code, h("button", { type: "submit", class: isOwner ? "" : "primary" }, "Join"));
    joinForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const c = normalizeRoomCode(this.code.value);
      if (!isValidRoomCode(c)) {
        this.error.textContent = "Room codes are four letters/numbers.";
        this.code.focus();
        return;
      }
      if (this.takeName()) navigate(`/room/${c}`);
    });

    const create = h("button", { type: "button", class: "primary" }, "Create room");
    create.addEventListener("click", () => void this.createRoom(create));

    const recent = recentRooms();
    replaceChildren(
      this.root,
      hero(isOwner ? "No accounts. Just a name and a room code." : "Got a room code? Pop it in."),
      this.identity,
      isOwner ? [create, h("div", { class: "or" }, "or join one")] : null,
      joinForm,
      this.error,
      recent.length
        ? h(
            "div",
            { class: "recent" },
            h("span", { class: "muted" }, "Pick up where you left off"),
            recent.map((c) =>
              h("a", { href: `/room/${c}`, class: "recent-room", "aria-label": `Rejoin room ${c}` }, h("span", {}, "Rejoin ", h("b", {}, c)), icon("arrow-right")),
            ),
          )
        : null,
    );
  }

  update() {}

  destroy() {
    this.root.remove();
  }
}
