import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostKeyFor, saveHostKey } from "../src/host-keys.ts";

const HOUR = 3_600_000;
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("host keys", () => {
  it("returns a saved key", () => {
    saveHostKey("ABCD", "k1");
    expect(hostKeyFor("ABCD")).toBe("k1");
    expect(hostKeyFor("WXYZ")).toBeNull();
  });

  it("drops keys older than 6 hours", () => {
    saveHostKey("ABCD", "k1");
    vi.advanceTimersByTime(5 * HOUR);
    expect(hostKeyFor("ABCD")).toBe("k1");
    vi.advanceTimersByTime(2 * HOUR);
    expect(hostKeyFor("ABCD")).toBeNull();
  });

  it("keeps other rooms when one is saved later", () => {
    saveHostKey("AAAA", "a");
    vi.advanceTimersByTime(HOUR);
    saveHostKey("BBBB", "b");
    expect(hostKeyFor("AAAA")).toBe("a");
    expect(hostKeyFor("BBBB")).toBe("b");
  });

  it("returns null on corrupt JSON without throwing", () => {
    store.set("cp-host-keys", "{not json");
    expect(hostKeyFor("ABCD")).toBeNull();
    store.set("cp-host-keys", "[1,2]");
    expect(hostKeyFor("ABCD")).toBeNull();
    expect(() => saveHostKey("ABCD", "k")).not.toThrow();
    expect(hostKeyFor("ABCD")).toBe("k");
  });
});
