import { describe, expect, it } from "vitest";

// Every file under client/scene/, as text.
const FILES = import.meta.glob<string>("../client/scene/**/*.ts", { query: "?raw", import: "default", eager: true });

describe("scene secrecy", () => {
  it("the scene never reads private state", () => {
    const entries = Object.entries(FILES);
    expect(entries.length).toBeGreaterThan(10);
    for (const [path, text] of entries)
      for (const bad of ["PrivateState", ".private", "info.ts"]) expect(text.includes(bad), `${path} has ${bad}`).toBe(false);
  });
});
