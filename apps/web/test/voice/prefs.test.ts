import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_PREFS, voicePrefs } from "../../src/voice/prefs.ts";
import { memoryStore } from "./fake-store.ts";

describe("voicePrefs", () => {
  it("gives the defaults on an empty store", () => {
    const prefs = voicePrefs(memoryStore());
    expect(prefs.get()).toEqual(DEFAULT_VOICE_PREFS);
    expect(DEFAULT_VOICE_PREFS).toEqual({
      micDeviceId: null,
      outputDeviceId: null,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      mode: "open",
      deafenAlsoMutes: false,
      relayOnly: false,
      duck: true,
    });
    expect(prefs.room("ABCD")).toEqual({ on: false, mic: "on", volumes: {}, blocked: [] });
  });

  it("gives the defaults on bad JSON or bad fields", () => {
    const store = memoryStore();
    store.write("voice", "{not json");
    store.write("voice-room:ABCD", "[1,2");
    const prefs = voicePrefs(store);
    expect(prefs.get()).toEqual(DEFAULT_VOICE_PREFS);
    expect(prefs.room("ABCD")).toEqual({ on: false, mic: "on", volumes: {}, blocked: [] });
    store.write("voice", JSON.stringify({ mode: "loud", echoCancellation: "yes", micDeviceId: 3, relayOnly: true }));
    store.write("voice-room:ABCD", JSON.stringify({ on: "yes", mic: "loud", volumes: { a: "x", b: 0.5 }, blocked: ["c", 4] }));
    expect(prefs.get()).toEqual({ ...DEFAULT_VOICE_PREFS, relayOnly: true });
    expect(prefs.room("ABCD")).toEqual({ on: false, mic: "on", volumes: { b: 0.5 }, blocked: ["c"] });
  });

  it("saved prefs without duck read as on", () => {
    const store = memoryStore();
    store.write("voice", JSON.stringify({ mode: "ptt", relayOnly: true }));
    expect(voicePrefs(store).get()).toEqual({ ...DEFAULT_VOICE_PREFS, mode: "ptt", relayOnly: true, duck: true });
    store.write("voice", JSON.stringify({ duck: "no" }));
    expect(voicePrefs(store).get().duck).toBe(true);
    expect(voicePrefs(store).set({ duck: false }).duck).toBe(false);
    expect(voicePrefs(store).get().duck).toBe(false);
  });

  it("set merges and saves", () => {
    const store = memoryStore();
    const prefs = voicePrefs(store);
    expect(prefs.set({ mode: "ptt" })).toEqual({ ...DEFAULT_VOICE_PREFS, mode: "ptt" });
    expect(prefs.set({ micDeviceId: "m1" })).toEqual({ ...DEFAULT_VOICE_PREFS, mode: "ptt", micDeviceId: "m1" });
    expect(JSON.parse(store.map.get("voice")!)).toMatchObject({ mode: "ptt", micDeviceId: "m1" });
    expect(voicePrefs(store).get().mode).toBe("ptt");
  });

  it("keeps room settings per code", () => {
    const store = memoryStore();
    const prefs = voicePrefs(store);
    prefs.setRoom("ABCD", { on: true, mic: "muted", volumes: { p1: 0.5 } });
    prefs.setRoom("WXYZ", { blocked: ["p2"], mic: "off" });
    expect(prefs.room("ABCD")).toEqual({ on: true, mic: "muted", volumes: { p1: 0.5 }, blocked: [] });
    expect(prefs.room("WXYZ")).toEqual({ on: false, mic: "off", volumes: {}, blocked: ["p2"] });
    expect(prefs.setRoom("ABCD", { on: false })).toEqual({ on: false, mic: "muted", volumes: { p1: 0.5 }, blocked: [] });
    expect(store.map.has("voice-room:ABCD")).toBe(true);
  });

  it("keeps only the 10 most recently written rooms", () => {
    const store = memoryStore();
    const prefs = voicePrefs(store);
    for (let i = 0; i < 12; i++) prefs.setRoom(`R${i}`, { on: true });
    // R0 is written again, so it is the newest now; R1 and R2 are the oldest.
    prefs.setRoom("R0", { on: true });
    expect(store.map.has("voice-room:R0")).toBe(true);
    expect(store.map.has("voice-room:R1")).toBe(false);
    expect(store.map.has("voice-room:R2")).toBe(false);
    expect(store.map.has("voice-room:R3")).toBe(true);
    expect([...store.map.keys()].filter((k) => k.startsWith("voice-room:"))).toHaveLength(10);
    expect(prefs.room("R1").on).toBe(false);
    expect(JSON.parse(store.map.get("voice-rooms")!)).toHaveLength(10);
  });
});
