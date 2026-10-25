import { describe, expect, it } from "vitest";
import file from "../data/tracks.json";
import { trackData } from "../server/geometry.ts";
import { parseTrackFile, recoveryFor, trackFileProblems, trackProblems, type TrackData } from "../shared/track-data.ts";
import { TRACKS } from "../shared/tracks-public.ts";

// The track data contract (spec §14 "Track data contract tests").
// godot/tools/export_tracks.gd writes the file from the track scenes; these
// are what the export has to pass.

const tracks = () => structuredClone(file.tracks) as unknown as TrackData[];
const pine = () => tracks()[0]!;
/** Problems with one edited copy of Pine Panic. */
const with_ = (edit: (t: TrackData) => void) => {
  const t = pine();
  edit(t);
  return trackProblems(t);
};

describe("data/tracks.json", () => {
  it("passes the contract as committed", () => {
    expect(trackFileProblems(file)).toEqual([]);
    expect(() => parseTrackFile(file)).not.toThrow();
  });

  it("has exactly the public tracks, with the same names, difficulty and par", () => {
    const data = parseTrackFile(file);
    expect(data.map((t) => t.id).sort()).toEqual(TRACKS.map((t) => t.id).sort());
    for (const p of TRACKS) {
      const t = trackData(p.id);
      expect({ id: t.id, name: t.name, difficulty: t.difficulty, par_seconds: t.par_seconds }).toEqual(p);
    }
  });
});

describe("track contract", () => {
  it("unique ids", () => {
    const twice = { version: 1, tracks: [pine(), pine()] };
    expect(trackFileProblems(twice)).toContain("pine_panic: duplicate track id");
    expect(() => parseTrackFile(twice)).toThrow(/duplicate track id/);
  });

  it("checkpoints numbered 1..n in driving order, each further along than the last", () => {
    expect(with_((t) => t.checkpoints.reverse())).not.toEqual([]);
    expect(with_((t) => (t.checkpoints[2]!.id = 7))).toContain("pine_panic: checkpoint 3: ids must run 1..n in order (got 7)");
    expect(with_((t) => (t.checkpoints[2]!.distance = t.checkpoints[1]!.distance))).toContain("pine_panic: checkpoint 3: distance must be past the one before");
    expect(with_((t) => (t.checkpoints = []))).toContain("pine_panic: needs at least one checkpoint");
    expect(with_((t) => (t.checkpoints[0]!.radius = 0))).toContain("pine_panic: checkpoint 1: radius must be > 0");
  });

  it("spawn and finish present, finish after the last checkpoint", () => {
    expect(with_((t) => delete (t as Partial<TrackData>).spawn)).toContain("pine_panic: spawn missing");
    expect(with_((t) => delete (t as Partial<TrackData>).finish)).toContain("pine_panic: finish missing");
    expect(with_((t) => (t.finish.distance = 10))).toContain("pine_panic: finish must come after the last checkpoint");
  });

  it("everything inside the bounds", () => {
    expect(with_((t) => (t.spawn.position = [9_999, 0, 0]))).toContain("pine_panic: spawn is outside the bounds");
    expect(with_((t) => (t.checkpoints[1]!.position = [0, 0, -9_999]))).toContain("pine_panic: checkpoint 2 is outside the bounds");
    expect(with_((t) => (t.finish.position = [-9_999, 0, 0]))).toContain("pine_panic: finish is outside the bounds");
    expect(with_((t) => (t.recovery[3]!.position = [0, 0, 9_999]))).toContain("pine_panic: recovery anchor 3 is outside the bounds");
    expect(with_((t) => (t.landmarks[0]!.position = [9_999, 0, 9_999]))).toContain(`pine_panic: landmark ${pine().landmarks[0]!.id} is outside the bounds`);
    expect(with_((t) => (t.bounds.width = -1))).toContain("pine_panic: bounds must be {x, z, width > 0, depth > 0}");
  });

  it("pace notes sorted by distance, inside the route", () => {
    expect(with_((t) => t.paceNotes.reverse())).toContain("pine_panic: pace note 1: notes must be sorted by distance");
    expect(with_((t) => (t.paceNotes.at(-1)!.distance = t.length + 1))).toContain(`pine_panic: pace note ${pine().paceNotes.length - 1}: distance must be within 0..length`);
    expect(with_((t) => (t.paceNotes[3]!.text = ""))).toContain("pine_panic: pace note 3: needs text");
    // Two notes at one spot ("bridge", then "LEFT 3" right after it) is fine.
    expect(with_((t) => (t.paceNotes[2]!.distance = t.paceNotes[1]!.distance))).toEqual([]);
  });

  it("par is null until calibrated, or a positive number", () => {
    expect(with_((t) => (t.par_seconds = null))).toEqual([]);
    expect(with_((t) => (t.par_seconds = 95))).toEqual([]);
    expect(with_((t) => (t.par_seconds = 0))).toContain("pine_panic: par_seconds must be null or > 0");
    expect(with_((t) => ((t as { par_seconds: unknown }).par_seconds = "90"))).toContain("pine_panic: par_seconds must be null or > 0");
  });

  it("a recovery anchor at the start, at most one per checkpoint, none past the last", () => {
    expect(with_((t) => t.recovery.shift())).toContain("pine_panic: needs a recovery anchor at the start (afterCheckpoint 0)");
    expect(with_((t) => (t.recovery[2]!.afterCheckpoint = 1))).toContain("pine_panic: recovery anchor 2: two anchors after checkpoint 1");
    expect(with_((t) => (t.recovery[2]!.afterCheckpoint = 6))).toContain("pine_panic: recovery anchor 2: afterCheckpoint must be 0..5");
  });

  it("the rest of the header: revision, name, difficulty, length", () => {
    expect(with_((t) => (t.revision = 0))).toContain("pine_panic: revision must be a positive integer");
    expect(with_((t) => ((t as { difficulty: string }).difficulty = "spicy"))).toContain("pine_panic: difficulty must be one of easy, medium, hard");
    expect(with_((t) => (t.length = 0))).toContain("pine_panic: length must be > 0");
    expect(trackProblems(null)).toEqual(["not an object"]);
    expect(trackFileProblems({ tracks: [] })).toEqual(["expected {version: 1, tracks: [...]}"]);
  });

  it("a reset lands on the last anchor at or before the checkpoints passed (track.gd's recovery_for)", () => {
    const t = pine();
    expect(recoveryFor(t, 0).position).toEqual(t.spawn.position);
    expect(recoveryFor(t, 3).position).toEqual(t.recovery[3]!.position);
    // Missing an anchor: fall back to the one before, never ahead.
    t.recovery = t.recovery.filter((a) => a.afterCheckpoint !== 3);
    expect(recoveryFor(t, 3).position).toEqual(t.recovery[2]!.position);
  });
});
