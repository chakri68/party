import { describe, expect, it } from "vitest";
import { blindRallySettingFields, parseSettings, rulesPreview } from "../shared/rules-text.ts";
import { DEFAULT_SETTINGS, effectiveAssists, type BlindRallySettings } from "../shared/types.ts";
import { game, racing } from "./helpers.ts";

// Step 11: the M1 assists (spec §4.3). Presets, Custom, what the Navigator's
// session carries, and the preview everyone reads before ready-up.

const settings = (patch: Partial<BlindRallySettings>) => parseSettings({ ...DEFAULT_SETTINGS, ...patch })!;
const session = (patch: Partial<BlindRallySettings>) => {
  const nav = game.getPrivateState(racing([["p0", "p1"]], 2, patch), "p1");
  if (nav.role !== "navigator") throw new Error("p1 should navigate");
  return nav.session;
};

describe("assists", () => {
  it("Classic is the default: no live marker; trip meter, notes and the 3D view on", () => {
    expect(DEFAULT_SETTINGS.assists).toBe("classic");
    expect(effectiveAssists(DEFAULT_SETTINGS)).toEqual({ liveMarker: false, tripMeter: true, paceNotes: true, camera3d: true });
    expect(session({}).assists).toEqual({ liveMarker: false, tripMeter: true, paceNotes: true, camera3d: true });
  });

  it("Beginner is all on, Nightmare all off (map only), whatever Custom's toggles say", () => {
    const odd = { liveMarker: false, tripMeter: false, paceNotes: true, camera3d: false };
    expect(effectiveAssists(settings({ assists: "beginner", ...odd }))).toEqual({ liveMarker: true, tripMeter: true, paceNotes: true, camera3d: true });
    expect(effectiveAssists(settings({ assists: "nightmare", ...odd }))).toEqual({ liveMarker: false, tripMeter: false, paceNotes: false, camera3d: false });
    expect(session({ assists: "nightmare" }).assists.camera3d).toBe(false);
  });

  it("Custom is exactly the four toggles", () => {
    const s = settings({ assists: "custom", liveMarker: true, tripMeter: false, paceNotes: false, camera3d: false });
    expect(effectiveAssists(s)).toEqual({ liveMarker: true, tripMeter: false, paceNotes: false, camera3d: false });
    expect(session({ assists: "custom", liveMarker: true, tripMeter: false, paceNotes: false, camera3d: true }).assists).toEqual({ liveMarker: true, tripMeter: false, paceNotes: false, camera3d: true });
  });

  it("settings refuse junk", () => {
    expect(parseSettings({ assists: "godmode" })).toBeNull();
    expect(parseSettings({ liveMarker: "yes" })).toBeNull();
    // Old saved settings without assists get Classic.
    expect(parseSettings({ mode: "race", timeLimit: 5, camera: "free", weather: "clear", stageMode: "solo" })!.assists).toBe("classic");
  });

  it("the lobby shows a preset picker, and the toggles only for Custom", () => {
    const keys = (raw: unknown) => blindRallySettingFields(raw, 4).map((f) => f.key);
    expect(keys({})).toContain("assists");
    expect(keys({})).not.toContain("liveMarker");
    expect(keys({ assists: "custom" })).toEqual(expect.arrayContaining(["liveMarker", "tripMeter", "paceNotes", "camera3d"]));
    // Picking Custom starts from what's in force, so it's a tweak and not a surprise.
    const field = blindRallySettingFields({ assists: "beginner" }, 4).find((f) => f.key === "assists")!;
    expect(field.options.find((o) => o.label === "Custom")!.patch).toEqual({ assists: "custom", liveMarker: true, tripMeter: true, paceNotes: true, camera3d: true });
    // Every patch the lobby can send, merged the way the shell merges it, parses.
    for (const f of [...blindRallySettingFields({}, 4), ...blindRallySettingFields({ assists: "custom" }, 4)]) {
      for (const o of f.options) expect(parseSettings({ ...DEFAULT_SETTINGS, ...o.patch }), `${f.key} ${o.label}`).not.toBeNull();
    }
  });

  it("the rules preview spells the assists out", () => {
    const line = (raw: unknown) => rulesPreview(raw).find((r) => r.label === "Assists")!.value;
    expect(line({})).toBe("Classic: no live car marker, trip meter, pace notes, 3D camera");
    expect(line({ assists: "nightmare" })).toBe("Nightmare: no live car marker, no trip meter, no pace notes, no 3D camera");
    expect(line({ assists: "custom", liveMarker: true, tripMeter: false, paceNotes: true })).toBe("Custom: live car marker, no trip meter, pace notes, 3D camera");
    const cam = (raw: unknown) => rulesPreview(raw).find((r) => r.label === "Navigator camera")!.value;
    expect(cam({ assists: "nightmare", camera: "chase" })).toBe("None: map only");
    expect(cam({ camera: "chase" })).toBe("Chase only");
    expect(rulesPreview({}).map((r) => r.label)).toEqual(["Stage", "Time limit", "Assists", "Navigator camera", "Weather", "Reset", "Drop-outs"]);
  });
});
