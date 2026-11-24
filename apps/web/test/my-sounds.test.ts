import { describe, expect, it } from "vitest";
import type { Library } from "../src/sounds/library.ts";
import { MY_SOUNDS_COPY, mySoundsModel, startLabel, writeLanded } from "../src/views/my-sounds-model.ts";

const slot2 = { id: "2", name: "Horn", ms: 2400, url: "/api/sounds/2?v=0123456789" };
const lib = (active: boolean): Library => ({ active, slots: [slot2] });

describe("the My sounds model", () => {
  it("six rows, add on empty ones", () => {
    const { rows, notes } = mySoundsModel(lib(true));
    expect(rows.map((r) => r.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(rows[1]).toEqual({ id: "2", name: "Horn", seconds: "2.4 s", actions: ["play", "rename", "replace", "remove"] });
    for (const r of rows.filter((r) => r.id !== "2")) {
      expect(r).toEqual({ id: r.id, name: null, seconds: null, actions: ["add"] });
    }
    expect(notes).toEqual([]);
  });

  it("a lapsed library: no add or replace, two lines", () => {
    const { rows, notes } = mySoundsModel(lib(false));
    expect(rows[1]!.actions).toEqual(["play", "rename", "remove"]);
    for (const r of rows.filter((r) => r.id !== "2")) expect(r.actions).toEqual([]);
    expect(notes).toEqual(["Get Host Pass to use these in your rooms.", "Get Host Pass to add sounds."]);
    expect(mySoundsModel(lib(true)).notes).toEqual([]);
  });

  it("shows a short sound with one decimal", () => {
    const { rows } = mySoundsModel({ active: true, slots: [{ ...slot2, id: "6", ms: 350 }] });
    expect(rows[5]!.seconds).toBe("0.4 s");
  });

  it("startLabel", () => {
    expect(startLabel(1.26)).toBe("Starts at 1.3 seconds");
    expect(startLabel(0)).toBe("Starts at 0.0 seconds");
  });

  it("the copy is plain", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const [key, text] of Object.entries(MY_SOUNDS_COPY)) {
      expect(emoji.test(text), key).toBe(false);
      expect(text.length, key).toBeLessThanOrEqual(80);
    }
  });

  it("writeLanded: reads a fresh list after an unclear answer", () => {
    const before = lib(true);
    const newer = { active: true, slots: [{ ...slot2, url: "/api/sounds/2?v=aaaaaaaaaa" }] };
    const renamed = { active: true, slots: [{ ...slot2, name: "Bell" }] };
    const empty = { active: true, slots: [] };
    expect(writeLanded({ kind: "save", slot: "2", name: "Horn" }, before, newer)).toBe(true);
    expect(writeLanded({ kind: "save", slot: "2", name: "Horn" }, before, before)).toBe(false);
    expect(writeLanded({ kind: "save", slot: "1", name: "Horn" }, before, before)).toBe(false);
    expect(writeLanded({ kind: "rename", slot: "2", name: "Bell" }, before, renamed)).toBe(true);
    expect(writeLanded({ kind: "rename", slot: "2", name: "Bell" }, before, before)).toBe(false);
    expect(writeLanded({ kind: "remove", slot: "2" }, before, empty)).toBe(true);
    expect(writeLanded({ kind: "remove", slot: "2" }, before, before)).toBe(false);
  });
});
