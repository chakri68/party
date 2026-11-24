import { describe, expect, it } from "vitest";
import { blindRallySettingFields } from "../shared/rules-text.ts";

describe("Blind Rally: the Nightmare warning", () => {
  const assists = (preset: string) => blindRallySettingFields({ assists: preset }, 4).find((f) => f.key === "assists")!;

  it("warns on Nightmare", () => {
    const f = assists("nightmare");
    expect(f.warn).toBe(true);
    expect(f.hint).toBe("Very hard. All assists are off.");
  });

  it("says nothing on the other presets", () => {
    for (const p of ["beginner", "classic", "custom"]) expect(assists(p).warn).toBeFalsy();
  });
});
