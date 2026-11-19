import { describe, expect, it } from "vitest";
import { signalLevel, signalText } from "../src/signal.ts";

describe("ping meter", () => {
  it("grades the round trip", () => {
    expect(signalLevel(null)).toBe("none");
    expect(signalLevel(40)).toBe("good");
    expect(signalLevel(149)).toBe("good");
    expect(signalLevel(150)).toBe("ok");
    expect(signalLevel(299)).toBe("ok");
    expect(signalLevel(300)).toBe("slow");
  });

  it("says it in words", () => {
    expect(signalText(84.4)).toBe("Connection: Good (84 ms)");
    expect(signalText(null)).toBe("Connection: not connected yet");
  });
});
