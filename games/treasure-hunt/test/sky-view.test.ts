import { describe, expect, it } from "vitest";
import { godotPhoto, type BridgeCall } from "../client/godot/bridge.ts";
import { GodotFeed, PhotoStore, photoList, skyMinute } from "../client/view.ts";
import type { PhotoCam, THPrivate, THPublic } from "../shared/types.ts";

// M4a Task 8: the page's half of the sky clock, and the photo clues.

type Sky = Pick<THPublic, "phase" | "sky" | "startedAt" | "replay">;
const NOW = 1_000_000;
const sky = (phase: THPublic["phase"], extra: Partial<Sky> = {}): Sky => ({ phase, sky: { startMin: 600 }, startedAt: null, replay: null, ...extra });
const cam = (x: number, z: number): PhotoCam => ({ x, z, yaw: 0.5, pitch: 0.1, target: "lighthouse" });
const priv = (photos: (PhotoCam | null)[]): THPrivate => ({
  teamId: 1,
  pins: [],
  revealed: [],
  clues: photos.map((photo, i) => ({ id: `c${i + 1}`, clues: ["a"], difficulty: 2, found: false, taken: false, photo })),
});

describe("skyMinute", () => {
  it("runs from startMin in hunting", () => {
    expect(skyMinute(sky("hunting", { startedAt: NOW - 90_000 }), NOW)).toBe(601.5);
  });

  it("sits at startMin before the hunt", () => {
    expect(skyMinute(sky("teams"), NOW)).toBe(600);
    expect(skyMinute(sky("countdown"), NOW)).toBe(600);
  });

  it("stops at the round's end when finished", () => {
    const replay = { durationS: 1800, tracks: [], finds: [] };
    expect(skyMinute(sky("finished", { startedAt: NOW - 5_000_000, replay }), NOW)).toBe(630);
  });
});

describe("GodotFeed, the sky and the photos", () => {
  const setup = (now = () => NOW) => {
    const sent: BridgeCall[][] = [];
    const feed = new GodotFeed((calls) => sent.push(calls), now);
    return { feed, sent, last: () => sent[sent.length - 1]! };
  };
  const fns = (calls: BridgeCall[]) => calls.map((c) => c.fn);
  const of = <F extends BridgeCall["fn"]>(calls: BridgeCall[], fn: F) => calls.find((c) => c.fn === fn)?.arg as Extract<BridgeCall, { fn: F }>["arg"] | undefined;

  // Review Focus 1: a reload mid-round puts the sky at the right minute at once.
  it("on ready in hunting: skyClock at the current minute, running, and the photo poses", () => {
    const { feed, last } = setup();
    feed.update(priv([cam(10, 20), null]), "hunting", 1, null, null, null, sky("hunting", { startedAt: NOW - 90_000 }));
    feed.sync(true);
    expect(of(last(), "skyClock")).toEqual({ min: 601.5, running: true });
    expect(of(last(), "photos")).toEqual({ list: [{ id: "c1", x: 10, z: 20, yaw: 0.5, pitch: 0.1 }] });
    expect(fns(last())[last().length - 1]).toBe("setPhase");
  });

  it("the clock goes on every sync and stops outside hunting", () => {
    const { feed, sent } = setup();
    feed.update(priv([]), "teams", 1, null, null, null, sky("teams"));
    feed.sync();
    feed.sync();
    expect(sent.map((c) => of(c, "skyClock"))).toEqual([
      { min: 600, running: false },
      { min: 600, running: false },
    ]);
  });

  it("photos go when the clues change, and again on ready, not on every sync", () => {
    const { feed, sent, last } = setup();
    feed.update(priv([cam(10, 20)]), "hunting", 1, null, null, null, sky("hunting", { startedAt: NOW }));
    feed.sync();
    expect(of(last(), "photos")?.list).toHaveLength(1);
    feed.sync();
    expect(of(last(), "photos")).toBeUndefined();
    feed.update(priv([cam(10, 20), cam(-4, 7)]), "hunting", 1, null, null, null, sky("hunting", { startedAt: NOW }));
    feed.sync();
    expect(of(last(), "photos")?.list.map((p) => p.id)).toEqual(["c1", "c2"]);
    feed.sync(true);
    expect(of(last(), "photos")?.list).toHaveLength(2);
    expect(sent).toHaveLength(4);
  });

  it("no photos call while there are none to send", () => {
    const { feed, last } = setup();
    feed.update(priv([null]), "hunting", 1, null, null, null, sky("hunting", { startedAt: NOW }));
    feed.sync(true);
    expect(of(last(), "photos")).toBeUndefined();
  });
});

describe("photoList", () => {
  it("only clues with a camera, pose only", () => {
    expect(photoList(priv([null, cam(1, 2)]))).toEqual([{ id: "c2", x: 1, z: 2, yaw: 0.5, pitch: 0.1 }]);
    expect(photoList(null)).toEqual([]);
  });
});

describe("godotPhoto", () => {
  it("accepts an id and base64 data", () => {
    expect(godotPhoto({ id: "c1", data: "abc" })).toEqual({ id: "c1", data: "abc" });
  });

  it("rejects a number, a missing id and oversized data", () => {
    expect(godotPhoto(5)).toBeNull();
    expect(godotPhoto({ data: "abc" })).toBeNull();
    expect(godotPhoto({ id: "c1", data: 5 })).toBeNull();
    expect(godotPhoto({ id: "c1", data: "a".repeat(400_001) })).toBeNull();
    expect(godotPhoto({ id: "c1", data: "a".repeat(400_000) })).not.toBeNull();
  });
});

describe("PhotoStore", () => {
  it("keys by id and pose, so a moved camera is a new photo", () => {
    const store = new PhotoStore();
    store.put("c1", "abc", priv([cam(10, 20)]));
    expect(store.get("c1", cam(10, 20))).toBe("data:image/jpeg;base64,abc");
    expect(store.get("c1", cam(11, 20))).toBeUndefined();
    expect(PhotoStore.key("c1", cam(10, 20))).toBe("c1|10,20");
  });

  it("drops a photo for a clue that has no camera now", () => {
    const store = new PhotoStore();
    store.put("c9", "abc", priv([cam(10, 20)]));
    expect(store.size).toBe(0);
  });
});
