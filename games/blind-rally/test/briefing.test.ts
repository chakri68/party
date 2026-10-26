import { describe, expect, it } from "vitest";
import { KEYS } from "../client/driver/input.ts";
import { roleBriefing } from "../shared/rules-text.ts";
import { DEFAULT_SETTINGS, type BlindRallySettings } from "../shared/types.ts";

// The pre-race card says what each seat can press. It's hand-written next to
// the bindings it describes, so these hold it to them and to the settings.

const brief = (role: "driver" | "navigator", patch: Partial<BlindRallySettings> = {}) => roleBriefing(role, { ...DEFAULT_SETTINGS, ...patch });
const labels = (role: "driver" | "navigator", patch: Partial<BlindRallySettings> = {}) => brief(role, patch).lines.map((l) => l.label);
const chips = (role: "driver" | "navigator", patch: Partial<BlindRallySettings> = {}) => brief(role, patch).lines.flatMap((l) => l.keys.flat());

describe("pre-race briefing", () => {
  it("names every Driver key input.ts listens to, and no other", () => {
    const shown: Record<string, string> = { KeyA: "A", KeyD: "D", KeyW: "W", KeyS: "S", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };
    expect(Object.keys(KEYS).map((k) => shown[k]).sort()).toEqual(chips("driver").sort());
    expect(labels("driver")).toEqual(expect.arrayContaining(["Reset car", "Compass"]));
  });

  it("gives the Navigator only the controls this race has", () => {
    // Classic: no live marker, so no G; free camera, so Y.
    expect(labels("navigator", { assists: "classic" })).not.toContain("GPS");
    expect(chips("navigator", { assists: "classic" })).toEqual(expect.arrayContaining(["Y", "M", "N"]));
    expect(labels("navigator", { assists: "beginner" })).toContain("GPS");
    expect(chips("navigator", { assists: "beginner" })).toContain("G");
    // A locked camera has nothing to cycle.
    const locked = brief("navigator", { camera: "chase" }).lines.find((l) => l.label === "Camera")!;
    expect(locked.keys).toEqual([]);
    expect(locked.text).toMatch(/Chase only/);
    // Nightmare is map only: no camera, zoom or map key, and no notes or trip meter either.
    const night = labels("navigator", { assists: "nightmare" });
    for (const gone of ["Camera", "Zoom", "Pace notes", "Trip meter", "GPS"]) expect(night).not.toContain(gone);
    expect(chips("navigator", { assists: "nightmare" })).not.toContain("M");
  });
});
