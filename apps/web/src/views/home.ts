import { isValidRoomCode, MAX_NAME_LENGTH, normalizeName, normalizeRoomCode } from "@games/protocol";
import { h, type View } from "@games/ui";
import { getIdentity, setDisplayName } from "../identity.ts";
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

  mount(container: HTMLElement) {
    const name = nameInput(getIdentity().displayName);
    const code = h("input", {
      name: "code",
      placeholder: "ABCD",
      autocomplete: "off",
      autocapitalize: "characters",
      spellcheck: "false",
      maxlength: 4,
      class: "code-input",
      "aria-label": "Room code",
    });
    const error = h("p", { class: "form-error", role: "alert" });
    const createBtn = h("button", { type: "button", class: "primary" }, "Create room");

    const takeName = (): boolean => {
      const n = normalizeName(name.value);
      if (!n) {
        error.textContent = "Pick a name first.";
        name.focus();
        return false;
      }
      setDisplayName(n);
      return true;
    };

    createBtn.addEventListener("click", async () => {
      if (!takeName()) return;
      createBtn.disabled = true;
      error.textContent = "";
      try {
        const res = await fetch("/api/rooms", { method: "POST" });
        const body = (await res.json()) as { code?: string; error?: string };
        if (!res.ok || !body.code) throw new Error(body.error ?? "Couldn't create a room.");
        navigate(`/room/${body.code}`);
      } catch (e) {
        error.textContent = e instanceof Error && e.message ? e.message : "Couldn't create a room.";
        createBtn.disabled = false;
      }
    });

    const joinForm = h(
      "form",
      { class: "join" },
      code,
      h("button", { type: "submit" }, "Join"),
    );
    joinForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const c = normalizeRoomCode(code.value);
      if (!isValidRoomCode(c)) {
        error.textContent = "Room codes are four letters/numbers.";
        code.focus();
        return;
      }
      if (takeName()) navigate(`/room/${c}`);
    });

    this.root.append(
      h("h1", {}, "Party Games"),
      h("p", { class: "tagline" }, "No accounts. Just a name and a room code."),
      h("label", { class: "field" }, h("span", {}, "Name"), name),
      createBtn,
      h("div", { class: "or" }, "or join one"),
      joinForm,
      error,
    );
    container.append(this.root);
    (name.value ? code : name).focus();
  }

  update() {}

  destroy() {
    this.root.remove();
  }
}
