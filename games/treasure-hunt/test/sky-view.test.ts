import { describe, expect, it } from "vitest";
import { godotPhoto, type BridgeCall } from "../client/godot/bridge.ts";
import { GodotFeed, PhotoStore, photoList, skyMinute } from "../client/view.ts";
import type { PhotoCam, THPrivate, THPublic } from "../shared/types.ts";

// M4a Task 8: the page's half of the sky clock, and the photo clues.

type Sky = Pick<THPublic, "phase" | "sky" | "startedAt" | "replay">;
const NOW = 1_000_000;
const sky = (phase: THPublic["phase"], extra: Partial<Sky> = {}): Sky => ({ phase, sky: { startMin: 600 }, startedAt: null, replay: null, ...extra });
const cam = (x: number, z: number): PhotoCam => ({ x, z, yaw: 0.5, pitch: 0.1, fov: 24.5, target: "lighthouse" });
const priv = (photos: (PhotoCam | null)[]): THPrivate => ({
  teamId: 1,
  pins: [],
  hotcold: { used: false, unlockAt: null, active: null },
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
  const setup = (now = () => NOW, store?: PhotoStore) => {
    const sent: BridgeCall[][] = [];
    const feed = new GodotFeed((calls) => sent.push(calls), now, store ? (p) => store.has(p.id, p) : undefined);
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
    expect(of(last(), "photos")).toEqual({ list: [{ id: "c1", x: 10, z: 20, yaw: 0.5, pitch: 0.1, fov: 24.5 }] });
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

  // Review I1b: a reloaded iframe must not render a held photo again, later and darker.
  it("on ready, poses the page already holds an image for don't go again", () => {
    const store = new PhotoStore();
    const { feed, last } = setup(() => NOW, store);
    feed.update(priv([cam(10, 20), cam(-4, 7)]), "hunting", 1, null, null, null, sky("hunting", { startedAt: NOW }));
    feed.sync(true);
    expect(of(last(), "photos")?.list.map((p) => p.id)).toEqual(["c1", "c2"]);
    store.put({ id: "c1", ...cam(10, 20), data: "abc" });
    feed.sync(true);
    expect(of(last(), "photos")?.list.map((p) => p.id)).toEqual(["c2"]);
    store.put({ id: "c2", ...cam(-4, 7), data: "def" });
    feed.sync(true);
    expect(of(last(), "photos")).toBeUndefined();
    // A held image for an old pose doesn't count: c1's camera moved.
    feed.update(priv([cam(11, 20), cam(-4, 7)]), "hunting", 1, null, null, null, sky("hunting", { startedAt: NOW }));
    feed.sync();
    expect(of(last(), "photos")).toEqual({ list: [{ id: "c1", x: 11, z: 20, yaw: 0.5, pitch: 0.1, fov: 24.5 }] });
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
    expect(photoList(priv([null, cam(1, 2)]))).toEqual([{ id: "c2", x: 1, z: 2, yaw: 0.5, pitch: 0.1, fov: 24.5 }]);
    expect(photoList(null)).toEqual([]);
  });
});

describe("godotPhoto", () => {
  const ok = { id: "c1", x: 10, z: 20, yaw: 0.5, pitch: 0.1, fov: 24.5, data: "abc" };

  it("accepts an id, the whole pose, and base64 data", () => {
    expect(godotPhoto(ok)).toEqual(ok);
  });

  it("rejects a number, a missing id, a bad pose, and empty or oversized data", () => {
    expect(godotPhoto(5)).toBeNull();
    expect(godotPhoto({ ...ok, id: undefined })).toBeNull();
    expect(godotPhoto({ ...ok, x: "10" })).toBeNull();
    expect(godotPhoto({ ...ok, z: Infinity })).toBeNull();
    expect(godotPhoto({ ...ok, yaw: undefined })).toBeNull();
    expect(godotPhoto({ ...ok, pitch: NaN })).toBeNull();
    expect(godotPhoto({ ...ok, fov: "24.5" })).toBeNull();
    expect(godotPhoto({ id: "c1", data: "abc" })).toBeNull();
    expect(godotPhoto({ ...ok, data: 5 })).toBeNull();
    expect(godotPhoto({ ...ok, data: "" })).toBeNull();
    expect(godotPhoto({ ...ok, data: "a".repeat(400_001) })).toBeNull();
    expect(godotPhoto({ ...ok, data: "a".repeat(400_000) })).not.toBeNull();
  });
});

describe("PhotoStore", () => {
  it("keys by id and the whole pose, so a moved or rezoomed camera is a new photo", () => {
    const store = new PhotoStore();
    store.put({ id: "c1", ...cam(10, 20), data: "abc" });
    expect(store.get("c1", cam(10, 20))).toBe("data:image/jpeg;base64,abc");
    expect(store.has("c1", cam(10, 20))).toBe(true);
    expect(store.get("c1", cam(11, 20))).toBeUndefined();
    expect(store.get("c1", { ...cam(10, 20), yaw: 0.6 })).toBeUndefined();
    expect(store.get("c1", { ...cam(10, 20), pitch: 0.2 })).toBeUndefined();
    expect(store.has("c1", { ...cam(10, 20), fov: 30 })).toBe(false);
    expect(PhotoStore.key("c1", cam(10, 20))).toBe("c1|10,20,0.5,0.1,24.5");
  });

  it("an image for an old pose doesn't show under the clue's new pose", () => {
    const store = new PhotoStore();
    // The board moved c1's camera to (11, 20) while (10, 20) was rendering.
    store.put({ id: "c1", ...cam(10, 20), data: "old" });
    expect(store.get("c1", cam(11, 20))).toBeUndefined();
    store.put({ id: "c1", ...cam(11, 20), data: "new" });
    expect(store.get("c1", cam(11, 20))).toBe("data:image/jpeg;base64,new");
  });

  it("a new map empties it; the same map keeps it", () => {
    const store = new PhotoStore();
    store.forSeed(1);
    store.put({ id: "c1", ...cam(10, 20), data: "abc" });
    store.forSeed(1);
    expect(store.size).toBe(1);
    store.forSeed(2);
    expect(store.size).toBe(0);
  });
});
