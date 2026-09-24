import { isValidRoomCode, MAX_NAME_LENGTH, normalizeName, normalizeRoomCode } from "@games/protocol";
import { h, replaceChildren, type View } from "@games/ui";
import { getIdentity, getOwnerKey, recentRooms, setDisplayName, setOwnerKey } from "../identity.ts";
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

export class HomeView implements View {
  private root = h("main", { class: "home" });
  // Kept across re-renders so typed values survive unlocking/forgetting the key.
  private name = nameInput(getIdentity().displayName);
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

    let ownerBlock: Node;
    if (isOwner) {
      const create = h("button", { type: "button", class: "primary" }, "Create room");
      create.addEventListener("click", () => void this.createRoom(create));
      ownerBlock = create;
    } else {
      // Tucked away: friends only ever need the code.
      const key = h("input", { type: "password", name: "owner-key", placeholder: "Owner key", autocomplete: "current-password" });
      const unlock = h("form", { class: "join" }, key, h("button", { type: "submit" }, "Unlock"));
      unlock.addEventListener("submit", (e) => {
        e.preventDefault();
        if (!key.value.trim()) return key.focus();
        setOwnerKey(key.value.trim());
        this.error.textContent = "";
        this.render();
      });
      ownerBlock = h("details", { class: "owner-unlock" }, h("summary", {}, "I'm the owner"), unlock);
    }

    const recent = recentRooms();
    replaceChildren(
      this.root,
      h("h1", {}, "Party Games"),
      h("p", { class: "tagline" }, isOwner ? "No accounts. Just a name and a room code." : "Got a room code? Pop it in."),
      h("label", { class: "field" }, h("span", {}, "Name"), this.name),
      isOwner ? [ownerBlock, h("div", { class: "or" }, "or join one")] : null,
      joinForm,
      this.error,
      recent.length
        ? h(
            "div",
            { class: "recent" },
            h("span", { class: "muted" }, "Pick up where you left off"),
            recent.map((c) => h("a", { href: `/room/${c}`, class: "recent-room" }, `Rejoin ${c}`)),
          )
        : null,
      isOwner
        ? h("button", { type: "button", class: "link forget", onclick: () => (setOwnerKey(null), this.render()) }, "Forget owner key on this device")
        : ownerBlock,
    );
  }

  update() {}

  destroy() {
    this.root.remove();
  }
}
