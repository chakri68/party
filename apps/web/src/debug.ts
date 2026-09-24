// Dev-only debug panel (§41). Loaded via a dynamic import behind
// `import.meta.env.DEV`, so none of this ships to production.
//
// Toggle with the ` key or the 🐞 button. It only ever shows *your* private
// state; opponents' hands never reach this client, debug or not.

import type { RoomClient, RoomUpdate } from "@games/room-client";
import { h, replaceChildren } from "@games/ui";

const STYLE = `
.dbg-toggle { position: fixed; left: 50%; top: 6px; transform: translateX(-50%); z-index: 1000; min-height: 32px; padding: 0 10px; opacity: .5; }
.dbg { position: fixed; inset: 44px auto auto 50%; transform: translateX(-50%); z-index: 1000; width: min(420px, calc(100vw - 24px));
  max-height: 70dvh; overflow: auto; padding: 12px; border-radius: 12px; background: #0b0f0dee;
  border: 1px solid #fff3; font: 12px/1.4 ui-monospace, monospace; display: grid; gap: 10px; }
.dbg[hidden] { display: none; }
.dbg h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #9fb2a6; }
.dbg pre { margin: 0; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-all; }
.dbg .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.dbg input, .dbg textarea, .dbg button { min-height: 30px; font: inherit; }
.dbg input[type=number] { width: 90px; }
.dbg textarea { width: 100%; min-height: 60px; background: #17221c; color: inherit; border: 1px solid #fff3; border-radius: 6px; }
`;

export function attachDebug(client: RoomClient, getLast: () => RoomUpdate | null): () => void {
  const style = h("style", {}, STYLE);
  const roomPre = h("pre");
  const privPre = h("pre");
  const info = h("div", { class: "muted" });

  const latency = h("input", { type: "number", min: 0, max: 5000, step: 100, value: client.simulate.latencyMs });
  latency.addEventListener("input", () => (client.simulate.latencyMs = Number(latency.value) || 0));
  const drop = h("input", { type: "number", min: 0, max: 90, step: 5, value: client.simulate.dropRate * 100 });
  drop.addEventListener("input", () => (client.simulate.dropRate = (Number(drop.value) || 0) / 100));

  const seed = h("input", { type: "number", placeholder: "seed" });
  const deck = h("textarea", { placeholder: "52 card ids, comma/space separated, dealt round-robin from left of dealer" });

  const panel = h(
    "div",
    { class: "dbg", hidden: true, role: "dialog", "aria-label": "Debug tools" },
    h("h3", {}, "Connection"),
    info,
    h("div", { class: "row" },
      h("button", { type: "button", onclick: () => client.reconnect() }, "Force reconnect"),
    ),
    h("div", { class: "row" }, "Latency ms", latency, "Drop %", drop),
    h("h3", {}, "Deal (host, server needs DEV_TOOLS=1)"),
    h("div", { class: "row" },
      seed,
      h("button", {
        type: "button",
        onclick: () => {
          if (!seed.value) seed.value = String(Math.floor(Math.random() * 1e9));
          console.info(`[debug] dealing seed ${seed.value}`);
          client.send({ type: "debug-start", seed: Number(seed.value) });
        },
      }, "Deal from seed"),
    ),
    deck,
    h("button", {
      type: "button",
      onclick: () => client.send({ type: "debug-start", deck: deck.value.split(/[\s,]+/).filter(Boolean) }),
    }, "Deal this deck"),
    h("h3", {}, "Room state"),
    roomPre,
    h("h3", {}, "My private state"),
    privPre,
  );

  const toggle = h("button", { type: "button", class: "dbg-toggle", "aria-label": "Debug tools" }, "🐞");
  const flip = () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) refresh();
  };
  toggle.addEventListener("click", flip);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "`" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) flip();
  };
  window.addEventListener("keydown", onKey);

  function refresh() {
    if (panel.hidden) return;
    const u = getLast();
    replaceChildren(
      info,
      `status: ${client.status} · player: ${client.playerId ?? "—"} · v${u?.stateVersion ?? "—"} · clock offset ${Math.round(client.clockOffset)} ms`,
    );
    roomPre.textContent = JSON.stringify(u?.room ?? null, null, 2);
    privPre.textContent = JSON.stringify(u?.private ?? null, null, 2);
  }
  const offUpdate = client.on("update", refresh);
  const offStatus = client.on("status", refresh);

  document.body.append(style, toggle, panel);
  if (new URLSearchParams(location.search).has("debug")) flip();

  return () => {
    offUpdate();
    offStatus();
    window.removeEventListener("keydown", onKey);
    style.remove();
    toggle.remove();
    panel.remove();
  };
}
