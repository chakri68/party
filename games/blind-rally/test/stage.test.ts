import { describe, expect, it } from "vitest";
import { blindRallySettingFields, parseSettings, rulesPreview } from "../shared/rules-text.ts";
import { act, ctx, game, newGame, racing } from "./helpers.ts";

// Spec §7.4: the host picks Solo (each car its own copy of the road; the
// spec's "cross-track") or Shared (one road, rivals as ghosts), and a shared
// stage gets its one track the way Fair Race always has: the host's pick or
// one lobby-wide ballot (server/ballot.ts).

describe("stage mode selection", () => {
  it("is a lobby field, Solo by default, and the patch is a setting", () => {
    const field = blindRallySettingFields({}, 4).find((f) => f.key === "stageMode")!;
    expect(field.options.map((o) => o.label)).toEqual(["Solo", "Shared"]);
    expect(field.selected).toBe(0);
    const shared = parseSettings({ ...parseSettings({}), ...field.options[1]!.patch })!;
    expect(shared.stageMode).toBe("shared");
    expect(blindRallySettingFields(shared, 4).find((f) => f.key === "stageMode")!.selected).toBe(1);
  });

  it("is in the rules everyone sees before ready-up", () => {
    expect(rulesPreview({ stageMode: "shared" }).find((r) => r.label === "Stage")!.value).toBe("Shared: one road, rivals as ghosts");
    expect(rulesPreview({ stageMode: "solo" }).find((r) => r.label === "Stage")!.value).toBe("Solo: a road each");
  });

  it("shared with a team vote: one ballot, and its winner is every car's course", () => {
    let s = newGame(4, { stageMode: "shared", trackPick: "ballot" });
    s = act(s, "p0", { type: "team.join", teamId: 1, role: "driver" });
    s = act(s, "p1", { type: "team.join", teamId: 1, role: "navigator" });
    s = act(s, "p2", { type: "team.join", teamId: 2, role: "driver" });
    s = act(s, "p3", { type: "team.join", teamId: 2, role: "navigator" });
    const other = game.getPublicState(s).tracks.find((t) => t.id !== s.trackId)!.id;
    s = act(s, "p1", { type: "track.vote", trackId: other });
    s = act(s, "p3", { type: "track.vote", trackId: other });
    expect(s.ballots).toHaveLength(1);
    for (const id of ["p0", "p1", "p2", "p3"]) s = act(s, id, { type: "player.ready", ready: true });
    s = act(s, "p0", { type: "race.start" });
    for (const nav of ["p1", "p3"]) {
      const p = game.getPrivateState(s, nav);
      expect(p.role === "navigator" && p.session.trackId).toBe(other);
      expect(p.role === "navigator" && p.session.ghosts).toBe(true);
    }
  });

  it("shared with the host's pick: the host's track for everyone", () => {
    const pick = game.getPublicState(newGame(4)).tracks.at(-1)!.id;
    let s = newGame(4, { stageMode: "shared" });
    s = act(s, "p0", { type: "track.pick", trackId: pick }, ctx(0, "p0"));
    const raced = racing([["p0", "p1"], ["p2", "p3"]], 4, { stageMode: "shared" });
    expect(s.trackId).toBe(pick);
    expect(raced.settings.stageMode).toBe("shared");
  });
});
